'use strict';
// YooKassa card vault: card numbers are NEVER accepted or stored by Shaurmeg.
// Configure shop ID and secret only on the server. One merchant-of-record is
// assumed; do not enable for multiple independently settled merchants without
// legal/settlement agreements.
const crypto=require('crypto');
const SHOP_ID=String(process.env.SHAURMEG_YOOKASSA_SHOP_ID||'').trim();
const SECRET=String(process.env.SHAURMEG_YOOKASSA_SECRET_KEY||'').trim();
const API='https://api.yookassa.ru/v3';
const enabled=()=>!!(SHOP_ID&&SECRET);
const uuid=v=>/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(String(v||''));
const formatRub=v=>Number(v).toFixed(2);
const cardSummary=v=>({brand:String(v?.card?.card_type||'bank_card').slice(0,35),last4:String(v?.card?.last4||'').replace(/\D/g,'').slice(-4)});
async function request(method,path,body=null,idempotenceKey=null,transport=fetch){
 if(!enabled())throw Object.assign(new Error('yookassa_not_configured'),{status:503});
 if(!/^\/(?:payments|payment_methods)(?:\/[a-f0-9-]{36})?$/i.test(path))throw new Error('invalid_yookassa_path');
 const auth=Buffer.from(SHOP_ID+':'+SECRET).toString('base64');
 const headers={Authorization:'Basic '+auth,'Content-Type':'application/json'};
 if(idempotenceKey){
  if(!uuid(idempotenceKey))throw new Error('invalid_idempotence_key');
  headers['Idempotence-Key']=idempotenceKey;
 }
 const result=await transport(API+path,{method,headers,...(body?{body:JSON.stringify(body)}:{})});
 const parsed=await result.json().catch(()=>({}));
 if(!result.ok){
  const e=new Error('yookassa_http_'+result.status);
  e.status=result.status>=500?502:400;
  e.gatewayStatus=result.status;e.gatewayCode=parsed.code;e.gatewayType=parsed.type;
  throw e;
 }
 return parsed;
}
function createBinding(id,userId,returnUrl){
 if(!uuid(id))throw new Error('bad_binding_id');
 const url=new URL(returnUrl);
 if(url.protocol!=='https:')throw new Error('bad_return_url');
 return request('POST','/payment_methods',{
  type:'bank_card',confirmation:{type:'redirect',return_url:url.toString()},
  metadata:{binding_id:id,telegram_user_id:String(userId)}
 },id);
}
const getBinding=id=>uuid(id)?request('GET','/payment_methods/'+id):Promise.reject(new Error('bad_binding_id'));
function createCharge({id,userId,amount,methodId,description}){
 if(!uuid(id)||!uuid(methodId))throw new Error('invalid_yookassa_payment');
 if(!Number.isInteger(amount)||amount<=0||amount>100000)throw new Error('invalid_yookassa_amount');
 return request('POST','/payments',{
  amount:{value:formatRub(amount),currency:'RUB'},capture:true,
  payment_method_id:methodId,
  description:String(description||'Shaurmeg').slice(0,128),
  metadata:{quick_order_id:id,telegram_user_id:String(userId)}
 },id);
}
const getCharge=id=>uuid(id)?request('GET','/payments/'+id):Promise.reject(new Error('bad_payment_id'));
function validatedCharge(received,{intentId,userId,total,paymentId=null}){
 if(!received||received.id===undefined||!uuid(received.id)||paymentId&&received.id!==paymentId)return false;
 const expected=Number(total);
 return received.status==='succeeded'&&received.paid===true&&
  received.amount?.currency==='RUB'&&Number(received.amount?.value)===expected&&
  received.metadata?.quick_order_id===intentId&&received.metadata?.telegram_user_id===String(userId);
}
module.exports={enabled,request,createBinding,getBinding,createCharge,getCharge,validatedCharge,cardSummary,uuid};
