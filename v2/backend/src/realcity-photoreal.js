'use strict';
/**
 * RealCity Photoreal
 * Heavy reconstruction orchestration. The API never performs GPU inference.
 * It signs private input reads, submits bounded jobs to a dedicated worker and
 * accepts a compact quantized splat artifact that is anchored to map geometry.
 */
const crypto=require('crypto');
const db=require('./db');
const config=require('./config');
const openWorld=require('./realcity-open-world');
const photo=require('./realcity-photo');
const S=require('../../frontend/realcity-spatial');

const ENGINE='realcity-photoreal-v1';
const PIPELINE_REVISION='v19-evidence-poses-v2';
const SCHEMA=1;
const MAX_SOURCES=96;
const MAX_CHUNKS=4;
const MAX_ARTIFACT_B64=12*1024*1024;
let schemaReady=null;

const clean=(v,n=300)=>String(v??'').trim().slice(0,n);
const finite=v=>Number.isFinite(Number(v));
const hash=v=>crypto.createHash('sha256').update(typeof v==='string'?v:JSON.stringify(v)).digest('hex');
const hmac=v=>crypto.createHmac('sha256',config.REALCITY_RECONSTRUCTION_SECRET).update(v).digest('hex');
const safeEqual=(a,b)=>{
  try{const A=Buffer.from(String(a),'hex'),B=Buffer.from(String(b),'hex');return A.length===B.length&&crypto.timingSafeEqual(A,B)}catch{return false}
};
function transientWorkerFailure(error){
  return /^(worker_http_(502|503|504)|worker_timeout|fetch failed|ECONNREFUSED|UND_ERR_CONNECT_TIMEOUT|AbortError|This operation was aborted|The operation was aborted)/i.test(String(error||''));
}
function sceneSignature(marker,profile,assets=[]){
  const scene=profile?.scene||{},hero=(scene.buildings||[]).find(b=>String(b.id)===String(scene.hero_building_id)||b.role==='hero');
  return hash({
    engine:ENGINE,pipeline_revision:PIPELINE_REVISION,...(config.REALCITY_RECONSTRUCTION_TIER?{reconstruction_tier:config.REALCITY_RECONSTRUCTION_TIER}:{}),
    target:[String(marker.id),marker.establishment_id,marker.venue_id,Number(marker.lon),Number(marker.lat)],
    hero:hero?{id:String(hero.id),geometry_key:S.geometryKey(hero.ring),height:Number(hero.height)||0}:null,
    scene:(scene.buildings||[]).slice(0,32).map(b=>[String(b.id),S.geometryKey(b.ring),Number(b.height)||0,Number(b.base_m)||0]),
    assets:(config.REALCITY_PHOTOREAL_USE_OWNER_ASSETS?assets:[]).map(a=>[a.id,a.sha256||'',a.direction_deg??null,a.category,a.subtype,a.role,a.priority,a.camera||null,a.metadata?.gps||null,a.metadata?.heading_deg??null,a.metadata?.focal_length_35mm??null,a.metadata?.exif_pose_v||0]),
    open:(profile?.real_world?.references||[]).map(r=>[r.source,r.source_id,r.license,r.coordinates,r.heading])
  });
}
async function ensureSchema(){
  if(schemaReady)return schemaReady;
  schemaReady=(async()=>{
    if(!db.configured)return;
    await db.query(`
      CREATE TABLE IF NOT EXISTS realcity_reconstruction_jobs(
        job_id TEXT PRIMARY KEY,
        marker_id BIGINT NOT NULL REFERENCES shaurmeg_markers(id) ON DELETE CASCADE,
        input_signature TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'queued',
        worker_job_id TEXT,
        source_count INT NOT NULL DEFAULT 0,
        result_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
        last_error TEXT NOT NULL DEFAULT '',
        attempts INT NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_realcity_reconstruction_marker ON realcity_reconstruction_jobs(marker_id,updated_at DESC);
    `);
  })().catch(e=>{schemaReady=null;throw e});
  return schemaReady;
}
function heroAnchor(profile){
  const scene=profile?.scene||{},hero=(scene.buildings||[]).find(b=>String(b.id)===String(scene.hero_building_id)||b.role==='hero');
  return hero?{building_id:String(hero.id),geometry_key:S.geometryKey(hero.ring),ring:hero.ring,height_m:Number(hero.height)||9}:null;
}
function sourceToken(markerId,assetId,expires){
  if(!config.REALCITY_RECONSTRUCTION_SECRET)return null;
  return hmac(['source',String(markerId),String(assetId),String(expires)].join(':'));
}
function sourceUrl(marker,asset){
  const expires=Math.floor(Date.now()/1000)+45*60,token=sourceToken(marker.id,asset.id,expires);
  if(!token)return null;
  return config.PUBLIC_API_URL+'/api/v2/realcity/reconstruction/source/'+encodeURIComponent(marker.id)+'/'+encodeURIComponent(asset.id)+'?expires='+expires+'&sig='+token;
}
function verifySource(markerId,assetId,expires,sig){
  if(!config.REALCITY_RECONSTRUCTION_SECRET||!/^\d+$/.test(String(expires||''))||Number(expires)<Math.floor(Date.now()/1000)-15)return false;
  if(Number(expires)>Math.floor(Date.now()/1000)+60*60)return false;
  return safeEqual(sourceToken(markerId,assetId,expires),sig);
}
async function readPrivateSource(markerId,assetId){
  const q=await db.query('SELECT realcity_astra_assets FROM shaurmeg_markers WHERE id=$1 AND is_active=TRUE',[markerId]);
  const asset=(q.rows[0]?.realcity_astra_assets||[]).find(a=>String(a.id)===String(assetId));if(!asset)return null;
  if(asset.stored){
    const o=await db.query('SELECT content,mime FROM realcity_astra_originals WHERE marker_id=$1 AND asset_id=$2',[markerId,assetId]).catch(()=>({rows:[]}));
    if(o.rows[0])return {content:o.rows[0].content,mime:o.rows[0].mime||'image/jpeg'};
  }
  const m=/^data:(image\/(?:png|jpeg|webp|avif|heic));base64,([a-z0-9+/=]+)$/i.exec(asset.src||'');
  return m?{content:Buffer.from(m[2],'base64'),mime:m[1]}:null;
}
async function enrichOwnerAssets(marker,assets){
  if(!config.REALCITY_PHOTOREAL_USE_OWNER_ASSETS||!db.configured||!Array.isArray(assets)||!assets.length)return assets||[];
  const ids=assets.filter(a=>a?.stored&&a.id&&Number(a.metadata?.exif_pose_v||0)<1).map(a=>String(a.id));
  if(!ids.length)return assets;
  const q=await db.query('SELECT asset_id,content FROM realcity_astra_originals WHERE marker_id=$1 AND asset_id=ANY($2::text[])',[marker.id,ids]).catch(()=>({rows:[]}));
  if(!q.rows.length)return assets;
  const originals=new Map(q.rows.map(r=>[String(r.asset_id),r.content])),out=[];let changed=false;
  for(const asset of assets){
    const raw=originals.get(String(asset.id));
    if(!raw){out.push(asset);continue}
    try{
      const pose=await photo.inspectPose(raw),next={...asset,metadata:{...(asset.metadata||{}),...pose}};
      out.push(next);changed=true;
    }catch{out.push(asset)}
  }
  if(changed)await db.query('UPDATE shaurmeg_markers SET realcity_astra_assets=$2::jsonb,updated_at=NOW() WHERE id=$1',[marker.id,JSON.stringify(out)]).catch(()=>{});
  return out;
}
function fovFromAsset(asset){
  const direct=Number(asset?.camera?.fov_deg);if(Number.isFinite(direct)&&direct>=25&&direct<=140)return direct;
  const f35=Number(asset?.metadata?.focal_length_35mm);
  if(Number.isFinite(f35)&&f35>4&&f35<600)return Math.max(25,Math.min(140,2*Math.atan(36/(2*f35))*180/Math.PI));
  return null;
}
function ownerCameraCoordinates(marker,asset){
  const cam=asset?.camera||{},gps=asset?.metadata?.gps||{};
  const lat=Number(cam.lat??gps.lat),lon=Number(cam.lon??gps.lon);
  if(Number.isFinite(lat)&&Number.isFinite(lon)&&Math.abs(lat)<=85&&Math.abs(lon)<=180)return [lon,lat];
  const heading=Number(cam.heading_deg??asset?.direction_deg??asset?.metadata?.heading_deg),distance=Number(cam.distance_m);
  if(asset?.category==='main_building'&&Number.isFinite(heading)&&Number.isFinite(distance)&&distance>=1&&distance<=220){
    const a=heading*Math.PI/180,lat0=Number(marker.lat),lon0=Number(marker.lon),cos=Math.max(.15,Math.cos(lat0*Math.PI/180));
    return [lon0-distance*Math.sin(a)/(111320*cos),lat0-distance*Math.cos(a)/110540];
  }
  return null;
}
function localMeters(marker,p){
  const lat0=Number(marker.lat)*Math.PI/180,lon=Number(p?.[0]),lat=Number(p?.[1]);
  return [(lon-Number(marker.lon))*111320*Math.max(.15,Math.cos(lat0)),(lat-Number(marker.lat))*110540];
}
function lonLatFromMeters(marker,p){
  const lat0=Number(marker.lat)*Math.PI/180;
  return [Number(marker.lon)+Number(p[0])/(111320*Math.max(.15,Math.cos(lat0))),Number(marker.lat)+Number(p[1])/110540];
}
function astraEvidenceIndex(profile){
  const byRef=new Map(),observed=[],numbers=new Set();
  const sceneById=new Map((profile?.scene?.buildings||[]).map(b=>[String(b.id),b]));
  const addFacade=(f,buildingId)=>{
    if(!f||f.evidence!=='observed'||!Array.isArray(f.edge)||f.edge.length!==2)return;
    const refs=Array.isArray(f.reference_ids)?f.reference_ids.map(String):[];
    const item={edge:f.edge,building_id:String(buildingId||''),confidence:Number(f.confidence)||.7,modules:Array.isArray(f.modules)?f.modules:[]};
    observed.push(item);
    for(const ref of refs){
      if(!byRef.has(ref))byRef.set(ref,[]);byRef.get(ref).push(item);
      const m=/owner[-_ ]?photo[-_ ]?(\d{1,2})/i.exec(ref);if(m)numbers.add(Number(m[1]));
    }
  };
  for(const b of (profile?.astra?.buildings||[])){
    const bid=String(b.building_id||'');
    for(const f of (b.facades||[]))addFacade(f,bid);
    for(const part of (b.parts||[]))for(const f of (part.facades||[]))addFacade(f,bid);
  }
  return {byRef,observed,numbers:[...numbers].sort((a,b)=>a-b),sceneById};
}
function ownerReferenceKeys(asset){
  const out=new Set([String(asset?.id||'')]);
  for(const raw of [asset?.filename,asset?.label,asset?.notes,asset?.id]){
    const s=String(raw||'');
    let m;
    const re=/(?:owner[-_ ]?photo|photo|image|img|фото)[-_ .]*(\d{1,2})/ig;
    while((m=re.exec(s)))out.add('owner-photo-'+Number(m[1]));
    const base=s.split(/[\\/]/).pop()||'',stem=base.replace(/\.[a-z0-9]{2,6}$/i,'');
    if(/^\d{1,2}$/.test(stem))out.add('owner-photo-'+Number(stem));
  }
  return [...out].filter(Boolean);
}
function semanticObservedFacade(asset,ctx){
  if(asset?.category!=='main_building'||!ctx.observed.length)return null;
  const subtype=String(asset.subtype||'');
  const kind=subtype==='entrance'?'entrance':subtype==='signage'?'sign':subtype==='storefront'?'storefront':null;
  if(kind){
    const hit=ctx.observed.filter(x=>x.modules.some(m=>m?.kind===kind)).sort((a,b)=>b.confidence-a.confidence)[0];
    if(hit)return hit;
  }
  return ctx.observed.slice().sort((a,b)=>b.confidence-a.confidence)[0];
}
function evidencePose(marker,profile,asset,ctx){
  const explicit=ownerCameraCoordinates(marker,asset);
  const headingExplicit=Number(asset?.camera?.heading_deg??asset?.direction_deg??asset?.metadata?.heading_deg);
  if(explicit)return {coordinates:explicit,heading:Number.isFinite(headingExplicit)?headingExplicit:null,distance_m:Number(asset?.camera?.distance_m)||null,source:asset?.metadata?.gps?'exif-gps':'manual-camera',refs:[]};
  const keys=ownerReferenceKeys(asset),entries=[];
  for(const key of keys)for(const item of (ctx.byRef.get(key)||[]))entries.push({...item,ref:key});
  if(!entries.length){
    const semantic=semanticObservedFacade(asset,ctx);if(semantic)entries.push({...semantic,ref:'astra-semantic'});
  }
  if(!entries.length)return {coordinates:null,heading:Number.isFinite(headingExplicit)?headingExplicit:null,distance_m:null,source:'unposed',refs:keys};
  let tx=0,ty=0,ox=0,oy=0,weight=0,maxLen=0;const refs=new Set();
  for(const e of entries){
    const a=localMeters(marker,e.edge[0]),b=localMeters(marker,e.edge[1]),mx=(a[0]+b[0])/2,my=(a[1]+b[1])/2;
    const scene=ctx.sceneById.get(String(e.building_id)),ring=scene?.ring||[];
    let cx=0,cy=0,n=0;
    for(const p of ring){const q=localMeters(marker,p);cx+=q[0];cy+=q[1];n++}
    if(n){cx/=n;cy/=n}
    let vx=mx-cx,vy=my-cy,norm=Math.hypot(vx,vy);
    if(norm<.25){vx=-(b[1]-a[1]);vy=b[0]-a[0];norm=Math.hypot(vx,vy)}
    vx/=Math.max(norm,1e-6);vy/=Math.max(norm,1e-6);
    const w=Math.max(.15,Number(e.confidence)||.7);tx+=mx*w;ty+=my*w;ox+=vx*w;oy+=vy*w;weight+=w;
    maxLen=Math.max(maxLen,Math.hypot(b[0]-a[0],b[1]-a[1]));refs.add(e.ref);
  }
  tx/=weight;ty/=weight;let on=Math.hypot(ox,oy);if(on<.1){ox=1;oy=0;on=1}ox/=on;oy/=on;
  const fov=fovFromAsset(asset)||70,explicitDistance=Number(asset?.camera?.distance_m);
  const estimated=maxLen>1?(maxLen/(2*Math.tan(fov*Math.PI/360)))*1.45:22;
  const distance=Number.isFinite(explicitDistance)&&explicitDistance>=1?explicitDistance:Math.max(10,Math.min(65,estimated));
  const coordinates=lonLatFromMeters(marker,[tx+ox*distance,ty+oy*distance]),target=lonLatFromMeters(marker,[tx,ty]);
  const heading=Number.isFinite(headingExplicit)?headingExplicit:openWorld._internals.bearing(coordinates,target);
  return {coordinates,heading,distance_m:distance,source:entries.some(e=>e.ref!=='astra-semantic')?'astra-evidence':'astra-semantic',refs:[...refs]};
}
function ownerPriority(asset){
  const category=String(asset?.category||''),base={main_building:90,neighbor_building:82,road_ground:78,landscape:76,panorama:72,vegetation:66,street_object:62}[category]||50;
  return base+(Number(asset?.priority)||3)*8+(asset?.primary?8:0)+(asset?.metadata?.gps?12:0);
}
function allowedOpenCandidate(c){
  return ['panoramax','kartaview','wikimedia'].includes(c.source)&&openWorld._internals.canPersistAdaptation(c);
}
function photorealCandidates(raw,marker,max=72,maxDistance=360){
  const origin=[Number(marker.lon),Number(marker.lat)],weights={panoramax:150,kartaview:145,wikimedia:105};
  const caps={panoramax:56,kartaview:56,wikimedia:32},bins=new Map(),counts={},seen=new Set(),out=[];
  const scored=(raw||[]).filter(allowedOpenCandidate).map(c=>{
    const d=openWorld._internals.haversine(c.coordinates,origin),bearing=openWorld._internals.bearing(origin,c.coordinates);
    const source=String(c.source||''),heading=finite(c.heading)?10:0,pano=c.panoramic?8:0;
    return {c,d,bearing,score:(weights[source]||80)+heading+pano-Math.min(92,d*.13)};
  }).filter(x=>x.d<=maxDistance).sort((a,b)=>b.score-a.score);
  for(const item of scored){
    const c=item.c,key=String(c.source)+':'+String(c.id);if(seen.has(key))continue;
    const cap=caps[c.source]||24;if((counts[c.source]||0)>=cap)continue;
    const bin=Math.floor(((item.bearing+15)%360)/30),n=bins.get(bin)||0;
    if(n>=8&&out.length>=Math.ceil(max*.55))continue;
    seen.add(key);counts[c.source]=(counts[c.source]||0)+1;bins.set(bin,n+1);
    out.push({...c,distance_m:item.d});if(out.length>=max)break;
  }
  return out;
}
async function buildSources(marker,profile,assets){
  const ownerAssets=(config.REALCITY_PHOTOREAL_USE_OWNER_ASSETS?assets:[]).slice(0,96).sort((a,b)=>ownerPriority(b)-ownerPriority(a));
  const evidence=astraEvidenceIndex(profile);
  const own=ownerAssets.map(a=>{
    const camera=a.camera||{},pose=evidencePose(marker,profile,a,evidence),coordinates=pose.coordinates,heading=pose.heading;
    return {
      id:'owner:'+a.id,kind:'owner',provider:'owner',url:(a.kind==='external_file'&&/^https:\/\//i.test(String(a.src||''))?String(a.src):sourceUrl(marker,a)),asset_id:a.id,
      category:a.category||'main_building',subtype:a.subtype||'detail',role:a.role||'environment',priority:Number(a.priority)||3,primary:!!a.primary,
      coordinates,heading,pitch:finite(camera.pitch_deg)?Number(camera.pitch_deg):null,fov:fovFromAsset(a),
      distance_m:pose.distance_m??(finite(camera.distance_m)?Number(camera.distance_m):null),altitude_m:finite(camera.altitude_m)?Number(camera.altitude_m):null,
      pose_source:pose.source,evidence_refs:pose.refs,angle:a.angle||'unknown',filename:String(a.filename||'').slice(0,180),label:String(a.label||'').slice(0,180),
      captured_at:a.metadata?.captured_at||null,camera_make:a.metadata?.camera_make||'',camera_model:a.metadata?.camera_model||'',
      focal_length_mm:finite(a.metadata?.focal_length_mm)?Number(a.metadata.focal_length_mm):null,
      license:'owner supplied',attribution:'Venue supplied original',photo_first:true
    };
  }).filter(x=>x.url);
  let publicCandidates=[];
  const persistedRefs=profile?.real_world?.references||[];
  try{
    const maxDistance=Math.max(220,Math.min(520,(Number(profile?.scene?.radius_m)||190)*2.35));
    const [live,persisted]=await Promise.all([
      openWorld.collectCandidates(marker).catch(()=>[]),
      openWorld.resolveReferences(persistedRefs).catch(()=>[])
    ]);
    const merged=[],seenCandidates=new Set();
    for(const candidate of [...persisted,...live]){
      const key=String(candidate.source)+':'+String(candidate.id);
      if(seenCandidates.has(key))continue;
      seenCandidates.add(key);merged.push(candidate);
    }
    publicCandidates=photorealCandidates(merged,marker,88,maxDistance);
  }catch{}
  const refs=new Map(persistedRefs.map(r=>[String(r.source)+':'+String(r.source_id),r]));
  const pub=publicCandidates.map(c=>{
    const ref=refs.get(String(c.source)+':'+String(c.id));
    return {
      id:c.source+':'+c.id,kind:'open',url:c.image_url,fallback_url:c.fallback_image_url||null,provider:c.source,
      coordinates:c.coordinates,heading:c.heading,fov:c.fov,panoramic:c.panoramic,distance_m:c.distance_m,
      captured_at:c.captured_at,license:c.license,license_url:c.license_url,attribution:c.attribution,page_url:c.page_url,
      match:c.persisted_match||ref?.match||null
    };
  });
  // Photo-first: observed owner pixels dominate appearance. Keep several
  // geotagged public frames early as absolute anchors when private EXIF is absent.
  const posed=own.filter(s=>Array.isArray(s.coordinates)),unposed=own.filter(s=>!Array.isArray(s.coordinates));
  const ordered=[...posed.slice(0,8),...pub.slice(0,4),...unposed,...posed.slice(8),...pub.slice(4)];
  const seen=new Set(),out=[];
  for(const s of ordered){
    if(!s.url||seen.has(s.id))continue;seen.add(s.id);out.push(s);if(out.length>=MAX_SOURCES)break;
  }
  return out;
}
function buildPayload(marker,profile,assets,sources,inputSignature,jobId){
  const scene=profile.scene||{},anchor=heroAnchor(profile);
  return {
    schema:SCHEMA,job_id:jobId,input_signature:inputSignature,
    target:{marker_id:String(marker.id),establishment_id:marker.establishment_id,venue_id:marker.venue_id,name:marker.name||'',coordinates:[Number(marker.lon),Number(marker.lat)]},
    map_anchor:{origin:[Number(marker.lon),Number(marker.lat),0],radius_m:Math.max(80,Math.min(350,Number(scene.radius_m)||190)),hero:anchor,
      buildings:(scene.buildings||[]).slice(0,32).map(b=>({building_id:String(b.id),role:b.role,ring:b.ring,height_m:Number(b.height)||9,base_m:Number(b.base_m)||0,geometry_key:S.geometryKey(b.ring)})),
      roads:(scene.roads||[]).slice(0,96),greens:(scene.greens||[]).slice(0,64)},
    sources,
    policy:{preserve_map_geometry:true,remove_dynamic_objects:true,prefer_observed_pixels:true,forbid_unlicensed_derivatives:true,
      photo_first:sources.some(s=>s.kind==='owner'),owner_source_count:sources.filter(s=>s.kind==='owner').length,
      owner_world_source_count:sources.filter(s=>s.kind==='owner'&&s.category!=='main_building').length,
      forbid_flat_owner_fallback:sources.some(s=>s.kind==='owner'),min_owner_frames:sources.filter(s=>s.kind==='owner').length>=3?2:1,
      max_points:config.REALCITY_RECONSTRUCTION_MAX_POINTS,max_frames:Math.min(config.REALCITY_RECONSTRUCTION_MAX_FRAMES,sources.length),
      target_mobile_bytes:config.REALCITY_RECONSTRUCTION_TARGET_BYTES},
    callback:{url:config.PUBLIC_API_URL+'/api/v2/realcity/reconstruction/callback',algorithm:'hmac-sha256'}
  };
}
function artifactDigest(artifact){
  const chunks=(artifact?.chunks||[]).map(c=>{
    let digest='';try{digest=crypto.createHash('sha256').update(Buffer.from(String(c?.data||''),'base64')).digest('hex')}catch{}
    return [String(c?.id||''),Number(c?.point_count)||0,digest].join(':');
  }).join(';');
  return hash([String(artifact?.engine||''),String(artifact?.input_signature||''),String(artifact?.target?.marker_id||''),(artifact?.origin||[]).join(','),chunks].join('|'));
}
function callbackDigest(body){
  return body?.status==='ready'?artifactDigest(body?.artifact):hash(clean(body?.error||'',500));
}
function resultSignature(body){
  return hmac(['callback',String(body?.job_id||''),String(body?.input_signature||''),String(body?.status||''),callbackDigest(body)].join(':'));
}
function verifyCallback(body,sig){
  return !!config.REALCITY_RECONSTRUCTION_SECRET&&safeEqual(resultSignature(body),sig);
}
function validateChunk(c){
  if(!c||!/^rcsp[12]-base64$/.test(c.codec||'')||!/^[a-z0-9_-]{1,60}$/i.test(String(c.id||'')))throw new Error('photoreal_invalid_chunk');
  if(!Number.isInteger(c.point_count)||c.point_count<100||c.point_count>config.REALCITY_RECONSTRUCTION_MAX_POINTS)throw new Error('photoreal_invalid_points');
  if(typeof c.data!=='string'||!/^[A-Za-z0-9+/=]+$/.test(c.data)||c.data.length>MAX_ARTIFACT_B64)throw new Error('photoreal_invalid_data');
  const record=c.codec==='rcsp2-base64'?22:12,raw=Buffer.from(c.data,'base64');
  if(raw.length!==c.point_count*record)throw new Error('photoreal_invalid_bytes');
  if(!Array.isArray(c.bounds_min)||!Array.isArray(c.bounds_max)||c.bounds_min.length!==3||c.bounds_max.length!==3||[...c.bounds_min,...c.bounds_max].some(v=>!finite(v)))throw new Error('photoreal_invalid_bounds');
  return {id:String(c.id),lod:Math.max(0,Math.min(3,Number(c.lod)||0)),codec:String(c.codec),point_count:c.point_count,data:c.data,
    bounds_min:c.bounds_min.map(Number),bounds_max:c.bounds_max.map(Number),byte_size:Math.ceil(c.data.length*.75),
    min_zoom:finite(c.min_zoom)?Number(c.min_zoom):16.8,max_zoom:finite(c.max_zoom)?Number(c.max_zoom):24};
}
function validateArtifact(body,row){
  const a=body?.artifact;if(!a||a.schema!==SCHEMA||a.engine!==ENGINE)throw new Error('photoreal_schema');
  const t=a.target||{};if(String(t.marker_id)!==String(row.id)||t.establishment_id!==row.establishment_id||t.venue_id!==row.venue_id)throw new Error('photoreal_target');
  if(a.input_signature!==body.input_signature)throw new Error('photoreal_signature');
  if(!Array.isArray(a.origin)||a.origin.length!==3||Math.abs(Number(a.origin[0])-Number(row.lon))>1e-7||Math.abs(Number(a.origin[1])-Number(row.lat))>1e-7)throw new Error('photoreal_origin');
  const anchor=heroAnchor(row.realcity_profile||{});if(!anchor||a.anchor?.building_id!==anchor.building_id||a.anchor?.geometry_key!==anchor.geometry_key)throw new Error('photoreal_anchor');
  const chunks=(a.chunks||[]).slice(0,MAX_CHUNKS).map(validateChunk);if(!chunks.length)throw new Error('photoreal_chunks_required');
  if(chunks.reduce((n,c)=>n+c.data.length,0)>MAX_ARTIFACT_B64)throw new Error('photoreal_artifact_too_large');
  return {
    schema:SCHEMA,status:'ready',engine:ENGINE,representation:String(a.representation||'gaussian-splats-v2'),generated_at:new Date().toISOString(),
    input_signature:a.input_signature,target:{marker_id:String(row.id),establishment_id:row.establishment_id,venue_id:row.venue_id},
    origin:a.origin.map(Number),anchor:a.anchor,chunks,
    camera:a.camera||null,alignment:a.alignment||{},quality:a.quality||{},environment:a.environment||{},
    sources:(a.sources||[]).slice(0,96).map(s=>({id:clean(s.id,140),kind:clean(s.kind,30),provider:clean(s.provider,50),category:clean(s.category,40),subtype:clean(s.subtype,60),role:clean(s.role,50),captured_at:clean(s.captured_at,80),license:clean(s.license,120),license_url:clean(s.license_url,800),attribution:clean(s.attribution,300),page_url:clean(s.page_url,1200)})),
    stats:{frames:Number(a.stats?.frames)||0,points:chunks.reduce((n,c)=>n+c.point_count,0),dynamic_removed:Number(a.stats?.dynamic_removed)||0,confidence_mean:Number(a.stats?.confidence_mean)||0,
      backend:clean(a.stats?.backend,80),gpu:clean(a.stats?.gpu,120)}
  };
}
async function queue(marker,profile=marker.realcity_profile||{}){
  await ensureSchema();
  if(!db.configured||!config.REALCITY_PHOTOREAL_ENABLED||!config.REALCITY_RECONSTRUCTION_WORKER_URL||!config.REALCITY_RECONSTRUCTION_SECRET)return {queued:false,reason:'worker_not_configured'};
  let assets=Array.isArray(marker.realcity_astra_assets)?marker.realcity_astra_assets:[];
  assets=await enrichOwnerAssets(marker,assets);
  const inputSignature=sceneSignature(marker,profile,assets);
  if(profile.photoreal?.status==='ready'&&profile.photoreal.input_signature===inputSignature)return {queued:false,reason:'current'};
  const sources=await buildSources(marker,profile,assets);
  if(sources.length<config.REALCITY_RECONSTRUCTION_MIN_VIEWS)return {queued:false,reason:'insufficient_views',sources:sources.length};
  // A GPU process can disappear without a callback. Do not let one dead job
  // permanently block a venue; fail stale work, then apply a short retry backoff.
  await db.query("UPDATE realcity_reconstruction_jobs SET status='failed',last_error='worker_timeout',updated_at=NOW() WHERE marker_id=$1 AND status IN ('queued','processing') AND updated_at<NOW()-INTERVAL '2 hours'",[marker.id]);
  const existing=await db.query("SELECT job_id,status FROM realcity_reconstruction_jobs WHERE marker_id=$1 AND input_signature=$2 AND status IN ('queued','processing') ORDER BY updated_at DESC LIMIT 1",[marker.id,inputSignature]);
  if(existing.rows[0])return {queued:false,reason:'already_queued',job_id:existing.rows[0].job_id};
  const recentFailure=await db.query("SELECT job_id,last_error,updated_at FROM realcity_reconstruction_jobs WHERE marker_id=$1 AND input_signature=$2 AND status='failed' AND updated_at>NOW()-INTERVAL '10 minutes' ORDER BY updated_at DESC LIMIT 1",[marker.id,inputSignature]);
  if(recentFailure.rows[0]){
    const transient=transientWorkerFailure(recentFailure.rows[0].last_error);
    if(!transient)return {queued:false,reason:'retry_cooldown',job_id:recentFailure.rows[0].job_id,error:recentFailure.rows[0].last_error};
  }
  const jobId='rc_'+crypto.randomBytes(12).toString('hex'),payload=buildPayload(marker,profile,assets,sources,inputSignature,jobId);
  await db.query("INSERT INTO realcity_reconstruction_jobs(job_id,marker_id,input_signature,status,source_count,attempts) VALUES($1,$2,$3,'queued',$4,1)",[jobId,marker.id,inputSignature,sources.length]);
  await db.query("UPDATE shaurmeg_markers SET realcity_profile=jsonb_set(COALESCE(realcity_profile,'{}'::jsonb),'{photoreal_job}',$2::jsonb),realcity_updated_at=NOW() WHERE id=$1",[marker.id,JSON.stringify({job_id:jobId,status:'queued',input_signature:inputSignature,source_count:sources.length,submitted_at:new Date().toISOString()})]);
  try{
    const ac=new AbortController(),timer=setTimeout(()=>ac.abort(),12000);
    const r=await fetch(config.REALCITY_RECONSTRUCTION_WORKER_URL.replace(/\/+$/,'')+'/v1/jobs',{method:'POST',signal:ac.signal,headers:{'Content-Type':'application/json','Authorization':'Bearer '+config.REALCITY_RECONSTRUCTION_WORKER_TOKEN},body:JSON.stringify(payload)});clearTimeout(timer);
    if(!r.ok)throw new Error('worker_http_'+r.status);
    const j=await r.json();await db.query("UPDATE realcity_reconstruction_jobs SET status='processing',worker_job_id=$2,updated_at=NOW() WHERE job_id=$1",[jobId,clean(j.job_id||jobId,140)]);
    return {queued:true,job_id:jobId,sources:sources.length};
  }catch(e){
    await db.query("UPDATE realcity_reconstruction_jobs SET status='failed',last_error=$2,updated_at=NOW() WHERE job_id=$1",[jobId,clean(e.message,500)]).catch(()=>{});
    await db.query("UPDATE shaurmeg_markers SET realcity_profile=jsonb_set(COALESCE(realcity_profile,'{}'::jsonb),'{photoreal_job}',$2::jsonb) WHERE id=$1",[marker.id,JSON.stringify({job_id:jobId,status:'failed',error:clean(e.message,180),input_signature:inputSignature})]).catch(()=>{});
    return {queued:false,reason:'submit_failed',error:e.message};
  }
}
async function acceptResult(body){
  await ensureSchema();if(!verifyCallback(body,body?.signature))throw Object.assign(new Error('photoreal_callback_unauthorized'),{status:401});
  const q=await db.query('SELECT j.*,m.* FROM realcity_reconstruction_jobs j JOIN shaurmeg_markers m ON m.id=j.marker_id WHERE j.job_id=$1 AND j.input_signature=$2 AND m.is_active=TRUE',[body.job_id,body.input_signature]);
  const row=q.rows[0];if(!row)throw Object.assign(new Error('photoreal_job_not_found'),{status:404});
  if(body.status!=='ready'){
    const error=clean(body.error||'worker_failed',500);await db.query("UPDATE realcity_reconstruction_jobs SET status='failed',last_error=$2,updated_at=NOW() WHERE job_id=$1",[body.job_id,error]);
    await db.query("UPDATE shaurmeg_markers SET realcity_profile=jsonb_set(COALESCE(realcity_profile,'{}'::jsonb),'{photoreal_job}',$2::jsonb) WHERE id=$1",[row.marker_id,JSON.stringify({job_id:body.job_id,status:'failed',error,input_signature:body.input_signature})]);
    return {ok:false,status:'failed'};
  }
  const marker={...row,id:row.marker_id,realcity_profile:row.realcity_profile||{}},artifact=validateArtifact(body,marker);
  const currentSig=sceneSignature(marker,marker.realcity_profile,marker.realcity_astra_assets||[]);
  if(currentSig!==body.input_signature)throw Object.assign(new Error('photoreal_inputs_changed'),{status:409});
  const summary={engine:artifact.engine,representation:artifact.representation,points:artifact.stats.points,chunks:artifact.chunks.length,frames:artifact.stats.frames,backend:artifact.stats.backend,gpu:artifact.stats.gpu,alignment:artifact.alignment};
  await db.tx(async client=>{
    await client.query("UPDATE realcity_reconstruction_jobs SET status='ready',result_summary=$2::jsonb,updated_at=NOW() WHERE job_id=$1",[body.job_id,JSON.stringify(summary)]);
    await client.query("UPDATE shaurmeg_markers SET realcity_profile=jsonb_set(jsonb_set(COALESCE(realcity_profile,'{}'::jsonb),'{photoreal}',$2::jsonb),'{photoreal_job}',$3::jsonb),realcity_quality='photoreal',realcity_updated_at=NOW() WHERE id=$1",[row.marker_id,JSON.stringify(artifact),JSON.stringify({job_id:body.job_id,status:'ready',input_signature:body.input_signature,completed_at:new Date().toISOString(),summary})]);
  });
  return {ok:true,status:'ready',summary};
}
function publicSummary(p){
  if(!p)return null;return {status:p.status,engine:p.engine,representation:p.representation,generated_at:p.generated_at,
    points:p.stats?.points||0,chunks:p.chunks?.length||0,frames:p.stats?.frames||0,backend:p.stats?.backend||'',gpu:p.stats?.gpu||'',
    alignment:p.alignment||{},quality:p.quality||{},source_count:p.sources?.length||0};
}
module.exports={ENGINE,SCHEMA,ensureSchema,sceneSignature,heroAnchor,verifySource,readPrivateSource,queue,acceptResult,publicSummary,resultSignature,_internals:{artifactDigest,callbackDigest,validateArtifact,validateChunk,photorealCandidates,transientWorkerFailure,fovFromAsset,ownerCameraCoordinates,ownerPriority,astraEvidenceIndex,ownerReferenceKeys,evidencePose}};
