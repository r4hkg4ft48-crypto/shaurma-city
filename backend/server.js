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

}

app.get('/api/health',(req,res)=>res.json({ok:true,mode:'shaurma-city',storage:DB?'postgres':'temporary'}));








const ownerClients=new Set();
const telegramClients=new Map();
const telegramSessions=new Map();
const adminTelegramSessions=new Map();

function verifyTelegramInitDataWithToken(initData,botToken){
 if(!botToken) throw new Error('telegram_not_configured');
 const p=new URLSearchParams(initData||'');
 const hash=p.get('hash'); if(!hash) throw new Error('bad_init_data');
 p.delete('hash');
 const authDate=Number(p.get('auth_date')||0);
 if(!authDate || Math.abs(Date.now()/1000-authDate)>86400) throw new Error('expired_init_data');
 const dataCheck=[...p.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>k+'='+v).join('\n');
 const secret=crypto.createHmac('sha256','WebAppData').update(botToken).digest();
 const calc=crypto.createHmac('sha256',secret).update(dataCheck).digest('hex');
 if(calc.length!==hash.length || !crypto.timingSafeEqual(Buffer.from(calc),Buffer.from(hash))) throw new Error('bad_hash');
 let user={}; try{user=JSON.parse(p.get('user')||'{}')}catch{}
 if(!user.id) throw new Error('no_user');
 return user;
}
function verifyTelegramInitData(initData){return verifyTelegramInitDataWithToken(initData,process.env.CLIENT_TELEGRAM_BOT_TOKEN||process.env.TELEGRAM_BOT_TOKEN)}
function newTelegramSession(user){
 const token=crypto.randomBytes(32).toString('hex');
 telegramSessions.set(token,{user,exp:Date.now()+12*60*60*1000});
 return token;
}
function telegramSession(req){
 const auth=req.get('authorization')||'';
 const token=auth.startsWith('Bearer ')?auth.slice(7):(req.query.session||'');
 const s=telegramSessions.get(token);
 if(!s||s.exp<Date.now()){if(token)telegramSessions.delete(token);return null}
 return s;
}
function newAdminTelegramSession(user){
 const sessionToken=crypto.randomBytes(32).toString('hex');
 adminTelegramSessions.set(sessionToken,{user,exp:Date.now()+12*60*60*1000});
 return sessionToken;
}
function adminTelegramSession(req){
 const auth=req.get('authorization')||'';
 const sessionToken=auth.startsWith('Bearer ')?auth.slice(7):(req.query.admin_session||'');
 const sess=adminTelegramSessions.get(sessionToken);
 if(!sess||sess.exp<Date.now()){if(sessionToken)adminTelegramSessions.delete(sessionToken);return null}
 return sess;
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
  if(!adminTelegramAllowed(user.id))return res.status(403).json({error:'admin_not_allowed'});
  const session=newAdminTelegramSession(user);
  res.json({ok:true,session,user:{id:String(user.id),username:user.username||'',first_name:user.first_name||'',last_name:user.last_name||''}});
 }catch(e){
  if(e.message==='telegram_not_configured')return res.status(503).json({error:e.message});
  res.status(401).json({error:e.message||'admin_telegram_auth_failed'});
 }
});

app.post('/api/shaurma/telegram-auth',(req,res)=>{
 try{
  const user=verifyTelegramInitData((req.body||{}).initData||'');
  const session=newTelegramSession(user);
  res.json({ok:true,session,user:{id:String(user.id),username:user.username||'',first_name:user.first_name||'',last_name:user.last_name||''}});
 }catch(e){
  if(e.message==='telegram_not_configured') return res.status(503).json({error:e.message});
  res.status(401).json({error:e.message||'telegram_auth_failed'});
 }
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
 const {items,total,customer_name,phone,address,comment,telegram_init_data}=req.body||{};
 const sess=telegramSession(req);
 let tgUser=sess?sess.user:null;
 if(!tgUser && telegram_init_data){
  try{tgUser=verifyTelegramInitData(telegram_init_data)}catch{}
 }
 if(!Array.isArray(items)||!items.length)return res.status(400).json({error:'empty_order'});
 if(!phone)return res.status(400).json({error:'phone_required'});
 const num=orderNumber();
 try{
  let order;
  if(DB){
   const q=await DB.query(
    'INSERT INTO shaurma_orders(order_number,items,total,customer_name,phone,address,comment,source,telegram_user_id,telegram_username,telegram_first_name) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *',
    [num,JSON.stringify(items),Number(total)||0,customer_name||(tgUser?.first_name||'Гость'),phone,address||'',comment||'',tgUser?'telegram':'web',tgUser?String(tgUser.id):null,tgUser?.username||null,tgUser?.first_name||null]
   );
   order=q.rows[0];
  }else{
   const d=readStore();d.shaurma_orders=d.shaurma_orders||[];
   order={id:Date.now(),order_number:num,items,total:Number(total)||0,customer_name:customer_name||(tgUser?.first_name||'Гость'),phone,address:address||'',comment:comment||'',status:'new',source:tgUser?'telegram':'web',telegram_user_id:tgUser?String(tgUser.id):null,telegram_username:tgUser?.username||null,telegram_first_name:tgUser?.first_name||null,created_at:new Date().toISOString(),updated_at:new Date().toISOString()};
   d.shaurma_orders.push(order);writeStore(d);
  }
  pushOwner('order',order);
  if(order.telegram_user_id) pushTelegram(order.telegram_user_id,'order',order);
  res.status(201).json(order);
 }catch(e){res.status(500).json({error:e.message})}
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

app.get('/shaurma-owner',(req,res)=>res.sendFile(path.join(__dirname,'shaurma-owner.html')));

app.use((req,res)=>res.status(404).json({error:'not_found'}));

initDb().then(()=>console.log('Shaurma City database ready')).catch(e=>console.error('DB init:',e.message)).finally(()=>app.listen(PORT,()=>console.log('Shaurma City API on '+PORT)));
