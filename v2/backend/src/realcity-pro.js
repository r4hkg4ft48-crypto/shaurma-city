'use strict';
// RealCity Pro: isolated from Astra; photo truth, map geometry and human QA.
const crypto=require('crypto');
const express=require('express');
const {Worker}=require('worker_threads');
const P=require('./realcity-photo');
const S=require('../../frontend/realcity-spatial');
const fail=(message,status=422)=>{throw Object.assign(new Error(message),{status})};
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const surfaceId=c=>'pro_'+hash([c.building_id,c.edge_index].join(':')).slice(0,24);
function buildOffThread(spec,sources){
 return new Promise((resolve,reject)=>{
  const worker=new Worker(require.resolve('./realcity-pro-worker'),{workerData:{spec,sources}});
  let settled=false;
  const timer=setTimeout(()=>{if(!settled){settled=true;worker.terminate().catch(()=>{});reject(Object.assign(new Error('pro_photo_worker_timeout'),{status:504}))}},120000);
  const end=(error,material)=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve(material)};
  worker.once('message',m=>m.ok?end(null,m.material):end(Object.assign(new Error(m.error||'pro_photo_worker_failed'),{status:422})));
  worker.once('error',err=>end(err));
  worker.once('exit',code=>{if(!settled)end(Object.assign(new Error('pro_photo_worker_exit_'+code),{status:500}))});
 });
}
const ROLES=new Set(['hero_front','hero_oblique','hero_side','hero_distance','neighbor','panorama','road','vegetation','landmark','environment']);
const settings=Object.freeze({mode:'realcity-pro',geometry:'mapped-only',facade:'source-pixels',
  procedural_facades:false,synthetic_windows:false,synthetic_vegetation:false,
  source_fabrication:false,generated_images_as_geometry:false,
  uncalibrated_projection:false,manual_review_required:true,max_texture_size:2048});
async function ensureSchema(db){
  await db.query("CREATE TABLE IF NOT EXISTS realcity_pro_assets (marker_id BIGINT NOT NULL REFERENCES shaurmeg_markers(id) ON DELETE CASCADE,asset_id TEXT NOT NULL,role TEXT NOT NULL,filename TEXT NOT NULL,sha256 TEXT NOT NULL,mime TEXT NOT NULL,content BYTEA NOT NULL,metadata JSONB NOT NULL,preview TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(marker_id,asset_id),UNIQUE(marker_id,sha256)); CREATE TABLE IF NOT EXISTS realcity_pro_calibrations (marker_id BIGINT NOT NULL REFERENCES shaurmeg_markers(id) ON DELETE CASCADE,asset_id TEXT NOT NULL,building_id TEXT NOT NULL,geometry_key TEXT NOT NULL,edge_index INT NOT NULL,source_quad JSONB NOT NULL,exclude JSONB NOT NULL DEFAULT '[]'::jsonb,flip_u BOOLEAN NOT NULL DEFAULT FALSE,confirmed BOOLEAN NOT NULL DEFAULT FALSE,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(marker_id,asset_id,building_id,edge_index)); CREATE TABLE IF NOT EXISTS realcity_pro_jobs (marker_id BIGINT PRIMARY KEY REFERENCES shaurmeg_markers(id) ON DELETE CASCADE,job_id TEXT NOT NULL,revision TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'queued',completed INT NOT NULL DEFAULT 0,total INT NOT NULL DEFAULT 0,last_error TEXT NOT NULL DEFAULT '',updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()); CREATE TABLE IF NOT EXISTS realcity_pro_drafts (marker_id BIGINT PRIMARY KEY REFERENCES shaurmeg_markers(id) ON DELETE CASCADE,revision TEXT NOT NULL,output JSONB NOT NULL,report JSONB NOT NULL,reviewed_revision TEXT,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());");
}
function manifest(row){
 const scene=row.realcity_profile?.scene||{},point=[Number(row.lon),Number(row.lat)];
 return {marker_id:String(row.id),establishment_id:row.establishment_id,venue_id:row.venue_id,
  hero_building_id:String(scene.hero_building_id||(scene.buildings||[]).find(b=>b.role==='hero')?.id||''),
  point,buildings:(scene.buildings||[]).map(b=>({
    building_id:String(b.id),geometry_key:S.geometryKey(b.ring),role:b.role||'context',
    height_m:Number(b.height)||0,base_m:Number(b.base_m)||0,
    edges:S.edges(b.ring,point).filter(e=>e.length>=.5).map(e=>({
      edge_index:e.index,edge:e.coordinates,length_m:Number(e.length.toFixed(3)),bearing:e.bearing
    }))
  }))};
}
function validCalibration(body,mani){
 const b=mani.buildings.find(x=>x.building_id===String(body?.building_id||''));
 if(!b)fail('pro_building_not_in_map');
 const edge_index=Number(body?.edge_index);
 if(!Number.isInteger(edge_index)||!b.edges.some(e=>e.edge_index===edge_index))fail('pro_edge_not_in_map');
 if(String(body?.geometry_key||'')!==b.geometry_key)fail('pro_geometry_revision_mismatch',409);
 if(!Array.isArray(body?.source_quad)||body.source_quad.length!==4)fail('pro_four_photo_corners_required');
 P.quad(body.source_quad);
 const exclude=Array.isArray(body.exclude)?body.exclude:[];
 if(exclude.length>16||exclude.some(p=>!Array.isArray(p)||p.length<3||p.length>40||p.some(v=>!Array.isArray(v)||v.length!==2||v.some(n=>!Number.isFinite(n)||n<0||n>1))))fail('pro_invalid_occlusion_mask');
 return {asset_id:String(body.asset_id||''),building_id:b.building_id,geometry_key:b.geometry_key,
  edge_index,source_quad:body.source_quad,exclude,flip_u:body.flip_u===true,confirmed:body.confirmed===true};
}
const revision=(row,assets,cals)=>hash(JSON.stringify({
 version:1,marker:[row.id,row.establishment_id,row.venue_id,row.lon,row.lat],
 geometry:manifest(row).buildings.map(b=>[b.building_id,b.geometry_key,b.height_m]),
 assets:assets.map(a=>[a.asset_id,a.sha256,a.role]),
 cals:cals.map(c=>[c.asset_id,c.building_id,c.geometry_key,c.edge_index,c.source_quad,c.exclude,c.flip_u,c.confirmed])
}));
function qualityGate(row,cals,mats){
 const hero=manifest(row).hero_building_id;
 const edges=new Set(cals.filter(c=>c.confirmed&&c.building_id===hero).map(c=>c.edge_index));
 const errors=[];
 if(edges.size<2)errors.push('Нужны две подтверждённые стороны главного здания');
 if(!mats.length)errors.push('Нет подтверждённых фасадов');
 if(mats.some(m=>Number(m.quality?.missing_fraction)>.015))errors.push('Маски оставляют непокрытые участки');
 if(mats.some(m=>(m.quality?.warnings||[]).includes('source_resolution_limited')))errors.push('Низкая исходная детализация одной из поверхностей');
 return {ready:!errors.length,errors,hero_edges:edges.size,observed_surfaces:mats.length,
  guarantees:['no synthetic facade','mapped geometry','original photo pixels','explicit visual review']};
}
function outputModel(row,cals,mats,rev,report){
 const mani=manifest(row),grouped=new Map(),available=new Set(mats.map(m=>m.id));
 for(const c of cals){
  const matId=surfaceId(c),b=mani.buildings.find(b=>b.building_id===c.building_id);
  const e=b?.edges.find(e=>e.edge_index===c.edge_index);
  if(!e||!available.has(matId))continue;
  const arr=grouped.get(b.building_id)||[];
  if(arr.some(f=>f.edge_index===e.edge_index))continue;
  arr.push({edge_index:e.edge_index,edge:e.edge,evidence:'observed',reference_ids:[...new Set(cals.filter(x=>x.building_id===c.building_id&&x.edge_index===c.edge_index).map(x=>x.asset_id))],
    wall:{color:'#ffffff',finish:'panel',module_m:3,joint_color:'#ffffff'},modules:[],
    surfaces:[{material_id:matId,u_m:0,z_m:b.base_m,width_m:e.length_m,
      height_m:Number((b.height_m-b.base_m).toFixed(3)),depth_m:0,
      flip_u:c.flip_u,confirmed:true,openings:[]}]});
  grouped.set(b.building_id,arr);
 }
 const buildings=mani.buildings.filter(b=>grouped.has(b.building_id)).map(b=>({
   building_id:b.building_id,geometry_key:b.geometry_key,height_m:b.height_m,base_m:b.base_m,role:b.role,
   roof:{color:'#000000',parapet_m:0},facades:grouped.get(b.building_id)
 }));
 return {version:2,status:'ready',mode:'realcity-pro',
   target:{marker_id:String(row.id),establishment_id:row.establishment_id,venue_id:row.venue_id,coordinates:mani.point},
   input_revision:rev,generated_at:new Date().toISOString(),buildings,
   materials:mats.map(({quality,edge_key,...m})=>m),environment:{},camera:{bearing:0,pitch:60,zoom:18.5},
   quality:{...report,verified_photo_pixels:true,procedural_fill:false}};
}
function install(app,{db,authorize}){
 const base='/api/shaurma/admin/realcity-pro/:establishmentId',busy=new Set();
 const admin=(req,res,next)=>authorize(req)?next():res.sendStatus(401);
 const route=fn=>async(req,res)=>{res.setHeader('Cache-Control','no-store');try{
   if(!db)fail('persistent_storage_required',503);await ensureSchema(db);await fn(req,res);
 }catch(e){console.error('realcity_pro',e.status?e.message:'operation_failed');res.status(e.status||500).json({error:e.status?e.message:'pro_operation_failed'})}};
 async function select(req){
  const est=String(req.params.establishmentId||'').toUpperCase(),id=String(req.query.marker_id||req.body?.marker_id||'');
  if(!/^SC-MSK-[A-F0-9]{10}$/.test(est)||!/^[0-9]{1,15}$/.test(id))fail('pro_exact_target_required',400);
  const r=await db.query('SELECT * FROM shaurmeg_markers WHERE id=$1 AND establishment_id=$2 AND is_active=TRUE',[id,est]);
  if(!r.rows[0])fail('pro_target_not_found',404);return r.rows[0];
 }
 async function assets(row,preview=true){
  const r=await db.query('SELECT asset_id,role,filename,sha256,mime,metadata,preview,created_at FROM realcity_pro_assets WHERE marker_id=$1 ORDER BY created_at,asset_id',[row.id]);
  return r.rows.map(({preview:thumb,...x})=>preview?{...x,preview:thumb}:x);
 }
 async function cals(row){
  const r=await db.query('SELECT asset_id,building_id,geometry_key,edge_index,source_quad,exclude,flip_u,confirmed,updated_at FROM realcity_pro_calibrations WHERE marker_id=$1 ORDER BY updated_at,asset_id',[row.id]);
  return r.rows;
 }
 async function state(row){
  const [a,c,d,j]=await Promise.all([assets(row),cals(row),db.query('SELECT revision,report,reviewed_revision,updated_at FROM realcity_pro_drafts WHERE marker_id=$1',[row.id]),db.query('SELECT job_id,revision,status,completed,total,last_error,updated_at FROM realcity_pro_jobs WHERE marker_id=$1',[row.id])]);
  return {marker:{id:String(row.id),name:row.name,establishment_id:row.establishment_id,venue_id:row.venue_id,lon:Number(row.lon),lat:Number(row.lat)},
    manifest:manifest(row),settings,assets:a,calibrations:c,revision:revision(row,a,c),draft:d.rows[0]||null,job:j.rows[0]||null,
    published:row.realcity_profile?.pro?{input_revision:row.realcity_profile.pro.input_revision,quality:row.realcity_profile.pro.quality}:null};
 }
 app.get(base,admin,route(async(req,res)=>res.json(await state(await select(req)))));
 app.post(base+'/assets',admin,express.raw({type:'application/octet-stream',limit:'16mb'}),route(async(req,res)=>{
  const row=await select(req),role=String(req.query.role||'environment');
  if(!ROLES.has(role))fail('pro_photo_role_unknown');
  const original=await P.inspect(req.body);
  const same=await db.query('SELECT asset_id FROM realcity_pro_assets WHERE marker_id=$1 AND sha256=$2',[row.id,original.sha256]);
  if(!same.rows.length){
   const usage=await db.query('SELECT COUNT(*)::int count,COALESCE(SUM(octet_length(content)),0)::bigint bytes FROM realcity_pro_assets WHERE marker_id=$1',[row.id]);
   if(+usage.rows[0].count>=100||+usage.rows[0].bytes+req.body.length>256*1024*1024)fail('pro_dataset_limit');
   await db.query('INSERT INTO realcity_pro_assets(marker_id,asset_id,role,filename,sha256,mime,content,metadata,preview) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)',
     [row.id,'pro_'+crypto.randomBytes(10).toString('hex'),role,String(req.query.filename||'photo').slice(0,140),
      original.sha256,original.mime,req.body,JSON.stringify(original.metadata),original.preview]);
  }
  res.json(await state(row));
 }));
 // Original-resolution image is fetched only with admin credentials; the
 // public Mini App receives derived, approved facade texture crops only.
 app.get(base+'/assets/:assetId/original',admin,route(async(req,res)=>{
  const row=await select(req);
  const q=await db.query('SELECT content,mime FROM realcity_pro_assets WHERE marker_id=$1 AND asset_id=$2',[row.id,String(req.params.assetId)]);
  if(!q.rows[0])fail('pro_photo_not_found',404);
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Content-Length',String(q.rows[0].content.length));
  res.type(q.rows[0].mime).send(q.rows[0].content);
 }));
 // Photo labels are editorial, never derived from filenames. A relabel
 // invalidates its calibration explicitly, preventing a panorama being
 // silently promoted to a measured facade.
 app.patch(base+'/assets/:assetId/role',admin,route(async(req,res)=>{
  const row=await select(req),newRole=String(req.body?.role||'');
  if(!ROLES.has(newRole))fail('pro_photo_role_unknown');
  const current=revision(row,await assets(row,false),await cals(row));
  if(req.body?.expected_revision!==current)fail('pro_sources_changed',409);
  const client=await db.connect();
  try{
   await client.query('BEGIN');
   const lock=await client.query('SELECT asset_id FROM realcity_pro_assets WHERE marker_id=$1 AND asset_id=$2 FOR UPDATE',[row.id,String(req.params.assetId)]);
   if(!lock.rows.length)fail('pro_photo_not_found',404);
   // Removing prior calibration is deliberately destructive only for this
   // single private asset and its marker; the original bytes remain intact.
   await client.query('DELETE FROM realcity_pro_calibrations WHERE marker_id=$1 AND asset_id=$2',[row.id,String(req.params.assetId)]);
   await client.query('UPDATE realcity_pro_assets SET role=$3 WHERE marker_id=$1 AND asset_id=$2',[row.id,String(req.params.assetId),newRole]);
   await client.query('COMMIT');
  }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}finally{client.release()}
  res.json(await state(row));
 }));
 app.put(base+'/calibrations',admin,route(async(req,res)=>{
  const row=await select(req),mani=manifest(row),c=validCalibration(req.body,mani);
  const item=await db.query('SELECT role FROM realcity_pro_assets WHERE marker_id=$1 AND asset_id=$2',[row.id,c.asset_id]);
  if(!item.rows.length)fail('pro_photo_not_found',404);
  const role=item.rows[0].role,b=mani.buildings.find(x=>x.building_id===c.building_id);
  if(['panorama','road','vegetation','environment','landmark','hero_distance'].includes(role))fail('pro_context_cannot_be_projected_to_wall');
  if(role.startsWith('hero_')&&b.building_id!==mani.hero_building_id&&b.role!=='hero')fail('pro_hero_building_required');
  if(role==='neighbor'&&(b.building_id===mani.hero_building_id||b.role==='hero'))fail('pro_neighbor_building_required');
  await db.query('INSERT INTO realcity_pro_calibrations(marker_id,asset_id,building_id,geometry_key,edge_index,source_quad,exclude,flip_u,confirmed) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9) ON CONFLICT(marker_id,asset_id,building_id,edge_index) DO UPDATE SET geometry_key=EXCLUDED.geometry_key,source_quad=EXCLUDED.source_quad,exclude=EXCLUDED.exclude,flip_u=EXCLUDED.flip_u,confirmed=EXCLUDED.confirmed,updated_at=NOW()',
    [row.id,c.asset_id,c.building_id,c.geometry_key,c.edge_index,JSON.stringify(c.source_quad),JSON.stringify(c.exclude),c.flip_u,c.confirmed]);
  res.json(await state(row));
 }));
 app.post(base+'/build',admin,route(async(req,res)=>{
  const row=await select(req),key=String(row.id);
  if(busy.has(key))fail('pro_build_in_progress',409);
  const [a,c]=await Promise.all([assets(row,false),cals(row)]),rev=revision(row,a,c),mani=manifest(row);
  if(req.body?.expected_revision!==rev)fail('pro_sources_changed',409);
  const usable=c.filter(x=>x.confirmed&&a.some(v=>v.asset_id===x.asset_id));
  if(!usable.length||usable.length>48)fail('pro_confirmed_facade_count');
  const groups=new Map();
  for(const cal of usable){
   const b=mani.buildings.find(x=>x.building_id===cal.building_id),e=b?.edges.find(x=>x.edge_index===cal.edge_index);
   if(!e||b.geometry_key!==cal.geometry_key)fail('pro_geometry_changed',409);
   const edgeKey=cal.building_id+':'+cal.edge_index,list=groups.get(edgeKey)||[];
   if(list.length>=4)fail('pro_max_four_views_per_surface');
   list.push(cal);groups.set(edgeKey,list);
  }
  if(groups.size>12)fail('pro_facade_surface_limit_12');
  const active=await db.query("SELECT job_id FROM realcity_pro_jobs WHERE marker_id=$1 AND status='processing' AND updated_at>NOW()-INTERVAL '10 minutes'",[row.id]);
  if(active.rows.length)fail('pro_build_in_progress',409);
  const jobId='rpro_'+crypto.randomBytes(12).toString('hex');
  busy.add(key);
  try{
   await db.query("INSERT INTO realcity_pro_jobs(marker_id,job_id,revision,status,completed,total,last_error,updated_at) VALUES($1,$2,$3,'processing',0,$4,'',NOW()) ON CONFLICT(marker_id) DO UPDATE SET job_id=EXCLUDED.job_id,revision=EXCLUDED.revision,status='processing',completed=0,total=EXCLUDED.total,last_error='',updated_at=NOW()",
     [row.id,jobId,rev,groups.size]);
  }catch(e){busy.delete(key);throw e}
  // Long-running photo rectification never blocks the live HTTP event loop.
  // Frontend polls the durable status; a render/restart is treated as a stale
  // process rather than pretending an old unpublished draft is ready.
  res.status(202).json({queued:true,job_id:jobId,revision:rev,total:groups.size});
  const run=async()=>{
   try{
    const materials=[],used=[];
    for(const [edgeKey,views] of groups){
     const cal=views[0],b=mani.buildings.find(x=>x.building_id===cal.building_id);
     const e=b.edges.find(x=>x.edge_index===cal.edge_index),sources=[];
     for(const view of views){
      const q=await db.query('SELECT content FROM realcity_pro_assets WHERE marker_id=$1 AND asset_id=$2',[row.id,view.asset_id]);
      if(!q.rows[0])fail('pro_original_missing',409);
      sources.push({id:view.asset_id,content:q.rows[0].content});
     }
     // Rectify up to four exact observations of this wall. Occlusion masks
     // reveal pixels of a calibrated secondary view, never invented textures.
     const m=await buildOffThread({
       id:surfaceId(cal),width_m:e.length_m,height_m:b.height_m-b.base_m,
       pixels_per_m:80,sharpen:0,roughness:1,metalness:0,lighting_mix:0,
       views:views.map(v=>({source_asset_id:v.asset_id,source_quad:v.source_quad,exclude:v.exclude,
        exposure_ev:0,white_balance:[1,1,1]}))
     },sources);
     m.edge_key=edgeKey;materials.push(m);used.push(...views);
     await db.query("UPDATE realcity_pro_jobs SET completed=$3,updated_at=NOW() WHERE marker_id=$1 AND job_id=$2",
       [row.id,jobId,materials.length]);
    }
    const report=qualityGate(row,used,materials),output=outputModel(row,used,materials,rev,report);
    if(JSON.stringify(output).length>16*1024*1024)fail('pro_material_budget');
    const fresh=await db.query('SELECT * FROM shaurmeg_markers WHERE id=$1 AND establishment_id=$2',[row.id,row.establishment_id]);
    const current=fresh.rows[0];
    if(!current||revision(current,await assets(current,false),await cals(current))!==rev)fail('pro_sources_changed_during_build',409);
    await db.query('INSERT INTO realcity_pro_drafts(marker_id,revision,output,report,reviewed_revision) VALUES($1,$2,$3::jsonb,$4::jsonb,NULL) ON CONFLICT(marker_id) DO UPDATE SET revision=EXCLUDED.revision,output=EXCLUDED.output,report=EXCLUDED.report,reviewed_revision=NULL,updated_at=NOW()',
      [row.id,rev,JSON.stringify(output),JSON.stringify(report)]);
    await db.query("UPDATE realcity_pro_jobs SET status='ready',completed=total,updated_at=NOW() WHERE marker_id=$1 AND job_id=$2",[row.id,jobId]);
   }catch(e){
    console.error('realcity_pro_background',String(e?.message||e).slice(0,300));
    await db.query("UPDATE realcity_pro_jobs SET status='failed',last_error=$3,updated_at=NOW() WHERE marker_id=$1 AND job_id=$2",
      [row.id,jobId,String(e?.message||e).slice(0,200)]).catch(()=>{});
   }finally{busy.delete(key)}
  };
  void run();
 }));
 app.get(base+'/preview',admin,route(async(req,res)=>{
  const row=await select(req),q=await db.query('SELECT revision,output,report FROM realcity_pro_drafts WHERE marker_id=$1',[row.id]);
  const d=q.rows[0];if(!d)fail('pro_draft_not_found',404);
  if(d.revision!==revision(row,await assets(row,false),await cals(row)))fail('pro_draft_stale',409);
  res.json({marker:{id:row.id,establishment_id:row.establishment_id,venue_id:row.venue_id,lon:row.lon,lat:row.lat},
    profile:{...row.realcity_profile,pro:d.output},report:d.report});
 }));
 app.post(base+'/review',admin,route(async(req,res)=>{
  const row=await select(req),rev=revision(row,await assets(row,false),await cals(row));
  if(req.body?.expected_revision!==rev||req.body.visually_verified!==true)fail('pro_explicit_review_required',409);
  const x=await db.query('UPDATE realcity_pro_drafts SET reviewed_revision=$2 WHERE marker_id=$1 AND revision=$2 RETURNING marker_id',[row.id,rev]);
  if(!x.rows.length)fail('pro_draft_stale',409);res.json({ok:true,reviewed_revision:rev});
 }));
 app.post(base+'/unpublish',admin,route(async(req,res)=>{
  const row=await select(req);
  if(req.body?.confirm_unpublish!==true)fail('pro_explicit_unpublish_confirmation',409);
  await db.query("UPDATE shaurmeg_markers SET realcity_profile=COALESCE(realcity_profile,'{}'::jsonb)-'pro',realcity_updated_at=NOW() WHERE id=$1 AND establishment_id=$2",[row.id,row.establishment_id]);
  res.json({ok:true,marker_id:String(row.id),unpublished:true});
 }));
 app.post(base+'/publish',admin,route(async(req,res)=>{
  const row=await select(req),rev=revision(row,await assets(row,false),await cals(row));
  const q=await db.query('SELECT * FROM realcity_pro_drafts WHERE marker_id=$1',[row.id]);const d=q.rows[0];
  if(!d||d.revision!==rev||d.reviewed_revision!==rev||req.body?.expected_revision!==rev)fail('pro_publish_not_reviewed',409);
  if(!d.report.ready)fail('pro_quality_gate_failed');
  const map=manifest(row);
  if(d.output.buildings.some(b=>map.buildings.find(x=>x.building_id===b.building_id)?.geometry_key!==b.geometry_key))fail('pro_geometry_changed',409);
  await db.query("UPDATE shaurmeg_markers SET realcity_profile=jsonb_set(COALESCE(realcity_profile,'{}'::jsonb),'{pro}',$2::jsonb),realcity_updated_at=NOW() WHERE id=$1",[row.id,JSON.stringify(d.output)]);
  res.json({ok:true,published_revision:rev,quality:d.report});
 }));
}
module.exports={install,ensureSchema,manifest,validCalibration,qualityGate,settings,revision,outputModel,surfaceId};
