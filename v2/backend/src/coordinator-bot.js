'use strict';
const crypto=require('crypto');
const coordinator=require('./menu-coordinator');
const db=require('./db');
const config=require('./config');

const token=()=>String(process.env.COORDINATOR_BOT_TOKEN||'').trim();
const webhookSecret=()=>String(process.env.COORDINATOR_WEBHOOK_SECRET||'').trim();
const coffeeBase=()=>String(process.env.COORDINATOR_COFFEE_URL||'https://kofeyok.vercel.app').replace(/\/+$/,'');
const coffeeSecret=()=>String(process.env.COORDINATOR_COFFEE_SECRET||'').trim();
const norm=x=>String(x||'').trim().toLowerCase().replace(/ё/g,'е');
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const HELP='📒 КООРДИНАТОР · МЕНЮ\n\n1. Подключите заведение: /connect ВАШ_СЕКРЕТНЫЙ_КЛЮЧ\n2. Управляйте меню: 7777 стоп лист\n3. Верните в продажу: 7777 в наличии\n4. Новая цена: 7777 цена 350\n5. Скрыть: 7777 скрыть\n6. Название: 7777 название Новый напиток\n7. Состав: 7777 состав КОД_ИНГРЕДИЕНТА 120\n\n/статус — активные подключения\n/помощь — справка\nЕсли подключены оба проекта, добавьте перед кодом «шаурмег» или «кофеёк».';
function equal(a,b){const aa=Buffer.from(a),bb=Buffer.from(b);return aa.length===bb.length&&crypto.timingSafeEqual(aa,bb);}
async function telegram(method,body){
  if(!token())throw fail('COORDINATOR_BOT_TOKEN missing',503);
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),10000);
  try{
    const r=await fetch('https://api.telegram.org/bot'+token()+'/'+method,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),signal:controller.signal});
    const data=await r.json();
    if(!r.ok||!data.ok)throw fail('Telegram '+method+': '+String(data.description||r.status),502);
    return data.result;
  }finally{clearTimeout(timeout);}
}
async function reply(chatId,text){
  return telegram('sendMessage',{chat_id:chatId,text:String(text).slice(0,3800),disable_web_page_preview:true});
}
async function coffee(action,telegramId,payload={}){
  const secret=coffeeSecret();
  if(secret.length<32)throw fail('Соединение с «Кофейком» пока не настроено.',503);
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),8000);
  try{
    const r=await fetch(coffeeBase()+'/api/admin?action=coordinator.'+encodeURIComponent(action),{
      method:'POST',headers:{'content-type':'application/json','x-coordinator-secret':secret},
      body:JSON.stringify({telegramId,...payload}),signal:controller.signal
    });
    const data=await r.json();
    if(!r.ok||data.ok===false)throw fail(String(data.message||data.error||'Ошибка кофейни'),r.status);
    return data;
  }finally{clearTimeout(timeout);}
}
async function coffeeResolve(telegramId){
  const secret=coffeeSecret();
  if(secret.length<32)return {ok:true,linked:false,project:'kofeyok'};
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),8000);
  try{
    const r=await fetch(coffeeBase()+'/api/admin?action=coordinator.resolve&telegramId=+encodeURIComponent(telegramId),{headers:{'x-coordinator-secret':secret},signal:controller.signal});
    const data=await r.json();
    if(!r.ok||!data.ok)throw fail('Связь с Кофейком недоступна.',503);
    return data;
  }finally{clearTimeout(timeout);}
}
async function locations(uid){
  const [sha,cof]=await Promise.all([
    coordinator.binding(uid).then(x=>({project:'shaurmeg',linked:!!x,venue:x?.name||''})),
    coffeeResolve(uid).catch(e=>({project:'kofeyok',linked:false,unavailable:e.message}))
  ]);
  return [sha,cof];
}
async function handle(message){
  const chatId=message?.chat?.id,uid=message?.from?.id;
  if(!chatId||!uid||String(message.chat.type)!=='private')return;
  const text=String(message.text||'').trim();
  if(!text)return reply(chatId,'Пока доступны текстовые команды. Наберите /помощь.');
  if(/^\/(?:start|help|помощь)(?:@\S+)?$/i.test(text))return reply(chatId,HELP);
  const connect=text.match(/^\/(?:connect|подключить)(?:@\S+)?\s+(\S+)$/i)||text.match(/^((?:SHA|KOF)-MNU-[A-F0-9]{16})$/i);
  if(connect){
    const code=connect[1].toUpperCase(),response=code.startsWith('SHA-')?await coordinator.claim(uid,code):await coffee('claim',uid,{key:code});
    return reply(chatId,'🔐 '+(response.venue||'Заведение')+' подключено в '+(response.project==='shaurmeg'?'Шаурмеге':'Кофейке')+'. Для команд используйте короткие коды из настройки «Идентификаторы блюд».');
  }
  if(/^\/(?:status|статус)(?:@\S+)?$/i.test(text)){
    const rows=await locations(uid);
    return reply(chatId,'🔒 Подключения:\n'+rows.map(x=>(x.project==='shaurmeg'?'Шаурмег':'Кофеёк')+': '+(x.unavailable?'⚠️ сервис временно недоступен':x.linked?'✅ '+x.venue:'не подключён')).join('\n'));
  }
  let project=null,command=text;
  const prefix=command.match(/^(шаурмег|shaurmeg|шаурма|кофеек|кофеёк|kofeyok)\s+(.+)$/is);
  if(prefix){project=/^(кофе|kofeyok)/i.test(norm(prefix[1]))?'kofeyok':'shaurmeg';command=prefix[2].trim();}
  if(!project){
    const current=await locations(uid);
    if(current.some(x=>x.unavailable))return reply(chatId,'⚠️ Сейчас не удалось проверить все привязки. Для безопасности укажите проект перед командой: «шаурмег 7777 стоп лист» или «кофеёк 7777 стоп лист».');
    const active=current.filter(x=>x.linked);
    if(active.length!==1)return reply(chatId,active.length?'Подключены два проекта. Добавьте «Шаурмег» или «Кофеёк» перед кодом.':'Нет однозначного подключения. /connect СЕКРЕТНЫЙ_КЛЮЧ\n'+HELP);
    project=active[0].project;
  }
  const result=project==='shaurmeg'?await coordinator.execute(uid,command):await coffee('execute',uid,{text:command});
  return reply(chatId,result.text||'✅ Изменение сохранено.');
}
async function prepareUpdate(updateId){
  // Insert-before-execute protects menu actions from Telegram retry duplication.
  const res=await db.query("INSERT INTO shaurma_coordinator_updates(update_id,received_at) VALUES($1,now()) ON CONFLICT DO NOTHING RETURNING update_id",[updateId]);
  return res.rowCount>0;
}
async function processUpdate(update){
  const id=Number(update?.update_id);
  if(!Number.isSafeInteger(id))return;
  if(!(await prepareUpdate(id)))return;
  const message=update.message;
  try{await handle(message);}
  catch(e){
    console.error('coordinator_message_failed',String(e.message||'unknown').slice(0,200));
    if(message?.chat?.id)try{await reply(message.chat.id,'⚠️ '+String(e.message||'Ошибка команды').slice(0,500));}catch(err){console.error('coordinator_reply_failed',err.message)}
  }
}
function install(app){
  app.post('/api/v2/telegram/coordinator',async(req,res)=>{
    if(token().length<30||webhookSecret().length<20)return res.sendStatus(503);
    const provided=String(req.get('x-telegram-bot-api-secret-token')||'');
    if(!equal(provided,webhookSecret()))return res.sendStatus(401);
    try{await processUpdate(req.body||{});res.sendStatus(200);}
    catch(e){console.error('coordinator_update_failed',e.message);res.sendStatus(500);}
  });
  app.get('/api/v2/telegram/coordinator-health',(req,res)=>res.json({enabled:!!token(),webhookSecured:webhookSecret().length>=20,coffeeLinked:coffeeSecret().length>=32}));
}
async function sync(){
  await db.query('CREATE TABLE IF NOT EXISTS shaurma_coordinator_updates(update_id bigint PRIMARY KEY,received_at timestamptz NOT NULL DEFAULT now())');
  if(!token())return {enabled:false};
  if(token().length<30||webhookSecret().length<20)throw fail('Set COORDINATOR_BOT_TOKEN and a random COORDINATOR_WEBHOOK_SECRET (20+ chars)',503);
  await telegram('setMyCommands',{commands:[
    {command:'start',description:'Инструкция и подключение'},
    {command:'connect',description:'Подключить заведение по ключу'},
    {command:'status',description:'Показать привязанные заведения'},
    {command:'help',description:'Команды меню'}]});
  await telegram('setWebhook',{url:config.PUBLIC_API_URL+'/api/v2/telegram/coordinator',secret_token:webhookSecret(),allowed_updates:['message']});
  return {enabled:true};
}
module.exports={install,sync,handle};
