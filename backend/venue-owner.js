'use strict';

const crypto=require('crypto');
const path=require('path');

function installVenueOwner(app,{DB,verifyTelegramInitDataWithToken,ownerOk,normalizeMarkerStyle,publishVenue,pushOwner}){
  const BOT_TOKEN=String(process.env.VENUE_OWNER_TELEGRAM_BOT_TOKEN||'').trim();
  const BASE_URL=String(process.env.PUBLIC_API_URL||'https://shaurma-city-api.onrender.com').replace(/\/$/,'');
  const OWNER_APP_URL=String(process.env.VENUE_OWNER_MINI_APP_URL||BASE_URL+'/venue-owner?v=1').trim();
  const SESSION_SECRET=String(process.env.VENUE_OWNER_SESSION_SECRET||process.env.OWNER_API_TOKEN||process.env.ADMIN_TELEGRAM_SESSION_SECRET||'').trim();
  const WEBHOOK_SECRET=BOT_TOKEN&&SESSION_SECRET?crypto.createHash('sha256').update('venue-owner-webhook:'+BOT_TOKEN+':'+SESSION_SECRET).digest('hex').slice(0,32):'';
  let botInfo=null;

  const DEFAULT_PERMISSIONS=['menu','profile','media','appearance','orders'];
  const normalizeCode=v=>String(v||'').trim().toUpperCase().replace(/\s+/g,'');
  const codeHash=v=>crypto.createHash('sha256').update('venue-owner-claim:'+normalizeCode(v)).digest('hex');
  const publicAccess=row=>({
    establishment_id:row.establishment_id,
    name:row.name,
    role:row.role,
    permissions:Array.isArray(row.permissions)?row.permissions:DEFAULT_PERMISSIONS,
    is_active:row.is_active!==false,
    marker_id:row.marker_id??null,
    venue_id:row.venue_id||''
  });

  function signSession(user){
    if(!SESSION_SECRET)throw new Error('venue_owner_session_not_configured');
    const now=Math.floor(Date.now()/1000);
    const payload={sub:String(user.id),username:user.username||'',first_name:user.first_name||'',iat:now,exp:now+7*24*60*60};
    const body=Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig=crypto.createHmac('sha256',SESSION_SECRET).update(body).digest('base64url');
    return body+'.'+sig;
  }
  function readSession(req){
    if(!SESSION_SECRET)return null;
    try{
      const auth=req.get('authorization')||'';
      const token=auth.startsWith('Bearer ')?auth.slice(7):(req.query.owner_session||'');
      const [body,sig,extra]=String(token||'').split('.');
      if(!body||!sig||extra)return null;
      const expected=crypto.createHmac('sha256',SESSION_SECRET).update(body).digest('base64url');
      const a=Buffer.from(sig),b=Buffer.from(expected);
      if(a.length!==b.length||!crypto.timingSafeEqual(a,b))return null;
      const payload=JSON.parse(Buffer.from(body,'base64url').toString('utf8'));
      const now=Math.floor(Date.now()/1000);
      if(!payload.sub||!payload.exp||payload.exp<now)return null;
      return payload;
    }catch{return null}
  }
  async function accessesFor(userId){
    if(!DB)return [];
    const q=await DB.query(`
      SELECT a.establishment_id,a.role,a.permissions,a.is_active,v.name,v.venue_id,m.id AS marker_id
      FROM shaurma_venue_admins a
      JOIN shaurma_venues v ON v.establishment_id=a.establishment_id
      LEFT JOIN LATERAL (
        SELECT id FROM shaurmeg_markers WHERE establishment_id=a.establishment_id ORDER BY id LIMIT 1
      ) m ON TRUE
      WHERE a.telegram_user_id=$1 AND a.is_active=TRUE AND v.is_active=TRUE
      ORDER BY v.name
    `,[String(userId)]);
    return q.rows.map(publicAccess);
  }
  async function requireAccess(req,res,establishmentId,permission){
    const sess=readSession(req);
    if(!sess){res.sendStatus(401);return null}
    if(!DB){res.status(503).json({error:'persistent_storage_required'});return null}
    const q=await DB.query(`
      SELECT a.*,v.venue_id,v.name
      FROM shaurma_venue_admins a
      JOIN shaurma_venues v ON v.establishment_id=a.establishment_id
      WHERE a.telegram_user_id=$1 AND a.establishment_id=$2 AND a.is_active=TRUE AND v.is_active=TRUE
      LIMIT 1
    `,[String(sess.sub),String(establishmentId)]);
    const row=q.rows[0];if(!row){res.sendStatus(403);return null}
    const permissions=Array.isArray(row.permissions)?row.permissions:DEFAULT_PERMISSIONS;
    if(permission&&row.role!=='owner'&&!permissions.includes(permission)){res.status(403).json({error:'permission_denied',permission});return null}
    return {session:sess,access:row,permissions};
  }
  async function getBotInfo(){
    if(botInfo)return botInfo;
    if(!BOT_TOKEN)return null;
    const r=await fetch('https://api.telegram.org/bot'+BOT_TOKEN+'/getMe');
    const j=await r.json().catch(()=>({}));
    if(!r.ok||!j.ok)throw new Error(j.description||'telegram_getme_failed');
    botInfo=j.result;return botInfo;
  }
  async function botApi(method,body={}){
    if(!BOT_TOKEN)throw new Error('telegram_not_configured');
    const r=await fetch('https://api.telegram.org/bot'+BOT_TOKEN+'/'+method,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const j=await r.json().catch(()=>({}));
    if(!r.ok||!j.ok)throw new Error(j.description||('telegram_'+method+'_failed'));
    return j.result;
  }
  async function sendOwnerBotMessage(chatId,text,extra={}){
    return botApi('sendMessage',{chat_id:chatId,text,parse_mode:'HTML',disable_web_page_preview:true,...extra});
  }
  async function claimForTelegramUser(user,code){
    if(!DB)throw new Error('persistent_storage_required');
    const normalized=normalizeCode(code);
    if(!/^[A-Z0-9_-]{6,40}$/.test(normalized))throw new Error('bad_claim_code');
    const client=await DB.connect();
    try{
      await client.query('BEGIN');
      const q=await client.query(`
        SELECT * FROM shaurma_venue_invites
        WHERE code_hash=$1 AND is_active=TRUE AND expires_at>NOW() AND uses<max_uses
        FOR UPDATE
      `,[codeHash(normalized)]);
      const inv=q.rows[0];if(!inv)throw new Error('claim_code_invalid_or_expired');
      await client.query(`
        INSERT INTO shaurma_venue_admins(establishment_id,telegram_user_id,telegram_username,telegram_first_name,role,permissions,is_active,added_by)
        VALUES($1,$2,$3,$4,$5,$6::jsonb,TRUE,'invite')
        ON CONFLICT(establishment_id,telegram_user_id) DO UPDATE SET
          telegram_username=EXCLUDED.telegram_username,
          telegram_first_name=EXCLUDED.telegram_first_name,
          role=EXCLUDED.role,
          permissions=EXCLUDED.permissions,
          is_active=TRUE,
          updated_at=NOW()
      `,[inv.establishment_id,String(user.id),user.username||'',user.first_name||'',inv.role,JSON.stringify(inv.permissions||DEFAULT_PERMISSIONS)]);
      await client.query("UPDATE shaurma_venue_invites SET uses=uses+1,is_active=CASE WHEN uses+1>=max_uses THEN FALSE ELSE is_active END,last_used_at=NOW() WHERE id=$1",[inv.id]);
      await client.query(`
        INSERT INTO shaurma_venue_audit(establishment_id,telegram_user_id,action,payload)
        VALUES($1,$2,'access_claimed',$3::jsonb)
      `,[inv.establishment_id,String(user.id),JSON.stringify({invite_id:inv.id,role:inv.role})]);
      await client.query('COMMIT');
      return (await accessesFor(user.id)).find(x=>x.establishment_id===inv.establishment_id);
    }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}finally{client.release()}
  }
  async function audit(establishmentId,userId,action,payload={}){
    if(!DB)return;
    await DB.query("INSERT INTO shaurma_venue_audit(establishment_id,telegram_user_id,action,payload) VALUES($1,$2,$3,$4::jsonb)",[establishmentId,String(userId),action,JSON.stringify(payload)]).catch(()=>{});
  }

  app.get('/api/venue-owner/config',async(req,res)=>{
    try{
      const info=await getBotInfo();
      res.setHeader('Cache-Control','no-store');
      res.json({configured:!!info,bot_username:info?.username||null,mini_app_url:OWNER_APP_URL});
    }catch{res.json({configured:false,bot_username:null,mini_app_url:OWNER_APP_URL})}
  });

  app.post('/api/venue-owner/telegram-auth',async(req,res)=>{
    try{
      if(!BOT_TOKEN)return res.status(503).json({error:'venue_owner_bot_not_configured'});
      const user=verifyTelegramInitDataWithToken((req.body||{}).initData||'',BOT_TOKEN);
      const session=signSession(user),accesses=await accessesFor(user.id);
      res.json({ok:true,session,user:{id:String(user.id),username:user.username||'',first_name:user.first_name||'',last_name:user.last_name||''},establishments:accesses});
    }catch(e){res.status(401).json({error:e.message||'venue_owner_auth_failed'})}
  });

  app.post('/api/venue-owner/claim',async(req,res)=>{
    const sess=readSession(req);if(!sess)return res.sendStatus(401);
    try{
      const access=await claimForTelegramUser({id:sess.sub,username:sess.username||'',first_name:sess.first_name||''},req.body?.code);
      res.json({ok:true,establishment:access,establishments:await accessesFor(sess.sub)});
    }catch(e){res.status(400).json({error:e.message||'claim_failed'})}
  });

  app.get('/api/venue-owner/me',async(req,res)=>{
    const sess=readSession(req);if(!sess)return res.sendStatus(401);
    res.json({user:{id:String(sess.sub),username:sess.username||'',first_name:sess.first_name||''},establishments:await accessesFor(sess.sub)});
  });

  app.get('/api/venue-owner/establishments/:establishmentId',async(req,res)=>{
    const auth=await requireAccess(req,res,req.params.establishmentId,'profile');if(!auth)return;
    try{
      const q=await DB.query(`
        SELECT v.establishment_id,v.venue_id,v.slug,v.name,v.is_active,v.config,v.menu,v.updated_at,
          m.id AS marker_id,m.address,m.description,m.hero_image,m.gallery,m.hours,m.price_label,m.category,
          m.marker_avatar,m.marker_style,m.lat,m.lon,m.updated_at AS marker_updated_at
        FROM shaurma_venues v
        LEFT JOIN LATERAL (
          SELECT * FROM shaurmeg_markers WHERE establishment_id=v.establishment_id ORDER BY id LIMIT 1
        ) m ON TRUE
        WHERE v.establishment_id=$1 LIMIT 1
      `,[req.params.establishmentId]);
      if(!q.rows[0])return res.sendStatus(404);
      res.json({...q.rows[0],permissions:auth.permissions,role:auth.access.role,marker_style:normalizeMarkerStyle(q.rows[0].marker_style,q.rows[0].category||'shawarma')});
    }catch(e){res.status(500).json({error:'establishment_read_failed'})}
  });

  app.patch('/api/venue-owner/establishments/:establishmentId/profile',async(req,res)=>{
    const auth=await requireAccess(req,res,req.params.establishmentId,'profile');if(!auth)return;
    const body=req.body||{},est=req.params.establishmentId;
    const name=String(body.name||'').trim().slice(0,160);
    const address=String(body.address||'').trim().slice(0,300);
    const description=String(body.description||'').trim().slice(0,1400);
    const hours=String(body.hours||'').trim().slice(0,160);
    const priceLabel=String(body.price_label||'').trim().slice(0,80);
    const hero=String(body.hero_image||'').trim().slice(0,1800000);
    const gallery=Array.isArray(body.gallery)?body.gallery.map(x=>String(x||'').trim()).filter(x=>x.startsWith('data:image/')).slice(0,6):[];
    const markerAvatar=String(body.marker_avatar||'').trim().slice(0,900000);
    const config=body.config&&typeof body.config==='object'&&!Array.isArray(body.config)?body.config:{};
    if(!name)return res.status(400).json({error:'name_required'});
    const client=await DB.connect();
    try{
      await client.query('BEGIN');
      const current=await client.query("SELECT v.config,m.category,m.marker_style FROM shaurma_venues v LEFT JOIN LATERAL (SELECT category,marker_style FROM shaurmeg_markers WHERE establishment_id=v.establishment_id ORDER BY id LIMIT 1) m ON TRUE WHERE v.establishment_id=$1",[est]);
      if(!current.rows[0]){await client.query('ROLLBACK');return res.sendStatus(404)}
      const currentConfig=current.rows[0].config||{};
      const safeConfig={...currentConfig};
      for(const key of ['subtitle','accent','builder_enabled','phone','website','delivery_enabled','pickup_enabled'])if(Object.prototype.hasOwnProperty.call(config,key))safeConfig[key]=config[key];
      await client.query("UPDATE shaurma_venues SET name=$2,config=$3::jsonb,updated_at=NOW() WHERE establishment_id=$1",[est,name,JSON.stringify(safeConfig)]);
      const q=await client.query(`
        UPDATE shaurmeg_markers SET name=$2,address=$3,description=$4,hero_image=$5,gallery=$6::jsonb,hours=$7,price_label=$8,marker_avatar=$9,metadata_locked=TRUE,updated_at=NOW()
        WHERE establishment_id=$1
        RETURNING id
      `,[est,name,address,description,hero,JSON.stringify(gallery),hours,priceLabel,markerAvatar]);
      await client.query('COMMIT');
      const venue=(await DB.query("SELECT * FROM shaurma_venues WHERE establishment_id=$1",[est])).rows[0];
      if(venue)publishVenue(venue);
      await audit(est,auth.session.sub,'profile_updated',{marker_ids:q.rows.map(x=>x.id)});
      res.json({ok:true,establishment_id:est});
    }catch(e){await client.query('ROLLBACK').catch(()=>{});res.status(500).json({error:'profile_update_failed'})}finally{client.release()}
  });

  app.patch('/api/venue-owner/establishments/:establishmentId/appearance',async(req,res)=>{
    const auth=await requireAccess(req,res,req.params.establishmentId,'appearance');if(!auth)return;
    const est=req.params.establishmentId;
    try{
      const cur=await DB.query("SELECT category,marker_style FROM shaurmeg_markers WHERE establishment_id=$1 ORDER BY id LIMIT 1",[est]);
      if(!cur.rows[0])return res.sendStatus(404);
      const style=normalizeMarkerStyle(req.body?.marker_style||cur.rows[0].marker_style,cur.rows[0].category||'shawarma');
      const avatar=String(req.body?.marker_avatar??'').trim().slice(0,900000);
      await DB.query("UPDATE shaurmeg_markers SET marker_style=$2::jsonb,marker_avatar=$3,appearance_locked=TRUE,updated_at=NOW() WHERE establishment_id=$1",[est,JSON.stringify(style),avatar]);
      await audit(est,auth.session.sub,'appearance_updated',{});
      res.json({ok:true,marker_style:style,has_avatar:!!avatar});
    }catch(e){res.status(500).json({error:'appearance_update_failed'})}
  });

  app.put('/api/venue-owner/establishments/:establishmentId/menu',async(req,res)=>{
    const auth=await requireAccess(req,res,req.params.establishmentId,'menu');if(!auth)return;
    const menu=Array.isArray(req.body?.menu)?req.body.menu.slice(0,250):null;
    if(!menu)return res.status(400).json({error:'invalid_menu'});
    const normalized=menu.map((x,i)=>({
      id:String(x.id||('item_'+i)).trim().slice(0,100),
      n:String(x.n||x.name||'Позиция').trim().slice(0,160),
      c:String(x.c||x.category||'shawarma').trim().slice(0,60),
      d:String(x.d||x.description||'').trim().slice(0,700),
      p:Math.max(0,Math.min(100000,Number(x.p??x.price)||0)),
      image:String(x.image||'').trim().slice(0,700000),
      active:x.active!==false
    })).filter(x=>x.id&&x.n);
    if(JSON.stringify(normalized).length>700000)return res.status(413).json({error:'menu_too_large'});
    try{
      const q=await DB.query("UPDATE shaurma_venues SET menu=$2::jsonb,updated_at=NOW() WHERE establishment_id=$1 RETURNING *",[req.params.establishmentId,JSON.stringify(normalized)]);
      if(!q.rows[0])return res.sendStatus(404);
      publishVenue(q.rows[0]);await audit(req.params.establishmentId,auth.session.sub,'menu_updated',{items:normalized.length});
      res.json({ok:true,menu:normalized});
    }catch(e){res.status(500).json({error:'menu_update_failed'})}
  });

  app.get('/api/venue-owner/establishments/:establishmentId/orders',async(req,res)=>{
    const auth=await requireAccess(req,res,req.params.establishmentId,'orders');if(!auth)return;
    try{
      const q=await DB.query("SELECT * FROM shaurma_orders WHERE establishment_id=$1 ORDER BY created_at DESC LIMIT 200",[req.params.establishmentId]);
      res.json(q.rows);
    }catch(e){res.status(500).json({error:'orders_read_failed'})}
  });

  app.get('/api/venue-owner/establishments/:establishmentId/stream',async(req,res)=>{
    const auth=await requireAccess(req,res,req.params.establishmentId,'orders');if(!auth)return;
    const establishmentId=req.params.establishmentId;
    res.setHeader('Content-Type','text/event-stream');
    res.setHeader('Cache-Control','no-cache, no-transform');
    res.setHeader('Connection','keep-alive');
    res.flushHeaders?.();
    let lastSeen=new Date(Date.now()-5000).toISOString();
    res.write('event: ready\ndata: '+JSON.stringify({ok:true,establishment_id:establishmentId})+'\n\n');
    const tick=setInterval(async()=>{
      try{
        const q=await DB.query("SELECT * FROM shaurma_orders WHERE establishment_id=$1 AND updated_at>$2 ORDER BY updated_at ASC LIMIT 50",[establishmentId,lastSeen]);
        for(const order of q.rows){
          lastSeen=new Date(order.updated_at||Date.now()).toISOString();
          res.write('event: order\ndata: '+JSON.stringify(order)+'\n\n');
        }
        res.write(': ping\n\n');
      }catch{}
    },4000);
    req.on('close',()=>clearInterval(tick));
  });

  app.patch('/api/venue-owner/establishments/:establishmentId/orders/:orderId',async(req,res)=>{
    const auth=await requireAccess(req,res,req.params.establishmentId,'orders');if(!auth)return;
    const status=String(req.body?.status||'');
    if(!['new','cooking','ready','done','cancelled'].includes(status))return res.status(400).json({error:'bad_status'});
    try{
      const q=await DB.query("UPDATE shaurma_orders SET status=$3,updated_at=NOW() WHERE id=$2 AND establishment_id=$1 RETURNING *",[req.params.establishmentId,req.params.orderId,status]);
      const order=q.rows[0];if(!order)return res.sendStatus(404);
      pushOwner('update',order);await audit(req.params.establishmentId,auth.session.sub,'order_status_updated',{order_id:order.id,status});
      res.json(order);
    }catch(e){res.status(500).json({error:'order_update_failed'})}
  });

  app.get('/api/venue-owner/establishments/:establishmentId/stats',async(req,res)=>{
    const auth=await requireAccess(req,res,req.params.establishmentId,'orders');if(!auth)return;
    try{
      const q=await DB.query("SELECT * FROM shaurma_orders WHERE establishment_id=$1 AND created_at>=NOW()-INTERVAL '1 day'",[req.params.establishmentId]),rows=q.rows;
      res.json({today:rows.length,new:rows.filter(x=>x.status==='new').length,cooking:rows.filter(x=>x.status==='cooking').length,ready:rows.filter(x=>x.status==='ready').length,revenue:rows.filter(x=>x.status!=='cancelled').reduce((s,x)=>s+(Number(x.total)||0),0)});
    }catch(e){res.status(500).json({error:'stats_failed'})}
  });

  app.post('/api/shaurma/admin/establishments/:establishmentId/invites',async(req,res)=>{
    if(!ownerOk(req))return res.sendStatus(401);if(!DB)return res.status(503).json({error:'persistent_storage_required'});
    const est=String(req.params.establishmentId||''),role=['owner','manager','editor'].includes(req.body?.role)?req.body.role:'owner';
    const permissions=Array.isArray(req.body?.permissions)?req.body.permissions.filter(x=>DEFAULT_PERMISSIONS.includes(x)):DEFAULT_PERMISSIONS;
    try{
      const venue=(await DB.query("SELECT establishment_id,name FROM shaurma_venues WHERE establishment_id=$1",[est])).rows[0];
      if(!venue)return res.sendStatus(404);
      const raw='SC-'+crypto.randomBytes(4).toString('hex').toUpperCase();
      const days=Math.max(1,Math.min(30,Number(req.body?.expires_days)||7));
      const q=await DB.query(`
        INSERT INTO shaurma_venue_invites(establishment_id,code_hash,role,permissions,expires_at,max_uses,created_by)
        VALUES($1,$2,$3,$4::jsonb,NOW()+($5||' days')::interval,1,'superadmin')
        RETURNING id,establishment_id,role,permissions,expires_at,max_uses,uses,created_at
      `,[est,codeHash(raw),role,JSON.stringify(permissions),String(days)]);
      let link=null,username=null;
      try{const info=await getBotInfo();username=info?.username||null;if(username)link='https://t.me/'+username+'?start=claim_'+raw}catch{}
      res.status(201).json({...q.rows[0],claim_code:raw,bot_username:username,claim_link:link,venue_name:venue.name});
    }catch(e){res.status(500).json({error:'invite_create_failed'})}
  });

  app.get('/api/shaurma/admin/establishments/:establishmentId/admins',async(req,res)=>{
    if(!ownerOk(req))return res.sendStatus(401);if(!DB)return res.status(503).json({error:'persistent_storage_required'});
    const q=await DB.query("SELECT establishment_id,telegram_user_id,telegram_username,telegram_first_name,role,permissions,is_active,created_at,updated_at FROM shaurma_venue_admins WHERE establishment_id=$1 ORDER BY created_at",[req.params.establishmentId]);
    res.json(q.rows);
  });

  app.delete('/api/shaurma/admin/establishments/:establishmentId/admins/:telegramUserId',async(req,res)=>{
    if(!ownerOk(req))return res.sendStatus(401);if(!DB)return res.status(503).json({error:'persistent_storage_required'});
    await DB.query("UPDATE shaurma_venue_admins SET is_active=FALSE,updated_at=NOW() WHERE establishment_id=$1 AND telegram_user_id=$2",[req.params.establishmentId,String(req.params.telegramUserId)]);
    res.json({ok:true});
  });

  app.post('/api/venue-owner-bot/webhook/:secret',async(req,res)=>{
    if(!WEBHOOK_SECRET||req.params.secret!==WEBHOOK_SECRET)return res.sendStatus(404);
    res.json({ok:true});
    const msg=req.body?.message;if(!msg?.from?.id||!msg.chat?.id)return;
    const user=msg.from,text=String(msg.text||'').trim();
    try{
      const start=text.match(/^\/start(?:\s+(.+))?$/i);
      if(start){
        const param=String(start[1]||'');
        if(param.startsWith('claim_')){
          const code=param.slice(6);
          try{
            const access=await claimForTelegramUser(user,code);
            await sendOwnerBotMessage(msg.chat.id,'✅ Доступ подключён\n\n<b>'+String(access?.name||'Заведение')+'</b>\nID: <code>'+String(access?.establishment_id||'')+'</code>',{reply_markup:{inline_keyboard:[[{text:'Открыть кабинет',web_app:{url:OWNER_APP_URL}}]]}});
          }catch{await sendOwnerBotMessage(msg.chat.id,'Код доступа недействителен или уже использован. Запросите новый код у администратора Shaurmeg.')}
          return;
        }
        const access=await accessesFor(user.id);
        const textOut=access.length
          ?'Ваш кабинет Shaurmeg готов. Доступно заведений: <b>'+access.length+'</b>.'
          :'Бот владельца Shaurmeg. Чтобы подключить заведение, откройте ссылку-приглашение или введите код доступа в кабинете.';
        await sendOwnerBotMessage(msg.chat.id,textOut,{reply_markup:{inline_keyboard:[[{text:'Открыть кабинет',web_app:{url:OWNER_APP_URL}}]]}});
        return;
      }
      if(/^\/id$/i.test(text)){await sendOwnerBotMessage(msg.chat.id,'Ваш Telegram ID: <code>'+String(user.id)+'</code>');return}
      if(/^[A-Za-z0-9_-]{6,40}$/.test(text)){
        try{
          const access=await claimForTelegramUser(user,text);
          await sendOwnerBotMessage(msg.chat.id,'✅ Подключено: <b>'+String(access?.name||'Заведение')+'</b>',{reply_markup:{inline_keyboard:[[{text:'Открыть кабинет',web_app:{url:OWNER_APP_URL}}]]}});
        }catch{await sendOwnerBotMessage(msg.chat.id,'Не получилось применить этот код. Проверьте его или запросите новый.')}
      }
    }catch(e){console.error('Venue owner bot update:',e.message)}
  });

  app.get('/venue-owner',(req,res)=>{
    res.setHeader('Cache-Control','no-store, no-cache, must-revalidate, max-age=0');
    res.sendFile(path.join(__dirname,'venue-owner.html'));
  });

  async function syncBot(){
    if(!BOT_TOKEN){console.log('Venue owner bot token not configured');return}
    try{
      const info=await getBotInfo();
      await botApi('setChatMenuButton',{menu_button:{type:'web_app',text:'Моё заведение',web_app:{url:OWNER_APP_URL}}});
      await botApi('setMyCommands',{commands:[{command:'start',description:'Открыть кабинет владельца'},{command:'id',description:'Показать Telegram ID'}]});
      if(WEBHOOK_SECRET)await botApi('setWebhook',{url:BASE_URL+'/api/venue-owner-bot/webhook/'+WEBHOOK_SECRET,allowed_updates:['message'],drop_pending_updates:false});
      console.log('Venue owner bot synced @'+String(info.username||''));
    }catch(e){console.error('Venue owner bot sync:',e.message)}
  }

  return {syncBot,getBotInfo};
}

module.exports={installVenueOwner};
