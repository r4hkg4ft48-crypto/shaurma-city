'use strict';
const crypto=require('crypto');
const express=require('express');
const language=require('./coordinator-language');
const rich=require('../../../backend/telegram-rich');
const coordinator=require('./menu-coordinator');
const db=require('./db');
const config=require('./config');

const token=()=>String(process.env.COORDINATOR_BOT_TOKEN||'').trim();
const webhookSecret=()=>String(process.env.COORDINATOR_WEBHOOK_SECRET||'').trim();
const coffeeBase=()=>String(process.env.COORDINATOR_COFFEE_URL||'https://kofeyok.vercel.app').replace(/\/+$/,'');
const coffeeSecret=()=>String(process.env.COORDINATOR_COFFEE_SECRET||'').trim();
const norm=x=>String(x||'').trim().toLowerCase().replace(/ё/g,'е');
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const HELP='📒 КООРДИНАТОР · МЕНЮ\n\n1. Подключите заведение: /connect ВАШ_СЕКРЕТНЫЙ_КЛЮЧ\n2. Управляйте меню: 7777 стоп лист\n3. Верните в продажу: 7777 в наличии\n4. Новая цена: 7777 цена 350\n5. Скрыть: 7777 скрыть\n6. Название: 7777 название Новый напиток\n7. Состав: 7777 состав КОД_ИНГРЕДИЕНТА 120\n8. Создать: создать позицию Название | 350 | КОД_КАТЕГОРИИ\n9. Создать ингредиент (Кофеёк): создать ингредиент Сироп | ml | 150\n10. Добавить вариант: КОД_ГРУППЫ добавить вариант Название | 25\n\n/статус — активные подключения\n/помощь — справка\nЕсли подключены оба проекта, добавьте перед кодом «шаурмег» или «кофеёк».';
function equal(a,b){const aa=Buffer.from(a),bb=Buffer.from(b);return aa.length===bb.length&&crypto.timingSafeEqual(aa,bb);}
async function telegramRaw(method,body){
  if(!token())throw fail('COORDINATOR_BOT_TOKEN missing',503);
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),10000);
  try{
    const r=await fetch('https://api.telegram.org/bot'+token()+'/'+method,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),signal:controller.signal});
    const data=await r.json();
    if(!r.ok||!data.ok)throw fail('Telegram '+method+': '+String(data.description||r.status),Number(data.error_code||r.status));
    return data.result;
  }finally{clearTimeout(timeout);}
}
async function telegram(method,body){
  return rich.withRich(method,body,(name,payload)=>telegramRaw(name,payload));
}
const homeKeyboard={inline_keyboard:[[
  {text:'📍 Мои подключения',callback_data:'cm:status'},
  {text:'📒 Команды',callback_data:'cm:help'}
]]};
async function reply(chatId,text,replyMarkup=null){
  return telegram('sendMessage',{chat_id:chatId,text:String(text).slice(0,3800),disable_web_page_preview:true,...(replyMarkup?{reply_markup:replyMarkup}:{})});
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
    const r=await fetch(coffeeBase()+'/api/admin?action=coordinator.resolve&telegramId='+encodeURIComponent(telegramId),{headers:{'x-coordinator-secret':secret},signal:controller.signal});
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

const appUrl=()=>{
  const base=String(config.PUBLIC_API_URL||'').replace(/\/+$/,'');
  return /^https:\/\//.test(base)?base+'/realcity-preview/coordinator-console.html':'';
};
const menuKeyboard=()=>{
  const rows=[...homeKeyboard.inline_keyboard];
  if(appUrl())rows.unshift([{text:'🎙 Открыть Menu Control',web_app:{url:appUrl()}}]);
  return {inline_keyboard:rows};
};
async function catalogFor(uid,project){
  if(project==='shaurmeg'){
    const linked=await coordinator.binding(uid);
    if(!linked)throw fail('Шаурмег: нет привязки к заведению',403);
    return {ok:true,project,venue:linked.name,venueId:linked.establishment_id,
      items:await coordinator.ensureCodes(linked.establishment_id)};
  }
  if(project==='kofeyok')return coffee('catalog',uid);
  throw fail('Укажите проект',400);
}
async function projectFor(uid,requested){
  const list=await locations(uid);
  if(list.some(x=>x.unavailable))throw fail('Не удалось безопасно проверить подключение Кофейка',503);
  const connected=list.filter(x=>x.linked);
  if(requested){
    if(!connected.some(x=>x.project===requested))throw fail('Вы не подключены к выбранному проекту',403);
    return requested;
  }
  if(connected.length!==1)throw fail('Выберите конкретный проект: Шаурмег или Кофеёк',409);
  return connected[0].project;
}
const compactList=items=>(items||[]).slice(0,8).map(x=>'• '+x.name+' — '+x.code).join('\n');
async function preview(uid,project,raw){
  const scope=await catalogFor(uid,project);
  const result=language.resolve(raw,scope.items);
  if(result.type==='unsupported'||result.type==='ambiguous'||result.type==='unknown'||result.type==='found'){
    return {...result,text:result.message||(result.type==='found'?'Найдено:\n'+compactList(result.items):'Не удалось определить позицию.')+(result.type==='ambiguous'&&result.items.length?'\n'+compactList(result.items):'')};
  }
  let item=result.item||null,command=result.command,executedText='';
  if(result.type==='proposal')executedText=item.code+' '+command;
  if(!executedText)throw fail('Не удалось безопасно определить команду.',400);
  const id=crypto.randomUUID();
  await db.query(
    'INSERT INTO shaurma_coordinator_pending(id,telegram_id,project,venue_id,kind,entity_id,code,command,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,now()+interval \'3 minutes\')',
    [id,String(uid),project,String(scope.venueId),item.kind,String(item.id),item.code,executedText]
  );
  return {type:'proposal',id,project,venue:scope.venue,text:'🔐 '+scope.venue+'\n'+result.text};
}
async function previewWithLegacy(uid,project,raw){
  const scope=await catalogFor(uid,project);
  let result=language.resolve(raw,scope.items);
  if(result.type!=='unknown')return preview(uid,project,raw);
  // Legacy code-based commands remain supported, but now require confirmation too.
  const match=String(raw||'').trim().match(/^([^\s]+)\s+([\s\S]+)$/);
  const item=match?scope.items.find(x=>language.normalize(x.code)===language.normalize(match[1])):null;
  const creation=/^создать\s+(позицию|блюдо|напиток|категорию|ингредиент|группу)\s+.+/i.test(String(raw||'').trim());
  if(!item&&!creation)return {type:'unknown',text:'Не распознал точную позицию. Назовите блюдо целиком или используйте его код.'};
  const id=crypto.randomUUID();
  await db.query(
    'INSERT INTO shaurma_coordinator_pending(id,telegram_id,project,venue_id,kind,entity_id,code,command,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,now()+interval \'3 minutes\')',
    [id,String(uid),project,String(scope.venueId),item?.kind||null,item?String(item.id):null,item?.code||null,String(raw).trim()]
  );
  return {type:'proposal',id,project,venue:scope.venue,
    text:'🔐 '+scope.venue+'\nПодтвердите команду:\n'+String(raw).trim().slice(0,300)};
}
async function confirm(uid,id){
  if(!/^[0-9a-f-]{36}$/i.test(String(id||'')))throw fail('Неверное подтверждение',400);
  const r=await db.query(
    'UPDATE shaurma_coordinator_pending SET consumed_at=now() WHERE id=$1 AND telegram_id=$2 AND consumed_at IS NULL AND expires_at>now() RETURNING *',
    [id,String(uid)]
  );
  const row=r.rows[0];
  if(!row)throw fail('Команда уже обработана или время подтверждения истекло',409);
  const project=await projectFor(uid,row.project);
  const scope=await catalogFor(uid,project);
  if(String(scope.venueId)!==String(row.venue_id))throw fail('Привязка заведения изменилась. Команда отменена.',403);
  if(row.code){
    const match=scope.items.find(x=>x.code===row.code&&x.kind===row.kind&&String(x.id)===row.entity_id);
    if(!match)throw fail('Позиция или код изменились. Повторите команду.',409);
  }
  return project==='shaurmeg'?coordinator.execute(uid,row.command):coffee('execute',uid,{text:row.command});
}
function verifyMiniApp(initData){
  if(!token())throw fail('Бот не настроен',503);
  if(typeof initData!=='string'||initData.length>4096)throw fail('telegram_identity_required',401);
  const p=new URLSearchParams(initData),received=p.get('hash'),auth=Number(p.get('auth_date'));
  if(!received||!/^[a-f0-9]{64}$/i.test(received)||!Number.isSafeInteger(auth)||auth>Date.now()/1000+60||Date.now()/1000-auth>12*60*60)
    throw fail('telegram_identity_expired',401);
  p.delete('hash');
  const check=[...p.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>k+'='+v).join('\n');
  const key=crypto.createHmac('sha256','WebAppData').update(token()).digest();
  const expected=crypto.createHmac('sha256',key).update(check).digest();
  if(!crypto.timingSafeEqual(expected,Buffer.from(received,'hex')))throw fail('telegram_identity_invalid',401);
  let user;try{user=JSON.parse(p.get('user')||'{}')}catch{throw fail('telegram_user_invalid',401)}
  if(!/^\d{4,20}$/.test(String(user.id||'')))throw fail('telegram_user_invalid',401);
  return String(user.id);
}
async function transcribe(bytes,mime){
  const key=String(process.env.COORDINATOR_STT_API_KEY||process.env.OPENAI_API_KEY||'').trim();
  if(!key)throw fail('Голос пока не подключён: настройте COORDINATOR_STT_API_KEY на сервере.',503);
  if(!bytes?.length||bytes.length>8*1024*1024)throw fail('Запись должна быть не больше 8 МБ',413);
  const type=/^(audio\/ogg|audio\/webm|audio\/mp4|audio\/mpeg)$/.test(mime)?mime:'audio/ogg';
  const ext={'audio/ogg':'ogg','audio/webm':'webm','audio/mp4':'m4a','audio/mpeg':'mp3'}[type];
  const form=new FormData();
  form.append('model','whisper-1');form.append('language','ru');
  form.append('file',new Blob([bytes],{type}), 'command.'+ext);
  const r=await fetch('https://api.openai.com/v1/audio/transcriptions',{
    method:'POST',headers:{Authorization:'Bearer '+key},body:form,signal:AbortSignal.timeout(25000)
  });
  const data=await r.json().catch(()=>({}));
  if(!r.ok)throw fail('Не удалось распознать речь',502);
  const text=String(data.text||'').trim().slice(0,300);
  if(!text)throw fail('Речь не распознана, повторите команду',422);
  return text;
}
async function voiceFromTelegram(fileId){
  const file=await telegramRaw('getFile',{file_id:String(fileId)});
  if(!file?.file_path||Number(file.file_size)>8*1024*1024)throw fail('Слишком большая запись',413);
  const r=await fetch('https://api.telegram.org/file/bot'+token()+'/'+file.file_path,{signal:AbortSignal.timeout(15000)});
  if(!r.ok)throw fail('Не удалось получить голосовую запись',502);
  const b=Buffer.from(await r.arrayBuffer());
  return transcribe(b,'audio/ogg');
}

async function handle(message){
  const chatId=message?.chat?.id,uid=message?.from?.id;
  if(!chatId||!uid||String(message.chat.type)!=='private')return;
  let text=String(message.text||'').trim();
  if(message.voice){
    const active=await locations(uid);
    if(!active.some(x=>x.linked))return reply(chatId,'Сначала подключите заведение: /connect КЛЮЧ');
    text=await voiceFromTelegram(message.voice.file_id);
    await reply(chatId,'🎙 Распознано: '+text);
  }
  if(!text)return reply(chatId,'Отправьте текст или голосовую команду. Наберите /помощь.');
  if(/^\/(?:start|help|помощь)(?:@\S+)?$/i.test(text))return reply(chatId,HELP+'\n\n🎙 Можно произносить названия блюд обычными словами.',menuKeyboard());
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
  const result=await previewWithLegacy(uid,project,command);
  if(result.type==='proposal')return reply(chatId,result.text,{inline_keyboard:[[
    {text:'✅ Подтвердить',callback_data:'cm:yes:'+result.id},
    {text:'✕ Отменить',callback_data:'cm:no:'+result.id}
  ]]});
  return reply(chatId,result.text||'Команда не распознана.');
}
async function prepareUpdate(updateId){
  // Insert-before-execute protects menu actions from Telegram retry duplication.
  const res=await db.query("INSERT INTO shaurma_coordinator_updates(update_id,received_at) VALUES($1,now()) ON CONFLICT DO NOTHING RETURNING update_id",[updateId]);
  return res.rowCount>0;
}
async function handleCallback(query){
  const chatId=query?.message?.chat?.id,uid=query?.from?.id;
  if(!chatId||!uid||query?.message?.chat?.type!=='private')return;
  const data=String(query.data||'');
  if(data!=='cm:status'&&data!=='cm:help'&&!/^cm:(?:yes|no):[0-9a-f-]{36}$/i.test(data))return;
  try{await telegram('answerCallbackQuery',{callback_query_id:query.id})}catch(e){console.warn('coordinator callback ack',e.message)}
  if(data==='cm:help')return reply(chatId,HELP,menuKeyboard());
  const confirmMatch=data.match(/^cm:(yes|no):([0-9a-f-]{36})$/i);
  if(confirmMatch){
    if(confirmMatch[1]==='no'){
      await db.query('UPDATE shaurma_coordinator_pending SET consumed_at=now() WHERE id=$1 AND telegram_id=$2 AND consumed_at IS NULL',[confirmMatch[2],String(uid)]);
      return reply(chatId,'Команда отменена.');
    }
    const result=await confirm(uid,confirmMatch[2]);
    return reply(chatId,result.text||'✅ Изменение сохранено.');
  }
  const rows=await locations(uid);
  return reply(chatId,'🔒 Подключения:\n'+rows.map(x=>(x.project==='shaurmeg'?'Шаурмег':'Кофеёк')+': '+(x.unavailable?'⚠️ сервис временно недоступен':x.linked?'✅ '+x.venue:'не подключён')).join('\n'),homeKeyboard);
}
async function processUpdate(update){
  const id=Number(update?.update_id);
  if(!Number.isSafeInteger(id))return;
  if(!(await prepareUpdate(id)))return;
  const message=update.message;
  try{if(update.callback_query)await handleCallback(update.callback_query);else await handle(message);}
  catch(e){
    console.error('coordinator_message_failed',String(e.message||'unknown').slice(0,200));
    const chatId=message?.chat?.id||update.callback_query?.message?.chat?.id;
    if(chatId)try{await reply(chatId,'⚠️ '+String(e.message||'Ошибка команды').slice(0,500));}catch(err){console.error('coordinator_reply_failed',err.message)}
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
  app.post('/api/v2/coordinator-app',async(req,res)=>{
    res.setHeader('Cache-Control','no-store');
    try{
      const uid=verifyMiniApp(req.body?.initData),action=String(req.body?.action||'');
      if(action==='status')return res.json({ok:true,locations:await locations(uid)});
      const project=await projectFor(uid,String(req.body?.project||''));
      if(action==='catalog'){
        const scope=await catalogFor(uid,project);
        return res.json({ok:true,project,venue:scope.venue,venueId:scope.venueId,items:scope.items.slice(0,5000)});
      }
      if(action==='preview'){
        const result=await previewWithLegacy(uid,project,String(req.body?.text||'').slice(0,350));
        return res.json({ok:true,...result});
      }
      if(action==='confirm'){
        const result=await confirm(uid,req.body?.pendingId);
        return res.json({ok:true,text:result.text||'Изменение сохранено'});
      }
      throw fail('unknown_action',404);
    }catch(e){res.status(e.status||500).json({ok:false,error:e.message})}
  });
  const audioRate=new Map();
  app.post('/api/v2/coordinator-app/voice',express.raw({type:['audio/ogg','audio/webm','audio/mp4','audio/mpeg','application/octet-stream'],limit:'8mb'}),async(req,res)=>{
    res.setHeader('Cache-Control','no-store');
    try{
      const uid=verifyMiniApp(req.get('x-telegram-init-data'));
      const last=audioRate.get(uid)||0;
      if(Date.now()-last<7000)throw fail('Повторите запись через несколько секунд',429);
      const connections=await locations(uid);
      if(!connections.some(x=>x.linked))throw fail('Сначала подключите заведение',403);
      audioRate.set(uid,Date.now());
      if(audioRate.size>3000)audioRate.clear();
      const text=await transcribe(req.body,String(req.get('content-type')||'').split(';')[0]);
      res.json({ok:true,text});
    }catch(e){res.status(e.status||500).json({ok:false,error:e.message})}
  });
  app.get('/api/v2/telegram/coordinator-health',(req,res)=>res.json({enabled:!!token(),webhookSecured:webhookSecret().length>=20,coffeeLinked:coffeeSecret().length>=32}));
}
async function sync(){
  await db.query('CREATE TABLE IF NOT EXISTS shaurma_coordinator_updates(update_id bigint PRIMARY KEY,received_at timestamptz NOT NULL DEFAULT now())');
  await db.query("CREATE TABLE IF NOT EXISTS shaurma_coordinator_pending(id uuid PRIMARY KEY,telegram_id text NOT NULL,project text NOT NULL CHECK(project IN ('shaurmeg','kofeyok')),venue_id text NOT NULL,kind text,entity_id text,code text,command text NOT NULL,expires_at timestamptz NOT NULL,consumed_at timestamptz,created_at timestamptz NOT NULL DEFAULT now())");
  await db.query('CREATE INDEX IF NOT EXISTS shaurma_coordinator_pending_actor ON shaurma_coordinator_pending(telegram_id,expires_at DESC)');
  if(!token())return {enabled:false};
  if(token().length<30||webhookSecret().length<20)throw fail('Set COORDINATOR_BOT_TOKEN and a random COORDINATOR_WEBHOOK_SECRET (20+ chars)',503);
  await telegram('setMyCommands',{commands:[
    {command:'start',description:'Инструкция и подключение'},
    {command:'connect',description:'Подключить заведение по ключу'},
    {command:'status',description:'Показать привязанные заведения'},
    {command:'help',description:'Команды меню'}]});
  await telegram('setWebhook',{url:config.PUBLIC_API_URL+'/api/v2/telegram/coordinator',secret_token:webhookSecret(),allowed_updates:['message','callback_query']});
  if(appUrl())await telegram('setChatMenuButton',{menu_button:{type:'web_app',text:'🎙 Menu Control',web_app:{url:appUrl()}}});
  return {enabled:true};
}
module.exports={install,sync,handle};
