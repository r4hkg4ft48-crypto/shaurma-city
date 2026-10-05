'use strict';
const crypto=require('crypto');
const config=require('./config');
const db=require('./db');
const rt=require('./realtime');
const voice=require('./voice-assistant');
const {createVenueCommandBus}=require('../../../backend/venue-command');
const {createVenueDialogAgent}=require('../../../backend/venue-agent');

const TELEGRAM_MAX_RETRIES=3;
const TELEGRAM_SYNC_DELAY_MS=300;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const venueCommandBus=createVenueCommandBus({
  DB:db,
  publishVenue:row=>{
    if(!row?.establishment_id)return;
    rt.pushVenue(row.establishment_id,'menu_changed',{establishment_id:row.establishment_id});
    rt.pushVenue(row.establishment_id,'venue',row);
    rt.pushOwner('venue',row);
  },
  pushOwner:rt.pushOwner
});
const venueDialogAgent=createVenueDialogAgent({DB:db,commandBus:venueCommandBus});

async function call(token,method,body={},attempt=0){
  if(!token)return null;
  const r=await fetch('https://api.telegram.org/bot'+token+'/'+method,{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify(body)
  });
  const j=await r.json().catch(()=>({}));

  if((r.status===429||j.error_code===429)&&attempt<TELEGRAM_MAX_RETRIES){
    const retryAfter=Math.max(1,Number(j.parameters?.retry_after)||1);
    const delay=retryAfter*1000+300;
    console.warn('Shaurmeg v2 Telegram rate limit '+method+' · retry '+(attempt+1)+'/'+TELEGRAM_MAX_RETRIES+' in '+delay+'ms');
    await sleep(delay);
    return call(token,method,body,attempt+1);
  }

  if(!r.ok||!j.ok){
    const error=new Error(j.description||method+'_failed');
    error.status=r.status;
    error.method=method;
    throw error;
  }
  return j.result;
}

async function sendClientMessage(chatId,text,replyMarkup=null){
  const token=config.AGGREGATOR_BOT_TOKEN||config.CLIENT_BOT_TOKEN;
  if(!token||!chatId)return null;
  const body={chat_id:chatId,text:String(text||''),disable_web_page_preview:true};
  if(replyMarkup)body.reply_markup=replyMarkup;
  return call(token,'sendMessage',body);
}

function menuUrl(marker,est){
  const u=new URL(config.PUBLIC_APP_URL+'/menu.html');
  u.searchParams.set('marker',String(marker));
  u.searchParams.set('establishment',String(est));
  return u.toString();
}

function normalizeInviteCode(v){
  const raw=String(v||'').normalize('NFKC').toUpperCase()
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g,'')
    .replace(/[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]/g,'-')
    .replace(/\u00A0/g,' ');
  const compact=raw.replace(/\s+/g,'');
  const match=compact.match(/OWN-?([A-F0-9]{10})/);
  return match?'OWN-'+match[1]:compact;
}
function inviteCodeHash(v){return crypto.createHash('sha256').update('shaurmeg-v2-owner:'+normalizeInviteCode(v)).digest('hex')}
function orderStatusLabel(status){
  return ({new:'Принят',cooking:'Готовится',ready:'Готово',done:'Выполнен',cancelled:'Отменён'})[String(status)]||String(status||'');
}
function nextKitchenStatus(status){
  return ({new:'cooking',cooking:'ready',ready:'done'})[String(status)]||null;
}
function nextKitchenButton(status,orderId){
  const next=nextKitchenStatus(status);
  if(!next)return null;
  const label={cooking:'🔥 Готовится',ready:'✅ Готово',done:'🏁 Выполнен'}[next];
  return {inline_keyboard:[[{text:label,callback_data:'ko:'+String(orderId)+':'+next}]]};
}
function kitchenOrderText(order){
  const items=Array.isArray(order?.items)?order.items:[];
  const lines=[
    '🥙 '+String(order?.venue_name||'Заведение')+', Вам поступил заказ:',
    '',
    'Заказ '+String(order?.order_number||('#'+order?.id)),
    ''
  ];
  if(items.length){
    lines.push('Позиции:');
    for(const item of items){
      lines.push('• '+String(item?.n||item?.name||'Позиция')+' × '+Math.max(1,Number(item?.q)||1));
      if(item?.detail)lines.push('  '+String(item.detail).slice(0,300));
    }
    lines.push('');
  }
  lines.push('Получение: '+(order?.fulfillment_type==='cafe'?'В заведении / самовывоз':'Доставка'));
  if(order?.fulfillment_type!=='cafe'&&order?.address)lines.push('Адрес: '+String(order.address));
  if(order?.customer_name)lines.push('Клиент: '+String(order.customer_name));
  if(order?.phone)lines.push('Телефон: '+String(order.phone));
  if(order?.comment)lines.push('Комментарий: '+String(order.comment));
  lines.push('Итого: '+Number(order?.total||0)+' ₽');
  lines.push('');
  lines.push('Статус: '+orderStatusLabel(order?.status));
  return lines.join('\n').slice(0,3900);
}

async function saveKitchenMessage(order,chatId,message){
  if(!message?.message_id)return;
  await db.query(`INSERT INTO shaurma_kitchen_order_messages(order_id,establishment_id,chat_id,message_id,updated_at)
    VALUES($1,$2,$3,$4,NOW())
    ON CONFLICT(order_id,chat_id) DO UPDATE SET message_id=EXCLUDED.message_id,establishment_id=EXCLUDED.establishment_id,updated_at=NOW()`,
    [order.id,order.establishment_id,String(chatId),message.message_id]);
}

async function notifyKitchenOrder(order){
  if(!config.KITCHEN_BOT_TOKEN||!order?.establishment_id)return {sent:0};
  const q=await db.query('SELECT DISTINCT chat_id FROM shaurma_kitchen_access WHERE establishment_id=$1 AND is_active=TRUE',[order.establishment_id]);
  let sent=0;
  for(const row of q.rows){
    try{
      const message=await call(config.KITCHEN_BOT_TOKEN,'sendMessage',{
        chat_id:row.chat_id,
        text:kitchenOrderText(order),
        disable_web_page_preview:true,
        reply_markup:nextKitchenButton(order.status,order.id)||{inline_keyboard:[]}
      });
      await saveKitchenMessage(order,row.chat_id,message);
      sent++;
    }catch(e){console.error('kitchen order notify',order.id,row.chat_id,e.message)}
    await sleep(80);
  }
  return {sent};
}

async function refreshKitchenOrderMessages(order){
  if(!config.KITCHEN_BOT_TOKEN||!order?.id)return;
  const q=await db.query('SELECT chat_id,message_id FROM shaurma_kitchen_order_messages WHERE order_id=$1',[order.id]);
  for(const row of q.rows){
    try{
      await call(config.KITCHEN_BOT_TOKEN,'editMessageText',{
        chat_id:row.chat_id,
        message_id:row.message_id,
        text:kitchenOrderText(order),
        disable_web_page_preview:true,
        reply_markup:nextKitchenButton(order.status,order.id)||{inline_keyboard:[]}
      });
    }catch(e){
      if(!/message is not modified/i.test(String(e.message||'')))console.error('kitchen message refresh',order.id,row.chat_id,e.message);
    }
    await sleep(60);
  }
}

async function kitchenAccesses(chatId){
  const q=await db.query(`SELECT k.establishment_id,v.name
    FROM shaurma_kitchen_access k JOIN shaurma_venues v ON v.establishment_id=k.establishment_id
    WHERE k.chat_id=$1 AND k.is_active=TRUE AND v.is_active=TRUE ORDER BY v.name`,[String(chatId)]);
  return q.rows;
}

async function claimKitchenAccess(chatId,user,rawCode){
  const code=normalizeInviteCode(rawCode);
  if(!/^OWN-[A-F0-9]{10}$/.test(code))throw Object.assign(new Error('bad_claim_code'),{status:400});
  const q=await db.query(`SELECT i.id,i.establishment_id,v.name
    FROM shaurma_venue_invites i JOIN shaurma_venues v ON v.establishment_id=i.establishment_id
    WHERE i.code_hash=$1 AND i.kitchen_enabled=TRUE AND i.expires_at>NOW() AND v.is_active=TRUE
    LIMIT 1`,[inviteCodeHash(code)]);
  const inv=q.rows[0];
  if(!inv)throw Object.assign(new Error('claim_code_invalid_or_expired'),{status:400});
  await db.query(`INSERT INTO shaurma_kitchen_access(establishment_id,telegram_user_id,telegram_username,telegram_first_name,chat_id,source_invite_id,is_active,updated_at)
    VALUES($1,$2,$3,$4,$5,$6,TRUE,NOW())
    ON CONFLICT(establishment_id,chat_id) DO UPDATE SET telegram_user_id=EXCLUDED.telegram_user_id,telegram_username=EXCLUDED.telegram_username,telegram_first_name=EXCLUDED.telegram_first_name,source_invite_id=EXCLUDED.source_invite_id,is_active=TRUE,updated_at=NOW()`,
    [inv.establishment_id,String(user?.id||''),String(user?.username||''),String(user?.first_name||''),String(chatId),inv.id]);
  await db.query("INSERT INTO shaurma_venue_audit(establishment_id,telegram_user_id,action,payload) VALUES($1,$2,'kitchen_access_claimed',$3::jsonb)",
    [inv.establishment_id,String(user?.id||''),JSON.stringify({chat_id:String(chatId),invite_id:inv.id})]);
  return inv;
}

async function notifyCustomerStatus(order){
  if(!order?.telegram_user_id)return;
  try{await sendClientMessage(order.telegram_user_id,'Заказ '+order.order_number+' · '+orderStatusLabel(order.status))}
  catch(e){console.error('kitchen customer notify',e.message)}
}


function voiceHelpText(){
  return [
    '🎙 Голосовой помощник кухни',
    '',
    'Можно сказать:',
    '• «Покажи активные заказы»',
    '• «Повтори последний заказ»',
    '• «Начинай готовить последний заказ»',
    '• «Заказ 42 готов»',
    '• «Последний заказ выполнен»',
    '',
    'Статус меняется только по цепочке:',
    'Принят → Готовится → Готово → Выполнен.'
  ].join('\n');
}

async function transitionKitchenOrder(order,chatId,user,targetStatus,source='button'){
  if(!order)return {changed:false,missing:true,order:null};
  const current=String(order.status||'');
  const target=String(targetStatus||'');
  if(current===target)return {changed:false,same:true,order};
  const expected=nextKitchenStatus(current);
  if(expected!==target)return {changed:false,blocked:true,expected,order};

  const upd=await db.query(
    'UPDATE shaurma_orders SET status=$3,updated_at=NOW() WHERE id=$1 AND establishment_id=$2 AND status=$4 RETURNING *',
    [order.id,order.establishment_id,target,current]
  );
  const changed=upd.rows[0];
  if(!changed){
    const latest=(await db.query('SELECT * FROM shaurma_orders WHERE id=$1',[order.id])).rows[0]||order;
    return {changed:false,race:true,order:latest};
  }

  await db.query(
    "INSERT INTO shaurma_venue_audit(establishment_id,telegram_user_id,action,payload) VALUES($1,$2,'kitchen_order_status_updated',$3::jsonb)",
    [changed.establishment_id,String(user?.id||''),JSON.stringify({
      order_id:changed.id,
      status:changed.status,
      chat_id:String(chatId),
      source:String(source||'button')
    })]
  );
  rt.pushOwner('update',changed);
  rt.pushVenue(changed.establishment_id,'update',changed);
  if(changed.telegram_user_id)rt.pushUser(changed.telegram_user_id,'update',changed);
  await Promise.all([refreshKitchenOrderMessages(changed),notifyCustomerStatus(changed)]);
  return {changed:true,order:changed};
}

async function downloadKitchenVoice(msg){
  const media=msg?.voice||msg?.audio;
  if(!media?.file_id)throw new Error('voice_file_missing');
  if(Number(media.file_size||0)>20*1024*1024)throw new Error('voice_file_too_large');
  const meta=await call(config.KITCHEN_BOT_TOKEN,'getFile',{file_id:media.file_id});
  if(!meta?.file_path)throw new Error('voice_file_path_missing');
  const r=await fetch('https://api.telegram.org/file/bot'+config.KITCHEN_BOT_TOKEN+'/'+meta.file_path);
  if(!r.ok)throw new Error('voice_download_failed');
  const bytes=await r.arrayBuffer();
  if(bytes.byteLength>20*1024*1024)throw new Error('voice_file_too_large');
  return {
    bytes,
    type:msg?.voice?'audio/ogg':String(media.mime_type||'audio/mpeg'),
    filename:msg?.voice?'voice.ogg':'voice-audio'
  };
}

async function transcribeKitchenVoice(msg){
  if(!config.OPENAI_API_KEY)throw new Error('voice_ai_not_configured');
  const media=await downloadKitchenVoice(msg);
  const form=new FormData();
  form.append('model',config.VOICE_TRANSCRIBE_MODEL);
  form.append('language','ru');
  form.append('prompt','Контекст: кухня ресторана, заказы Shaurmeg, статусы Принят, Готовится, Готово, Выполнен.');
  form.append('file',new Blob([media.bytes],{type:media.type}),media.filename);
  const r=await fetch('https://api.openai.com/v1/audio/transcriptions',{
    method:'POST',
    headers:{Authorization:'Bearer '+config.OPENAI_API_KEY},
    body:form
  });
  const j=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error('voice_transcription_failed:'+String(j?.error?.message||r.status));
  const text=String(j?.text||'').trim();
  if(!text)throw new Error('voice_transcription_empty');
  return text.slice(0,2000);
}

async function aiKitchenIntent(transcript){
  const local=voice.parseLocalIntent(transcript);
  if(local.intent!=='unknown'||!config.OPENAI_API_KEY)return local;

  const prompt=[
    'Ты классификатор голосовых команд сотрудника кухни ресторана.',
    'Никаких действий не выполняй. Верни только JSON без markdown.',
    'Допустимые intent: list_active, read_order, set_status, help, unknown.',
    'Допустимые target: latest, oldest, order_number, id.',
    'Допустимые status только для set_status: new, cooking, ready, done.',
    'new = принят; cooking = готовится/начать готовить; ready = готов; done = выполнен/выдан.',
    'Если номер не назван, target=latest и order_ref="".',
    'Формат: {"intent":"...","target":"...","order_ref":"...","status":"..."}.',
    'Команда: '+JSON.stringify(String(transcript||''))
  ].join('\n');

  const r=await fetch('https://api.openai.com/v1/responses',{
    method:'POST',
    headers:{
      Authorization:'Bearer '+config.OPENAI_API_KEY,
      'Content-Type':'application/json'
    },
    body:JSON.stringify({
      model:config.VOICE_INTENT_MODEL,
      input:prompt,
      max_output_tokens:120,
      store:false
    })
  });
  const j=await r.json().catch(()=>({}));
  if(!r.ok){
    console.error('kitchen voice intent',String(j?.error?.message||r.status));
    return local;
  }
  const parsed=voice.parseJsonObject(voice.extractResponseText(j));
  return voice.sanitizeAiIntent(parsed);
}

async function kitchenOrdersForChat(chatId,{activeOnly=true,limit=8,oldestFirst=false}={}){
  const statusClause=activeOnly?"AND o.status NOT IN ('done','cancelled')":'';
  const direction=oldestFirst?'ASC':'DESC';
  const q=await db.query(
    'SELECT o.* FROM shaurma_orders o '+
    'JOIN shaurma_kitchen_access k ON k.establishment_id=o.establishment_id AND k.chat_id=$1 AND k.is_active=TRUE '+
    'WHERE 1=1 '+statusClause+' ORDER BY o.created_at '+direction+' LIMIT $2',
    [String(chatId),Math.max(1,Math.min(20,Number(limit)||8))]
  );
  return q.rows;
}

async function resolveVoiceOrder(chatId,intent,accesses){
  if(intent.target==='id'&&/^\d+$/.test(String(intent.order_ref||''))){
    const q=await db.query(
      'SELECT o.* FROM shaurma_orders o JOIN shaurma_kitchen_access k ON k.establishment_id=o.establishment_id '+
      'AND k.chat_id=$2 AND k.is_active=TRUE WHERE o.id=$1 LIMIT 1',
      [String(intent.order_ref),String(chatId)]
    );
    return q.rows[0]||null;
  }

  if(intent.target==='order_number'&&String(intent.order_ref||'')){
    const q=await db.query(
      'SELECT o.* FROM shaurma_orders o JOIN shaurma_kitchen_access k ON k.establishment_id=o.establishment_id '+
      'AND k.chat_id=$2 AND k.is_active=TRUE WHERE UPPER(o.order_number)=UPPER($1) LIMIT 1',
      [String(intent.order_ref),String(chatId)]
    );
    return q.rows[0]||null;
  }

  if((accesses||[]).length>1)throw new Error('voice_multiple_venues');

  const activeOnly=intent.intent==='set_status';
  let rows=await kitchenOrdersForChat(chatId,{
    activeOnly,
    limit:1,
    oldestFirst:intent.target==='oldest'
  });
  if(!rows.length&&intent.intent==='read_order'){
    rows=await kitchenOrdersForChat(chatId,{
      activeOnly:false,
      limit:1,
      oldestFirst:intent.target==='oldest'
    });
  }
  return rows[0]||null;
}

function voiceOrderSummary(order,multiVenue=false){
  const items=Array.isArray(order?.items)?order.items:[];
  return '• '+String(order?.order_number||('#'+order?.id))+
    (multiVenue?' · '+String(order?.venue_name||''):'')+
    ' · '+orderStatusLabel(order?.status)+
    ' · '+items.reduce((n,x)=>n+Math.max(1,Number(x?.q)||1),0)+' поз.'+
    ' · '+Number(order?.total||0)+' ₽';
}

async function executeKitchenVoice(msg,transcript,intent){
  const chatId=msg?.chat?.id,user=msg?.from;
  const accesses=await kitchenAccesses(chatId);
  if(!accesses.length){
    return call(config.KITCHEN_BOT_TOKEN,'sendMessage',{
      chat_id:chatId,
      text:'Сначала подключите заведение ключом OWN-XXXXXXXXXX.'
    });
  }

  const heard='🎙 Услышал: «'+String(transcript||'').slice(0,500)+'»\n\n';

  if(intent.intent==='help'){
    return call(config.KITCHEN_BOT_TOKEN,'sendMessage',{chat_id:chatId,text:heard+voiceHelpText()});
  }

  if(intent.intent==='list_active'){
    const rows=await kitchenOrdersForChat(chatId,{activeOnly:true,limit:8});
    const body=rows.length
      ? 'Активные заказы:\n'+rows.map(x=>voiceOrderSummary(x,accesses.length>1)).join('\n')
      : 'Активных заказов сейчас нет.';
    return call(config.KITCHEN_BOT_TOKEN,'sendMessage',{chat_id:chatId,text:heard+body});
  }

  if(intent.intent==='read_order'){
    let order;
    try{order=await resolveVoiceOrder(chatId,intent,accesses)}
    catch(e){
      if(e.message==='voice_multiple_venues'){
        return call(config.KITCHEN_BOT_TOKEN,'sendMessage',{chat_id:chatId,text:heard+'В этом чате подключено несколько заведений. Назовите номер заказа, чтобы я не выбрал не то.'});
      }
      throw e;
    }
    if(!order)return call(config.KITCHEN_BOT_TOKEN,'sendMessage',{chat_id:chatId,text:heard+'Доступный заказ не найден.'});
    return call(config.KITCHEN_BOT_TOKEN,'sendMessage',{chat_id:chatId,text:heard+kitchenOrderText(order)});
  }

  if(intent.intent==='set_status'){
    let order;
    try{order=await resolveVoiceOrder(chatId,intent,accesses)}
    catch(e){
      if(e.message==='voice_multiple_venues'){
        return call(config.KITCHEN_BOT_TOKEN,'sendMessage',{chat_id:chatId,text:heard+'В этом чате подключено несколько заведений. Назовите номер заказа, чтобы изменение было однозначным.'});
      }
      throw e;
    }
    if(!order)return call(config.KITCHEN_BOT_TOKEN,'sendMessage',{chat_id:chatId,text:heard+'Активный заказ не найден.'});

    const result=await transitionKitchenOrder(order,chatId,user,intent.status,'voice');
    if(result.same){
      return call(config.KITCHEN_BOT_TOKEN,'sendMessage',{
        chat_id:chatId,
        text:heard+'Заказ '+order.order_number+' уже имеет статус «'+orderStatusLabel(order.status)+'».'
      });
    }
    if(result.blocked){
      const next=result.expected?orderStatusLabel(result.expected):'нет';
      return call(config.KITCHEN_BOT_TOKEN,'sendMessage',{
        chat_id:chatId,
        text:heard+'Статус не изменён. Сейчас «'+orderStatusLabel(order.status)+'». Следующий допустимый статус: «'+next+'».'
      });
    }
    if(result.race){
      return call(config.KITCHEN_BOT_TOKEN,'sendMessage',{
        chat_id:chatId,
        text:heard+'Заказ уже успели обновить. Текущий статус: «'+orderStatusLabel(result.order?.status)+'».'
      });
    }
    return call(config.KITCHEN_BOT_TOKEN,'sendMessage',{
      chat_id:chatId,
      text:heard+'✅ Заказ '+result.order.order_number+' → '+orderStatusLabel(result.order.status)
    });
  }

  return call(config.KITCHEN_BOT_TOKEN,'sendMessage',{
    chat_id:chatId,
    text:heard+'Команду не распознал.\n\n'+voiceHelpText()
  });
}

async function handleKitchenVoice(msg){
  const chatId=msg?.chat?.id;
  if(!chatId)return;
  if(config.VOICE_PROVIDER!=='openai'){
    return call(config.KITCHEN_BOT_TOKEN,'sendMessage',{
      chat_id:chatId,
      text:'🎙 Голосовой ввод сейчас стоит в бесплатном режиме: платные API не вызываются. Диалоговый агент уже готов к голосу; пока используйте текст. Позже подключим локальный STT и подадим его расшифровку в тот же агент.'
    });
  }
  if(!config.OPENAI_API_KEY){
    return call(config.KITCHEN_BOT_TOKEN,'sendMessage',{
      chat_id:chatId,
      text:'Для провайдера OpenAI не задан OPENAI_API_KEY. Платные вызовы не выполняются.'
    });
  }
  try{await call(config.KITCHEN_BOT_TOKEN,'sendChatAction',{chat_id:chatId,action:'typing'})}catch{}
  try{
    const transcript=await transcribeKitchenVoice(msg);
    const localIntent=voice.parseLocalIntent(transcript);
    if(localIntent.intent!=='unknown')return executeKitchenVoice(msg,transcript,localIntent);

    const result=await venueDialogAgent.handle({user:msg?.from,text:transcript});
    if(result?.handled){
      const text='🎙 Услышал: «'+String(transcript).slice(0,500)+'»\n\n'+String(result.text||'');
      return call(config.KITCHEN_BOT_TOKEN,'sendMessage',{
        chat_id:chatId,
        text:text.replace(/<\/?(?:b|code)>/gi,'').slice(0,3900),
        disable_web_page_preview:true,
        ...(result.reply_markup?{reply_markup:result.reply_markup}:{})
      });
    }
    return call(config.KITCHEN_BOT_TOKEN,'sendMessage',{chat_id:chatId,text:'🎙 Услышал: «'+String(transcript).slice(0,500)+'»\n\nНе уверен, что понял запрос. Ничего не меняю.'});
  }catch(e){
    console.error('kitchen voice',e.message);
    const tooLarge=e.message==='voice_file_too_large';
    const noCredits=/no credits remaining|insufficient_quota|billing/i.test(String(e.message||''));
    return call(config.KITCHEN_BOT_TOKEN,'sendMessage',{
      chat_id:chatId,
      text:tooLarge
        ? 'Голосовое слишком большое. Отправьте более короткое сообщение.'
        : noCredits
          ? '🎙 Голосовой помощник временно недоступен: на OpenAI API закончились кредиты. Пополните баланс API-проекта и отправьте голосовое ещё раз.'
          : 'Не удалось обработать голосовую команду. Попробуйте ещё раз или используйте /voice.'
    });
  }
}

async function handleKitchenCallback(query){
  const id=String(query?.id||''),chatId=query?.message?.chat?.id,user=query?.from;
  const agentData=String(query?.data||'');
  if(/^va:/.test(agentData)&&chatId&&user?.id){
    try{
      const result=await venueDialogAgent.handleCallback({user,data:agentData});
      await call(config.KITCHEN_BOT_TOKEN,'answerCallbackQuery',{callback_query_id:id,text:'Принято'});
      if(result?.handled&&result.text){
        return call(config.KITCHEN_BOT_TOKEN,'sendMessage',{
          chat_id:chatId,
          text:String(result.text||'').replace(/<\/?(?:b|code)>/gi,'').slice(0,3900),
          disable_web_page_preview:true,
          ...(result.reply_markup?{reply_markup:result.reply_markup}:{})
        });
      }
      return;
    }catch(e){
      console.error('venue dialog callback',e.message);
      try{await call(config.KITCHEN_BOT_TOKEN,'answerCallbackQuery',{callback_query_id:id,text:'Не удалось обработать выбор',show_alert:true})}catch{}
      return;
    }
  }
  const m=String(query?.data||'').match(/^ko:(\d+):(cooking|ready|done)$/);
  if(!m||!chatId)return;
  try{
    const q=await db.query(`SELECT o.* FROM shaurma_orders o
      JOIN shaurma_kitchen_access k ON k.establishment_id=o.establishment_id AND k.chat_id=$2 AND k.is_active=TRUE
      WHERE o.id=$1 LIMIT 1`,[m[1],String(chatId)]);
    const order=q.rows[0];
    if(!order){
      await call(config.KITCHEN_BOT_TOKEN,'answerCallbackQuery',{callback_query_id:id,text:'Нет доступа к этому заказу',show_alert:true});
      return;
    }
    const result=await transitionKitchenOrder(order,chatId,user,m[2],'button');
    if(!result.changed){
      if(result.order)await refreshKitchenOrderMessages(result.order);
      await call(config.KITCHEN_BOT_TOKEN,'answerCallbackQuery',{
        callback_query_id:id,
        text:result.race?'Заказ уже обновлён':'Статус уже: '+orderStatusLabel(result.order?.status||order.status)
      });
      return;
    }
    await call(config.KITCHEN_BOT_TOKEN,'answerCallbackQuery',{callback_query_id:id,text:orderStatusLabel(result.order.status)+' ✓'});
  }catch(e){
    console.error('kitchen callback',e.message);
    try{await call(config.KITCHEN_BOT_TOKEN,'answerCallbackQuery',{callback_query_id:id,text:'Не удалось изменить статус',show_alert:true})}catch{}
  }
}

async function kitchenPhotoDataUrl(msg){
  const photos=Array.isArray(msg?.photo)?msg.photo:[];
  if(!photos.length)return '';
  const preferred=[...photos].reverse().find(x=>!x.file_size||Number(x.file_size)<=480000)||photos[0];
  const file=await call(config.KITCHEN_BOT_TOKEN,'getFile',{file_id:preferred.file_id});
  if(!file?.file_path)throw new Error('telegram_photo_path_missing');
  const response=await fetch('https://api.telegram.org/file/bot'+config.KITCHEN_BOT_TOKEN+'/'+file.file_path);
  if(!response.ok)throw new Error('telegram_photo_download_failed');
  const ab=await response.arrayBuffer();
  if(ab.byteLength>520000)throw new Error('telegram_photo_too_large');
  const ext=String(file.file_path).split('.').pop().toLowerCase();
  const mime=ext==='png'?'image/png':ext==='webp'?'image/webp':'image/jpeg';
  return 'data:'+mime+';base64,'+Buffer.from(ab).toString('base64');
}

async function handleKitchenMessage(msg){
  const chatId=msg?.chat?.id,user=msg?.from;
  if(!chatId)return;

  if(msg?.photo?.length&&user?.id){
    try{
      const caption=String(msg.caption||'').trim();
      const m=caption.match(/^(?:фото|картинка|изображение)(?:\s+(?:для|позиции|блюда))?\s*(.*)$/i);
      const image=await kitchenPhotoDataUrl(msg);
      const result=await venueCommandBus.setItemImage({user,itemQuery:String(m?.[1]||'').trim(),image});
      return call(config.KITCHEN_BOT_TOKEN,'sendMessage',{chat_id:chatId,text:String(result?.text||'Фото обновлено').replace(/<\/?(?:b|code)>/gi,'').slice(0,3900)});
    }catch(e){
      console.error('kitchen menu photo',e.message);
      return call(config.KITCHEN_BOT_TOKEN,'sendMessage',{chat_id:chatId,text:e.message==='telegram_photo_too_large'?'Фото слишком большое. Отправьте его как обычное фото Telegram, не как файл.':'Не удалось сохранить фото позиции.'});
    }
  }

  if(msg?.voice||msg?.audio)return handleKitchenVoice(msg);
  const raw=String(msg.text||'').trim();
  const start=raw.match(/^\/start(?:@[A-Za-z0-9_]+)?(?:\s+(.+))?$/i);
  const connect=raw.match(/^\/connect(?:@[A-Za-z0-9_]+)?(?:\s+(.+))?$/i);
  const code=normalizeInviteCode(start?.[1]||connect?.[1]||raw);
  const hasCode=/^OWN-[A-F0-9]{10}$/.test(code);

  if(/^\/disconnect(?:@[A-Za-z0-9_]+)?$/i.test(raw)){
    await db.query('UPDATE shaurma_kitchen_access SET is_active=FALSE,updated_at=NOW() WHERE chat_id=$1',[String(chatId)]);
    return call(config.KITCHEN_BOT_TOKEN,'sendMessage',{chat_id:chatId,text:'Доступ кухни отключён. Чтобы подключить заведение снова, отправьте его ключ OWN-…'});
  }

  if(hasCode){
    try{
      const access=await claimKitchenAccess(chatId,user,code);
      return call(config.KITCHEN_BOT_TOKEN,'sendMessage',{
        chat_id:chatId,
        text:'✅ Кухня подключена\n\n'+access.name+'\nТеперь новые заказы этого заведения будут приходить сюда автоматически.\n\nСтатусы: Принят → Готовится → Готово → Выполнен.\n\nЕсли у вас есть права владельца/менеджера, меню можно менять прямо здесь — /assistant.'
      });
    }catch(e){
      return call(config.KITCHEN_BOT_TOKEN,'sendMessage',{chat_id:chatId,text:e.message==='claim_code_invalid_or_expired'?'Ключ не найден или срок его действия истёк.':'Неверный ключ. Формат: OWN-XXXXXXXXXX'});
    }
  }

  if(/^\/voice(?:@[A-Za-z0-9_]+)?$/i.test(raw)){
    return call(config.KITCHEN_BOT_TOKEN,'sendMessage',{chat_id:chatId,text:voiceHelpText()});
  }

  if(start||/^\/status(?:@[A-Za-z0-9_]+)?$/i.test(raw)){
    const accesses=await kitchenAccesses(chatId);
    if(accesses.length){
      return call(config.KITCHEN_BOT_TOKEN,'sendMessage',{
        chat_id:chatId,
        text:'👨‍🍳 Бот приёма заказов Shaurmeg подключён.\n\nЗаведения:\n'+accesses.map(x=>'• '+x.name+' · '+x.establishment_id).join('\n')+'\n\nНовые заказы будут приходить автоматически.\nДля управления меню: /assistant'
      });
    }
    return call(config.KITCHEN_BOT_TOKEN,'sendMessage',{
      chat_id:chatId,
      text:'👨‍🍳 Бот приёма заказов Shaurmeg\n\nОтправьте ключ доступа заведения в формате:\nOWN-XXXXXXXXXX'
    });
  }

  if(raw&&user?.id){
    try{
      const result=await venueDialogAgent.handle({user,text:raw});
      if(result?.handled){
        const text=String(result.text||'').replace(/<\/?(?:b|code)>/gi,'').slice(0,3900);
        return call(config.KITCHEN_BOT_TOKEN,'sendMessage',{
          chat_id:chatId,
          text,
          disable_web_page_preview:true,
          ...(result.reply_markup?{reply_markup:result.reply_markup}:{})
        });
      }
    }catch(e){
      console.error('kitchen venue dialog agent',e.message);
      return call(config.KITCHEN_BOT_TOKEN,'sendMessage',{chat_id:chatId,text:'Не удалось обработать запрос. Ничего не изменено — попробуйте сформулировать иначе.'});
    }
  }

  return call(config.KITCHEN_BOT_TOKEN,'sendMessage',{
    chat_id:chatId,
    text:'Не распознал запрос. Напишите /assistant — покажу примеры управления меню.'
  });
}

async function sync(){
  const mapUrl=config.PUBLIC_APP_URL+'/index.html';
  const adminUrl=config.PUBLIC_APP_URL+'/admin-map.html';
  const venueUrl=config.PUBLIC_APP_URL+'/admin-venue-pro.html?v=20261005-astra3';
  const tasks=[];
  const add=(name,fn)=>tasks.push({name,fn});

  if(config.AGGREGATOR_BOT_TOKEN){
    add('aggregator.menu',()=>call(config.AGGREGATOR_BOT_TOKEN,'setChatMenuButton',{menu_button:{type:'web_app',text:'Карта',web_app:{url:mapUrl}}}));
    add('aggregator.commands',()=>call(config.AGGREGATOR_BOT_TOKEN,'setMyCommands',{commands:[{command:'start',description:'Открыть карту Шаурмега'},{command:'map',description:'Карта заведений'}]}));
    add('aggregator.webhook',()=>call(config.AGGREGATOR_BOT_TOKEN,'setWebhook',{url:config.PUBLIC_API_URL+'/api/v2/telegram/aggregator',allowed_updates:['message']}));
  }

  if(config.CLIENT_BOT_TOKEN){
    add('client.menu',()=>call(config.CLIENT_BOT_TOKEN,'setChatMenuButton',{menu_button:{type:'web_app',text:'Выбрать заведение',web_app:{url:mapUrl}}}));
    add('client.commands',()=>call(config.CLIENT_BOT_TOKEN,'setMyCommands',{commands:[{command:'start',description:'Открыть меню выбранной точки'},{command:'menu',description:'Открыть меню'}]}));
    add('client.webhook',()=>call(config.CLIENT_BOT_TOKEN,'setWebhook',{url:config.PUBLIC_API_URL+'/api/v2/telegram/client',allowed_updates:['message']}));
  }

  if(config.ADMIN_BOT_TOKEN){
    add('admin.menu',()=>call(config.ADMIN_BOT_TOKEN,'setChatMenuButton',{menu_button:{type:'web_app',text:'Админка карты',web_app:{url:adminUrl}}}));
  }
  if(config.VENUE_OWNER_BOT_TOKEN){
    add('venue.menu',()=>call(config.VENUE_OWNER_BOT_TOKEN,'setChatMenuButton',{menu_button:{type:'web_app',text:'Мои заведения',web_app:{url:venueUrl}}}));
  }
  if(config.KITCHEN_BOT_TOKEN){
    add('kitchen.commands',()=>call(config.KITCHEN_BOT_TOKEN,'setMyCommands',{commands:[
      {command:'start',description:'Подключить приём заказов'},
      {command:'status',description:'Показать подключённые заведения'},
      {command:'voice',description:'Голосовые команды кухни'},
      {command:'assistant',description:'Управление меню и точкой'},
      {command:'connect',description:'Подключить заведение по ключу'},
      {command:'disconnect',description:'Отключить этот чат от заказов'}
    ]}));
    add('kitchen.webhook',()=>call(config.KITCHEN_BOT_TOKEN,'setWebhook',{url:config.PUBLIC_API_URL+'/api/v2/telegram/kitchen',allowed_updates:['message','callback_query']}));
  }

  let ok=0;
  let failed=0;
  for(const task of tasks){
    try{await task.fn();ok++}
    catch(e){failed++;console.error('Shaurmeg v2 Telegram sync '+task.name+':',e.message)}
    await sleep(TELEGRAM_SYNC_DELAY_MS);
  }

  console.log('Shaurmeg v2 Telegram sync · '+ok+' ok · '+failed+' failed · app '+config.PUBLIC_APP_URL);
  if(config.KITCHEN_BOT_TOKEN){
    try{
      const [me,webhook]=await Promise.all([
        call(config.KITCHEN_BOT_TOKEN,'getMe',{}),
        call(config.KITCHEN_BOT_TOKEN,'getWebhookInfo',{})
      ]);
      console.log('Kitchen bot diagnostics · @'+String(me?.username||'')+' · configured @'+String(config.KITCHEN_BOT_USERNAME||'')+' · webhook '+String(webhook?.url||'')+' · pending '+Number(webhook?.pending_update_count||0)+(webhook?.last_error_message?' · last_error '+String(webhook.last_error_message):''));
    }catch(e){console.error('Kitchen bot diagnostics failed:',e.message)}
  }
  return {ok:failed===0,total:tasks.length,failed};
}

function install(app){
  app.post('/api/v2/telegram/aggregator',async(req,res)=>{
    res.sendStatus(200);
    try{
      const msg=req.body?.message;
      if(!msg?.chat?.id)return;
      if(!/^\/(start|map)/i.test(String(msg.text||'')))return;
      await call(config.AGGREGATOR_BOT_TOKEN,'sendMessage',{
        chat_id:msg.chat.id,
        text:'🗺 Шаурмег — выберите заведение на карте.',
        reply_markup:{inline_keyboard:[[{text:'Открыть карту',web_app:{url:config.PUBLIC_APP_URL+'/index.html'}}]]}
      });
    }catch(e){console.error('aggregator webhook',e.message)}
  });

  app.post('/api/v2/telegram/client',async(req,res)=>{
    res.sendStatus(200);
    try{
      const msg=req.body?.message;
      if(!msg?.chat?.id)return;
      const raw=String(msg.text||'');
      const m=raw.match(/^\/(?:start|menu)(?:@[A-Za-z0-9_]+)?(?:\s+order_(\d+))?/i);
      if(!m)return;

      if(!m[1]){
        return call(config.CLIENT_BOT_TOKEN,'sendMessage',{chat_id:msg.chat.id,text:'Сначала выберите заведение на карте Шаурмега.'});
      }

      const q=await db.query(
        `SELECT m.id,m.establishment_id,m.name,m.address,v.menu
         FROM shaurmeg_markers m
         JOIN shaurma_venues v ON v.venue_id=m.venue_id
         WHERE m.id=$1 AND m.is_active=TRUE AND v.is_active=TRUE`,
        [m[1]]
      );
      const x=q.rows[0];
      if(!x){
        return call(config.CLIENT_BOT_TOKEN,'sendMessage',{chat_id:msg.chat.id,text:'Эта точка недоступна. Выберите её заново на карте.'});
      }

      return call(config.CLIENT_BOT_TOKEN,'sendMessage',{
        chat_id:msg.chat.id,
        text:'🥙 '+x.name+(x.address?'\n'+x.address:''),
        reply_markup:{inline_keyboard:[[{text:'Открыть меню и заказать',web_app:{url:menuUrl(x.id,x.establishment_id)}}]]}
      });
    }catch(e){console.error('client webhook',e.message)}
  });

  app.get('/api/v2/telegram/kitchen-health',async(req,res)=>{
    if(!config.KITCHEN_BOT_TOKEN)return res.json({ok:false,enabled:false});
    try{
      const [me,webhook]=await Promise.all([
        call(config.KITCHEN_BOT_TOKEN,'getMe',{}),
        call(config.KITCHEN_BOT_TOKEN,'getWebhookInfo',{})
      ]);
      res.json({
        ok:true,
        enabled:true,
        bot:{id:String(me?.id||''),username:String(me?.username||''),first_name:String(me?.first_name||'')},
        configured_username:config.KITCHEN_BOT_USERNAME||'',
        webhook:{
          url:String(webhook?.url||''),
          pending_update_count:Number(webhook?.pending_update_count||0),
          last_error_date:webhook?.last_error_date||null,
          last_error_message:String(webhook?.last_error_message||''),
          max_connections:webhook?.max_connections||null,
          allowed_updates:webhook?.allowed_updates||[]
        }
      });
    }catch(e){res.status(503).json({ok:false,enabled:true,error:String(e.message||'telegram_health_failed')})}
  });

  app.post('/api/v2/telegram/kitchen',async(req,res)=>{
    res.sendStatus(200);
    if(!config.KITCHEN_BOT_TOKEN)return;
    try{
      const kind=req.body?.callback_query?'callback_query':req.body?.message?'message':'other';
      const chatId=req.body?.message?.chat?.id||req.body?.callback_query?.message?.chat?.id||'';
      console.log('Kitchen webhook update · '+kind+(chatId?' · chat '+chatId:''));
      if(req.body?.callback_query)return handleKitchenCallback(req.body.callback_query);
      if(req.body?.message)return handleKitchenMessage(req.body.message);
    }catch(e){console.error('kitchen webhook',e.message)}
  });
}

module.exports={sync,install,sendClientMessage,notifyKitchenOrder,refreshKitchenOrderMessages,orderStatusLabel};
