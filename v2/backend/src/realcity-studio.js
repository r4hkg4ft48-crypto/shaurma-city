'use strict';
const crypto=require('crypto');
const express=require('express');
const A=require('./realcity-astra');
const P=require('./realcity-photo');
const R=require('./realcity-photoreal');
const error=(message,status=422)=>{throw Object.assign(new Error(message),{status})};
async function ensureSchema(db){
 await db.query(`
 CREATE TABLE IF NOT EXISTS realcity_astra_originals(
  marker_id BIGINT NOT NULL REFERENCES shaurmeg_markers(id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL, sha256 TEXT NOT NULL, mime TEXT NOT NULL,
  content BYTEA NOT NULL, metadata JSONB NOT NULL, preview TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY(marker_id,asset_id), UNIQUE(marker_id,sha256)
 );
 CREATE TABLE IF NOT EXISTS realcity_astra_access(
  marker_id BIGINT PRIMARY KEY REFERENCES shaurmeg_markers(id) ON DELETE CASCADE,
  token_hash TEXT UNIQUE NOT NULL, expires_at TIMESTAMPTZ NOT NULL
 );
 CREATE TABLE IF NOT EXISTS realcity_astra_drafts(
  marker_id BIGINT PRIMARY KEY REFERENCES shaurmeg_markers(id) ON DELETE CASCADE,
  input_revision TEXT NOT NULL, recipe JSONB NOT NULL, output JSONB NOT NULL,
  report JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
 );`);
}
function install(app,{db,authorize,manifest,normalizeAssets,normalizeConfig,readiness}){
 const base='/api/shaurma/admin/astra-realcity/:establishmentId';
 const active=new Set();
 const noStore=res=>{res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Content-Type-Options','nosniff');};
 const route=fn=>async(req,res)=>{
  noStore(res);try{if(!db)error('persistent_storage_required',503);await fn(req,res);}
  catch(e){console.error('realcity studio:',e.status?e.message:'operation_failed');res.status(e.status||500).json({error:e.status?e.message:'realcity_operation_failed'});}
 };
 const admin=async(req,res,next)=>{if(!authorize(req))return res.sendStatus(401);next();};
 const select=async(req,client=db,lock=false)=>{
  const est=String(req.params.establishmentId||'').toUpperCase(),id=String(req.query.marker_id||req.body?.marker_id||'');
  if(!/^SC-MSK-[A-F0-9]{10}$/.test(est)||!/^\d+$/.test(id))error('realcity_exact_target_required',400);
  const q=await client.query('SELECT * FROM shaurmeg_markers WHERE id=$1 AND establishment_id=$2 AND is_active=TRUE'+(lock?' FOR UPDATE':''),[id,est]);
  if(!q.rows[0])error('realcity_target_not_found',404);return q.rows[0];
 };
 const byToken=async(req)=>{
  const token=String(req.params.token||'');if(!/^[a-f0-9]{64}$/.test(token))error('astra_access_expired_or_revoked',401);
  const q=await db.query('SELECT m.* FROM realcity_astra_access a JOIN shaurmeg_markers m ON m.id=a.marker_id WHERE a.token_hash=$1 AND a.expires_at>NOW() AND m.is_active=TRUE',[P.hash(token)]);
  if(!q.rows[0])error('astra_access_expired_or_revoked',401);return q.rows[0];
 };
 const getDraft=async id=>(await db.query('SELECT input_revision,report,updated_at FROM realcity_astra_drafts WHERE marker_id=$1',[id])).rows[0]||null;
 const decorate=row=>({...manifest(row),processing:P.instructions,assets:(row.realcity_astra_assets||[]).map(({src,...asset})=>({...asset,source:asset.stored?'private_original':src?.startsWith('data:')?'legacy_embedded':'external_reference'}))});
 const current=async row=>({ok:true,marker_id:String(row.id),establishment_id:row.establishment_id,venue_id:row.venue_id,name:row.name,address:row.address,lat:row.lat,lon:row.lon,assets:normalizeAssets(row.realcity_astra_assets),config:normalizeConfig(row.realcity_astra_config),readiness:readiness(row.realcity_astra_assets),manifest:decorate(row),output:row.realcity_profile?.astra||null,draft:await getDraft(row.id),realcity:{status:row.realcity_status,quality:row.realcity_quality,updated_at:row.realcity_updated_at}});
 const source=async(row,id)=>{
  const asset=(row.realcity_astra_assets||[]).find(x=>x.id===id);if(!asset)error('photo_source_not_in_dataset',404);
  if(asset.stored){const q=await db.query('SELECT content,mime FROM realcity_astra_originals WHERE marker_id=$1 AND asset_id=$2',[row.id,id]);if(!q.rows[0])error('photo_original_missing',404);return q.rows[0];}
  const match=/^data:(image\/(?:png|jpeg|webp));base64,([a-z0-9+/=]+)$/i.exec(asset.src||'');
  if(!match)error('upload_original_for_processing');return {content:Buffer.from(match[2],'base64'),mime:match[1]};
 };
 const updateInput=async(client,row,assets,config)=>{
  const changed=A.revision(row)!==A.revision({...row,realcity_astra_assets:assets,realcity_astra_config:config});
  return (await client.query(`UPDATE shaurmeg_markers SET realcity_astra_assets=$2::jsonb,realcity_astra_config=$3::jsonb,
   realcity_profile=jsonb_set(COALESCE(realcity_profile,'{}'::jsonb),'{astra_input}',$4::jsonb) ||
    CASE WHEN realcity_profile ? 'astra' AND $5::boolean THEN jsonb_build_object('astra',(realcity_profile->'astra') || '{"status":"stale"}'::jsonb) ELSE '{}'::jsonb END,
   updated_at=NOW() WHERE id=$1 RETURNING *`,[row.id,JSON.stringify(assets),JSON.stringify(config),JSON.stringify({version:3,mode:'photo-facades-v3',asset_count:assets.length,readiness:readiness(assets)}),changed])).rows[0];
 };
 const transaction=async fn=>{
  const client=await db.connect();try{await client.query('BEGIN');const value=await fn(client);await client.query('COMMIT');return value;}
  catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}
 };
 async function process(row,recipe){
  if(recipe?.version!==3||recipe.expected_revision!==A.revision(row))error('astra_inputs_changed_reload_package',409);
  if(!Array.isArray(recipe.materials)||!recipe.materials.length||recipe.materials.length>12)error('photo_recipe_material_limit');
  if(active.size>=1)error('photo_processor_busy_retry',429);
  active.add(String(row.id));
  try{
   const previous=(await db.query('SELECT output FROM realcity_astra_drafts WHERE marker_id=$1',[row.id])).rows[0]?.output;
   const materials=[];
   for(const spec of recipe.materials){
    const m=await P.buildMaterial(spec,async id=>(await source(row,id)).content,previous?.materials?.find(m=>m.id===spec.id));materials.push(m);
   }
   const output=A.compile({...recipe.output,version:2,materials:[...(recipe.output?.materials||[]).filter(m=>!materials.some(n=>n.id===m.id)),...materials]},row);
   const report={method:P.METHOD,materials:materials.map(({data_url,...m})=>m),warnings:materials.flatMap(m=>m.quality.warnings.map(w=>m.id+': '+w)),review_required:true,automatic_depth:false};
   await transaction(async client=>{
    const latest=(await client.query('SELECT * FROM shaurmeg_markers WHERE id=$1 AND establishment_id=$2 AND venue_id=$3 AND is_active=TRUE FOR UPDATE',[row.id,row.establishment_id,row.venue_id])).rows[0];
    if(!latest||A.revision(latest)!==recipe.expected_revision)error('astra_inputs_changed_reload_package',409);
    await client.query(`INSERT INTO realcity_astra_drafts(marker_id,input_revision,recipe,output,report) VALUES($1,$2,$3::jsonb,$4::jsonb,$5::jsonb)
      ON CONFLICT(marker_id) DO UPDATE SET input_revision=EXCLUDED.input_revision,recipe=EXCLUDED.recipe,output=EXCLUDED.output,report=EXCLUDED.report,updated_at=NOW()`,[row.id,recipe.expected_revision,JSON.stringify(recipe),JSON.stringify(output),JSON.stringify(report)]);
   });
   return {ok:true,status:'review',output,report};
  }finally{active.delete(String(row.id));}
 }
 app.get(base,admin,route(async(req,res)=>{
  const all=await db.query('SELECT * FROM shaurmeg_markers WHERE establishment_id=$1 AND is_active=TRUE ORDER BY id',[String(req.params.establishmentId).toUpperCase()]);
  const row=req.query.marker_id?all.rows.find(r=>String(r.id)===req.query.marker_id):all.rows[0];if(!row)error('realcity_target_not_found',404);
  res.json({...await current(row),markers:all.rows.map(r=>({marker_id:String(r.id),name:r.name,address:r.address}))});
 }));
 app.put(base,admin,route(async(req,res)=>{
  const saved=await transaction(async client=>{
   const row=await select(req,client,true);if(req.body.expected_revision!==A.revision(row))error('astra_inputs_changed_reload_package',409);
   if(!Array.isArray(req.body.assets)||req.body.assets.length>120)error('photo_asset_limit_120');
   const assets=normalizeAssets(req.body.assets),old=new Map((row.realcity_astra_assets||[]).map(a=>[a.id,a]));
   for(const asset of assets){
    if(asset.stored){const before=old.get(asset.id);if(!before?.stored||before.sha256!==asset.sha256)error('photo_original_binding_mismatch');asset.src=before.src;asset.metadata=before.metadata;}
   }
   const config=normalizeConfig(req.body.config);return updateInput(client,row,assets,config);
  });res.json(await current(saved));
 }));
 // One original per request; no base64 batch in a JSON column. Hash deduplication
 // is scoped to the exact marker; there is no cross-venue private source lookup.
 app.post(base+'/assets',admin,express.raw({type:'application/octet-stream',limit:'16mb'}),route(async(req,res)=>{
  const row=await select(req),photo=await P.inspect(req.body);
  const saved=await transaction(async client=>{
   const latest=await select(req,client,true),assets=normalizeAssets(latest.realcity_astra_assets);
   const duplicate=await client.query('SELECT asset_id FROM realcity_astra_originals WHERE marker_id=$1 AND sha256=$2',[row.id,photo.sha256]);
   const id=duplicate.rows[0]?.asset_id||'photo_'+crypto.randomBytes(12).toString('hex');
   if(assets.some(a=>a.id===id))return latest;
   if(assets.length>=120)error('photo_asset_limit_120');
   if(!duplicate.rows.length){
    const total=await client.query('SELECT COALESCE(SUM(octet_length(content)),0) AS bytes FROM realcity_astra_originals WHERE marker_id=$1',[row.id]);
    if(Number(total.rows[0].bytes)+req.body.length>256*1024*1024)error('photo_dataset_limit_256mb');
    await client.query('INSERT INTO realcity_astra_originals(marker_id,asset_id,sha256,mime,content,metadata,preview) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7)',[row.id,id,photo.sha256,photo.mime,req.body,JSON.stringify(photo.metadata),photo.preview]);
   }
   const categories=new Set(['main_building','panorama','landscape','road_ground','neighbor_building','vegetation','street_object']);
   const category=categories.has(String(req.query.category||''))?String(req.query.category):'main_building';
   const defaults={main_building:'main_facade',panorama:'district',landscape:'terrain',road_ground:'road',neighbor_building:'front',vegetation:'trees',street_object:'detail'};
   const roles={main_building:'hero_facade',panorama:'environment',landscape:'landscape',road_ground:'ground',neighbor_building:'context_building',vegetation:'vegetation',street_object:'street_object'};
   const qnum=(name,min,max)=>{const n=Number(req.query[name]);return Number.isFinite(n)?Math.max(min,Math.min(max,n)):null};
   const camera={
    ...(Number.isFinite(Number(photo.metadata?.gps?.lat))&&Number.isFinite(Number(photo.metadata?.gps?.lon))?{lat:Number(photo.metadata.gps.lat),lon:Number(photo.metadata.gps.lon)}:{}),
    ...(qnum('camera_lat',-85,85)!==null&&qnum('camera_lon',-180,180)!==null?{lat:qnum('camera_lat',-85,85),lon:qnum('camera_lon',-180,180)}:{}),
    heading_deg:qnum('heading_deg',0,359)??(Number.isFinite(Number(photo.metadata?.heading_deg))?Number(photo.metadata.heading_deg):null),
    pitch_deg:qnum('pitch_deg',-45,45),fov_deg:qnum('fov_deg',25,140),distance_m:qnum('distance_m',1,220),altitude_m:qnum('altitude_m',-50,500)
   };
   assets.push({id,src:photo.preview,stored:true,sha256:photo.sha256,metadata:photo.metadata,kind:'image',category,
    subtype:String(req.query.subtype||defaults[category]).slice(0,60),role:roles[category],camera,
    filename:String(req.query.filename||'photo').slice(0,180),label:String(req.query.label||'').slice(0,180),notes:String(req.query.notes||'').slice(0,900),
    angle:String(req.query.angle||'unknown').slice(0,30),direction_deg:camera.heading_deg,priority:Math.max(1,Math.min(5,Number(req.query.priority)||4)),
    primary:!assets.some(a=>a.category===category),created_at:new Date().toISOString()});
   return updateInput(client,latest,assets,normalizeConfig(latest.realcity_astra_config));
  });res.json(await current(saved));
 }));
 app.post(base+'/reconstruct',admin,route(async(req,res)=>{
  const row=await select(req),assets=normalizeAssets(row.realcity_astra_assets),ready=readiness(assets);
  if(!assets.length)error('photo_dataset_empty');
  const result=await R.queue({...row,realcity_astra_assets:assets},row.realcity_profile||{});
  res.json({ok:true,...result,readiness:ready,pipeline:'photo-first'});
 }));
 app.post(base+'/access',admin,route(async(req,res)=>{
  const row=await select(req),token=crypto.randomBytes(32).toString('hex');
  const q=await db.query(`INSERT INTO realcity_astra_access(marker_id,token_hash,expires_at) VALUES($1,$2,NOW()+INTERVAL '7 days')
   ON CONFLICT(marker_id) DO UPDATE SET token_hash=EXCLUDED.token_hash,expires_at=EXCLUDED.expires_at RETURNING expires_at`,[row.id,P.hash(token)]);
  res.json({path:'/api/realcity/astra/'+token,expires_at:q.rows[0].expires_at,scope:'read_inputs_and_prepare_draft',publish:false});
 }));
 app.delete(base+'/access',admin,route(async(req,res)=>{const row=await select(req);await db.query('DELETE FROM realcity_astra_access WHERE marker_id=$1',[row.id]);res.json({ok:true});}));
 app.post(base+'/process',admin,route(async(req,res)=>res.json(await process(await select(req),req.body.recipe))));
 app.get(base+'/draft',admin,route(async(req,res)=>{
  const row=await select(req),draft=(await db.query('SELECT * FROM realcity_astra_drafts WHERE marker_id=$1',[row.id])).rows[0];
  if(!draft)error('photo_draft_missing',404);res.json({draft,profile:{...row.realcity_profile,astra:draft.output},marker:{id:String(row.id),establishment_id:row.establishment_id,venue_id:row.venue_id,lon:Number(row.lon),lat:Number(row.lat),name:row.name},stale:draft.input_revision!==A.revision(row)});
 }));
 app.post(base+'/publish',admin,route(async(req,res)=>{
  const output=await transaction(async client=>{
   const row=await select(req,client,true),draft=(await client.query('SELECT * FROM realcity_astra_drafts WHERE marker_id=$1',[row.id])).rows[0];
   if(!draft)error('photo_draft_missing',404);
   if(req.body.expected_revision!==draft.input_revision||req.body.expected_draft_updated_at!==new Date(draft.updated_at).toISOString())error('photo_draft_changed_reload',409);
   return A.save(client,row,{expected_revision:draft.input_revision,output:draft.output});
  });res.json({ok:true,output});
 }));
 app.get(base+'/assets/:assetId',admin,route(async(req,res)=>{const value=await source(await select(req),req.params.assetId);res.type(value.mime).send(value.content);}));
 app.get('/api/realcity/astra/:token',route(async(req,res)=>{
  const row=await byToken(req),root='/api/realcity/astra/'+req.params.token;
  res.json({schema:'shaurmeg.astra.package.v3',manifest:decorate(row),assets:normalizeAssets(row.realcity_astra_assets).map(a=>({...a,original_path:a.stored||a.src.startsWith('data:')?root+'/assets/'+encodeURIComponent(a.id):null})),output:row.realcity_profile?.astra||null,draft:await getDraft(row.id),submit_draft_path:root+'/draft',permissions:{read:true,prepare_draft:true,publish:false}});
 }));
 app.get('/api/realcity/astra/:token/assets/:assetId',route(async(req,res)=>{const value=await source(await byToken(req),req.params.assetId);res.type(value.mime).send(value.content);}));
 app.post('/api/realcity/astra/:token/draft',route(async(req,res)=>{
  const row=await byToken(req);res.json(await process(row,req.body));
 }));
}
module.exports={ensureSchema,install};
