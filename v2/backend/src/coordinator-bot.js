'use strict';
const crypto=require('crypto');
const express=require('express');
const language=require('./coordinator-language');
const shaLanguage=require('./coordinator-shaurmeg-language');
const dialogue=require('./coordinator-dialogue');
const rich=require('../../../backend/telegram-rich');
const coordinator=require('./menu-coordinator');
const db=require('./db');
const config=require('./config');

const token=()=>String(process.env.COORDINATOR_BOT_TOKEN||'').trim();
const webhookSecret=()=>String(process.env.COORDINATOR_WEBHOOK_SECRET||'').trim();
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const HELP='🥙 КООРДИНАТОР МЕНЮ · ШАУРМЕГ\n\n' +
  '1. Получите одноразовый ключ в админке своего заведения → Идентификаторы меню.\n' +
  '2. Отправьте /connect SHA-MNU-... (ключ действует один раз).\n' +
  '3. Проверьте подключение через /status, найдите позиции через /menu.\n' +
  '4. Напишите или произнесите: «Убери сырную шаурму», «Измени цену на сырную шаурму 350».\n' +
  '5. Проверьте название заведения и блюдо, нажмите «Подтвердить».\n\n' +
  '/menu шаурма — поиск по меню\n' +
  '/status — подключённое заведение\n' +
  '«Переименуй идентификатор сырной шаурмы в сырная» — своё имя для голоса\n' +
  'Можно менять состав, название, описание, категории, доступность, цены и добавки.\n' +
  'Этот бот работает только с заведениями «Шаурмега».';
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
async function locations(uid){
  const bound=await coordinator.binding(uid);
  return [{project:'shaurmeg',linked:!!bound,venue:bound?.name||'',venueId:bound?.establishment_id||null}];
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
async function catalogFor(uid){
  const linked=await coordinator.binding(uid);
  if(!linked)throw fail('Сначала подключите своё заведение «Шаурмега»: /connect КЛЮЧ',403);
  return {ok:true,project:'shaurmeg',venue:linked.name,venueId:linked.establishment_id,
    items:await coordinator.ensureCodes(linked.establishment_id)};
}
async function projectFor(uid,requested){
  if(requested&&requested!=='shaurmeg')throw fail('Координатор управляет только меню «Шаурмега».',400);
  if(!(await coordinator.binding(uid)))throw fail('Заведение «Шаурмега» не подключено. Используйте /connect КЛЮЧ.',403);
  return 'shaurmeg';
}
const compactList=items=>(items||[]).slice(0,8).map(x=>'• '+(x.identifier||x.name)+(x.spokenName?' ('+x.name+')':'')).join('\n');
async function preview(uid,project,raw){
  const scope=await catalogFor(uid);
  const result=shaLanguage.resolve(raw,scope.items);
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
  const scope=await catalogFor(uid);
  let result=shaLanguage.resolve(raw,scope.items);
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
  // Pre-existing pending records for other projects must never run in this bot.
  if(row.project!=='shaurmeg')throw fail('Подтверждение не относится к заведению «Шаурмега».',403);
  await projectFor(uid,row.project);
  const scope=await catalogFor(uid);
  if(String(scope.venueId)!==String(row.venue_id))throw fail('Привязка заведения изменилась. Команда отменена.',403);
  if(row.code){
    const match=scope.items.find(x=>x.code===row.code&&x.kind===row.kind&&String(x.id)===row.entity_id);
    if(!match)throw fail('Позиция или код изменились. Повторите команду.',409);
  }
  return coordinator.execute(uid,row.command);
}

async function dialogState(uid,scope){
 const r=await db.query('SELECT state FROM shaurma_coordinator_dialogue WHERE telegram_id=$1 AND venue_id=$2 AND expires_at>now()',[String(uid),String(scope.venueId)]);
 return r.rows[0]?.state||dialogue.fresh();
}
async function saveDialogState(uid,scope,state){
 // The row is scoped to the actor AND establishment; no cross-venue conversational memory.
 await db.query("INSERT INTO shaurma_coordinator_dialogue(telegram_id,venue_id,state,expires_at) VALUES($1,$2,$3::jsonb,now()+interval '15 minutes') ON CONFLICT(telegram_id) DO UPDATE SET venue_id=EXCLUDED.venue_id,state=EXCLUDED.state,expires_at=EXCLUDED.expires_at,updated_at=now()",
 [String(uid),String(scope.venueId),JSON.stringify(state||dialogue.fresh())]);
}
const fmtMoney=v=>v===null||v===undefined||v===''?'не указана':(Number(v).toLocaleString('ru-RU')+' ₽');
async function dialogInfo(scope,turn){
 // A trusted catalog ref is checked again against this venue's current persisted menu.
 const current=scope.items.find(x=>x.kind==='item'&&x.code===turn.item?.code&&String(x.id)===String(turn.item?.id));
 if(!current)return 'Не могу подтвердить позицию: каталог изменился. Назовите блюдо заново.';
 const r=await db.query('SELECT menu FROM shaurma_venues WHERE establishment_id=$1 AND is_active=true',[scope.venueId]);
 const dish=(Array.isArray(r.rows[0]?.menu)?r.rows[0].menu:[]).find(x=>String(x.id)===String(current.id));
 if(!dish)return 'Блюдо больше не найдено в меню этого заведения.';
 const name=String(dish.n||current.name);
 const available=dish.active!==false&&dish.available!==false&&!(dish.coordinator_blocked_ingredients||[]).length;
 if(turn.topic==='price')return '💰 '+name+' · '+fmtMoney(dish.p)+'.';
 if(turn.topic==='composition')return '🥙 '+name+' · состав: '+String(dish.composition||'пока не указан')+'.';
 if(turn.topic==='availability')return '📍 '+name+' · '+(available?'не ограничено флагами блюда (категория и расписание проверяются отдельно)':'ограничено или снято с продажи')+'.';
 return '🥙 '+name+'\nКод: '+current.code+'\nЦена: '+fmtMoney(dish.p)+'\nСостав: '+String(dish.composition||'не указан')+'\nПродажа: '+(available?'разрешена настройками меню':'ограничена')+(dish.d?'\nОписание: '+String(dish.d).slice(0,200):'');
}
async function dialogReport(scope,topic){
 if(topic==='audit'||topic==='audit24h'){
  // Reports never read outside the currently authenticated Shaurmeg establishment.
  const query=topic==='audit24h'
   ? "SELECT command,entity_type,created_at FROM shaurma_coordinator_audit WHERE establishment_id=$1 AND created_at>=now()-interval '24 hours' ORDER BY created_at DESC LIMIT 8"
   : 'SELECT command,entity_type,created_at FROM shaurma_coordinator_audit WHERE establishment_id=$1 ORDER BY created_at DESC LIMIT 8';
  const r=await db.query(query,[scope.venueId]);
  const label=topic==='audit24h'?'Изменения меню за 24 часа':'Последние изменения меню';
  return r.rows.length?'🧾 '+label+' · '+scope.venue+'\n'+r.rows.map((x,i)=>(i+1)+'. '+new Date(x.created_at).toLocaleString('ru-RU',{timeZone:'Europe/Moscow'})+' МСК · '+String(x.command).slice(0,160)).join('\n'):'🧾 '+(topic==='audit24h'?'За последние 24 часа':'За всё время')+' изменений меню этого заведения не найдено.';
 }
 const r=await db.query('SELECT menu FROM shaurma_venues WHERE establishment_id=$1 AND is_active=true',[scope.venueId]);
 const menu=Array.isArray(r.rows[0]?.menu)?r.rows[0].menu:[];
 const stopped=menu.filter(x=>x&&x.active===false||x&&x.available===false||x&&Array.isArray(x.coordinator_blocked_ingredients)&&x.coordinator_blocked_ingredients.length);
 if(topic==='stopped')return '⏸ По явным настройкам меню «'+scope.venue+'» остановлено '+stopped.length+' позиций:\n'+
   (stopped.length?stopped.slice(0,20).map(x=>'• '+String(x.n||x.id)+' · '+(scope.items.find(c=>c.kind==='item'&&String(c.id)===String(x.id))?.code||'без кода')).join('\n'):'Стоп-позиций нет.')+
   (stopped.length>20?'\nИ ещё '+(stopped.length-20)+'.':'')+'\nОтключение категории и расписание продаж здесь отдельно не учитываются.';
 return '📊 Сводка меню · '+scope.venue+'\nВсего позиций: '+menu.length+'\nОтключены или ограничены настройками: '+stopped.length+
   '\nНе ограничены настройками: '+(menu.length-stopped.length)+'\nДля списка скажите «Что в стоп-листе?», для истории — «Что изменилось?».'+
   '\nЭто сводка по флагам отдельных блюд: без отключений категорий и расписаний. Статистика заказов не включена.';
}
async function dialogueTurn(uid,text){
 const scope=await catalogFor(uid);
 const state=await dialogState(uid,scope);
 const turn=dialogue.step(String(text||'').slice(0,1200),scope.items,state);
 if(turn.type==='unknown'){
  const legacy=await previewWithLegacy(uid,'shaurmeg',text);
  if(legacy.type==='proposal')return legacy;
  return {...turn,text:turn.text||legacy.text};
 }
 await saveDialogState(uid,scope,turn.state);
 if(turn.type==='proposal'){
  const result=await previewWithLegacy(uid,'shaurmeg',turn.item.code+' '+turn.command);
  if(result.type!=='proposal')throw fail('Команда не прошла повторную проверку, уточните действие',409);
  return result;
 }
 if(turn.type==='info')return {type:'reply',text:await dialogInfo(scope,turn)};
 if(turn.type==='report')return {type:'reply',text:await dialogReport(scope,turn.topic)};
 return {...turn,text:turn.text||'Уточните запрос.'};
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
  const connectCommand=text.match(/^\/(?:connect|подключить)(?:@\S+)?(?:\s+(.+))?$/i);
  const standaloneKey=/^SHA-MNU-[A-F0-9]{16}$/i.test(text);
  if(connectCommand||standaloneKey){
    const key=String(standaloneKey?text:connectCommand[1]||'').trim().toUpperCase();
    if(!/^SHA-MNU-[A-F0-9]{16}$/.test(key))
      return reply(chatId,'Укажите одноразовый ключ своего заведения «Шаурмега». Формат: /connect SHA-MNU-...\nСоздаётся в админке → Идентификаторы меню.');
    const response=await coordinator.claim(uid,key);
    return reply(chatId,'✅ '+response.venue+' · подключено к «Шаурмегу».\n/menu — посмотреть позиции и коды.\nОтправьте сообщение или голосовую команду. Для изменений потребуется подтверждение.',menuKeyboard());
  }
  if(/^(?:[A-Z]{3}-MNU-[A-F0-9]{16}|\/(?:connect|подключить)\s+[A-Z]{3}-MNU-[A-F0-9]{16})$/i.test(text))
    return reply(chatId,'Этот ключ не относится к «Шаурмегу». Получите ключ SHA-MNU-... в админке своего заведения.');
  if(/^\/(?:reset|сброс)(?:@\S+)?$/i.test(text)){
    const scope=await catalogFor(uid);
    await saveDialogState(uid,scope,dialogue.fresh());
    return reply(chatId,'Контекст разговора очищен. Меню не изменено.');
  }
  const showMenu=text.match(/^\/(?:menu|меню|каталог)(?:@\S+)?(?:\s+(.+))?$/i);
  if(showMenu){
    const bound=await coordinator.binding(uid);
    if(!bound)return reply(chatId,'Сначала подключите своё заведение «Шаурмега»: /connect КЛЮЧ');
    const items=await coordinator.ensureCodes(bound.establishment_id);
    const search=language.normalize(showMenu[1]||'');
    const dishes=items.filter(x=>x.kind==='item'&&(!search||language.normalize(x.name).includes(search)||language.normalize(x.identifier||'').includes(search)||language.normalize(x.code).includes(search)));
    const shown=dishes.slice(0,30);
    return reply(chatId,'🥙 '+bound.name+' · позиции меню ('+dishes.length+')\n'+
      (shown.length?shown.map(x=>'• '+(x.identifier||x.name)+(x.spokenName?' · '+x.name:'')).join('\n'):'Позиции не найдены.')+
      (dishes.length>shown.length?'\n…Ещё '+(dishes.length-shown.length)+'. Уточните поиск: /menu шаурма':'')+
      '\n\nПереименовать обращение: «Переименуй идентификатор сырной шаурмы в сырная». Внутренний код остаётся неизменным.');
  }
  if(/^\/(?:status|статус)(?:@\S+)?$/i.test(text)){
    const linked=await coordinator.binding(uid);
    return reply(chatId,linked?'✅ «Шаурмег» · '+linked.name+'\nУправление меню доступно. /menu — список позиций.':'🥙 Заведение не подключено.\nОткройте админку заведения → Идентификаторы меню → Создать ключ, затем /connect SHA-MNU-...');
  }
  let command=text;
  const prefix=command.match(/^(?:шаурмег|shaurmeg|шаурма)\s+(.+)$/is);
  if(prefix)command=prefix[1].trim();
  if(!(await coordinator.binding(uid)))return reply(chatId,'🥙 Сначала подключите своё заведение «Шаурмега»: /connect SHA-MNU-...');
  const result=await dialogueTurn(uid,command);
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
  const linked=await coordinator.binding(uid);
  return reply(chatId,linked?'✅ «Шаурмег» · '+linked.name+'\nМеню доступно через /menu.':'🥙 Заведение не подключено. Используйте /connect SHA-MNU-...',homeKeyboard);
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
      if(action==='connect'){
        const key=String(req.body?.key||'').trim().toUpperCase();
        if(!/^SHA-MNU-[A-F0-9]{16}$/.test(key))throw fail('Нужен одноразовый ключ «Шаурмега» в формате SHA-MNU-...',400);
        const bound=await coordinator.claim(uid,key);
        return res.json({ok:true,project:'shaurmeg',venue:bound.venue});
      }
      const project=await projectFor(uid,String(req.body?.project||''));
      if(action==='catalog'){
        const scope=await catalogFor(uid);
        return res.json({ok:true,project,venue:scope.venue,venueId:scope.venueId,items:scope.items.slice(0,5000)});
      }
      if(action==='preview'){
        const result=await dialogueTurn(uid,String(req.body?.text||'').slice(0,600));
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
  app.get('/api/v2/telegram/coordinator-health',(req,res)=>res.json({
    enabled:token().length>=30,webhookSecured:webhookSecret().length>=20,
    shaMenuAvailable:true,dialogueLocal:true,voiceConfigured:!!(process.env.COORDINATOR_STT_API_KEY||process.env.OPENAI_API_KEY),
    miniAppConfigured:!!appUrl(),project:'shaurmeg'
  }));
}
async function sync(){
  await db.query('CREATE TABLE IF NOT EXISTS shaurma_coordinator_updates(update_id bigint PRIMARY KEY,received_at timestamptz NOT NULL DEFAULT now())');
  await db.query("CREATE TABLE IF NOT EXISTS shaurma_coordinator_pending(id uuid PRIMARY KEY,telegram_id text NOT NULL,project text NOT NULL CHECK(project='shaurmeg'),venue_id text NOT NULL,kind text,entity_id text,code text,command text NOT NULL,expires_at timestamptz NOT NULL,consumed_at timestamptz,created_at timestamptz NOT NULL DEFAULT now())");
  await db.query('CREATE INDEX IF NOT EXISTS shaurma_coordinator_pending_actor ON shaurma_coordinator_pending(telegram_id,expires_at DESC)');
  await db.query("CREATE TABLE IF NOT EXISTS shaurma_coordinator_dialogue(telegram_id text PRIMARY KEY,venue_id text NOT NULL,state jsonb NOT NULL DEFAULT '{}'::jsonb,expires_at timestamptz NOT NULL,updated_at timestamptz NOT NULL DEFAULT now())");
  if(!token()){console.warn('Coordinator bot disabled: COORDINATOR_BOT_TOKEN not configured');return {enabled:false};}
  if(token().length<30||webhookSecret().length<20)throw fail('Set COORDINATOR_BOT_TOKEN and a random COORDINATOR_WEBHOOK_SECRET (20+ chars)',503);
  await telegram('setMyCommands',{commands:[
    {command:'start',description:'Инструкция и подключение'},
    {command:'connect',description:'Подключить заведение по ключу'},
    {command:'status',description:'Показать привязанные заведения'},
    {command:'menu',description:'Поиск по меню Шаурмега'},
    {command:'reset',description:'Очистить контекст диалога'},
    {command:'help',description:'Команды меню'}]});
  await telegram('setWebhook',{url:config.PUBLIC_API_URL+'/api/v2/telegram/coordinator',secret_token:webhookSecret(),allowed_updates:['message','callback_query']});
  if(appUrl())await telegram('setChatMenuButton',{menu_button:{type:'web_app',text:'🎙 Menu Control',web_app:{url:appUrl()}}});
  let botUsername='unknown';
  try{botUsername=String((await telegram('getMe',{})).username||'unknown')}catch(e){console.warn('Coordinator getMe:',e.message)}
  console.info('Coordinator bot synced @'+botUsername+': Shaurmeg only, menu app '+(appUrl()?'configured':'unavailable')+', voice '+(process.env.COORDINATOR_STT_API_KEY||process.env.OPENAI_API_KEY?'configured':'unavailable'));
  return {enabled:true};
}
module.exports={install,sync,handle};
