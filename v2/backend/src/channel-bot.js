'use strict';

const config=require('./config');
const db=require('./db');
const content=require('./channel-content');

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let runtimeUsername='';
let runtimeChannelChatId='';

async function call(method,body={},attempt=0){
  const token=config.CHANNEL_BOT_TOKEN;
  if(!token)return null;
  const r=await fetch('https://api.telegram.org/bot'+token+'/'+method,{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify(body)
  });
  const j=await r.json().catch(()=>({}));
  if((r.status===429||j.error_code===429)&&attempt<3){
    const delay=(Math.max(1,Number(j.parameters?.retry_after)||1)*1000)+250;
    await sleep(delay);
    return call(method,body,attempt+1);
  }
  if(!r.ok||!j.ok){
    const e=new Error(j.description||method+'_failed');
    e.status=r.status;
    e.telegram=j;
    throw e;
  }
  return j.result;
}

function allAdminIds(){
  const out=new Set();
  for(const id of (config.ADMIN_IDS||[]))out.add(String(id));
  for(const id of (config.CHANNEL_BOT_ADMIN_IDS||[]))out.add(String(id));
  return out;
}
function isAdmin(userId){return allAdminIds().has(String(userId||''))}
function configuredChannelChatId(){
  const raw=String(config.CHANNEL_CHAT_ID||'').trim();
  if(!raw)return '';
  if(/^@[-_A-Za-z0-9]{4,}$/.test(raw)||/^-100\d+$/.test(raw))return raw;
  return '';
}
function channelChatId(){return String(runtimeChannelChatId||configuredChannelChatId()||'').trim()}
function assetUrl(post){
  const base=String(config.CHANNEL_ASSET_BASE_URL||config.PUBLIC_API_URL||'').replace(/\/+$/,'');
  const path=String(post?.media?.path||'').replace(/^\/+/, '');
  return base&&path?base+'/'+path:'';
}
function botUrl(start=''){
  const username=String(runtimeUsername||config.CHANNEL_BOT_USERNAME||'').replace(/^@/,'');
  if(!username)return '';
  return 'https://t.me/'+username+(start?'?start='+encodeURIComponent(start):'');
}
function channelAdminUrl(){
  const username=String(runtimeUsername||config.CHANNEL_BOT_USERNAME||'').replace(/^@/,'');
  if(!username)return '';
  return 'https://t.me/'+username+'?startchannel&admin=post_messages+edit_messages+delete_messages';
}
function connectKeyboard(){
  const url=botUrl('connect');
  return url?{inline_keyboard:[[{text:'Подключить заведение',url}]]}:null;
}
function publicKeyboard(){
  return {inline_keyboard:[
    [{text:'🟠 Подключить заведение',callback_data:'lead:start'}],
    [{text:'⚡ Как подключается',callback_data:'lead:how'},{text:'🧩 Возможности',callback_data:'lead:features'}],
    [{text:'🗺 Открыть Шаурмег',url:config.PUBLIC_APP_URL+'/index.html'}]
  ]};
}
function adminKeyboard(){
  const rows=[
    [{text:'📚 Каталог',callback_data:'admin:catalog'},{text:'🚀 Публикация запуска',callback_data:'admin:launch'}],
    [{text:'📥 Новые заявки',callback_data:'admin:leads'}]
  ];
  const adminUrl=channelAdminUrl();
  if(adminUrl)rows.push([{text:'➕ Добавить бота в канал',url:adminUrl}]);
  return {inline_keyboard:rows};
}

async function bootstrap(){
  if(!db.configured)return;
  await db.query(`
    CREATE TABLE IF NOT EXISTS shaurmeg_channel_publications(
      id BIGSERIAL PRIMARY KEY,
      slug TEXT NOT NULL,
      channel_chat_id TEXT NOT NULL,
      message_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
      published_by TEXT NOT NULL DEFAULT '',
      published_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_channel_publications_slug ON shaurmeg_channel_publications(slug,published_at DESC);

    CREATE TABLE IF NOT EXISTS shaurmeg_channel_leads(
      telegram_user_id TEXT PRIMARY KEY,
      chat_id TEXT NOT NULL,
      telegram_username TEXT NOT NULL DEFAULT '',
      telegram_first_name TEXT NOT NULL DEFAULT '',
      stage TEXT NOT NULL DEFAULT 'venue_name',
      venue_name TEXT NOT NULL DEFAULT '',
      city TEXT NOT NULL DEFAULT '',
      locations_count INT,
      contact TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'draft',
      source TEXT NOT NULL DEFAULT 'telegram_channel',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_channel_leads_status ON shaurmeg_channel_leads(status,updated_at DESC);

    CREATE TABLE IF NOT EXISTS shaurmeg_channel_settings(
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL DEFAULT '',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  const q=await db.query("SELECT value FROM shaurmeg_channel_settings WHERE key='channel_chat_id' LIMIT 1");
  runtimeChannelChatId=String(q.rows[0]?.value||'').trim();
}

async function sendText(chatId,text,replyMarkup=null,opts={}){
  const body={chat_id:chatId,text:String(text||'').slice(0,4090),disable_web_page_preview:true};
  if(replyMarkup)body.reply_markup=replyMarkup;
  if(opts.parse_mode)body.parse_mode=opts.parse_mode;
  return call('sendMessage',body);
}

async function postToChannel(post,publishedBy=''){
  const chatId=channelChatId();
  if(!chatId)throw new Error('channel_chat_id_not_configured');
  const text=String(post.text||'');
  const media=assetUrl(post);
  const buttons=post.cta==='connect'?connectKeyboard():null;
  const parseMode=post.format||'';
  const messageIds=[];

  if(media&&post.media?.kind){
    try{
      const kind=String(post.media.kind);
      if(text.length<=1000&&['photo','video','animation'].includes(kind)){
        const method={photo:'sendPhoto',video:'sendVideo',animation:'sendAnimation'}[kind];
        const field={photo:'photo',video:'video',animation:'animation'}[kind];
        const msg=await call(method,{chat_id:chatId,[field]:media,caption:text,...(parseMode?{parse_mode:parseMode}:{}),...(buttons?{reply_markup:buttons}:{})});
        if(msg?.message_id)messageIds.push(msg.message_id);
      }else{
        const method={photo:'sendPhoto',video:'sendVideo',animation:'sendAnimation'}[kind];
        const field={photo:'photo',video:'video',animation:'animation'}[kind];
        if(method){
          const mediaMsg=await call(method,{chat_id:chatId,[field]:media});
          if(mediaMsg?.message_id)messageIds.push(mediaMsg.message_id);
        }
        const msg=await sendText(chatId,text,buttons,parseMode?{parse_mode:parseMode}:{});
        if(msg?.message_id)messageIds.push(msg.message_id);
      }
    }catch(e){
      console.warn('channel media fallback',post.slug,e.message);
      const msg=await sendText(chatId,text,buttons,parseMode?{parse_mode:parseMode}:{});
      if(msg?.message_id)messageIds.push(msg.message_id);
    }
  }else{
    const msg=await sendText(chatId,text,buttons,parseMode?{parse_mode:parseMode}:{});
    if(msg?.message_id)messageIds.push(msg.message_id);
  }

  if(db.configured&&messageIds.length){
    await db.query(`INSERT INTO shaurmeg_channel_publications(slug,channel_chat_id,message_ids,published_by)
      VALUES($1,$2,$3::jsonb,$4)`,[post.slug,String(chatId),JSON.stringify(messageIds),String(publishedBy||'')]);
  }
  if(post.pin&&messageIds.length){
    try{await call('pinChatMessage',{chat_id:chatId,message_id:messageIds[messageIds.length-1],disable_notification:true})}
    catch(e){console.warn('channel pin',post.slug,e.message)}
  }
  return {slug:post.slug,message_ids:messageIds};
}

async function unpublish(slug){
  if(!db.configured)throw new Error('database_required');
  const q=await db.query(`SELECT id,channel_chat_id,message_ids FROM shaurmeg_channel_publications
    WHERE slug=$1 ORDER BY published_at DESC LIMIT 1`,[slug]);
  const row=q.rows[0];
  if(!row)return false;
  const ids=Array.isArray(row.message_ids)?row.message_ids:[];
  for(const id of ids){
    try{await call('deleteMessage',{chat_id:row.channel_chat_id,message_id:Number(id)})}
    catch(e){console.warn('channel delete',slug,id,e.message)}
  }
  await db.query('DELETE FROM shaurmeg_channel_publications WHERE id=$1',[row.id]);
  return true;
}

function catalogText(){
  return ['📚 Контент запуска','',...content.list().map(p=>`${String(p.order).padStart(3,'0')} · ${p.slug} — ${p.title}`),'','Команды:','/preview <slug>','/publish <slug>','/publish_launch','/unpublish <slug>','/leads'].join('\n');
}
function helpText(){
  return ['Управление каналом Шаурмега','',
    '/catalog — список материалов',
    '/preview <slug> — предпросмотр',
    '/publish <slug> — опубликовать один материал',
    '/publish_launch — опубликовать стартовую серию по порядку',
    '/unpublish <slug> — удалить последнюю публикацию этого материала',
    '/leads — последние заявки на подключение',
    '/status — диагностика канала и бота'].join('\n');
}

async function beginLead(msg){
  if(!db.configured)return sendText(msg.chat.id,'Сейчас форма подключения недоступна. Напишите администратору канала.');
  const user=msg.from||{};
  await db.query(`INSERT INTO shaurmeg_channel_leads(telegram_user_id,chat_id,telegram_username,telegram_first_name,stage,status,updated_at)
    VALUES($1,$2,$3,$4,'venue_name','draft',NOW())
    ON CONFLICT(telegram_user_id) DO UPDATE SET chat_id=EXCLUDED.chat_id,telegram_username=EXCLUDED.telegram_username,
      telegram_first_name=EXCLUDED.telegram_first_name,stage='venue_name',status='draft',venue_name='',city='',locations_count=NULL,contact='',updated_at=NOW()`,
    [String(user.id),String(msg.chat.id),String(user.username||''),String(user.first_name||'')]);
  return sendText(msg.chat.id,'Начнём с самого важного.\n\nКак называется заведение?\n\nМожно написать обычным сообщением. Для отмены — /cancel');
}

async function leadRow(userId){
  if(!db.configured)return null;
  const q=await db.query('SELECT * FROM shaurmeg_channel_leads WHERE telegram_user_id=$1 LIMIT 1',[String(userId)]);
  return q.rows[0]||null;
}
async function cancelLead(msg){
  if(db.configured)await db.query("UPDATE shaurmeg_channel_leads SET status='cancelled',stage='done',updated_at=NOW() WHERE telegram_user_id=$1",[String(msg.from?.id||'')]);
  return sendText(msg.chat.id,'Хорошо, заявку остановил. В любой момент можно снова нажать «Подключить заведение».',publicKeyboard());
}

async function notifyAdmins(row){
  const text=[
    '🆕 Новая заявка на подключение Шаурмега',
    '',
    'Заведение: '+row.venue_name,
    'Город: '+row.city,
    'Точек: '+(row.locations_count||1),
    'Контакт: '+row.contact,
    'Telegram: '+(row.telegram_username?'@'+row.telegram_username:'id '+row.telegram_user_id)
  ].join('\n');
  for(const adminId of allAdminIds()){
    try{await sendText(adminId,text)}catch(e){console.warn('lead admin notify',adminId,e.message)}
  }
}

async function continueLead(msg){
  const userId=String(msg.from?.id||'');
  const row=await leadRow(userId);
  if(!row||row.status!=='draft'||row.stage==='done')return false;
  const raw=String(msg.contact?.phone_number||msg.text||'').trim();
  if(!raw)return true;
  if(/^\/cancel\b/i.test(raw)){await cancelLead(msg);return true}

  if(row.stage==='venue_name'){
    await db.query("UPDATE shaurmeg_channel_leads SET venue_name=$2,stage='city',updated_at=NOW() WHERE telegram_user_id=$1",[userId,raw.slice(0,180)]);
    await sendText(msg.chat.id,'В каком городе находится заведение?');
    return true;
  }
  if(row.stage==='city'){
    await db.query("UPDATE shaurmeg_channel_leads SET city=$2,stage='locations',updated_at=NOW() WHERE telegram_user_id=$1",[userId,raw.slice(0,120)]);
    await sendText(msg.chat.id,'Сколько точек хотите подключить?\n\nНапример: 1');
    return true;
  }
  if(row.stage==='locations'){
    const n=Math.max(1,Math.min(999,Number.parseInt(raw,10)||1));
    await db.query("UPDATE shaurmeg_channel_leads SET locations_count=$2,stage='contact',updated_at=NOW() WHERE telegram_user_id=$1",[userId,n]);
    await sendText(msg.chat.id,'Оставьте телефон или удобный контакт в Telegram.\n\nНапример: +7… или @username');
    return true;
  }
  if(row.stage==='contact'){
    const q=await db.query(`UPDATE shaurmeg_channel_leads SET contact=$2,status='new',stage='done',updated_at=NOW()
      WHERE telegram_user_id=$1 RETURNING *`,[userId,raw.slice(0,180)]);
    const done=q.rows[0];
    await sendText(msg.chat.id,'Готово ✅\n\nЗаявка сохранена и передана администратору. Дальше уже можно обсуждать конкретную точку, меню и подключение — без повторного заполнения анкеты.');
    if(done)await notifyAdmins(done);
    return true;
  }
  return false;
}

async function recentLeadsText(){
  if(!db.configured)return 'База данных не подключена.';
  const q=await db.query(`SELECT venue_name,city,locations_count,contact,telegram_username,telegram_user_id,updated_at
    FROM shaurmeg_channel_leads WHERE status='new' ORDER BY updated_at DESC LIMIT 10`);
  if(!q.rows.length)return 'Новых заявок пока нет.';
  const lines=['📥 Последние заявки',''];
  q.rows.forEach((x,i)=>{
    lines.push(`${i+1}. ${x.venue_name||'Без названия'} · ${x.city||'город не указан'} · ${x.locations_count||1} точк.`);
    lines.push(`   ${x.contact||'-'} · ${x.telegram_username?'@'+x.telegram_username:'id '+x.telegram_user_id}`);
  });
  return lines.join('\n');
}

async function adminStatusText(){
  const lines=['⚙️ Channel bot',''];
  lines.push('Bot token: '+(config.CHANNEL_BOT_TOKEN?'configured':'missing'));
  lines.push('Channel: '+(config.CHANNEL_CHAT_ID||'missing'));
  lines.push('Assets: '+(config.CHANNEL_ASSET_BASE_URL||'text fallback'));
  lines.push('Admins: '+allAdminIds().size);
  if(config.CHANNEL_BOT_TOKEN){
    try{
      const [me,webhook]=await Promise.all([call('getMe',{}),call('getWebhookInfo',{})]);
      runtimeUsername=String(me?.username||runtimeUsername||'');
      lines.push('Bot: @'+runtimeUsername);
      lines.push('Webhook: '+String(webhook?.url||'not set'));
      lines.push('Pending updates: '+Number(webhook?.pending_update_count||0));
      if(webhook?.last_error_message)lines.push('Last error: '+String(webhook.last_error_message));
      const target=channelChatId();
      if(target){
        try{
          const member=await call('getChatMember',{chat_id:target,user_id:me.id});
          lines.push('Channel access: '+String(member?.status||'unknown'));
          if(member?.status==='administrator'){
            lines.push('Can post: '+(member.can_post_messages!==false?'yes':'no'));
            lines.push('Can edit/pin: '+(member.can_edit_messages!==false?'yes':'no'));
            lines.push('Can delete: '+(member.can_delete_messages!==false?'yes':'no'));
          }
        }catch(e){lines.push('Channel access: not added / '+String(e.message||'unavailable'))}
      }
    }catch(e){lines.push('Telegram: '+e.message)}
  }
  return lines.join('\n');
}

async function handleAdminMessage(msg){
  const text=String(msg.text||'').trim();
  const chatId=msg.chat.id;
  if(/^\/start\b/i.test(text))return sendText(chatId,'Панель управления каналом Шаурмега.',adminKeyboard());
  if(/^\/help\b/i.test(text))return sendText(chatId,helpText());
  if(/^\/catalog\b/i.test(text))return sendText(chatId,catalogText());
  if(/^\/leads\b/i.test(text))return sendText(chatId,await recentLeadsText());
  if(/^\/status\b/i.test(text))return sendText(chatId,await adminStatusText());

  let m=text.match(/^\/preview\s+([a-z0-9-]+)/i);
  if(m){
    const post=content.get(m[1]);
    if(!post)return sendText(chatId,'Не нашёл материал «'+m[1]+'».');
    return sendText(chatId,'PREVIEW · '+post.title+'\n\n'+post.text,post.cta==='connect'?connectKeyboard():null);
  }
  m=text.match(/^\/publish\s+([a-z0-9-]+)/i);
  if(m){
    const post=content.get(m[1]);
    if(!post)return sendText(chatId,'Не нашёл материал «'+m[1]+'».');
    const result=await postToChannel(post,msg.from?.id);
    return sendText(chatId,'Опубликовано ✅\n'+post.title+'\nmessages: '+result.message_ids.join(', '));
  }
  m=text.match(/^\/unpublish\s+([a-z0-9-]+)/i);
  if(m){
    const ok=await unpublish(m[1]);
    return sendText(chatId,ok?'Последняя публикация удалена.':'Публикация не найдена.');
  }
  if(/^\/publish_launch\b/i.test(text)){
    const results=[];
    for(const post of content.launch()){
      results.push(await postToChannel(post,msg.from?.id));
      await sleep(750);
    }
    return sendText(chatId,'Стартовая серия опубликована ✅\nМатериалов: '+results.length);
  }
  return false;
}

async function handlePublicMessage(msg){
  const text=String(msg.text||'').trim();
  if(/^\/cancel\b/i.test(text))return cancelLead(msg);
  if(/^\/connect\b/i.test(text)||/^\/start(?:@[A-Za-z0-9_]+)?\s+connect\b/i.test(text))return beginLead(msg);
  if(/^\/start\b/i.test(text)||/^\/about\b/i.test(text)){
    return sendText(msg.chat.id,'Шаурмег помогает заведению получить точку на карте, собственное меню, заказ, статусы и управление внутри одной Telegram-экосистемы.\n\nЗдесь можно сразу начать подключение или посмотреть, как устроена система.',publicKeyboard());
  }
  if(await continueLead(msg))return true;
  return sendText(msg.chat.id,'Выберите действие ниже.',publicKeyboard());
}

async function handleCallback(q){
  try{await call('answerCallbackQuery',{callback_query_id:q.id})}catch{}
  const data=String(q.data||'');
  const msg=q.message;
  if(!msg?.chat?.id)return;
  if(isAdmin(q.from?.id)){
    if(data==='admin:catalog')return sendText(msg.chat.id,catalogText());
    if(data==='admin:leads')return sendText(msg.chat.id,await recentLeadsText());
    if(data==='admin:launch')return sendText(msg.chat.id,'Для защиты от случайной публикации используйте команду /publish_launch.');
  }
  if(data==='lead:start')return beginLead({...msg,from:q.from});
  if(data==='lead:how')return sendText(msg.chat.id,'Подключение строится по пяти шагам: создаём точку → привязываем владельца → загружаем меню и оформление → подключаем приём заказов → проверяем и публикуем.\n\nНачать можно прямо здесь.',{inline_keyboard:[[{text:'🟠 Подключить заведение',callback_data:'lead:start'}]]});
  if(data==='lead:features')return sendText(msg.chat.id,'Карта заведений, персональное меню, корзина, заказы и статусы, избранное, история, управление владельца, отдельный бот кухни и настраиваемый визуальный слой точки.\n\nВ канале каждая функция будет показана отдельно.',publicKeyboard());
}

async function handleMessage(msg){
  if(!msg?.chat?.id||!msg?.from?.id)return;
  if(msg.chat.type!=='private')return;
  if(isAdmin(msg.from.id)){
    const handled=await handleAdminMessage(msg);
    if(handled!==false)return handled;
  }
  return handlePublicMessage(msg);
}

async function bindChannel(chat,triggerPublish=false){
  if(!chat?.id||!['channel','supergroup'].includes(String(chat.type||'')))return false;
  runtimeChannelChatId=String(chat.id);
  if(db.configured){
    await db.query(`INSERT INTO shaurmeg_channel_settings(key,value,updated_at) VALUES('channel_chat_id',$1,NOW())
      ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=NOW()`,[runtimeChannelChatId]);
  }
  console.log('Shaurmeg channel bound · '+runtimeChannelChatId+' · '+String(chat.title||chat.username||''));
  try{await call('setChatDescription',{chat_id:runtimeChannelChatId,description:'Шаурмег — карта, меню, заказы, live-статусы и управление заведением в одной Telegram-экосистеме. Подключение — через бота канала.'})}catch(e){console.warn('channel description',e.message)}
  if(triggerPublish)setTimeout(()=>publishLaunchMissing().then(r=>console.log('Channel launch after bind · '+(r.published||0)+' published · '+(r.failed||0)+' failed')).catch(e=>console.error('channel launch after bind',e.message)),1200);
  return true;
}

async function discoverPendingChannel(){
  try{
    await call('deleteWebhook',{drop_pending_updates:false});
    const updates=await call('getUpdates',{timeout:0,limit:100,allowed_updates:['my_chat_member','channel_post']})||[];
    for(const u of updates){
      const chat=u?.my_chat_member?.chat||u?.channel_post?.chat;
      if(chat&&['channel','supergroup'].includes(String(chat.type||''))){
        await bindChannel(chat,false);
        return true;
      }
    }
  }catch(e){console.warn('channel discovery',e.message)}
  return false;
}

async function sync(){
  if(!config.CHANNEL_BOT_TOKEN)return {enabled:false};
  try{
    const me=await call('getMe',{});
    runtimeUsername=String(me?.username||'');
  }catch(e){console.error('channel bot getMe',e.message)}
  try{await call('setMyName',{name:'Шаурмег • подключение'})}catch(e){console.warn('channel bot name',e.message)}
  try{await call('setMyDescription',{description:'Официальный бот Шаурмега: подключение заведения, возможности продукта и заявки на запуск.'})}catch(e){console.warn('channel bot description',e.message)}
  try{await call('setMyShortDescription',{short_description:'Подключение заведения к Шаурмегу'})}catch(e){console.warn('channel bot short description',e.message)}
  await discoverPendingChannel();
  const boundChat=channelChatId();
  if(boundChat){
    try{await call('setChatDescription',{chat_id:boundChat,description:'Шаурмег — карта, меню, заказы, live-статусы и управление заведением в одной Telegram-экосистеме. Подключение — через бота канала.'})}
    catch(e){console.warn('channel description',e.message)}
  }

  const commands=[
    {command:'start',description:'О Шаурмеге'},
    {command:'connect',description:'Подключить заведение'},
    {command:'about',description:'Возможности продукта'}
  ];
  await call('setMyDefaultAdministratorRights',{
    for_channels:true,
    rights:{
      can_manage_chat:true,
      can_change_info:false,
      can_post_messages:true,
      can_edit_messages:true,
      can_delete_messages:true,
      can_invite_users:false,
      can_restrict_members:false,
      can_promote_members:false,
      can_manage_video_chats:false,
      can_post_stories:false,
      can_edit_stories:false,
      can_delete_stories:false,
      is_anonymous:false
    }
  });
  await call('setMyCommands',{commands});
  for(const adminId of allAdminIds()){
    try{await call('setMyCommands',{scope:{type:'chat',chat_id:Number(adminId)},commands:[
      {command:'catalog',description:'Контент канала'},
      {command:'publish',description:'Опубликовать материал'},
      {command:'publish_launch',description:'Опубликовать стартовую серию'},
      {command:'leads',description:'Новые заявки'},
      {command:'status',description:'Диагностика'},
      {command:'help',description:'Команды управления'}
    ]})}catch(e){console.warn('channel admin commands',adminId,e.message)}
  }
  await call('setWebhook',{url:config.PUBLIC_API_URL+'/api/v2/telegram/channel',allowed_updates:['message','callback_query','my_chat_member','channel_post']});
  return {enabled:true,username:runtimeUsername};
}

function install(app){
  app.get('/api/v2/telegram/channel-health',async(req,res)=>{
    if(!config.CHANNEL_BOT_TOKEN)return res.json({ok:false,enabled:false});
    try{
      const [me,webhook]=await Promise.all([call('getMe',{}),call('getWebhookInfo',{})]);
      runtimeUsername=String(me?.username||runtimeUsername||'');
      let channel_access={status:'not_checked'};
      const target=channelChatId();
      if(target){
        try{
          const member=await call('getChatMember',{chat_id:target,user_id:me.id});
          channel_access={status:String(member?.status||'unknown'),can_post_messages:member?.can_post_messages!==false,can_edit_messages:member?.can_edit_messages!==false,can_delete_messages:member?.can_delete_messages!==false};
        }catch(e){channel_access={status:'not_added',error:String(e.message||'channel_access_failed')}}
      }
      res.json({ok:true,enabled:true,bot:{id:String(me?.id||''),username:runtimeUsername},channel:target||'',channel_source:runtimeChannelChatId?'bound':'environment',channel_admin_url:channelAdminUrl(),channel_access,webhook:{url:String(webhook?.url||''),pending_update_count:Number(webhook?.pending_update_count||0),last_error_message:String(webhook?.last_error_message||'')}});
    }catch(e){res.status(503).json({ok:false,enabled:true,error:String(e.message||'channel_health_failed')})}
  });

  app.post('/api/v2/telegram/channel',async(req,res)=>{
    res.sendStatus(200);
    if(!config.CHANNEL_BOT_TOKEN)return;
    try{
      if(req.body?.my_chat_member){await bindChannel(req.body.my_chat_member.chat,true);return}
      if(req.body?.channel_post){
        const p=req.body.channel_post;
        await bindChannel(p.chat,true);
        if(/^#?bind$/i.test(String(p.text||'').trim())){
          try{await call('deleteMessage',{chat_id:p.chat.id,message_id:p.message_id})}catch(e){console.warn('channel bind cleanup',e.message)}
        }
        return;
      }
      if(req.body?.callback_query)return handleCallback(req.body.callback_query);
      if(req.body?.message)return handleMessage(req.body.message);
    }catch(e){console.error('channel webhook',e.message)}
  });
}

async function publishLaunchMissing(){
  if(!config.CHANNEL_AUTO_PUBLISH_LAUNCH)return {enabled:false,published:0};
  const target=channelChatId();
  if(!target)return {enabled:true,published:0,error:'channel_chat_id_not_configured'};
  const existing=new Set();
  if(db.configured){
    const q=await db.query('SELECT DISTINCT slug FROM shaurmeg_channel_publications WHERE channel_chat_id=$1',[target]);
    for(const row of q.rows)existing.add(String(row.slug));
  }
  let published=0,failed=0;
  for(const post of content.launch()){
    if(existing.has(post.slug))continue;
    try{
      await postToChannel(post,'auto-launch');
      published++;
      await sleep(900);
    }catch(e){
      failed++;
      console.error('channel auto publish',post.slug,e.message);
    }
  }
  return {enabled:true,published,failed};
}

module.exports={bootstrap,sync,install,postToChannel,unpublish,handleMessage,handleCallback,publishLaunchMissing};
