'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const db=require('../src/db');
const telegram=require('../src/telegram');
const quick=require('../src/quick-order-bot');
const ID='12345678-1234-1234-1234-1234567890ab';
const EST='SC-MSK-1234567890';
function mockHarness({price=320,available=true,duplicate=false,sendKitchen=1,staleFavorite=false}={}){
 const original={tx:db.tx,query:db.query,notifyKitchenOrder:telegram.notifyKitchenOrder};
 const log={queries:[],api:[],orders:[],notified:0};
 const intent={id:ID,telegram_user_id:'7891234',establishment_id:EST,venue_id:'lepyoshka',marker_id:5,
  item_id:'flat_cheese',state:'draft',quantity:1,total:320,
  expires_at:new Date(Date.now()+600000),items:[{id:'flat_cheese',n:'Лепёшка с сыром',q:1,p:320}]};
 const venue={establishment_id:EST,venue_id:'lepyoshka',name:'В Лепёшке',marker_id:5,
  config:{menu_sections:[{id:'flatbread',name:'Лепёшки',active:true}]},
  menu:[{id:'flat_cheese',n:'Лепёшка с сыром',c:'flatbread',p:price,active:true,available,stock:null}]};
 const user={first_name:'Пётр',username:'petr',favorites:staleFavorite?[]:[{establishment_id:EST,item_id:'flat_cheese'}]};
 const query=async(sql,params)=>{
  log.queries.push({sql,params});
  if(sql.includes('SELECT * FROM shaurma_quick_order_intents WHERE id='))return {rows:[intent]};
  if(sql.includes('pg_advisory_xact_lock'))return {rows:[]};
  if(sql.includes("AND state='completed' AND created_at"))return {rows:duplicate?[{id:'previous'}]:[]};
  if(sql.includes('SELECT favorites,first_name,username'))return {rows:[user]};
  if(sql.includes('SELECT v.venue_id,v.establishment_id,v.name,v.menu'))return {rows:[venue]};
  if(sql.includes('INSERT INTO shaurma_orders')){
   const row={id:42,order_number:params[0],items:JSON.parse(params[1]),total:params[2],customer_name:params[3],telegram_user_id:params[4],telegram_username:params[5],telegram_first_name:params[6],
    venue_id:params[7],venue_name:params[8],establishment_id:params[9],marker_id:params[10],status:'new',source:'telegram-quick-order',payment_status:'pending',payment_method:'on_receipt',fulfillment_type:'cafe'};
   log.orders.push(row);return {rows:[row]};
  }
  return {rows:[]};
 };
 db.tx=async callback=>callback({query});
 db.query=query;
 telegram.notifyKitchenOrder=async()=>{log.notified++;return {sent:sendKitchen}};
 return {log,api:async(method,body)=>{log.api.push({method,body});return {message_id:12}},
  restore:()=>{db.tx=original.tx;db.query=original.query;telegram.notifyKitchenOrder=original.notifyKitchenOrder}};
}
test('creates a real unpaid pickup order from the exact saved favorite and notifies the kitchen',async()=>{
 assert.equal(quick.QUICK_PAYMENT_MODE,'on_receipt');
 const m=mockHarness();
 try{
  const out=await quick.placeUnpaidOrder(ID,'7891234',m.api);
  assert.equal(out.order.id,42);
  assert.equal(m.log.orders.length,1);
  assert.equal(m.log.orders[0].total,320);
  assert.equal(m.log.orders[0].payment_status,'pending');
  assert.equal(m.log.orders[0].payment_method,'on_receipt');
  assert.equal(m.log.orders[0].establishment_id,EST);
  assert.equal(m.log.orders[0].marker_id,5);
  assert.equal(m.log.notified,1);
  assert.match(m.log.api[0].body.text,/Передан на кухню/);
  assert.match(m.log.api[0].body.text,/при получении/);
  assert.equal(m.log.queries.some(q=>q.sql.includes('sendInvoice')),false);
 }finally{m.restore()}
});
test('refuses payment and kitchen order if venue price changed',async()=>{
 const m=mockHarness({price:350});
 try{
  const out=await quick.placeUnpaidOrder(ID,'7891234',m.api);
  assert.equal(out.stale,true);
  assert.equal(m.log.orders.length,0);
  assert.equal(m.log.notified,0);
  assert.match(m.log.api[0].body.text,/Заказ не создан/);
 }finally{m.restore()}
});
test('refuses a favorite that was removed before checkout',async()=>{
 const m=mockHarness({staleFavorite:true});
 try{
  const out=await quick.placeUnpaidOrder(ID,'7891234',m.api);
  assert.equal(out.stale,true);assert.equal(m.log.orders.length,0);
 }finally{m.restore()}
});
test('suppresses duplicate order even when two intents are independently selected',async()=>{
 const m=mockHarness({duplicate:true});
 try{
  const out=await quick.placeUnpaidOrder(ID,'7891234',m.api);
  assert.equal(out.duplicate,true);
  assert.equal(m.log.orders.length,0);
 }finally{m.restore()}
});
test('flags missing kitchen confirmation and preserves the order for retry',async()=>{
 const m=mockHarness({sendKitchen:0});
 try{
  const out=await quick.placeUnpaidOrder(ID,'7891234',m.api);
  assert.equal(out.delivered,0);
  assert.equal(m.log.orders.length,1);
  assert.match(m.log.api[0].body.text,/ещё не подтверждена/);
  assert.equal(m.log.queries.some(q=>q.sql.includes('kitchen_confirmed_at=NOW()')),false);
 }finally{m.restore()}
});
