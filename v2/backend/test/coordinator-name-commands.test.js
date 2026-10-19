'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const sha=require('../src/coordinator-shaurmeg-language');
const dialogue=require('../src/coordinator-dialogue');

const catalog=[
 {kind:'item',id:'cheese',code:'P101',name:'Сырная шаурма',spokenName:'сырная',identifier:'сырная'},
 {kind:'item',id:'classic',code:'P102',name:'Классическая шаурма',identifier:'Классическая шаурма'},
 {kind:'ingredient',id:JSON.stringify(['cheese','ingredient','сыр']),code:'I101',name:'Сырная шаурма · Сыр',spokenName:'сыр-для-сырной',identifier:'сыр-для-сырной'}
];
test('Full Russian menu name works in old "name + action" command format',()=>{
 const a=sha.resolve('Сырная шаурма стоп лист',catalog);
 assert.equal(a.type,'proposal');
 assert.equal(a.item.id,'cheese');assert.equal(a.command,'стоп лист');
 const b=sha.resolve('Классическая шаурма в наличии',catalog);
 assert.equal(b.type,'proposal');assert.equal(b.item.code,'P102');
});
test('Custom spoken name works before price, availability, nickname and composition actions',()=>{
 for(const [cmd,operation] of [
  ['сырная стоп лист','стоп лист'],['сырная цена 350','цена 350'],
  ['сырная в наличии','в наличии'],['сырная идентификатор любимая','идентификатор любимая'],
  ['Сырная шаурма состав + халапеньо','состав + халапеньо']
 ]){
  const a=dialogue.step(cmd,catalog);
  assert.equal(a.type,'proposal',cmd);
  assert.equal(a.item.id,'cheese',cmd);assert.equal(a.command,operation,cmd);
 }
});
test('A bare real name safely selects dish, later "убери" refers to it',()=>{
 const selected=dialogue.step('Сырная шаурма',catalog);
 assert.equal(selected.type,'reply');
 assert.equal(selected.state.last.id,'cheese');
 const followup=dialogue.step('Убери',catalog,selected.state);
 assert.equal(followup.type,'proposal');
 assert.equal(followup.command,'стоп лист');
});
test('New named action supersedes pending disambiguation',()=>{
 const unclear=dialogue.step('Убери шаурму',catalog);
 assert.equal(unclear.type,'clarify');
 const exact=dialogue.step('Классическая шаурма стоп лист',catalog,unclear.state);
 assert.equal(exact.type,'proposal');
 assert.equal(exact.item.id,'classic');
});
test('Missing or duplicated names never allow unsafe writes',()=>{
 assert.notEqual(dialogue.step('Чужая шаурма стоп лист',catalog).type,'proposal');
 assert.notEqual(dialogue.step('чужая цена 300',catalog).type,'proposal');
 assert.notEqual(dialogue.step('сырная цена 99999999',catalog).type,'proposal');
 const duplicate=catalog.concat([{kind:'item',id:'another',code:'P999',name:'Сырная шаурма'}]);
 assert.notEqual(dialogue.step('Сырная шаурма стоп лист',duplicate).type,'proposal');
});

test('Signed Mini App previews named command, records canonical internal code, confirms once',async()=>{
 const source=fs.readFileSync(path.join(__dirname,'../src/coordinator-bot.js'),'utf8');
 const uid='1234567', token='123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890';
 const recorded=[],executed=[],pending=new Map(),routes=new Map();
 const coordinator={
  async binding(id){assert.equal(String(id),uid);return {name:'Тестовое заведение',establishment_id:'venue-test'};},
  async ensureCodes(id){assert.equal(id,'venue-test');return catalog;},
  async execute(id,command){executed.push({id:String(id),command});return {text:'✅ Готово'};}
 };
 const fakeDb={async query(sql,args=[]){
  if(sql.startsWith('SELECT state FROM shaurma_coordinator_dialogue'))return {rows:[],rowCount:0};
  if(sql.startsWith('INSERT INTO shaurma_coordinator_dialogue'))return {rows:[],rowCount:1};
  if(sql.startsWith('INSERT INTO shaurma_coordinator_pending')){
   const [id,actor,project,venue,kind,entity,code,command]=args;
   const row={id,telegram_id:actor,project,venue_id:venue,kind,entity_id:entity,code,command};
   pending.set(id,row);recorded.push(row);
   return {rows:[],rowCount:1};
  }
  if(sql.startsWith('UPDATE shaurma_coordinator_pending SET consumed_at=now()')){
   const row=pending.get(args[0]);
   if(!row||row.telegram_id!==args[1])return {rows:[],rowCount:0};
   pending.delete(args[0]);return {rows:[row],rowCount:1};
  }
  throw new Error('unexpected SQL: '+sql.slice(0,100));
 }};
 const deps={
  crypto,express:{raw:()=>()=>{}},
  './coordinator-language':require('../src/coordinator-language'),
  './coordinator-shaurmeg-language':sha,
  './coordinator-dialogue':dialogue,
  './menu-coordinator':coordinator,'./db':fakeDb,
  '../../../backend/telegram-rich':{withRich(_method,_body,fn){return fn(_method,_body);}},
  './config':{PUBLIC_API_URL:'https://example.invalid'}
 };
 const env={COORDINATOR_BOT_TOKEN:token,COORDINATOR_WEBHOOK_SECRET:'a'.repeat(24)};
 const ctx={module:{exports:{}},exports:{},Buffer,console,AbortController,FormData,Blob,URLSearchParams,
  setTimeout,clearTimeout,fetch:async()=>({ok:true,status:200,json:async()=>({ok:true,result:{}})}),
  process:{env},require(name){if(!(name in deps))throw Error('unexpected dependency '+name);return deps[name];}
 };
 vm.runInNewContext(source,ctx,{filename:'coordinator-bot.js'});
 const bot=ctx.module.exports;
 const app={post(name,...handlers){routes.set(name,handlers.at(-1));},get(){}};
 bot.install(app);
 const authDate=String(Math.floor(Date.now()/1000)), user=JSON.stringify({id:Number(uid)});
 const toSign='auth_date='+authDate+'\nuser='+user;
 const secret=crypto.createHmac('sha256','WebAppData').update(token).digest();
 const hash=crypto.createHmac('sha256',secret).update(toSign).digest('hex');
 const initData=new URLSearchParams({auth_date:authDate,user,hash}).toString();
 async function api(action,payload={}){
  const res={statusCode:200,body:null,setHeader(){},status(n){this.statusCode=n;return this;},json(j){this.body=j;return this;}};
  await routes.get('/api/v2/coordinator-app')({body:{initData,action,...payload}},res);
  return res;
 }
 const preview=await api('preview',{text:'Сырная шаурма стоп лист'});
 assert.equal(preview.statusCode,200);
 assert.equal(preview.body.type,'proposal');
 assert.equal(executed.length,0,'cannot write before explicit confirmation');
 assert.equal(recorded.length,1);
 assert.equal(recorded[0].code,'P101');
 assert.equal(recorded[0].entity_id,'cheese');
 assert.equal(recorded[0].command,'P101 стоп лист');
 const committed=await api('confirm',{pendingId:preview.body.id});
 assert.equal(committed.statusCode,200);
 assert.deepEqual(executed,[{id:uid,command:'P101 стоп лист'}]);
 const replay=await api('confirm',{pendingId:preview.body.id});
 assert.equal(replay.statusCode,409);
 assert.equal(executed.length,1);
 const unknown=await api('preview',{text:'Чужое блюдо стоп лист'});
 assert.notEqual(unknown.body.type,'proposal');
 assert.equal(executed.length,1);
});
