'use strict';
const crypto=require('crypto');
const config=require('./config');
const db=require('./db');
const rt=require('./realtime');

const TELEGRAM_MAX_RETRIES=3;
const TELEGRAM_SYNC_DELAY_MS=300;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

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

function normalizeInviteCode(v){return String(v||'').trim().toUpperCase().replace(/\s+/g,'')}
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

async function handleKitchenCallback(query){
  const id=String(query?.id||''),chatId=query?.message?.chat?.id,user=query?.from;
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
    const expected=nextKitchenStatus(order.status);
    if(expected!==m[2]){
      await refreshKitchenOrderMessages(order);
      await call(config.KITCHEN_BOT_TOKEN,'answerCallbackQuery',{callback_query_id:id,text:'Статус уже: '+orderStatusLabel(order.status)});
      return;
    }
    const upd=await db.query('UPDATE shaurma_orders SET status=$3,updated_at=NOW() WHERE id=$1 AND establishment_id=$2 AND status=$4 RETURNING *',
      [order.id,order.establishment_id,m[2],order.status]);
    const changed=upd.rows[0];
    if(!changed){
      const latest=(await db.query('SELECT * FROM shaurma_orders WHERE id=$1',[order.id])).rows[0];
      if(latest)await refreshKitchenOrderMessages(latest);
      await call(config.KITCHEN_BOT_TOKEN,'answerCallbackQuery',{callback_query_id:id,text:'Заказ уже обновлён'});
      return;
    }
    await db.query("INSERT INTO shaurma_venue_audit(establishment_id,telegram_user_id,action,payload) VALUES($1,$2,'kitchen_order_status_updated',$3::jsonb)",
      [changed.establishment_id,String(user?.id||''),JSON.stringify({order_id:changed.id,status:changed.status,chat_id:String(chatId)})]);
    rt.pushOwner('update',changed);
    rt.pushVenue(changed.establishment_id,'update',changed);
    if(changed.telegram_user_id)rt.pushUser(changed.telegram_user_id,'update',changed);
    await Promise.all([refreshKitchenOrderMessages(changed),notifyCustomerStatus(changed)]);
    await call(config.KITCHEN_BOT_TOKEN,'answerCallbackQuery',{callback_query_id:id,text:orderStatusLabel(changed.status)+' ✓'});
  }catch(e){
    console.error('kitchen callback',e.message);
    try{await call(config.KITCHEN_BOT_TOKEN,'answerCallbackQuery',{callback_query_id:id,text:'Не удалось изменить статус',show_alert:true})}catch{}
  }
}

async function handleKitchenMessage(msg){
  const chatId=msg?.chat?.id,user=msg?.from;
  if(!chatId)return;
  const raw=String(msg.text||'').trim();
  const start=raw.match(/^\/start(?:@[A-Za-z0-9_]+)?(?:\s+(.+))?$/i);
  const connect=raw.match(/^\/connect(?:@[A-Za-z0-9_]+)?(?:\s+(.+))?$/i);
  const direct=raw.match(/^(OWN-[A-F0-9]{10})$/i);
  const code=normalizeInviteCode(start?.[1]||connect?.[1]||direct?.[1]||'');

  if(/^\/disconnect(?:@[A-Za-z0-9_]+)?$/i.test(raw)){
    await db.query('UPDATE shaurma_kitchen_access SET is_active=FALSE,updated_at=NOW() WHERE chat_id=$1',[String(chatId)]);
    return call(config.KITCHEN_BOT_TOKEN,'sendMessage',{chat_id:chatId,text:'Доступ кухни отключён. Чтобы подключить заведение снова, отправьте его ключ OWN-…'});
  }

  if(code){
    try{
      const access=await claimKitchenAccess(chatId,user,code);
      return call(config.KITCHEN_BOT_TOKEN,'sendMessage',{
        chat_id:chatId,
        text:'✅ Кухня подключена\n\n'+access.name+'\nТеперь новые заказы этого заведения будут приходить сюда автоматически.\n\nСтатусы: Принят → Готовится → Готово → Выполнен.'
      });
    }catch(e){
      return call(config.KITCHEN_BOT_TOKEN,'sendMessage',{chat_id:chatId,text:e.message==='claim_code_invalid_or_expired'?'Ключ не найден или срок его действия истёк.':'Неверный ключ. Формат: OWN-XXXXXXXXXX'});
    }
  }

  if(start||/^\/status(?:@[A-Za-z0-9_]+)?$/i.test(raw)){
    const accesses=await kitchenAccesses(chatId);
    if(accesses.length){
      return call(config.KITCHEN_BOT_TOKEN,'sendMessage',{
        chat_id:chatId,
        text:'👨‍🍳 Бот приёма заказов Shaurmeg подключён.\n\nЗаведения:\n'+accesses.map(x=>'• '+x.name+' · '+x.establishment_id).join('\n')+'\n\nНовые заказы будут приходить автоматически.'
      });
    }
    return call(config.KITCHEN_BOT_TOKEN,'sendMessage',{
      chat_id:chatId,
      text:'👨‍🍳 Бот приёма заказов Shaurmeg\n\nОтправьте ключ доступа заведения в формате:\nOWN-XXXXXXXXXX\n\nМожно использовать тот же ключ, который выдан для подключения заведения к кабинету владельца.'
    });
  }
}

async function sync(){
  const mapUrl=config.PUBLIC_APP_URL+'/index.html';
  const adminUrl=config.PUBLIC_APP_URL+'/admin-map.html';
  const venueUrl=config.PUBLIC_APP_URL+'/admin-venue.html';
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

  app.post('/api/v2/telegram/kitchen',async(req,res)=>{
    res.sendStatus(200);
    if(!config.KITCHEN_BOT_TOKEN)return;
    try{
      if(req.body?.callback_query)return handleKitchenCallback(req.body.callback_query);
      if(req.body?.message)return handleKitchenMessage(req.body.message);
    }catch(e){console.error('kitchen webhook',e.message)}
  });
}

module.exports={sync,install,sendClientMessage,notifyKitchenOrder,refreshKitchenOrderMessages,orderStatusLabel};
