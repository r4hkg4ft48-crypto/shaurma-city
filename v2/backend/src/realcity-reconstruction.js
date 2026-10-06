'use strict';

const crypto=require('crypto');
const express=require('express');
const db=require('./db');
const config=require('./config');
const openWorld=require('./realcity-open-world');

const ENGINE='realcity-reconstruction-v1';
const MAX_SOURCES=64;
const MAX_ARTIFACT_BYTES=64*1024*1024;
const JOB_TTL_MS=45*60*1000;
const ALLOWED_ARTIFACTS=new Set(['surfels.rcs','preview.webp','mesh.glb','scene.json']);

const clean=(v,n=500)=>String(v||'').trim().slice(0,n);
const finite=n=>Number.isFinite(Number(n));
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const tokenOk=req=>!!config.REALCITY_RECONSTRUCTION_WORKER_TOKEN&&crypto.timingSafeEqual(
  Buffer.from(crypto.createHash('sha256').update(String(req.get('x-realcity-worker-token')||'')).digest('hex')),
  Buffer.from(crypto.createHash('sha256').update(config.REALCITY_RECONSTRUCTION_WORKER_TOKEN).digest('hex'))
);

async function ensureSchema(){
  if(!db.configured)return;
  await db.query(`
    CREATE TABLE IF NOT EXISTS realcity_reconstruction_jobs(
      id UUID PRIMARY KEY,
      marker_id BIGINT NOT NULL REFERENCES shaurmeg_markers(id) ON DELETE CASCADE,
      establishment_id TEXT NOT NULL,
      venue_id TEXT NOT NULL,
      profile_version INTEGER NOT NULL,
      input_revision TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      package JSONB NOT NULL,
      report JSONB NOT NULL DEFAULT '{}'::jsonb,
      worker_id TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      claimed_at TIMESTAMPTZ,
      heartbeat_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      finished_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS idx_realcity_reconstruction_jobs_status_created
      ON realcity_reconstruction_jobs(status,created_at);
    CREATE TABLE IF NOT EXISTS realcity_reconstruction_artifacts(
      job_id UUID NOT NULL REFERENCES realcity_reconstruction_jobs(id) ON DELETE CASCADE,
      marker_id BIGINT NOT NULL REFERENCES shaurmeg_markers(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      mime TEXT NOT NULL,
      sha256 TEXT NOT NULL,
      bytes INTEGER NOT NULL,
      content BYTEA NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY(job_id,name)
    );
  `);
}

function sourcePackage(x){
  return {
    id:clean(x.id,180),source:clean(x.source,40),source_id:clean(x.source_id,180),
    coordinates:Array.isArray(x.coordinates)?x.coordinates.map(Number):null,
    heading:finite(x.heading)?Number(x.heading):null,fov:finite(x.fov)?Number(x.fov):78,
    panoramic:x.panoramic===true,captured_at:x.captured_at||null,
    license:clean(x.license,180),attribution:clean(x.attribution,500),
    image_url:clean(x.image_url,2200),page_url:clean(x.page_url,2200),
    distance_m:finite(x.distance_m)?Number(x.distance_m):null,
    match:x.match&&typeof x.match==='object'?{
      building_id:clean(x.match.building_id,120),
      edge_index:x.match.edge_index!==null&&x.match.edge_index!==undefined&&Number.isInteger(Number(x.match.edge_index))?Number(x.match.edge_index):null,
      distance_m:finite(x.match.distance_m)?Number(x.match.distance_m):null,
      heading_error_deg:finite(x.match.heading_error_deg)?Number(x.match.heading_error_deg):null,
      quality:finite(x.match.quality)?Number(x.match.quality):null
    }:null
  };
}

function revision(marker,profile,sources){
  return crypto.createHash('sha256').update(JSON.stringify({
    target:[String(marker.id),marker.establishment_id,marker.venue_id,Number(marker.lon),Number(marker.lat)],
    profile_version:Number(profile.version)||0,
    scene:profile.scene||{},
    sources:sources.map(x=>[x.id,x.source,x.source_id,x.coordinates,x.heading,x.captured_at,x.license])
  })).digest('hex');
}

function reconstructionCandidates(raw,marker,max=MAX_SOURCES){
  const origin=[Number(marker.lon),Number(marker.lat)],bins=new Map(),perSource={},seen=new Set(),out=[];
  const weights={panoramax:140,kartaview:134,wikimedia:92};
  const scored=(raw||[]).filter(x=>x?.image_url&&Array.isArray(x.coordinates)&&x.coordinates.length===2&&openWorld._internals.canPersistAdaptation(x)).map(x=>{
    const d=openWorld._internals.haversine(x.coordinates,origin);
    const b=openWorld._internals.bearing(origin,x.coordinates);
    const source=String(x.source||''),heading=Number.isFinite(Number(x.heading))?8:0,pano=x.panoramic?7:0;
    return {x,d,b,score:(weights[source]||70)+heading+pano-Math.min(85,d*.14)};
  }).sort((a,b)=>b.score-a.score);
  const sourceCaps={panoramax:48,kartaview:48,wikimedia:28};
  for(const item of scored){
    const x=item.x,key=String(x.source)+':'+String(x.id);if(seen.has(key))continue;
    const cap=sourceCaps[x.source]||20;if((perSource[x.source]||0)>=cap)continue;
    const bin=Math.floor(((item.b+15)%360)/30),binCount=bins.get(bin)||0;
    if(binCount>=8&&out.length>=Math.ceil(max*.55))continue;
    seen.add(key);perSource[x.source]=(perSource[x.source]||0)+1;bins.set(bin,binCount+1);
    out.push({...x,distance_m:item.d});if(out.length>=max)break;
  }
  return out;
}

function currentPhotoreal(profile){
  return profile?.photoreal&&profile.photoreal.status==='ready'?profile.photoreal:null;
}

function shouldEnqueue(profile){
  if(config.REALCITY_RECONSTRUCTION_ENABLED===false)return false;
  const photo=currentPhotoreal(profile);
  if(!photo)return true;
  if(Number(photo.profile_version||0)<Number(profile?.version||0))return true;
  const t=new Date(photo.generated_at||0).getTime();
  return !Number.isFinite(t)||Date.now()-t>config.REALCITY_RECONSTRUCTION_REFRESH_DAYS*86400000;
}

async function buildPackage(marker,profile){
  const refs=new Map((profile?.real_world?.references||[]).map(r=>[String(r.source)+':'+String(r.source_id),r]));
  const raw=await openWorld.collectCandidates(marker);
  const candidates=reconstructionCandidates(raw,marker,MAX_SOURCES);
  const sources=candidates.map(x=>{
    const ref=refs.get(String(x.source)+':'+String(x.id));
    const distance=Number.isFinite(Number(x.distance_m))?Number(x.distance_m):openWorld._internals.haversine(x.coordinates,[Number(marker.lon),Number(marker.lat)]);
    return sourcePackage({...x,distance_m:distance,match:ref?.match||null});
  });
  const scene=profile.scene||{};
  return {
    schema:'shaurmeg.realcity.reconstruction.package.v1',
    engine:ENGINE,
    target:{
      marker_id:String(marker.id),establishment_id:marker.establishment_id,venue_id:marker.venue_id,
      name:marker.name||'',address:marker.address||'',coordinates:[Number(marker.lon),Number(marker.lat)]
    },
    profile_version:Number(profile.version)||0,
    scene:{
      radius_m:Number(scene.radius_m)||190,
      hero_building_id:scene.hero_building_id||null,
      buildings:(scene.buildings||[]).slice(0,64).map(b=>({
        id:String(b.id),role:b.role||'background',ring:b.ring,height_m:Number(b.height)||9,base_m:Number(b.base_m)||0,levels:Number(b.levels)||null
      })),
      roads:(scene.roads||[]).slice(0,96),
      greens:(scene.greens||[]).slice(0,64),
      trees:(scene.trees||[]).slice(0,128)
    },
    sources,
    quality_targets:{
      min_sources:3,preferred_sources:18,max_sources:MAX_SOURCES,
      near_radius_m:Math.min(140,Number(scene.radius_m)||190),
      target_points_mobile:260000,target_points_high:900000,
      max_artifact_bytes:MAX_ARTIFACT_BYTES
    },
    reconstruction_policy:{
      spatial_truth:'osm_openfreemap',
      source_pixels_dominate:true,
      no_freeform_building_geometry:true,
      remove_dynamic_people:true,
      preserve_static_street_context:true,
      generated_completion_only_for_unobserved_regions:true,
      output:['surfels.rcs','scene.json','preview.webp']
    }
  };
}

async function enqueue(marker,profile){
  if(!db.configured||!shouldEnqueue(profile))return null;
  const packageData=await buildPackage(marker,profile);
  if(packageData.sources.length<1){
    await db.query(`UPDATE shaurmeg_markers SET realcity_profile=jsonb_set(COALESCE(realcity_profile,'{}'::jsonb),'{photoreal}',$2::jsonb,true) WHERE id=$1`,[
      marker.id,JSON.stringify({version:1,status:'insufficient_sources',engine:ENGINE,profile_version:Number(profile.version)||0,generated_at:new Date().toISOString(),source_count:0})
    ]);
    return null;
  }
  const inputRevision=revision(marker,profile,packageData.sources);
  const existing=await db.query(`SELECT id,status FROM realcity_reconstruction_jobs
    WHERE marker_id=$1 AND input_revision=$2 AND status IN ('queued','claimed','processing','ready') ORDER BY created_at DESC LIMIT 1`,[marker.id,inputRevision]);
  if(existing.rows[0])return existing.rows[0];
  const id=crypto.randomUUID();
  await db.query(`INSERT INTO realcity_reconstruction_jobs(id,marker_id,establishment_id,venue_id,profile_version,input_revision,status,package)
    VALUES($1,$2,$3,$4,$5,$6,'queued',$7::jsonb)`,[
      id,marker.id,marker.establishment_id,marker.venue_id,Number(profile.version)||0,inputRevision,JSON.stringify(packageData)
    ]);
  await db.query(`UPDATE shaurmeg_markers SET realcity_profile=jsonb_set(COALESCE(realcity_profile,'{}'::jsonb),'{photoreal}',$2::jsonb,true) WHERE id=$1`,[
    marker.id,JSON.stringify({version:1,status:'queued',engine:ENGINE,job_id:id,profile_version:Number(profile.version)||0,source_count:packageData.sources.length,generated_at:new Date().toISOString()})
  ]);
  return {id,status:'queued'};
}

async function recoverStaleJobs(){
  if(!db.configured)return;
  await db.query(`UPDATE realcity_reconstruction_jobs SET status='queued',worker_id=NULL,claimed_at=NULL,heartbeat_at=NULL,updated_at=NOW()
    WHERE status IN ('claimed','processing') AND COALESCE(heartbeat_at,claimed_at,updated_at)<NOW()-INTERVAL '45 minutes'`);
}

async function claim(workerId){
  return db.tx(async client=>{
    await client.query(`UPDATE realcity_reconstruction_jobs SET status='queued',worker_id=NULL,claimed_at=NULL,heartbeat_at=NULL,updated_at=NOW()
      WHERE status IN ('claimed','processing') AND COALESCE(heartbeat_at,claimed_at,updated_at)<NOW()-INTERVAL '45 minutes'`);
    const q=await client.query(`SELECT * FROM realcity_reconstruction_jobs WHERE status='queued'
      ORDER BY created_at ASC FOR UPDATE SKIP LOCKED LIMIT 1`);
    const row=q.rows[0];if(!row)return null;
    const u=await client.query(`UPDATE realcity_reconstruction_jobs SET status='claimed',worker_id=$2,attempts=attempts+1,claimed_at=NOW(),heartbeat_at=NOW(),updated_at=NOW()
      WHERE id=$1 RETURNING *`,[row.id,workerId]);
    return u.rows[0];
  });
}

async function heartbeat(id,workerId,report={}){
  const q=await db.query(`UPDATE realcity_reconstruction_jobs SET status='processing',heartbeat_at=NOW(),updated_at=NOW(),report=report||$3::jsonb
    WHERE id=$1 AND worker_id=$2 AND status IN ('claimed','processing') RETURNING id`,[id,workerId,JSON.stringify(report||{})]);
  return !!q.rows[0];
}

async function storeArtifact(jobId,name,kind,mime,buffer,workerId){
  if(!ALLOWED_ARTIFACTS.has(name)||!Buffer.isBuffer(buffer)||!buffer.length||buffer.length>MAX_ARTIFACT_BYTES)throw Object.assign(new Error('artifact_invalid'),{status:422});
  const q=await db.query('SELECT marker_id FROM realcity_reconstruction_jobs WHERE id=$1 AND worker_id=$2 AND status IN (\'claimed\',\'processing\')',[jobId,workerId]);
  if(!q.rows[0])throw Object.assign(new Error('reconstruction_job_not_claimed'),{status:409});
  await db.query(`INSERT INTO realcity_reconstruction_artifacts(job_id,marker_id,name,kind,mime,sha256,bytes,content)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8)
    ON CONFLICT(job_id,name) DO UPDATE SET kind=EXCLUDED.kind,mime=EXCLUDED.mime,sha256=EXCLUDED.sha256,bytes=EXCLUDED.bytes,content=EXCLUDED.content,created_at=NOW()`,
    [jobId,q.rows[0].marker_id,name,clean(kind,40)||'binary',clean(mime,100)||'application/octet-stream',sha(buffer),buffer.length,buffer]);
  return {name,bytes:buffer.length,sha256:sha(buffer)};
}

async function complete(jobId,workerId,result){
  return db.tx(async client=>{
    const q=await client.query('SELECT * FROM realcity_reconstruction_jobs WHERE id=$1 AND worker_id=$2 AND status IN (\'claimed\',\'processing\') FOR UPDATE',[jobId,workerId]);
    const job=q.rows[0];if(!job)throw Object.assign(new Error('reconstruction_job_not_claimed'),{status:409});
    const aq=await client.query('SELECT name,kind,mime,sha256,bytes FROM realcity_reconstruction_artifacts WHERE job_id=$1 ORDER BY name',[jobId]);
    const names=new Set(aq.rows.map(x=>x.name));if(!names.has('surfels.rcs')||!names.has('scene.json'))throw Object.assign(new Error('reconstruction_required_artifacts_missing'),{status:422});
    const marker=(await client.query('SELECT id,establishment_id,venue_id,lon,lat,realcity_profile FROM shaurmeg_markers WHERE id=$1 AND establishment_id=$2 AND venue_id=$3 FOR UPDATE',[job.marker_id,job.establishment_id,job.venue_id])).rows[0];
    if(!marker)throw Object.assign(new Error('reconstruction_target_missing'),{status:404});
    const profile=marker.realcity_profile||{};
    if(Number(profile.version||0)!==Number(job.profile_version))throw Object.assign(new Error('reconstruction_profile_changed'),{status:409});
    const radius=Math.max(20,Math.min(260,Number(result?.radius_m)||Number(job.package?.scene?.radius_m)||160));
    const pointCount=Math.max(0,Math.min(5000000,Number(result?.point_count)||0));
    const camera=result?.camera&&typeof result.camera==='object'?result.camera:(profile.real_world?.camera||profile.camera||{zoom:18.2,pitch:63,bearing:-20});
    const publicBase=config.PUBLIC_API_URL+'/api/v2/map/markers/'+encodeURIComponent(String(job.marker_id))+'/realcity/artifacts/';
    const photoreal={
      version:1,status:'ready',engine:ENGINE,job_id:String(job.id),profile_version:Number(job.profile_version),
      generated_at:new Date().toISOString(),origin:[Number(marker.lon),Number(marker.lat),0],
      radius_m:radius,point_count:pointCount,source_count:Array.isArray(job.package?.sources)?job.package.sources.length:0,
      quality:clean(result?.quality,40)||'reconstructed',camera,
      coverage:result?.coverage||{},bounds:result?.bounds||null,
      artifacts:Object.fromEntries(aq.rows.map(a=>[a.name,{url:publicBase+encodeURIComponent(a.name)+'?job='+encodeURIComponent(String(job.id)),kind:a.kind,mime:a.mime,sha256:a.sha256,bytes:Number(a.bytes)}])),
      attribution:(job.package?.sources||[]).map(s=>({source:s.source,license:s.license,attribution:s.attribution,page_url:s.page_url})),
      reconstruction:{provider:clean(result?.provider,80)||'depth-anything-v2-small',pose_solver:clean(result?.pose_solver,80)||'gps_heading_multiview',dense:true,source_pixels_dominate:true}
    };
    await client.query(`UPDATE shaurmeg_markers SET realcity_profile=jsonb_set(COALESCE(realcity_profile,'{}'::jsonb),'{photoreal}',$2::jsonb,true),realcity_updated_at=NOW() WHERE id=$1`,[marker.id,JSON.stringify(photoreal)]);
    await client.query(`UPDATE realcity_reconstruction_jobs SET status='ready',report=report||$3::jsonb,heartbeat_at=NOW(),updated_at=NOW(),finished_at=NOW() WHERE id=$1 AND worker_id=$2`,[jobId,workerId,JSON.stringify(result||{})]);
    return photoreal;
  });
}

async function failJob(jobId,workerId,error,report={}){
  const message=clean(error,800)||'reconstruction_failed';
  await db.query(`UPDATE realcity_reconstruction_jobs SET status='failed',report=report||$4::jsonb||jsonb_build_object('error',$3::text),updated_at=NOW(),finished_at=NOW()
    WHERE id=$1 AND worker_id=$2`,[jobId,workerId,message,JSON.stringify(report||{})]);
}

function install(router){
  router.get('/map/markers/:id/realcity/artifacts/:name',async(req,res)=>{
    try{
      const name=clean(req.params.name,80);if(!ALLOWED_ARTIFACTS.has(name))return res.sendStatus(404);
      const job=clean(req.query.job,80);
      const q=await db.query(`SELECT a.mime,a.sha256,a.bytes,a.content FROM realcity_reconstruction_artifacts a
        JOIN realcity_reconstruction_jobs j ON j.id=a.job_id
        WHERE a.marker_id=$1 AND a.name=$2 AND j.status='ready' AND ($3='' OR j.id::text=$3)
        ORDER BY a.created_at DESC LIMIT 1`,[req.params.id,name,job]);
      const row=q.rows[0];if(!row)return res.sendStatus(404);
      res.type(row.mime).setHeader('Cache-Control','public,max-age=31536000,immutable').setHeader('ETag','"'+row.sha256+'"').send(row.content);
    }catch{res.sendStatus(404)}
  });

  router.post('/internal/realcity/reconstruction/claim',express.json({limit:'32kb'}),async(req,res)=>{
    if(!tokenOk(req))return res.sendStatus(401);
    const workerId=clean(req.body?.worker_id,120)||'worker';
    const job=await claim(workerId);res.setHeader('Cache-Control','no-store');res.json(job?{job_id:String(job.id),package:job.package,attempts:job.attempts}:{job:null});
  });
  router.post('/internal/realcity/reconstruction/jobs/:id/heartbeat',express.json({limit:'256kb'}),async(req,res)=>{
    if(!tokenOk(req))return res.sendStatus(401);
    const ok=await heartbeat(req.params.id,clean(req.body?.worker_id,120),req.body?.report||{});res.status(ok?200:409).json({ok});
  });
  router.put('/internal/realcity/reconstruction/jobs/:id/artifacts/:name',express.raw({type:'application/octet-stream',limit:'64mb'}),async(req,res)=>{
    if(!tokenOk(req))return res.sendStatus(401);
    try{
      const value=await storeArtifact(req.params.id,clean(req.params.name,80),req.query.kind,req.query.mime,req.body,clean(req.get('x-realcity-worker-id'),120));
      res.json({ok:true,...value});
    }catch(e){res.status(e.status||500).json({error:e.status?e.message:'artifact_store_failed'})}
  });
  router.post('/internal/realcity/reconstruction/jobs/:id/complete',express.json({limit:'1mb'}),async(req,res)=>{
    if(!tokenOk(req))return res.sendStatus(401);
    try{res.json({ok:true,photoreal:await complete(req.params.id,clean(req.body?.worker_id,120),req.body?.result||{})})}
    catch(e){res.status(e.status||500).json({error:e.status?e.message:'reconstruction_complete_failed'})}
  });
  router.post('/internal/realcity/reconstruction/jobs/:id/fail',express.json({limit:'512kb'}),async(req,res)=>{
    if(!tokenOk(req))return res.sendStatus(401);
    await failJob(req.params.id,clean(req.body?.worker_id,120),req.body?.error,req.body?.report||{});res.json({ok:true});
  });
}

module.exports={ENGINE,ensureSchema,enqueue,shouldEnqueue,recoverStaleJobs,buildPackage,install,_internals:{revision,sourcePackage,tokenOk,reconstructionCandidates}};
