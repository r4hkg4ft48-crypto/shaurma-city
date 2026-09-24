'use strict';
const express=require('express');
const crypto=require('crypto');
const db=require('./db');
const config=require('./config');
const auth=require('./auth');
const rt=require('./realtime');
const D=require('./domain');
const realcity=require('./realcity-service');

const router=express.Router();

function fail(res,e,fallback='server_error'){console.error(fallback,e);res.status(e.status||500).json({error:e.message||fallback})}
const DEFAULT_VENUE_PERMISSIONS=['menu','profile','media','appearance','orders'];
function normalizeInviteCode(v){return String(v||'').trim().toUpperCase().replace(/\s+/g,'')}
function inviteCodeHash(v){return crypto.createHash('sha256').update('shaurmeg-v2-owner:'+normalizeInviteCode(v)).digest('hex')}
async function ownerAccesses(userId){
  const q=await db.query(`SELECT a.establishment_id,a.role,a.permissions,v.name,v.venue_id,
    (SELECT id FROM shaurmeg_markers m WHERE m.establishment_id=a.establishment_id ORDER BY id LIMIT 1) marker_id
    FROM shaurma_venue_admins a JOIN shaurma_venues v ON v.establishment_id=a.establishment_id
    WHERE a.telegram_user_id=$1 AND a.is_active=TRUE AND v.is_active=TRUE ORDER BY v.name`,[String(userId)]);
  return q.rows;
}
function publicUser(row){
  return row?{id:String(row.telegram_user_id),username:row.username||'',first_name:row.first_name||'',last_name:row.last_name||'',profile:row.profile||{},favorites:Array.isArray(row.favorites)?row.favorites:[],preferences:row.preferences||{},payment:{provider:row.payment_provider||null,card_brand:row.payment_card_brand||null,card_last4:row.payment_card_last4||null,autopay_enabled:!!row.autopay_enabled,linked:!!row.payment_card_last4}}:null;
}
async function menuContext(marker,est){
  const markerId=D.markerId(marker),establishment=D.establishmentId(est);
  if(!markerId||!establishment)return null;
  const q=await db.query(`
    SELECT m.id marker_id,m.establishment_id,m.venue_id,m.name marker_name,m.address,m.description,m.lat,m.lon,
      m.hero_image,m.gallery,m.hours,m.price_label,m.marker_avatar,m.marker_style,m.realcity_profile,m.realcity_quality,m.updated_at marker_updated_at,
      v.slug,v.name venue_name,v.is_active,v.config,v.menu,v.updated_at
    FROM shaurmeg_markers m
    JOIN shaurma_venues v ON v.venue_id=m.venue_id AND v.establishment_id=m.establishment_id
    WHERE m.id=$1 AND m.establishment_id=$2 AND m.is_active=TRUE AND v.is_active=TRUE AND COALESCE(m.source_suppressed,FALSE)=FALSE
    LIMIT 1`,[markerId,establishment]);
  const r=q.rows[0];if(!r)return null;
  const menu=Array.isArray(r.menu)?r.menu:[];
  return {
    marker:{id:r.marker_id,establishment_id:r.establishment_id,venue_id:r.venue_id,name:r.marker_name,address:r.address,description:r.description||'',lat:r.lat,lon:r.lon,hero_image:r.hero_image||'',gallery:Array.isArray(r.gallery)?r.gallery:[],hours:r.hours||'',price_label:r.price_label||'',marker_avatar:r.marker_avatar||'',marker_style:D.markerStyle(r.marker_style),realcity_profile:r.realcity_profile||{},realcity_quality:r.realcity_quality||'heuristic',updated_at:r.marker_updated_at},
    venue:{establishment_id:r.establishment_id,venue_id:r.venue_id,slug:r.slug,name:r.venue_name,config:r.config||{},menu,sections:D.menuSections(r.config||{},menu),updated_at:r.updated_at}
  };
}

router.get('/health',(req,res)=>res.json({ok:true,version:config.BUILD,database:db.configured,architecture:'clean-v2'}));

router.get('/map/points',async(req,res)=>{
  try{
    const q=await db.query(`
      SELECT m.id,m.establishment_id,m.venue_id,m.name,m.address,m.lat,m.lon,m.category,m.marker_style,
        (m.marker_avatar<>'') has_avatar,m.realcity_profile,m.realcity_quality,m.updated_at,
        (jsonb_array_length(v.menu)>0) has_menu
      FROM shaurmeg_markers m JOIN shaurma_venues v ON v.venue_id=m.venue_id
      WHERE m.is_active=TRUE AND v.is_active=TRUE AND COALESCE(m.source_suppressed,FALSE)=FALSE
      ORDER BY m.id`);
    res.setHeader('Cache-Control','no-store');
    res.json(q.rows.map(x=>({...x,marker_id:x.id,marker_style:D.markerStyle(x.marker_style),has_avatar:!!x.has_avatar,has_menu:!!x.has_menu,realcity_profile:x.realcity_profile||{}})));
  }catch(e){fail(res,e,'map_points_failed')}
});
router.get('/map/markers/:id/avatar',async(req,res)=>{
  try{
    const q=await db.query("SELECT marker_avatar FROM shaurmeg_markers WHERE id=$1 AND is_active=TRUE",[req.params.id]);
    const raw=String(q.rows[0]?.marker_avatar||''),m=raw.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/s);
    if(!m)return res.sendStatus(404);res.type(m[1]).setHeader('Cache-Control','public,max-age=86400').send(Buffer.from(m[2],'base64'));
  }catch(e){res.sendStatus(404)}
});
router.get('/menu-context',async(req,res)=>{
  try{const ctx=await menuContext(req.query.marker_id,req.query.establishment_id);if(!ctx)return res.status(404).json({error:'menu_context_not_found'});res.setHeader('Cache-Control','no-store');res.json(ctx)}
  catch(e){fail(res,e,'menu_context_failed')}
});

router.post('/auth/telegram',async(req,res)=>{
  try{
    const user=auth.verifyInitData(req.body?.initData||'',config.CLIENT_BOT_TOKEN);
    const q=await db.query(`
      INSERT INTO shaurma_users(telegram_user_id,username,first_name,last_name,language_code,is_premium,last_seen_at,updated_at)
      VALUES($1,$2,$3,$4,$5,$6,NOW(),NOW())
      ON CONFLICT(telegram_user_id) DO UPDATE SET username=EXCLUDED.username,first_name=EXCLUDED.first_name,last_name=EXCLUDED.last_name,language_code=EXCLUDED.language_code,is_premium=EXCLUDED.is_premium,last_seen_at=NOW(),updated_at=NOW()
      RETURNING *`,[String(user.id),user.username||null,user.first_name||null,user.last_name||null,user.language_code||null,!!user.is_premium]);
    res.json({ok:true,session:auth.sign(user,'client'),user:publicUser(q.rows[0])});
  }catch(e){fail(res,e,'telegram_auth_failed')}
});
router.get('/me',auth.requireSession('client'),async(req,res)=>{
  try{const q=await db.query('SELECT * FROM shaurma_users WHERE telegram_user_id=$1',[String(req.session.sub)]);if(!q.rows[0])return res.sendStatus(404);res.json(publicUser(q.rows[0]))}
  catch(e){fail(res,e,'profile_read_failed')}
});
router.patch('/me',auth.requireSession('client'),async(req,res)=>{
  try{
    const p=req.body?.profile&&typeof req.body.profile==='object'?req.body.profile:null;
    const prefs=req.body?.preferences&&typeof req.body.preferences==='object'?req.body.preferences:null;
    const fav=Array.isArray(req.body?.favorites)?req.body.favorites.slice(0,100):null;
    const q=await db.query(`UPDATE shaurma_users SET profile=CASE WHEN $2::jsonb IS NULL THEN profile ELSE profile||$2::jsonb END,preferences=CASE WHEN $3::jsonb IS NULL THEN preferences ELSE preferences||$3::jsonb END,favorites=COALESCE($4::jsonb,favorites),updated_at=NOW() WHERE telegram_user_id=$1 RETURNING *`,[String(req.session.sub),p?JSON.stringify(p):null,prefs?JSON.stringify(prefs):null,fav?JSON.stringify(fav):null]);
    res.json(publicUser(q.rows[0]));
  }catch(e){fail(res,e,'profile_update_failed')}
});
router.get('/me/orders',auth.requireSession('client'),async(req,res)=>{
  try{const q=await db.query('SELECT * FROM shaurma_orders WHERE telegram_user_id=$1 ORDER BY created_at DESC LIMIT 100',[String(req.session.sub)]);res.json(q.rows)}
  catch(e){fail(res,e,'orders_read_failed')}
});
router.get('/me/stream',auth.requireSession('client'),(req,res)=>{const close=rt.stream(res,rt.userSet(req.session.sub));req.on('close',close)});

router.post('/orders',async(req,res)=>{
  try{
    const sess=auth.readToken(req,'client');
    let tg=sess?{id:sess.sub,username:sess.username,first_name:sess.first_name}:null;
    if(!tg&&req.body?.telegram_init_data){try{tg=auth.verifyInitData(req.body.telegram_init_data,config.CLIENT_BOT_TOKEN)}catch{}}
    const ctx=await menuContext(req.body?.marker_id,req.body?.establishment_id);if(!ctx)return res.status(409).json({error:'invalid_venue_context'});
    if(String(req.body?.venue_id||ctx.venue.venue_id)!==String(ctx.venue.venue_id))return res.status(409).json({error:'venue_context_mismatch'});
    const items=Array.isArray(req.body?.items)?req.body.items:[];if(!items.length)return res.status(400).json({error:'empty_order'});
    const menu=new Map(ctx.venue.menu.filter(x=>x.active!==false).map(x=>[String(x.id),x]));
    const normalized=[];
    for(const i of items){
      const src=menu.get(String(i.id));if(!src)return res.status(400).json({error:'item_not_in_menu',item_id:i.id});
      const q=Math.max(1,Math.min(50,Math.floor(Number(i.q)||1))),p=Number(src.p??src.price);
      if(!Number.isFinite(p)||p<0)return res.status(400).json({error:'invalid_price'});
      normalized.push({id:String(src.id),n:String(src.n||src.name||'Позиция'),p,q,detail:String(i.detail||'').slice(0,500)});
    }
    const fulfillment=req.body?.fulfillment_type==='cafe'?'cafe':'delivery';
    if(fulfillment==='delivery'&&!String(req.body?.phone||'').trim())return res.status(400).json({error:'phone_required'});
    if(fulfillment==='delivery'&&!String(req.body?.address||'').trim())return res.status(400).json({error:'address_required'});
    const total=normalized.reduce((s,x)=>s+x.p*x.q,0),num=D.orderNumber();
    const q=await db.query(`
      INSERT INTO shaurma_orders(order_number,items,total,customer_name,phone,address,comment,status,source,telegram_user_id,telegram_username,telegram_first_name,fulfillment_type,payment_status,payment_method,venue_id,venue_name,establishment_id)
      VALUES($1,$2::jsonb,$3,$4,$5,$6,$7,'new',$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`,
      [num,JSON.stringify(normalized),total,String(req.body?.customer_name||tg?.first_name||'Гость').slice(0,120),fulfillment==='delivery'?String(req.body.phone):null,fulfillment==='delivery'?String(req.body.address):null,String(req.body?.comment||'').slice(0,500),tg?'telegram':'web',tg?String(tg.id):null,tg?.username||null,tg?.first_name||null,fulfillment,'pending',req.body?.payment_method||null,ctx.venue.venue_id,ctx.venue.name,ctx.venue.establishment_id]);
    const order=q.rows[0];rt.pushOwner('order',order);rt.pushVenue(order.establishment_id,'order',order);if(order.telegram_user_id)rt.pushUser(order.telegram_user_id,'order',order);
    res.status(201).json(order);
  }catch(e){fail(res,e,'order_create_failed')}
});

router.post('/admin/auth/telegram',async(req,res)=>{
  try{
    const user=auth.verifyInitData(req.body?.initData||'',config.ADMIN_BOT_TOKEN);
    if(!config.ADMIN_IDS.has(String(user.id)))return res.status(403).json({error:'admin_not_allowed'});
    res.json({ok:true,session:auth.sign(user,'admin'),user:{id:String(user.id),username:user.username||'',first_name:user.first_name||''}});
  }catch(e){fail(res,e,'admin_auth_failed')}
});
router.post('/admin/login',(req,res)=>{
  if(!config.OWNER_PASSWORD||!config.OWNER_API_TOKEN)return res.status(503).json({error:'owner_not_configured'});
  if(String(req.body?.password||'')!==config.OWNER_PASSWORD)return res.status(401).json({error:'invalid_password'});
  res.json({ok:true,token:config.OWNER_API_TOKEN});
});
router.get('/admin/stream',auth.requireOwner,(req,res)=>{const close=rt.stream(res,rt.ownerStream);req.on('close',close)});
router.get('/admin/venues',auth.requireOwner,async(req,res)=>{
  try{const q=await db.query(`SELECT v.*,COUNT(m.id)::int marker_count FROM shaurma_venues v LEFT JOIN shaurmeg_markers m ON m.venue_id=v.venue_id GROUP BY v.venue_id ORDER BY v.name`);res.json(q.rows)}
  catch(e){fail(res,e,'admin_venues_failed')}
});
router.get('/admin/venues/:establishmentId/admins',auth.requireOwner,async(req,res)=>{
  try{
    const est=D.establishmentId(req.params.establishmentId);if(!est)return res.status(400).json({error:'bad_establishment_id'});
    const q=await db.query('SELECT id,establishment_id,telegram_user_id,telegram_username,telegram_first_name,role,permissions,is_active,created_at,updated_at FROM shaurma_venue_admins WHERE establishment_id=$1 ORDER BY created_at',[est]);
    res.json(q.rows);
  }catch(e){fail(res,e,'venue_admins_failed')}
});
router.post('/admin/venues/:establishmentId/admins',auth.requireOwner,async(req,res)=>{
  try{
    const est=D.establishmentId(req.params.establishmentId),uid=String(req.body?.telegram_user_id||'').trim();
    if(!est||!/^\d{4,20}$/.test(uid))return res.status(400).json({error:'invalid_owner_access'});
    const permissions=Array.isArray(req.body?.permissions)?req.body.permissions:DEFAULT_VENUE_PERMISSIONS;
    const q=await db.query(`INSERT INTO shaurma_venue_admins(establishment_id,telegram_user_id,telegram_username,telegram_first_name,role,permissions,is_active,added_by)
      VALUES($1,$2,$3,$4,$5,$6::jsonb,TRUE,'superadmin')
      ON CONFLICT(establishment_id,telegram_user_id) DO UPDATE SET role=EXCLUDED.role,permissions=EXCLUDED.permissions,is_active=TRUE,updated_at=NOW()
      RETURNING *`,[est,uid,String(req.body?.telegram_username||''),String(req.body?.telegram_first_name||''),String(req.body?.role||'owner'),JSON.stringify(permissions)]);
    await db.query("INSERT INTO shaurma_venue_audit(establishment_id,telegram_user_id,action,payload) VALUES($1,'superadmin','owner_access_granted',$2::jsonb)",[est,JSON.stringify({telegram_user_id:uid})]);
    res.status(201).json(q.rows[0]);
  }catch(e){fail(res,e,'venue_admin_create_failed')}
});
router.delete('/admin/venues/:establishmentId/admins/:telegramUserId',auth.requireOwner,async(req,res)=>{
  try{
    const est=D.establishmentId(req.params.establishmentId);if(!est)return res.status(400).json({error:'bad_establishment_id'});
    const q=await db.query('UPDATE shaurma_venue_admins SET is_active=FALSE,updated_at=NOW() WHERE establishment_id=$1 AND telegram_user_id=$2 RETURNING id',[est,String(req.params.telegramUserId)]);
    if(!q.rows[0])return res.sendStatus(404);res.json({ok:true});
  }catch(e){fail(res,e,'venue_admin_delete_failed')}
});
router.post('/admin/venues/:establishmentId/invites',auth.requireOwner,async(req,res)=>{
  try{
    const est=D.establishmentId(req.params.establishmentId);if(!est)return res.status(400).json({error:'bad_establishment_id'});
    const venue=await db.query('SELECT name FROM shaurma_venues WHERE establishment_id=$1',[est]);if(!venue.rows[0])return res.sendStatus(404);
    const code='OWN-'+crypto.randomBytes(5).toString('hex').toUpperCase(),hours=Math.max(1,Math.min(168,Number(req.body?.hours)||72));
    const permissions=Array.isArray(req.body?.permissions)?req.body.permissions:DEFAULT_VENUE_PERMISSIONS;
    const q=await db.query(`INSERT INTO shaurma_venue_invites(establishment_id,code_hash,role,permissions,expires_at,max_uses,is_active,created_by)
      VALUES($1,$2,$3,$4::jsonb,NOW()+($5::text||' hours')::interval,1,TRUE,'superadmin') RETURNING id,establishment_id,role,permissions,expires_at`,
      [est,inviteCodeHash(code),String(req.body?.role||'owner'),JSON.stringify(permissions),String(hours)]);
    res.status(201).json({...q.rows[0],code,venue_name:venue.rows[0].name});
  }catch(e){fail(res,e,'venue_invite_create_failed')}
});
router.get('/admin/markers',auth.requireOwner,async(req,res)=>{
  try{const q=await db.query('SELECT * FROM shaurmeg_markers ORDER BY id');res.json(q.rows.map(x=>({...x,marker_style:D.markerStyle(x.marker_style)})))}
  catch(e){fail(res,e,'admin_markers_failed')}
});
router.post('/admin/markers',auth.requireOwner,async(req,res)=>{
  try{
    const b=req.body||{},name=String(b.name||'').trim(),lat=Number(b.lat),lon=Number(b.lon);if(!name||!Number.isFinite(lat)||!Number.isFinite(lon))return res.status(400).json({error:'invalid_marker'});
    const vId=D.venueId(b.venue_id)||crypto.randomBytes(8).toString('hex'),est=D.establishmentIdForVenue(vId);
    const row=await db.tx(async c=>{
      await c.query(`INSERT INTO shaurma_venues(venue_id,slug,name,is_active,config,menu,establishment_id) VALUES($1,$1,$2,TRUE,$3::jsonb,'[]'::jsonb,$4) ON CONFLICT(venue_id) DO UPDATE SET name=EXCLUDED.name,establishment_id=COALESCE(shaurma_venues.establishment_id,EXCLUDED.establishment_id),updated_at=NOW()`,[vId,name,JSON.stringify({subtitle:'МЕНЮ ЗАВЕДЕНИЯ',builder_enabled:false}),est]);
      const q=await c.query(`INSERT INTO shaurmeg_markers(venue_id,establishment_id,name,address,description,lat,lon,hero_image,gallery,hours,price_label,marker_avatar,marker_style,category,is_active,position_locked,metadata_locked) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13::jsonb,$14,TRUE,TRUE,TRUE) RETURNING *`,[vId,est,name,String(b.address||''),String(b.description||''),lat,lon,String(b.hero_image||''),JSON.stringify(Array.isArray(b.gallery)?b.gallery:[]),String(b.hours||''),String(b.price_label||''),String(b.marker_avatar||''),JSON.stringify(D.markerStyle(b.marker_style)),String(b.category||'shawarma')]);
      return q.rows[0];
    });res.status(201).json(row);
  }catch(e){fail(res,e,'marker_create_failed')}
});
router.put('/admin/markers/:id',auth.requireOwner,async(req,res)=>{
  try{
    const b=req.body||{},lat=Number(b.lat),lon=Number(b.lon);if(!Number.isFinite(lat)||!Number.isFinite(lon)||!String(b.name||'').trim())return res.status(400).json({error:'invalid_marker'});
    const q=await db.query(`UPDATE shaurmeg_markers SET name=$2,address=$3,description=$4,lat=$5,lon=$6,hero_image=$7,gallery=$8::jsonb,hours=$9,price_label=$10,marker_avatar=$11,marker_style=$12::jsonb,category=$13,is_active=$14,position_locked=TRUE,metadata_locked=TRUE,appearance_locked=TRUE,updated_at=NOW() WHERE id=$1 RETURNING *`,[req.params.id,String(b.name).trim(),String(b.address||''),String(b.description||''),lat,lon,String(b.hero_image||''),JSON.stringify(Array.isArray(b.gallery)?b.gallery:[]),String(b.hours||''),String(b.price_label||''),String(b.marker_avatar||''),JSON.stringify(D.markerStyle(b.marker_style)),String(b.category||'shawarma'),b.is_active!==false]);
    if(!q.rows[0])return res.sendStatus(404);await db.query('UPDATE shaurma_venues SET name=$2,is_active=$3,updated_at=NOW() WHERE venue_id=$1',[q.rows[0].venue_id,q.rows[0].name,q.rows[0].is_active]);res.json(q.rows[0]);
  }catch(e){fail(res,e,'marker_update_failed')}
});
router.put('/admin/markers/:id/realcity',auth.requireOwner,async(req,res)=>{
  try{
    const saved=await realcity.saveReferences(req.params.id,req.body?.reference_images);
    if(!saved)return res.sendStatus(404);
    res.status(202).json({...saved,profile_version:realcity.PROFILE_VERSION});
  }catch(e){fail(res,e,'realcity_reference_update_failed')}
});
router.post('/admin/markers/:id/realcity/rebuild',auth.requireOwner,async(req,res)=>{
  try{
    const q=await db.query("UPDATE shaurmeg_markers SET realcity_status='pending',updated_at=NOW() WHERE id=$1 RETURNING id",[req.params.id]);
    if(!q.rows[0])return res.sendStatus(404);
    realcity.queue(req.params.id)?.catch(()=>{});
    res.status(202).json({ok:true,status:'pending',profile_version:realcity.PROFILE_VERSION});
  }catch(e){fail(res,e,'realcity_rebuild_failed')}
});
router.get('/admin/markers/:id/realcity',auth.requireOwner,async(req,res)=>{
  try{
    const q=await db.query("SELECT id,realcity_status,realcity_quality,realcity_updated_at,realcity_profile,jsonb_array_length(realcity_reference_images) reference_count FROM shaurmeg_markers WHERE id=$1",[req.params.id]);
    if(!q.rows[0])return res.sendStatus(404);res.json(q.rows[0]);
  }catch(e){fail(res,e,'realcity_read_failed')}
});
router.delete('/admin/markers/:id',auth.requireOwner,async(req,res)=>{
  try{const q=await db.query('UPDATE shaurmeg_markers SET is_active=FALSE,source_suppressed=TRUE,updated_at=NOW() WHERE id=$1 RETURNING id,venue_id',[req.params.id]);if(!q.rows[0])return res.sendStatus(404);await db.query('UPDATE shaurma_venues SET is_active=FALSE,updated_at=NOW() WHERE venue_id=$1',[q.rows[0].venue_id]);res.json({ok:true})}
  catch(e){fail(res,e,'marker_delete_failed')}
});
router.put('/admin/venues/:establishmentId/menu',auth.requireOwner,async(req,res)=>{
  try{
    const est=D.establishmentId(req.params.establishmentId);if(!est)return res.status(400).json({error:'bad_establishment_id'});
    const menu=D.normalizeMenu(req.body?.menu),configPatch=req.body?.config&&typeof req.body.config==='object'?req.body.config:{};
    const current=await db.query('SELECT config FROM shaurma_venues WHERE establishment_id=$1',[est]);if(!current.rows[0])return res.sendStatus(404);
    const cfg={...(current.rows[0].config||{}),...configPatch};
    const q=await db.query('UPDATE shaurma_venues SET menu=$2::jsonb,config=$3::jsonb,updated_at=NOW() WHERE establishment_id=$1 RETURNING *',[est,JSON.stringify(menu),JSON.stringify(cfg)]);
    rt.pushVenue(est,'venue',q.rows[0]);res.json(q.rows[0]);
  }catch(e){fail(res,e,'menu_update_failed')}
});
router.get('/admin/orders',auth.requireOwner,async(req,res)=>{
  try{const est=D.establishmentId(req.query.establishment_id);const q=est?await db.query('SELECT * FROM shaurma_orders WHERE establishment_id=$1 ORDER BY created_at DESC LIMIT 300',[est]):await db.query('SELECT * FROM shaurma_orders ORDER BY created_at DESC LIMIT 300');res.json(q.rows)}
  catch(e){fail(res,e,'admin_orders_failed')}
});
router.patch('/admin/orders/:id',auth.requireOwner,async(req,res)=>{
  try{
    const status=String(req.body?.status||'');if(!['new','cooking','ready','done','cancelled'].includes(status))return res.status(400).json({error:'bad_status'});
    const q=await db.query('UPDATE shaurma_orders SET status=$2,updated_at=NOW() WHERE id=$1 RETURNING *',[req.params.id,status]);const o=q.rows[0];if(!o)return res.sendStatus(404);
    rt.pushOwner('update',o);rt.pushVenue(o.establishment_id,'update',o);if(o.telegram_user_id)rt.pushUser(o.telegram_user_id,'update',o);res.json(o);
  }catch(e){fail(res,e,'order_update_failed')}
});

router.post('/venue-owner/auth/telegram',async(req,res)=>{
  try{
    const user=auth.verifyInitData(req.body?.initData||'',config.VENUE_OWNER_BOT_TOKEN);
    const accesses=await ownerAccesses(user.id);
    res.json({ok:true,session:auth.sign(user,'venue'),user:{id:String(user.id),username:user.username||'',first_name:user.first_name||''},establishments:accesses});
  }catch(e){fail(res,e,'venue_owner_auth_failed')}
});
router.get('/venue-owner/me',auth.requireSession('venue'),async(req,res)=>{
  try{res.json({user:{id:String(req.session.sub),username:req.session.username||'',first_name:req.session.first_name||''},establishments:await ownerAccesses(req.session.sub)})}
  catch(e){fail(res,e,'venue_owner_me_failed')}
});
router.post('/venue-owner/claim',auth.requireSession('venue'),async(req,res)=>{
  const code=normalizeInviteCode(req.body?.code);
  if(!/^OWN-[A-F0-9]{10}$/.test(code))return res.status(400).json({error:'bad_claim_code'});
  try{
    const access=await db.tx(async client=>{
      const q=await client.query('SELECT * FROM shaurma_venue_invites WHERE code_hash=$1 AND is_active=TRUE AND expires_at>NOW() AND uses<max_uses FOR UPDATE',[inviteCodeHash(code)]);
      const inv=q.rows[0];if(!inv)throw Object.assign(new Error('claim_code_invalid_or_expired'),{status:400});
      await client.query(`INSERT INTO shaurma_venue_admins(establishment_id,telegram_user_id,telegram_username,telegram_first_name,role,permissions,is_active,added_by)
        VALUES($1,$2,$3,$4,$5,$6::jsonb,TRUE,'invite')
        ON CONFLICT(establishment_id,telegram_user_id) DO UPDATE SET role=EXCLUDED.role,permissions=EXCLUDED.permissions,is_active=TRUE,updated_at=NOW()`,
        [inv.establishment_id,String(req.session.sub),req.session.username||'',req.session.first_name||'',inv.role,JSON.stringify(inv.permissions||DEFAULT_VENUE_PERMISSIONS)]);
      await client.query('UPDATE shaurma_venue_invites SET uses=uses+1,is_active=CASE WHEN uses+1>=max_uses THEN FALSE ELSE is_active END,last_used_at=NOW() WHERE id=$1',[inv.id]);
      await client.query("INSERT INTO shaurma_venue_audit(establishment_id,telegram_user_id,action,payload) VALUES($1,$2,'access_claimed',$3::jsonb)",[inv.establishment_id,String(req.session.sub),JSON.stringify({invite_id:inv.id})]);
      return inv.establishment_id;
    });
    res.json({ok:true,establishment_id:access,establishments:await ownerAccesses(req.session.sub)});
  }catch(e){fail(res,e,'venue_owner_claim_failed')}
});
async function venueAccess(req,res,permission){
  const s=auth.readToken(req,'venue');if(!s){res.status(401).json({error:'unauthorized'});return null}
  const est=D.establishmentId(req.params.establishmentId||req.query.establishment_id);if(!est){res.status(400).json({error:'bad_establishment_id'});return null}
  const q=await db.query('SELECT * FROM shaurma_venue_admins WHERE establishment_id=$1 AND telegram_user_id=$2 AND is_active=TRUE',[est,String(s.sub)]);
  const a=q.rows[0];if(!a){res.status(403).json({error:'forbidden'});return null}
  const perms=Array.isArray(a.permissions)?a.permissions:[];if(permission&&a.role!=='owner'&&!perms.includes(permission)){res.status(403).json({error:'permission_denied'});return null}
  return {s,est,a};
}
router.get('/venue-owner/establishments/:establishmentId',async(req,res)=>{
  const a=await venueAccess(req,res,'profile');if(!a)return;
  try{const q=await db.query(`SELECT v.*,m.id marker_id,m.address,m.description,m.lat,m.lon,m.hero_image,m.gallery,m.hours,m.price_label,m.marker_avatar,m.marker_style FROM shaurma_venues v LEFT JOIN LATERAL(SELECT * FROM shaurmeg_markers WHERE establishment_id=v.establishment_id ORDER BY id LIMIT 1)m ON TRUE WHERE v.establishment_id=$1`,[a.est]);if(!q.rows[0])return res.sendStatus(404);res.json({...q.rows[0],marker_style:D.markerStyle(q.rows[0].marker_style),sections:D.menuSections(q.rows[0].config,q.rows[0].menu)})}
  catch(e){fail(res,e,'venue_owner_read_failed')}
});
router.put('/venue-owner/establishments/:establishmentId/menu',async(req,res)=>{
  const a=await venueAccess(req,res,'menu');if(!a)return;
  try{const menu=D.normalizeMenu(req.body?.menu);const cur=await db.query('SELECT config FROM shaurma_venues WHERE establishment_id=$1',[a.est]);const cfg={...(cur.rows[0]?.config||{}),menu_sections:Array.isArray(req.body?.sections)?req.body.sections:cur.rows[0]?.config?.menu_sections};const q=await db.query('UPDATE shaurma_venues SET menu=$2::jsonb,config=$3::jsonb,updated_at=NOW() WHERE establishment_id=$1 RETURNING *',[a.est,JSON.stringify(menu),JSON.stringify(cfg)]);await db.query("INSERT INTO shaurma_venue_audit(establishment_id,telegram_user_id,action,payload) VALUES($1,$2,'menu_updated',$3::jsonb)",[a.est,String(a.s.sub),JSON.stringify({items:menu.length})]);rt.pushVenue(a.est,'venue',q.rows[0]);res.json(q.rows[0])}
  catch(e){fail(res,e,'venue_owner_menu_failed')}
});
router.patch('/venue-owner/establishments/:establishmentId/profile',async(req,res)=>{
  const a=await venueAccess(req,res,'profile');if(!a)return;
  try{
    const b=req.body||{},name=String(b.name||'').trim();if(!name)return res.status(400).json({error:'name_required'});
    await db.tx(async c=>{await c.query('UPDATE shaurma_venues SET name=$2,config=config||$3::jsonb,updated_at=NOW() WHERE establishment_id=$1',[a.est,name,JSON.stringify(b.config&&typeof b.config==='object'?b.config:{})]);await c.query('UPDATE shaurmeg_markers SET name=$2,address=$3,description=$4,hours=$5,price_label=$6,hero_image=$7,metadata_locked=TRUE,updated_at=NOW() WHERE establishment_id=$1',[a.est,name,String(b.address||''),String(b.description||''),String(b.hours||''),String(b.price_label||''),String(b.hero_image||'')]);});
    res.json({ok:true});
  }catch(e){fail(res,e,'venue_owner_profile_failed')}
});
router.get('/venue-owner/establishments/:establishmentId/orders',async(req,res)=>{
  const a=await venueAccess(req,res,'orders');if(!a)return;
  try{const q=await db.query('SELECT * FROM shaurma_orders WHERE establishment_id=$1 ORDER BY created_at DESC LIMIT 200',[a.est]);res.json(q.rows)}
  catch(e){fail(res,e,'venue_owner_orders_failed')}
});
router.patch('/venue-owner/establishments/:establishmentId/orders/:orderId',async(req,res)=>{
  const a=await venueAccess(req,res,'orders');if(!a)return;
  const status=String(req.body?.status||'');
  if(!['new','cooking','ready','done','cancelled'].includes(status))return res.status(400).json({error:'bad_status'});
  try{
    const q=await db.query('UPDATE shaurma_orders SET status=$3,updated_at=NOW() WHERE id=$1 AND establishment_id=$2 RETURNING *',[req.params.orderId,a.est,status]);
    const order=q.rows[0];if(!order)return res.sendStatus(404);
    await db.query("INSERT INTO shaurma_venue_audit(establishment_id,telegram_user_id,action,payload) VALUES($1,$2,'order_status_updated',$3::jsonb)",[a.est,String(a.s.sub),JSON.stringify({order_id:order.id,status})]);
    rt.pushOwner('update',order);rt.pushVenue(a.est,'update',order);if(order.telegram_user_id)rt.pushUser(order.telegram_user_id,'update',order);
    res.json(order);
  }catch(e){fail(res,e,'venue_owner_order_update_failed')}
});
router.patch('/venue-owner/establishments/:establishmentId/appearance',async(req,res)=>{
  const a=await venueAccess(req,res,'appearance');if(!a)return;
  try{
    const q=await db.query('SELECT category,marker_style,marker_avatar FROM shaurmeg_markers WHERE establishment_id=$1 ORDER BY id LIMIT 1',[a.est]);
    if(!q.rows[0])return res.sendStatus(404);
    const style=D.markerStyle(req.body?.marker_style||q.rows[0].marker_style);
    const avatar=String(req.body?.marker_avatar??q.rows[0].marker_avatar??'').trim().slice(0,900000);
    await db.query('UPDATE shaurmeg_markers SET marker_style=$2::jsonb,marker_avatar=$3,appearance_locked=TRUE,updated_at=NOW() WHERE establishment_id=$1',[a.est,JSON.stringify(style),avatar]);
    await db.query("INSERT INTO shaurma_venue_audit(establishment_id,telegram_user_id,action,payload) VALUES($1,$2,'appearance_updated',$3::jsonb)",[a.est,String(a.s.sub),JSON.stringify({icon:style.icon,background:style.background})]);
    res.json({ok:true,marker_style:style,has_avatar:!!avatar});
  }catch(e){fail(res,e,'venue_owner_appearance_failed')}
});
router.get('/venue-owner/establishments/:establishmentId/stream',async(req,res)=>{
  const a=await venueAccess(req,res,'orders');if(!a)return;const close=rt.stream(res,rt.venueSet(a.est));req.on('close',close);
});

module.exports={router,menuContext};
