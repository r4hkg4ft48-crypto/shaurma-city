'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const crypto=require('node:crypto');
const source=fs.readFileSync(path.join(__dirname,'../src/coordinator-bot.js'),'utf8');
const miniApp=fs.readFileSync(path.join(__dirname,'../../frontend/coordinator-console.html'),'utf8');

test('Coordinator has no other-project bridge or selector',()=>{
  assert.doesNotMatch(source,/COORDINATOR_COFFEE|coffeeBase|coffeeResolve|kofeyok|\/api\/admin\?action=coordinator/i);
  assert.doesNotMatch(miniApp,/kofeyok|Кофеёк|<select id="project"/i);
  assert.match(miniApp,/id="connectKey"/);
  assert.match(source,/shaLanguage\.resolve/);
  assert.match(source,/if\(row\.project!=='shaurmeg'\)/);
});

test('Telegram and signed Mini App accept only Shaurmeg one-time venue keys',async()=>{
  const token='123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890';
  const authDate=String(Math.floor(Date.now()/1000));
  const uid='1234567',issued=[],sent=[],executed=[],queries=[];
  let binding=null;
  const coordinator={
    async binding(id){assert.equal(String(id),uid);return binding;},
    async claim(id,key){
      assert.equal(String(id),uid);
      assert.match(key,/^SHA-MNU-[A-F0-9]{16}$/);
      issued.push(key);
      binding={name:'Тестовое заведение',establishment_id:'test_venue'};
      return {project:'shaurmeg',venue:binding.name};
    },
    async ensureCodes(est){
      assert.equal(est,'test_venue');
      return [{kind:'item',id:'test_dish',code:'P123ABC',name:'Сырная шаурма'}];
    },
    async execute(id,command){executed.push([id,command]);return{text:'ok'};}
  };
  const routes=new Map();
  const app={
    post(path,...handlers){routes.set(path,handlers.at(-1));},
    get(path,handler){routes.set(path,handler);}
  };
  const express={raw:()=>((_req,_res,next)=>next?.())};
  const fakeFetch=async(url,options)=>{
    assert.match(url,/^https:\/\/api\.telegram\.org\/bot/);
    if(url.includes('/sendMessage'))sent.push(JSON.parse(options.body));
    return {ok:true,status:200,async json(){return {ok:true,result:{}};}};
  };
  const deps={
    crypto,express,
    './coordinator-language':require('../src/coordinator-language'),
    './coordinator-shaurmeg-language':require('../src/coordinator-shaurmeg-language'),
    '../../../backend/telegram-rich':{withRich(_m,_b,fn){return fn(_m,_b);}},
    './menu-coordinator':coordinator,
    './db':{async query(sql){queries.push(sql);return {rows:[{id:'00000000-0000-4000-8000-000000000000',project:'other'}],rowCount:1};}},
    './config':{PUBLIC_API_URL:'https://example.invalid'}
  };
  const ctx={
    module:{exports:{}},exports:{},Buffer,console,AbortController,FormData,Blob,
    URLSearchParams,setTimeout,clearTimeout,fetch:fakeFetch,
    process:{env:{COORDINATOR_BOT_TOKEN:token,COORDINATOR_WEBHOOK_SECRET:'a'.repeat(24)}},
    require(name){if(!(name in deps))throw new Error('unexpected dependency '+name);return deps[name]}
  };
  vm.runInNewContext(source,ctx,{filename:'coordinator-bot.js'});
  const bot=ctx.module.exports;
  const message=(text)=>({chat:{id:1234567,type:'private'},from:{id:1234567},text});
  await bot.handle(message('/connect XYZ-MNU-0000000000000000'));
  assert.equal(issued.length,0,'A different-project key must never be routed to a bridge');
  assert.match(sent.at(-1).text,/одноразовый ключ своего заведения «Шаурмега»/);
  await bot.handle(message('/connect SHA-MNU-0123456789ABCDEF'));
  assert.equal(issued.length,1);
  assert.match(sent.at(-1).text,/подключено к «Шаурмегу»/);
  await bot.handle(message('/status'));
  assert.match(sent.at(-1).text,/Тестовое заведение/);
  await bot.handle(message('/menu шаурма'));
  assert.match(sent.at(-1).text,/P123ABC/);
  
  bot.install(app);
  const dataCheck='auth_date='+authDate+'\nuser='+JSON.stringify({id:Number(uid)});
  const secret=crypto.createHmac('sha256','WebAppData').update(token).digest();
  const hash=crypto.createHmac('sha256',secret).update(dataCheck).digest('hex');
  const initData=new URLSearchParams({auth_date:authDate,user:JSON.stringify({id:Number(uid)}),hash}).toString();
  async function run(body){
    const res={
      statusCode:200,body:null,setHeader(){},status(n){this.statusCode=n;return this;},
      json(value){this.body=value;return this;},sendStatus(n){this.statusCode=n;return this}
    };
    await routes.get('/api/v2/coordinator-app')({body:{initData,...body}},res);
    return res;
  }
  const status=await run({action:'status'});
  assert.equal(status.statusCode,200);
  assert.equal(status.body.locations.length,1);
  assert.equal(status.body.locations[0].project,'shaurmeg');
  const cross=await run({action:'catalog',project:'other'});
  assert.equal(cross.statusCode,400);
  const connected=await run({action:'connect',key:'SHA-MNU-ABCDEF0123456789'});
  assert.equal(connected.statusCode,200);
  assert.equal(issued.length,2);
  const reject=await run({action:'connect',key:'XYZ-MNU-0123456789ABCDEF'});
  assert.equal(reject.statusCode,400);
  assert.equal(issued.length,2);
  const foreign=await run({action:'confirm',pendingId:'00000000-0000-4000-8000-000000000000'});
  assert.equal(foreign.statusCode,403);
  assert.equal(executed.length,0,'Old pending records from another project cannot execute');
  const h=routes.get('/api/v2/telegram/coordinator-health')(null,{json(x){return x}});
  assert.equal(h.project,'shaurmeg');
  assert.equal('coffeeLinked' in h,false);
});
