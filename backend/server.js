const express=require('express');
const path=require('path');
const fs=require('fs');
const {Pool}=require('pg');
const crypto=require('crypto');

const app=express();
app.use(express.json());
app.use((req,res,next)=>{
 res.setHeader('Access-Control-Allow-Origin','*');
 res.setHeader('Access-Control-Allow-Headers','Content-Type, X-Owner-Token, Authorization');
 res.setHeader('Access-Control-Allow-Methods','GET,POST,PATCH,OPTIONS');
 if(req.method==='OPTIONS') return res.sendStatus(204);
 next();
});
app.use(express.static(__dirname));

const PORT=process.env.PORT||3000;
const DB=process.env.DATABASE_URL?new Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}}):null;
const DATA_FILE=path.join('/tmp','shaurma-city-orders.json');

const seed={shaurma_orders:[]};

function cloneSeed(){return JSON.parse(JSON.stringify(seed))}
function readStore(){try{return JSON.parse(fs.readFileSync(DATA_FILE,'utf8'))}catch{const d=cloneSeed();fs.writeFileSync(DATA_FILE,JSON.stringify(d));return d}}
function writeStore(v){fs.writeFileSync(DATA_FILE,JSON.stringify(v))}

async function initDb(){
 if(!DB)return;

 if(process.env.RESET_TO_SHAURMA==='true'){
  await DB.query('DROP TABLE IF EXISTS shaurma_orders CASCADE');
 }

 await DB.query(`
  CREATE TABLE IF NOT EXISTS shaurma_orders(
    id BIGSERIAL PRIMARY KEY,
    order_number TEXT UNIQUE NOT NULL,
    items JSONB NOT NULL DEFAULT '[]'::jsonb,
    total INT NOT NULL DEFAULT 0,
    customer_name TEXT DEFAULT 'Гость',
    phone TEXT,
    address TEXT,
    comment TEXT,
    status TEXT NOT NULL DEFAULT 'new',
    source TEXT NOT NULL DEFAULT 'web',
    telegram_user_id TEXT,
    telegram_username TEXT,
    telegram_first_name TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_shaurma_orders_created_at
    ON shaurma_orders(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_shaurma_orders_status
    ON shaurma_orders(status);
 `);
 await DB.query("ALTER TABLE shaurma_orders ADD COLUMN IF NOT EXISTS telegram_username TEXT");
 await DB.query("ALTER TABLE shaurma_orders ADD COLUMN IF NOT EXISTS telegram_first_name TEXT");
 await DB.query("ALTER TABLE shaurma_orders ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'web'");
 await DB.query("ALTER TABLE shaurma_orders ADD COLUMN IF NOT EXISTS telegram_user_id TEXT");
 await DB.query("ALTER TABLE shaurma_orders ADD COLUMN IF NOT EXISTS fulfillment_type TEXT NOT NULL DEFAULT 'delivery'");
 await DB.query("ALTER TABLE shaurma_orders ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'pending'");
 await DB.query("ALTER TABLE shaurma_orders ADD COLUMN IF NOT EXISTS payment_method TEXT");
 await DB.query("CREATE INDEX IF NOT EXISTS idx_shaurma_orders_telegram_user ON shaurma_orders(telegram_user_id, created_at DESC)");

 await DB.query(`
  CREATE TABLE IF NOT EXISTS shaurma_users(
    telegram_user_id TEXT PRIMARY KEY,
    username TEXT,
    first_name TEXT,
    last_name TEXT,
    language_code TEXT,
    is_premium BOOLEAN NOT NULL DEFAULT FALSE,
    profile JSONB NOT NULL DEFAULT '{}'::jsonb,
    favorites JSONB NOT NULL DEFAULT '[]'::jsonb,
    preferences JSONB NOT NULL DEFAULT '{}'::jsonb,
    payment_provider TEXT,
    payment_customer_id TEXT,
    payment_method_id TEXT,
    payment_card_brand TEXT,
    payment_card_last4 TEXT,
    autopay_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_shaurma_users_last_seen ON shaurma_users(last_seen_at DESC);
 `);

}

app.get('/api/health',(req,res)=>res.json({ok:true,mode:'shaurma-city',storage:DB?'postgres':'temporary',identity:'telegram-user-id',profile_storage:DB?'postgres':'unavailable'}));








const ownerClients=new Set();
const telegramClients=new Map();

function verifyTelegramInitDataWithToken(initData,botToken){
 if(!botToken) throw new Error('telegram_not_configured');
 const p=new URLSearchParams(initData||'');
 const hash=p.get('hash'); if(!hash) throw new Error('bad_init_data');
 p.delete('hash');
 const authDate=Number(p.get('auth_date')||0);
 const age=Math.floor(Date.now()/1000)-authDate;
 if(!authDate || age>86400 || age < -300) throw new Error('expired_init_data');
 const dataCheck=[...p.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>k+'='+v).join('\n');
 const secret=crypto.createHmac('sha256','WebAppData').update(botToken).digest();
 const calc=crypto.createHmac('sha256',secret).update(dataCheck).digest('hex');
 if(calc.length!==hash.length || !crypto.timingSafeEqual(Buffer.from(calc),Buffer.from(hash))) throw new Error('bad_hash');
 let user={}; try{user=JSON.parse(p.get('user')||'{}')}catch{}
 if(!user.id) throw new Error('no_user');
 return user;
}
function verifyTelegramInitData(initData){return verifyTelegramInitDataWithToken(initData,process.env.CLIENT_TELEGRAM_BOT_TOKEN||process.env.CUSTOMER_BOT_TOKEN||process.env.TELEGRAM_BOT_TOKEN)}
function clientBotToken(){
 return process.env.CLIENT_TELEGRAM_BOT_TOKEN||process.env.CUSTOMER_BOT_TOKEN||process.env.TELEGRAM_BOT_TOKEN||'';
}
function sessionSecret(){
 const token=clientBotToken();
 if(!token)throw new Error('telegram_not_configured');
 return crypto.createHmac('sha256','ShaurmaCitySessionV1').update(token).digest();
}
function b64url(v){return Buffer.from(v).toString('base64url')}
function newTelegramSession(user){
 const now=Math.floor(Date.now()/1000);
 const payload={sub:String(user.id),username:user.username||'',first_name:user.first_name||'',last_name:user.last_name||'',iat:now,exp:now+7*24*60*60};
 const body=b64url(JSON.stringify(payload));
 const sig=crypto.createHmac('sha256',sessionSecret()).update(body).digest('base64url');
 return body+'.'+sig;
}
function telegramSession(req){
 try{
  const auth=req.get('authorization')||'';
  const token=auth.startsWith('Bearer ')?auth.slice(7):(req.query.session||'');
  const [body,sig,extra]=String(token||'').split('.');
  if(!body||!sig||extra)return null;
  const expected=crypto.createHmac('sha256',sessionSecret()).update(body).digest('base64url');
  const a=Buffer.from(sig),b=Buffer.from(expected);
  if(a.length!==b.length||!crypto.timingSafeEqual(a,b))return null;
  const payload=JSON.parse(Buffer.from(body,'base64url').toString('utf8'));
  const now=Math.floor(Date.now()/1000);
  if(!payload.sub||!payload.exp||payload.exp<now)return null;
  return {user:{id:String(payload.sub),username:payload.username||'',first_name:payload.first_name||'',last_name:payload.last_name||''},exp:payload.exp*1000};
 }catch{return null}
}
async function upsertTelegramUser(user){
 if(!DB)return null;
 const q=await DB.query(`
  INSERT INTO shaurma_users(telegram_user_id,username,first_name,last_name,language_code,is_premium,last_seen_at,updated_at)
  VALUES($1,$2,$3,$4,$5,$6,NOW(),NOW())
  ON CONFLICT(telegram_user_id) DO UPDATE SET
   username=EXCLUDED.username,
   first_name=EXCLUDED.first_name,
   last_name=EXCLUDED.last_name,
   language_code=EXCLUDED.language_code,
   is_premium=EXCLUDED.is_premium,
   last_seen_at=NOW(),
   updated_at=NOW()
  RETURNING telegram_user_id,username,first_name,last_name,language_code,is_premium,profile,favorites,preferences,
   payment_provider,payment_card_brand,payment_card_last4,autopay_enabled,created_at,last_seen_at,updated_at
 `,[String(user.id),user.username||null,user.first_name||null,user.last_name||null,user.language_code||null,!!user.is_premium]);
 return q.rows[0];
}
function publicUserProfile(row){
 if(!row)return null;
 return {
  id:String(row.telegram_user_id),
  username:row.username||'',
  first_name:row.first_name||'',
  last_name:row.last_name||'',
  language_code:row.language_code||'',
  is_premium:!!row.is_premium,
  profile:row.profile||{},
  favorites:Array.isArray(row.favorites)?row.favorites:[],
  preferences:row.preferences||{},
  payment:{
   provider:row.payment_provider||null,
   card_brand:row.payment_card_brand||null,
   card_last4:row.payment_card_last4||null,
   autopay_enabled:!!row.autopay_enabled,
   linked:!!row.payment_card_last4
  },
  created_at:row.created_at,
  last_seen_at:row.last_seen_at,
  updated_at:row.updated_at
 };
}
function adminSessionSecret(){
 const token=process.env.ADMIN_TELEGRAM_BOT_TOKEN||process.env.OWNER_API_TOKEN||'';
 if(!token)throw new Error('admin_not_configured');
 return crypto.createHmac('sha256','ShaurmaCityAdminSessionV1').update(token).digest();
}
function newAdminTelegramSession(user){
 const now=Math.floor(Date.now()/1000);
 const payload={sub:String(user.id),username:user.username||'',first_name:user.first_name||'',iat:now,exp:now+7*24*60*60};
 const body=Buffer.from(JSON.stringify(payload)).toString('base64url');
 const sig=crypto.createHmac('sha256',adminSessionSecret()).update(body).digest('base64url');
 return body+'.'+sig;
}
function adminTelegramSession(req){
 try{
  const auth=req.get('authorization')||'';
  const token=auth.startsWith('Bearer ')?auth.slice(7):(req.query.admin_session||'');
  const [body,sig,extra]=String(token||'').split('.');
  if(!body||!sig||extra)return null;
  const expected=crypto.createHmac('sha256',adminSessionSecret()).update(body).digest('base64url');
  const a=Buffer.from(sig),b=Buffer.from(expected);
  if(a.length!==b.length||!crypto.timingSafeEqual(a,b))return null;
  const payload=JSON.parse(Buffer.from(body,'base64url').toString('utf8'));
  const now=Math.floor(Date.now()/1000);
  if(!payload.sub||!payload.exp||payload.exp<now)return null;
  if(!adminTelegramAllowed(payload.sub))return null;
  return {user:{id:String(payload.sub),username:payload.username||'',first_name:payload.first_name||''},exp:payload.exp*1000};
 }catch{return null}
}
function adminTelegramAllowed(userId){
 const raw=process.env.ADMIN_TELEGRAM_IDS||'';
 return raw.split(',').map(x=>x.trim()).filter(Boolean).includes(String(userId));
}
function pushTelegram(userId,event,payload){
 const set=telegramClients.get(String(userId)); if(!set)return;
 const data='event: '+event+'\n'+'data: '+JSON.stringify(payload)+'\n\n';
 for(const res of set){try{res.write(data)}catch{set.delete(res)}}
}
function ownerOk(req){if(process.env.OWNER_API_TOKEN && (req.get('x-owner-token')===process.env.OWNER_API_TOKEN || req.query.token===process.env.OWNER_API_TOKEN))return true;return !!adminTelegramSession(req)}
function pushOwner(event,payload){
 const data='event: '+event+'\n'+'data: '+JSON.stringify(payload)+'\n\n';
 for(const res of ownerClients){try{res.write(data)}catch{ownerClients.delete(res)}}
}
function orderNumber(){return 'SC-'+Date.now().toString().slice(-7)+'-'+Math.floor(10+Math.random()*90)}
async function syncTelegramMiniApp(){
 const token=process.env.CLIENT_TELEGRAM_BOT_TOKEN||process.env.CUSTOMER_BOT_TOKEN||process.env.TELEGRAM_BOT_TOKEN;
 if(!token){console.log('Telegram client bot token not configured');return}
 try{
  const r=await fetch('https://api.telegram.org/bot'+token+'/setChatMenuButton',{
   method:'POST',
   headers:{'Content-Type':'application/json'},
   body:JSON.stringify({menu_button:{type:'web_app',text:'Открыть Shaurma City',web_app:{url:'https://shaurma-city-app.onrender.com/?v=58'}}})
  });
  const j=await r.json().catch(()=>({}));
  if(!r.ok||!j.ok)throw new Error(j.description||('HTTP '+r.status));
  console.log('Telegram Mini App menu synced to Shaurma City');
 }catch(e){console.error('Telegram Mini App sync:',e.message)}
}

async function syncAdminTelegramMiniApp(){
 const token=process.env.ADMIN_TELEGRAM_BOT_TOKEN;
 if(!token){console.log('Telegram admin bot token not configured');return}
 try{
  const r=await fetch('https://api.telegram.org/bot'+token+'/setChatMenuButton',{
   method:'POST',
   headers:{'Content-Type':'application/json'},
   body:JSON.stringify({menu_button:{type:'web_app',text:'Админка Shaurma City',web_app:{url:'https://shaurma-city-api.onrender.com/shaurma-owner?v=2'}}})
  });
  const j=await r.json().catch(()=>({}));
  if(!r.ok||!j.ok)throw new Error(j.description||('HTTP '+r.status));
  console.log('Telegram admin Mini App menu synced to Shaurma City');
 }catch(e){console.error('Telegram admin Mini App sync:',e.message)}
}


app.post('/api/shaurma/login',(req,res)=>{
 if(!process.env.OWNER_PASSWORD||!process.env.OWNER_API_TOKEN)return res.status(503).json({error:'owner_not_configured'});
 if((req.body||{}).password!==process.env.OWNER_PASSWORD)return res.status(401).json({error:'invalid_password'});
 res.json({ok:true,token:process.env.OWNER_API_TOKEN});
});

app.get('/api/shaurma/stream',(req,res)=>{
 if(!ownerOk(req))return res.sendStatus(401);
 res.setHeader('Content-Type','text/event-stream');
 res.setHeader('Cache-Control','no-cache');
 res.setHeader('Connection','keep-alive');
 res.flushHeaders?.();
 res.write('event: ready\ndata: {"ok":true}\n\n');
 ownerClients.add(res);
 const keep=setInterval(()=>{try{res.write(': ping\n\n')}catch{}},20000);
 req.on('close',()=>{clearInterval(keep);ownerClients.delete(res)});
});


app.post('/api/shaurma/admin-telegram-auth',(req,res)=>{
 try{
  const user=verifyTelegramInitDataWithToken((req.body||{}).initData||'',process.env.ADMIN_TELEGRAM_BOT_TOKEN);
  if(!adminTelegramAllowed(user.id))return res.status(403).json({error:'admin_not_allowed',user_id:String(user.id)});
  const session=newAdminTelegramSession(user);
  res.json({ok:true,session,user:{id:String(user.id),username:user.username||'',first_name:user.first_name||'',last_name:user.last_name||''}});
 }catch(e){
  if(e.message==='telegram_not_configured')return res.status(503).json({error:e.message});
  res.status(401).json({error:e.message||'admin_telegram_auth_failed'});
 }
});

app.post('/api/shaurma/telegram-auth',async(req,res)=>{
 try{
  const user=verifyTelegramInitData((req.body||{}).initData||'');
  const session=newTelegramSession(user);
  const stored=await upsertTelegramUser(user);
  res.json({ok:true,session,user:stored?publicUserProfile(stored):{id:String(user.id),username:user.username||'',first_name:user.first_name||'',last_name:user.last_name||'',profile:{},favorites:[],preferences:{},payment:{linked:false,autopay_enabled:false}}});
 }catch(e){
  if(e.message==='telegram_not_configured') return res.status(503).json({error:e.message});
  console.error('telegram auth:',e.message);
  res.status(401).json({error:e.message||'telegram_auth_failed'});
 }
});

app.get('/api/shaurma/me',async(req,res)=>{
 const sess=telegramSession(req);if(!sess)return res.sendStatus(401);
 if(!DB)return res.status(503).json({error:'persistent_storage_required'});
 try{
  const q=await DB.query(`SELECT telegram_user_id,username,first_name,last_name,language_code,is_premium,profile,favorites,preferences,
   payment_provider,payment_card_brand,payment_card_last4,autopay_enabled,created_at,last_seen_at,updated_at
   FROM shaurma_users WHERE telegram_user_id=$1`,[String(sess.user.id)]);
  if(!q.rows[0])return res.sendStatus(404);
  res.json(publicUserProfile(q.rows[0]));
 }catch(e){res.status(500).json({error:'profile_read_failed'})}
});

app.patch('/api/shaurma/me',async(req,res)=>{
 const sess=telegramSession(req);if(!sess)return res.sendStatus(401);
 if(!DB)return res.status(503).json({error:'persistent_storage_required'});
 try{
  const body=req.body||{};
  const profile=(body.profile&&typeof body.profile==='object'&&!Array.isArray(body.profile))?body.profile:null;
  const preferences=(body.preferences&&typeof body.preferences==='object'&&!Array.isArray(body.preferences))?body.preferences:null;
  const favorites=Array.isArray(body.favorites)?body.favorites.slice(0,100):null;
  if(profile && JSON.stringify(profile).length>12000)return res.status(413).json({error:'profile_too_large'});
  if(preferences && JSON.stringify(preferences).length>20000)return res.status(413).json({error:'preferences_too_large'});
  if(favorites && JSON.stringify(favorites).length>30000)return res.status(413).json({error:'favorites_too_large'});
  const q=await DB.query(`
   UPDATE shaurma_users SET
    profile=CASE WHEN $2::jsonb IS NULL THEN profile ELSE profile || $2::jsonb END,
    preferences=CASE WHEN $3::jsonb IS NULL THEN preferences ELSE preferences || $3::jsonb END,
    favorites=COALESCE($4::jsonb,favorites),
    updated_at=NOW()
   WHERE telegram_user_id=$1
   RETURNING telegram_user_id,username,first_name,last_name,language_code,is_premium,profile,favorites,preferences,
    payment_provider,payment_card_brand,payment_card_last4,autopay_enabled,created_at,last_seen_at,updated_at
  `,[String(sess.user.id),profile?JSON.stringify(profile):null,preferences?JSON.stringify(preferences):null,favorites?JSON.stringify(favorites):null]);
  if(!q.rows[0])return res.sendStatus(404);
  res.json(publicUserProfile(q.rows[0]));
 }catch(e){console.error('profile update:',e.message);res.status(500).json({error:'profile_update_failed'})}
});

app.get('/api/shaurma/my-orders',async(req,res)=>{
 const sess=telegramSession(req); if(!sess)return res.sendStatus(401);
 try{
  const uid=String(sess.user.id);
  const rows=DB?(await DB.query('SELECT * FROM shaurma_orders WHERE telegram_user_id=$1 ORDER BY created_at DESC LIMIT 100',[uid])).rows:(readStore().shaurma_orders||[]).filter(x=>String(x.telegram_user_id)===uid).sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
  res.json(rows);
 }catch(e){res.status(500).json({error:e.message})}
});

app.get('/api/shaurma/my-stream',(req,res)=>{
 const sess=telegramSession(req); if(!sess)return res.sendStatus(401);
 const uid=String(sess.user.id);
 res.setHeader('Content-Type','text/event-stream');
 res.setHeader('Cache-Control','no-cache');
 res.setHeader('Connection','keep-alive');
 res.flushHeaders?.();
 res.write('event: ready\ndata: {"ok":true}\n\n');
 if(!telegramClients.has(uid)) telegramClients.set(uid,new Set());
 const set=telegramClients.get(uid); set.add(res);
 const keep=setInterval(()=>{try{res.write(': ping\n\n')}catch{}},20000);
 req.on('close',()=>{clearInterval(keep);set.delete(res);if(!set.size)telegramClients.delete(uid)});
});

app.post('/api/shaurma/orders',async(req,res)=>{
 const {items,total,customer_name,phone,address,comment,telegram_init_data,fulfillment_type,payment_status,payment_method}=req.body||{};
 const sess=telegramSession(req);
 let tgUser=sess?sess.user:null;
 if(!tgUser && telegram_init_data){
  try{tgUser=verifyTelegramInitData(telegram_init_data)}catch{}
 }
 if(!Array.isArray(items)||!items.length)return res.status(400).json({error:'empty_order'});
 const fulfillment=['dine_in','takeaway','delivery'].includes(fulfillment_type)?fulfillment_type:(fulfillment_type==='cafe'?'dine_in':'delivery');
 if(fulfillment==='delivery' && !phone)return res.status(400).json({error:'phone_required'});
 if(fulfillment==='delivery' && !address)return res.status(400).json({error:'address_required'});
 const num=orderNumber();
 try{
  let order;
  const safePaymentStatus=['pending','paid','failed','cancelled'].includes(payment_status)?payment_status:'pending';
  if(DB){
   const q=await DB.query(
    'INSERT INTO shaurma_orders(order_number,items,total,customer_name,phone,address,comment,source,telegram_user_id,telegram_username,telegram_first_name,fulfillment_type,payment_status,payment_method) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *',
    [num,JSON.stringify(items),Number(total)||0,customer_name||(tgUser?.first_name||'Гость'),fulfillment==='delivery'?(phone||null):null,fulfillment==='delivery'?(address||null):null,comment||'',tgUser?'telegram':'web',tgUser?String(tgUser.id):null,tgUser?.username||null,tgUser?.first_name||null,fulfillment,safePaymentStatus,payment_method||null]
   );
   order=q.rows[0];
  }else{
   const d=readStore();d.shaurma_orders=d.shaurma_orders||[];
   order={id:Date.now(),order_number:num,items,total:Number(total)||0,customer_name:customer_name||(tgUser?.first_name||'Гость'),phone:fulfillment==='delivery'?(phone||null):null,address:fulfillment==='delivery'?(address||null):null,comment:comment||'',status:'new',source:tgUser?'telegram':'web',telegram_user_id:tgUser?String(tgUser.id):null,telegram_username:tgUser?.username||null,telegram_first_name:tgUser?.first_name||null,fulfillment_type:fulfillment,payment_status:safePaymentStatus,payment_method:payment_method||null,created_at:new Date().toISOString(),updated_at:new Date().toISOString()};
   d.shaurma_orders.push(order);writeStore(d);
  }
  pushOwner('order',order);
  if(order.telegram_user_id) pushTelegram(order.telegram_user_id,'order',order);
  res.status(201).json(order);
 }catch(e){console.error('create order:',e.message);res.status(500).json({error:'order_create_failed'})}
});

app.get('/api/shaurma/orders',async(req,res)=>{
 if(!ownerOk(req))return res.sendStatus(401);
 try{
  const rows=DB?(await DB.query('SELECT * FROM shaurma_orders ORDER BY created_at DESC LIMIT 200')).rows:(readStore().shaurma_orders||[]).slice().reverse();
  res.json(rows);
 }catch(e){res.status(500).json({error:e.message})}
});

app.patch('/api/shaurma/orders/:id',async(req,res)=>{
 if(!ownerOk(req))return res.sendStatus(401);
 const allowed=['new','cooking','ready','done','cancelled'];
 const status=(req.body||{}).status;
 if(!allowed.includes(status))return res.status(400).json({error:'bad_status'});
 try{
  let order;
  if(DB){
   const q=await DB.query('UPDATE shaurma_orders SET status=$1,updated_at=NOW() WHERE id=$2 RETURNING *',[status,req.params.id]);
   order=q.rows[0]; if(!order)return res.sendStatus(404);
  }else{
   const d=readStore(),arr=d.shaurma_orders||[],x=arr.find(v=>String(v.id)===String(req.params.id));if(!x)return res.sendStatus(404);x.status=status;x.updated_at=new Date().toISOString();writeStore(d);order=x;
  }
  pushOwner('update',order);if(order.telegram_user_id)pushTelegram(order.telegram_user_id,'update',order);res.json(order);
 }catch(e){res.status(500).json({error:e.message})}
});

app.get('/api/shaurma/stats',async(req,res)=>{
 if(!ownerOk(req))return res.sendStatus(401);
 try{
  const rows=DB?(await DB.query('SELECT * FROM shaurma_orders WHERE created_at >= NOW()-INTERVAL \'1 day\'')).rows:(readStore().shaurma_orders||[]).filter(x=>Date.now()-new Date(x.created_at).getTime()<86400000);
  res.json({
   today:rows.length,
   new:rows.filter(x=>x.status==='new').length,
   cooking:rows.filter(x=>x.status==='cooking').length,
   ready:rows.filter(x=>x.status==='ready').length,
   revenue:rows.filter(x=>x.status!=='cancelled').reduce((a,x)=>a+(Number(x.total)||0),0)
  });
 }catch(e){res.status(500).json({error:e.message})}
});

const sendOwner=(req,res)=>res.sendFile(path.join(__dirname,'shaurma-owner.html'));
app.get('/shaurma-owner',sendOwner);
app.get('/admin',sendOwner);
app.get('/owner',sendOwner);

app.use((req,res)=>res.status(404).json({error:'not_found'}));

initDb().then(async()=>{console.log('Shaurma City database ready');await syncTelegramMiniApp();await syncAdminTelegramMiniApp()}).catch(e=>console.error('DB init:',e.message)).finally(()=>app.listen(PORT,()=>console.log('Shaurma City API on '+PORT)));
