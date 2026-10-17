'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
process.env.SHAURMEG_YOOKASSA_SHOP_ID='test-shop';
process.env.SHAURMEG_YOOKASSA_SECRET_KEY='test-secret';
const ps=require('../src/yookassa');
const INTENT='12345678-1234-1234-1234-1234567890ab';
const PAYMENT='12345678-1234-1234-1234-1234567890ac';
test('payment can only be accepted with exact merchant-verified identity, amount and status',()=>{
 const body={id:PAYMENT,status:'succeeded',paid:true,amount:{value:'330.00',currency:'RUB'},
  metadata:{quick_order_id:INTENT,telegram_user_id:'777'}};
 const context={intentId:INTENT,userId:'777',total:330,paymentId:PAYMENT};
 assert.equal(ps.validatedCharge(body,context),true);
 for(const corrupted of [
  {...body,status:'pending'}, {...body,paid:false},
  {...body,amount:{value:'331.00',currency:'RUB'}},
  {...body,amount:{value:'330.00',currency:'USD'}},
  {...body,metadata:{...body.metadata,telegram_user_id:'888'}},
  {...body,metadata:{...body.metadata,quick_order_id:PAYMENT}},
  {...body,id:INTENT}
 ])assert.equal(ps.validatedCharge(corrupted,context),false);
});
test('PSP API uses basic auth, idempotency and never sends card numbers',async()=>{
 let sent=null;
 const transport=async(url,init)=>{
  sent={url,init};
  return {ok:true,status:200,json:async()=>({id:PAYMENT,status:'pending'})};
 };
 await ps.request('POST','/payments',{capture:true},INTENT,transport);
 assert.equal(sent.url,'https://api.yookassa.ru/v3/payments');
 assert.equal(sent.init.headers['Idempotence-Key'],INTENT);
 assert.equal(sent.init.headers.Authorization,'Basic '+Buffer.from('test-shop:test-secret').toString('base64'));
 assert.equal(sent.init.body,'{"capture":true}');
});
test('PSP rejects unexpected paths or non-idempotent identifiers',async()=>{
 await assert.rejects(ps.request('POST','https://evil.com',{x:1},INTENT),/invalid_yookassa_path/);
 await assert.rejects(ps.request('POST','/payments',{x:1},'untrusted'),/invalid_idempotence_key/);
});
