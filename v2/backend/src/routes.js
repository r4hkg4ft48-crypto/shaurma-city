'use strict';
const express=require('express');
const crypto=require('crypto');
const db=require('./db');
const config=require('./config');
const auth=require('./auth');
const rt=require('./realtime');
const D=require('./domain');
const realcity=require('./realcity-service');
const telegram=require('./telegram');

const router=express.Router();

function fail(res,e,fallback='server_error'){console.error(fallback,e);res.status(e.status||500).json({error:e.message||fallback})}
function verifyCustomerTelegram(initData){
  return auth.verifyInitDataAny(initData,[config.AGGREGATOR_BOT_TOKEN,config.CLIENT_BOT_TOKEN]);
}
function orderStatusLabel(status){
  return ({new:'Принят',cooking:'Готовится',ready:'Готово',done:'Выполнен',cancelled:'Отменён'})[String(status)]||String(status||'');
}
function notifyCustomer(order,text,menuCtx=null){
  if(!order?.telegram_user_id)return;
  const row=[];
  if(menuCtx?.marker?.id&&menuCtx?.venue?.establishment_id){
    const u=new URL(config.PUBLIC_APP_URL+'/menu.html');
    u.searchParams.set('marker',String(menuCtx.marker.id));
    u.searchParams.set('establishment',String(menuCtx.venue.establishment_id));
    row.push({text:'Открыть меню',web_app:{url:u.toString()}});
  }else{
    row.push({text:'Открыть карту',web_app:{url:config.PUBLIC_APP_URL+'/index.html'}});
  }
  telegram.sendClientMessage(order.telegram_user_id,text,{inline_keyboard:[row]})
    .catch(e=>console.error('telegram_customer_notify',e.message));
}
const DEFAULT_VENUE_PERMISSIONS=['menu','profile','media','appearance','orders'];
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
function referralCodeFor(userId){return 'SR'+crypto.createHash('sha256').update('shaurmeg-referral:'+String(userId)).digest('hex').slice(0,10).toUpperCase()}
function normalizeReferralCode(v){return String(v||'').trim().toUpperCase().replace(/^REF[_-]?/,'').replace(/[^A-Z0-9]/g,'').slice(0,24)}
function referralStartParam(initData){
  try{return new URLSearchParams(String(initData||'')).get('start_param')||''}catch{return ''}
}
async function applyReferral(referredUserId,rawCode){
  const code=normalizeReferralCode(rawCode);if(!/^SR[A-F0-9]{10}$/.test(code))return false;
  const q=await db.query('SELECT telegram_user_id FROM shaurma_users WHERE referral_code=$1',[code]);
  const referrer=String(q.rows[0]?.telegram_user_id||'');const referred=String(referredUserId||'');
  if(!referrer||!referred||referrer===referred)return false;
  const ins=await db.query(`INSERT INTO shaurma_referrals(referrer_user_id,referred_user_id,referral_code,status)
    VALUES($1,$2,$3,'joined') ON CONFLICT(referred_user_id) DO NOTHING RETURNING id`,[referrer,referred,code]);
  return !!ins.rows[0];
}
function referralUrl(code){return 'https://t.me/'+config.AGGREGATOR_BOT_USERNAME+'?startapp=ref_'+encodeURIComponent(code)}
async function ownerAccesses(userId){
  const q=await db.query(`SELECT a.establishment_id,a.role,a.permissions,v.name,v.venue_id,
    (SELECT id FROM shaurmeg_markers m WHERE m.establishment_id=a.establishment_id ORDER BY id LIMIT 1) marker_id
    FROM shaurma_venue_admins a JOIN shaurma_venues v ON v.establishment_id=a.establishment_id
    WHERE a.telegram_user_id=$1 AND a.is_active=TRUE AND v.is_active=TRUE ORDER BY v.name`,[String(userId)]);
  return q.rows;
}
function publicUser(row){
  return row?{id:String(row.telegram_user_id),username:row.username||'',first_name:row.first_name||'',last_name:row.last_name||'',profile:row.profile||{},favorites:Array.isArray(row.favorites)?row.favorites:[],preferences:row.preferences||{},referral_code:row.referral_code||'',payment:{provider:row.payment_provider||null,card_brand:row.payment_card_brand||null,card_last4:row.payment_card_last4||null,autopay_enabled:!!row.autopay_enabled,linked:!!row.payment_card_last4}}:null;
}
function favoriteRefs(value){
  if(!Array.isArray(value))return [];
  const seen=new Set(),out=[];
  for(const raw of value){
    if(!raw||typeof raw!=='object'||Array.isArray(raw))continue;
    const establishment_id=D.establishmentId(raw.establishment_id),item_id=String(raw.item_id||'').trim().slice(0,100);
    if(!establishment_id||!item_id)continue;
    const key=establishment_id+':'+item_id;if(seen.has(key))continue;seen.add(key);
    out.push({establishment_id,item_id,added_at:String(raw.added_at||'')||null});
  }
  return out.slice(0,200);
}
function publicFavoriteImage(establishmentId,item,updatedAt){
  const raw=String(item?.image||item?.i||'').trim();
  if(!raw)return '';
  if(/^data:image\/[a-zA-Z0-9.+-]+;base64,/i.test(raw)){
    const stamp=new Date(updatedAt||Date.now()).getTime();
    return config.PUBLIC_API_URL+'/api/v2/menu-image/'+encodeURIComponent(establishmentId)+'/'+encodeURIComponent(String(item.id))+'?v='+stamp;
  }
  return raw;
}
async function favoriteView(userId){
  const uid=String(userId||'');
  const [uq,oq]=await Promise.all([
    db.query('SELECT favorites FROM shaurma_users WHERE telegram_user_id=$1',[uid]),
    db.query(`SELECT establishment_id,venue_name,marker_id,items,created_at
      FROM shaurma_orders
      WHERE telegram_user_id=$1 AND status<>'cancelled'
      ORDER BY created_at DESC LIMIT 300`,[uid])
  ]);
  const explicit=favoriteRefs(uq.rows[0]?.favorites),history=new Map(),establishments=new Set(explicit.map(x=>x.establishment_id));
  for(const order of oq.rows){
    const est=D.establishmentId(order.establishment_id);if(!est)continue;establishments.add(est);
    const counted=new Set();
    for(const item of (Array.isArray(order.items)?order.items:[])){
      const itemId=String(item?.id||'').trim().slice(0,100);if(!itemId)continue;
      const key=est+':'+itemId,entry=history.get(key)||{orders:0,quantity:0,last_order_at:null};
      if(!counted.has(itemId)){entry.orders++;counted.add(itemId)}
      entry.quantity+=Math.max(1,Number(item?.q)||1);
      if(!entry.last_order_at)entry.last_order_at=order.created_at;
      history.set(key,entry);
    }
  }
  const ests=[...establishments];
  if(!ests.length)return {groups:[],explicit:[]};
  const vq=await db.query(`SELECT v.establishment_id,v.venue_id,v.name,v.menu,v.updated_at,
      (SELECT m.id FROM shaurmeg_markers m WHERE m.establishment_id=v.establishment_id AND m.is_active=TRUE AND COALESCE(m.source_suppressed,FALSE)=FALSE ORDER BY m.id LIMIT 1) marker_id,
      (SELECT m.address FROM shaurmeg_markers m WHERE m.establishment_id=v.establishment_id AND m.is_active=TRUE AND COALESCE(m.source_suppressed,FALSE)=FALSE ORDER BY m.id LIMIT 1) address
    FROM shaurma_venues v
    WHERE v.establishment_id=ANY($1::text[]) AND v.is_active=TRUE`,[ests]);

  const explicitSet=new Set(explicit.map(x=>x.establishment_id+':'+x.item_id)),groups=[];
  for(const venue of vq.rows){
    if(!venue.marker_id)continue;
    const menu=(Array.isArray(venue.menu)?venue.menu:[]).filter(x=>x?.active!==false),byId=new Map(menu.map(x=>[String(x.id),x]));
    const inferred=[...history.entries()]
      .filter(([key])=>key.startsWith(venue.establishment_id+':'))
      .map(([key,stats])=>({item_id:key.slice(venue.establishment_id.length+1),...stats}))
      .filter(x=>byId.has(x.item_id))
      .sort((a,b)=>b.orders-a.orders||b.quantity-a.quantity||String(byId.get(a.item_id)?.n||byId.get(a.item_id)?.name||'').localeCompare(String(byId.get(b.item_id)?.n||byId.get(b.item_id)?.name||''),'ru'))
      .slice(0,6);
    const candidateIds=new Set(inferred.map(x=>x.item_id));
    for(const fav of explicit)if(fav.establishment_id===venue.establishment_id)candidateIds.add(fav.item_id);
    const items=[...candidateIds].map(itemId=>{
      const item=byId.get(itemId);if(!item)return null;
      const key=venue.establishment_id+':'+itemId,stats=history.get(key)||{orders:0,quantity:0,last_order_at:null};
      return {
        item_id:itemId,
        name:String(item.n||item.name||'Позиция'),
        description:String(item.d||item.description||''),
        price:Number(item.p??item.price)||0,
        image:publicFavoriteImage(venue.establishment_id,item,venue.updated_at),
        explicit:explicitSet.has(key),
        order_count:Number(stats.orders)||0,
        quantity:Number(stats.quantity)||0,
        last_order_at:stats.last_order_at||null
      };
    }).filter(Boolean).sort((a,b)=>Number(b.explicit)-Number(a.explicit)||b.order_count-a.order_count||b.quantity-a.quantity||a.name.localeCompare(b.name,'ru'));
    if(items.length)groups.push({
      establishment_id:venue.establishment_id,venue_id:venue.venue_id,venue_name:venue.name,
      marker_id:String(venue.marker_id),address:venue.address||'',items
    });
  }
  groups.sort((a,b)=>String(a.venue_name).localeCompare(String(b.venue_name),'ru',{sensitivity:'base'}));
  return {groups,explicit:[...explicitSet]};
}
async function setExplicitFavorite(userId,establishmentId,itemId,enabled){
  const uid=String(userId||''),est=D.establishmentId(establishmentId),id=String(itemId||'').trim().slice(0,100);
  if(!est||!id)throw Object.assign(new Error('bad_favorite'),{status:400});
  if(enabled){
    const vq=await db.query('SELECT menu FROM shaurma_venues WHERE establishment_id=$1 AND is_active=TRUE LIMIT 1',[est]);
    const item=(Array.isArray(vq.rows[0]?.menu)?vq.rows[0].menu:[]).find(x=>x?.active!==false&&String(x?.id||'')===id);
    if(!item)throw Object.assign(new Error('favorite_item_unavailable'),{status:404});
  }
  return db.tx(async client=>{
    const uq=await client.query('SELECT favorites FROM shaurma_users WHERE telegram_user_id=$1 FOR UPDATE',[uid]);
    if(!uq.rows[0])throw Object.assign(new Error('user_not_found'),{status:404});
    let refs=favoriteRefs(uq.rows[0].favorites),key=est+':'+id;
    refs=refs.filter(x=>x.establishment_id+':'+x.item_id!==key);
    if(enabled)refs.unshift({establishment_id:est,item_id:id,added_at:new Date().toISOString()});
    refs=refs.slice(0,200);
    await client.query('UPDATE shaurma_users SET favorites=$2::jsonb,updated_at=NOW() WHERE telegram_user_id=$1',[uid,JSON.stringify(refs)]);
    return refs;
  });
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
      SELECT m.id,m.establishment_id,m.venue_id,m.name,m.address,m.description,m.hours,m.price_label,m.lat,m.lon,m.category,m.marker_style,
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
router.get('/menu-image/:establishmentId/:itemId',async(req,res)=>{
  try{
    const est=D.establishmentId(req.params.establishmentId),itemId=String(req.params.itemId||'').slice(0,100);
    if(!est||!itemId)return res.sendStatus(404);
    const q=await db.query('SELECT menu,updated_at FROM shaurma_venues WHERE establishment_id=$1 AND is_active=TRUE LIMIT 1',[est]);
    const menu=Array.isArray(q.rows[0]?.menu)?q.rows[0].menu:[],item=menu.find(x=>String(x?.id||'')===itemId);
    const raw=String(item?.image||item?.i||''),m=raw.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/s);
    if(!m)return res.sendStatus(404);
    res.type(m[1]).setHeader('Cache-Control','public,max-age=86400,immutable').send(Buffer.from(m[2],'base64'));
  }catch(e){res.sendStatus(404)}
});
router.get('/menu-context',async(req,res)=>{
  try{
    const ctx=await menuContext(req.query.marker_id,req.query.establishment_id);if(!ctx)return res.status(404).json({error:'menu_context_not_found'});
    const stamp=new Date(ctx.venue.updated_at||Date.now()).getTime();
    const publicMenu=(ctx.venue.menu||[]).map(x=>{
      const raw=String(x.image||x.i||'');
      if(!/^data:image\/[a-zA-Z0-9.+-]+;base64,/i.test(raw))return x;
      return {...x,image:config.PUBLIC_API_URL+'/api/v2/menu-image/'+encodeURIComponent(ctx.venue.establishment_id)+'/'+encodeURIComponent(String(x.id))+'?v='+stamp};
    });
    res.setHeader('Cache-Control','no-store');res.json({...ctx,venue:{...ctx.venue,menu:publicMenu}});
  }catch(e){fail(res,e,'menu_context_failed')}
});

router.post('/auth/telegram',async(req,res)=>{
  try{
    const initData=req.body?.initData||'',user=verifyCustomerTelegram(initData),ownCode=referralCodeFor(user.id);
    const q=await db.query(`
      INSERT INTO shaurma_users(telegram_user_id,username,first_name,last_name,language_code,is_premium,referral_code,last_seen_at,updated_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,NOW(),NOW())
      ON CONFLICT(telegram_user_id) DO UPDATE SET username=EXCLUDED.username,first_name=EXCLUDED.first_name,last_name=EXCLUDED.last_name,language_code=EXCLUDED.language_code,is_premium=EXCLUDED.is_premium,referral_code=COALESCE(shaurma_users.referral_code,EXCLUDED.referral_code),last_seen_at=NOW(),updated_at=NOW()
      RETURNING *`,[String(user.id),user.username||null,user.first_name||null,user.last_name||null,user.language_code||null,!!user.is_premium,ownCode]);
    const rawRef=referralStartParam(initData)||req.body?.referral_code||'';
    if(rawRef)await applyReferral(user.id,rawRef);
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
router.get('/me/dashboard',auth.requireSession('client'),async(req,res)=>{
  try{
    const uid=String(req.session.sub);
    const [uq,sq,fq,rq,bq]=await Promise.all([
      db.query('SELECT * FROM shaurma_users WHERE telegram_user_id=$1',[uid]),
      db.query(`SELECT
        COUNT(*) FILTER(WHERE status<>'cancelled')::int order_count,
        COUNT(*) FILTER(WHERE status IN ('new','cooking','ready'))::int active_orders,
        COUNT(*) FILTER(WHERE status='done')::int completed_orders,
        COALESCE(SUM(total) FILTER(WHERE status<>'cancelled'),0)::int total_spent,
        COALESCE(ROUND(AVG(total) FILTER(WHERE status<>'cancelled')),0)::int avg_check
        FROM shaurma_orders WHERE telegram_user_id=$1`,[uid]),
      db.query(`SELECT venue_name,COUNT(*)::int orders,COALESCE(SUM(total),0)::int spent
        FROM shaurma_orders WHERE telegram_user_id=$1 AND status<>'cancelled'
        GROUP BY venue_name ORDER BY orders DESC,spent DESC LIMIT 1`,[uid]),
      db.query(`SELECT COUNT(*)::int invited,
        COUNT(*) FILTER(WHERE status IN ('ordered','qualified'))::int ordered,
        COUNT(*) FILTER(WHERE status='qualified')::int qualified
        FROM shaurma_referrals WHERE referrer_user_id=$1`,[uid]),
      db.query('SELECT COALESCE(SUM(amount),0)::int balance FROM shaurma_bonus_ledger WHERE telegram_user_id=$1',[uid])
    ]);
    const user=uq.rows[0];if(!user)return res.sendStatus(404);
    const code=user.referral_code||referralCodeFor(uid);
    if(!user.referral_code)await db.query('UPDATE shaurma_users SET referral_code=$2,updated_at=NOW() WHERE telegram_user_id=$1',[uid,code]);
    res.json({
      user:publicUser({...user,referral_code:code}),
      stats:sq.rows[0]||{order_count:0,active_orders:0,completed_orders:0,total_spent:0,avg_check:0},
      favorite_venue:fq.rows[0]||null,
      referral:{code,url:referralUrl(code),invited:Number(rq.rows[0]?.invited||0),ordered:Number(rq.rows[0]?.ordered||0),qualified:Number(rq.rows[0]?.qualified||0)},
      bonuses:{balance:Number(bq.rows[0]?.balance||0),status:'rules_pending'}
    });
  }catch(e){fail(res,e,'dashboard_failed')}
});

router.get('/me/favorites',auth.requireSession('client'),async(req,res)=>{
  try{res.setHeader('Cache-Control','no-store');res.json(await favoriteView(req.session.sub))}
  catch(e){fail(res,e,'favorites_read_failed')}
});
router.put('/me/favorites/:establishmentId/:itemId',auth.requireSession('client'),async(req,res)=>{
  try{
    await setExplicitFavorite(req.session.sub,req.params.establishmentId,req.params.itemId,true);
    res.json({ok:true,favorite:true});
  }catch(e){fail(res,e,'favorite_add_failed')}
});
router.delete('/me/favorites/:establishmentId/:itemId',auth.requireSession('client'),async(req,res)=>{
  try{
    await setExplicitFavorite(req.session.sub,req.params.establishmentId,req.params.itemId,false);
    res.json({ok:true,favorite:false});
  }catch(e){fail(res,e,'favorite_remove_failed')}
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
    if(!tg&&req.body?.telegram_init_data){try{tg=verifyCustomerTelegram(req.body.telegram_init_data)}catch{}}
    const ctx=await menuContext(req.body?.marker_id,req.body?.establishment_id);if(!ctx)return res.status(409).json({error:'invalid_venue_context'});
    if(String(req.body?.venue_id||ctx.venue.venue_id)!==String(ctx.venue.venue_id))return res.status(409).json({error:'venue_context_mismatch'});
    const items=Array.isArray(req.body?.items)?req.body.items:[];if(!items.length)return res.status(400).json({error:'empty_order'});
    const menu=new Map(ctx.venue.menu.filter(x=>x.active!==false).map(x=>[String(x.id),x]));
    const normalized=[];
    for(const i of items){
      const q=Math.max(1,Math.min(50,Math.floor(Number(i.q)||1)));
      if(i.builder){
        const built=D.priceBuilder(ctx.venue.config,i.builder);
        if(!built)return res.status(400).json({error:'invalid_builder_selection'});
        normalized.push({...built,q});continue;
      }
      const src=menu.get(String(i.id));if(!src)return res.status(400).json({error:'item_not_in_menu',item_id:i.id});
      const p=Number(src.p??src.price);
      if(!Number.isFinite(p)||p<0)return res.status(400).json({error:'invalid_price'});
      normalized.push({id:String(src.id),n:String(src.n||src.name||'Позиция'),p,q,detail:String(i.detail||'').slice(0,500)});
    }
    const fulfillment=req.body?.fulfillment_type==='cafe'?'cafe':'delivery';
    if(fulfillment==='delivery'&&!String(req.body?.phone||'').trim())return res.status(400).json({error:'phone_required'});
    if(fulfillment==='delivery'&&!String(req.body?.address||'').trim())return res.status(400).json({error:'address_required'});
    const total=normalized.reduce((s,x)=>s+x.p*x.q,0),num=D.orderNumber();
    const q=await db.query(`
      INSERT INTO shaurma_orders(order_number,items,total,customer_name,phone,address,comment,status,source,telegram_user_id,telegram_username,telegram_first_name,fulfillment_type,payment_status,payment_method,venue_id,venue_name,establishment_id,marker_id)
      VALUES($1,$2::jsonb,$3,$4,$5,$6,$7,'new',$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING *`,
      [num,JSON.stringify(normalized),total,String(req.body?.customer_name||tg?.first_name||'Гость').slice(0,120),fulfillment==='delivery'?String(req.body.phone):null,fulfillment==='delivery'?String(req.body.address):null,String(req.body?.comment||'').slice(0,500),tg?'telegram':'web',tg?String(tg.id):null,tg?.username||null,tg?.first_name||null,fulfillment,'pending',req.body?.payment_method||null,ctx.venue.venue_id,ctx.venue.name,ctx.venue.establishment_id,ctx.marker.id]);
    const order=q.rows[0];
    if(order.telegram_user_id)db.query(`UPDATE shaurma_referrals SET status=CASE WHEN status='joined' THEN 'ordered' ELSE status END,first_order_id=COALESCE(first_order_id,$2),updated_at=NOW() WHERE referred_user_id=$1`,[String(order.telegram_user_id),order.id]).catch(e=>console.error('referral_order_mark',e.message));
    db.query("INSERT INTO shaurma_venue_audit(establishment_id,telegram_user_id,action,payload) VALUES($1,$2,'order_created',$3::jsonb)",[
      order.establishment_id,String(order.telegram_user_id||''),JSON.stringify({order_id:order.id,order_number:order.order_number,marker_id:order.marker_id,total:order.total})
    ]).catch(e=>console.error('order_audit',e.message));
    rt.pushOwner('order',order);rt.pushVenue(order.establishment_id,'order',order);if(order.telegram_user_id)rt.pushUser(order.telegram_user_id,'order',order);
    notifyCustomer(order,'🥙 Заказ '+order.order_number+' принят\n'+order.venue_name+' · '+order.total+' ₽',ctx);
    telegram.notifyKitchenOrder(order).catch(e=>console.error('kitchen_order_notify',e.message));
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
      const tq=await c.query(`WITH themes AS (
          SELECT * FROM unnest($1::text[]) WITH ORDINALITY AS t(theme_key,ord)
        ), used AS (
          SELECT config->>'theme_key' AS theme_key,count(*)::int AS used_count
          FROM shaurma_venues WHERE is_active=TRUE GROUP BY 1
        )
        SELECT themes.theme_key FROM themes
        LEFT JOIN used USING(theme_key)
        ORDER BY COALESCE(used.used_count,0),themes.ord
        LIMIT 1`,[D.VENUE_THEME_KEYS]);
      const theme=tq.rows[0]?.theme_key||D.venueThemeKey(est);
      await c.query(`INSERT INTO shaurma_venues(venue_id,slug,name,is_active,config,menu,establishment_id) VALUES($1,$1,$2,TRUE,$3::jsonb,'[]'::jsonb,$4) ON CONFLICT(venue_id) DO UPDATE SET name=EXCLUDED.name,establishment_id=COALESCE(shaurma_venues.establishment_id,EXCLUDED.establishment_id),updated_at=NOW()`,[vId,name,JSON.stringify({subtitle:'МЕНЮ ЗАВЕДЕНИЯ',builder_enabled:false,theme_key:theme,theme:D.DEFAULT_VENUE_THEME}),est]);
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
    rt.pushOwner('update',o);rt.pushVenue(o.establishment_id,'update',o);if(o.telegram_user_id)rt.pushUser(o.telegram_user_id,'update',o);
    notifyCustomer(o,'Заказ '+o.order_number+' · '+orderStatusLabel(o.status));
    telegram.refreshKitchenOrderMessages(o).catch(e=>console.error('kitchen_order_refresh',e.message));
    res.json(o);
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
router.put('/venue-owner/establishments/:establishmentId/builder',async(req,res)=>{
  const a=await venueAccess(req,res,'menu');if(!a)return;
  try{
    const enabled=req.body?.enabled===true,builder=D.normalizeBuilderConfig(req.body?.builder||{});
    const current=await db.query('SELECT config FROM shaurma_venues WHERE establishment_id=$1',[a.est]);
    if(!current.rows[0])return res.sendStatus(404);
    const cfg={...(current.rows[0].config||{}),builder_enabled:enabled,builder};
    const q=await db.query('UPDATE shaurma_venues SET config=$2::jsonb,updated_at=NOW() WHERE establishment_id=$1 RETURNING *',[a.est,JSON.stringify(cfg)]);
    await db.query("INSERT INTO shaurma_venue_audit(establishment_id,telegram_user_id,action,payload) VALUES($1,$2,'builder_updated',$3::jsonb)",[
      a.est,String(a.s.sub),JSON.stringify({
        enabled,types:builder.types.length,breads:builder.breads.length,meats:builder.meats.length,
        sauces:builder.sauces.length,extras:builder.extras.length
      })
    ]);
    rt.pushVenue(a.est,'venue',q.rows[0]);
    res.json({ok:true,builder_enabled:enabled,builder});
  }catch(e){fail(res,e,'venue_owner_builder_failed')}
});

router.put('/venue-owner/establishments/:establishmentId/theme',async(req,res)=>{
  const a=await venueAccess(req,res,'profile');if(!a)return;
  try{
    const theme=D.normalizeVenueTheme(req.body?.theme||req.body||{});
    const current=await db.query('SELECT config FROM shaurma_venues WHERE establishment_id=$1',[a.est]);
    if(!current.rows[0])return res.sendStatus(404);
    const cfg={...(current.rows[0].config||{}),theme};
    const q=await db.query('UPDATE shaurma_venues SET config=$2::jsonb,updated_at=NOW() WHERE establishment_id=$1 RETURNING *',[a.est,JSON.stringify(cfg)]);
    await db.query("INSERT INTO shaurma_venue_audit(establishment_id,telegram_user_id,action,payload) VALUES($1,$2,'theme_updated',$3::jsonb)",[
      a.est,String(a.s.sub),JSON.stringify(theme)
    ]);
    rt.pushVenue(a.est,'venue',q.rows[0]);
    res.json({ok:true,theme});
  }catch(e){fail(res,e,'venue_owner_theme_failed')}
});

router.patch('/venue-owner/establishments/:establishmentId/profile',async(req,res)=>{
  const a=await venueAccess(req,res,'profile');if(!a)return;
  try{
    const b=req.body||{},name=String(b.name||'').trim();if(!name)return res.status(400).json({error:'name_required'});
    const configPatch=b.config&&typeof b.config==='object'&&!Array.isArray(b.config)?{...b.config}:{};
    if(configPatch.theme)configPatch.theme=D.normalizeVenueTheme(configPatch.theme);
    await db.tx(async c=>{await c.query('UPDATE shaurma_venues SET name=$2,config=config||$3::jsonb,updated_at=NOW() WHERE establishment_id=$1',[a.est,name,JSON.stringify(configPatch)]);await c.query('UPDATE shaurmeg_markers SET name=$2,address=$3,description=$4,hours=$5,price_label=$6,hero_image=$7,metadata_locked=TRUE,updated_at=NOW() WHERE establishment_id=$1',[a.est,name,String(b.address||''),String(b.description||''),String(b.hours||''),String(b.price_label||''),String(b.hero_image||'')]);});
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
    notifyCustomer(order,'Заказ '+order.order_number+' · '+orderStatusLabel(order.status));
    telegram.refreshKitchenOrderMessages(order).catch(e=>console.error('kitchen_order_refresh',e.message));
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
