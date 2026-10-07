'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const config=require('../src/config');
const P=require('../src/realcity-photoreal');
const S=require('../../frontend/realcity-spatial');
global.RealCitySpatial=S;
require('../../frontend/realcity-splat-layer');
const R=global.RealCitySplatLayer;

const ring=[[37,55],[37.0001,55],[37.0001,55.0001],[37,55.0001],[37,55]];
const marker={id:'7',establishment_id:'SC-MSK-TEST000001',venue_id:'venue-7',lon:37,lat:55,name:'Test',realcity_astra_assets:[]};
const profile={scene:{hero_building_id:'hero',radius_m:190,buildings:[{id:'hero',role:'hero',ring,height:12,base_m:0}]},real_world:{references:[]}};

function chunk(codec='rcsp2-base64',points=100){
  const record=codec==='rcsp2-base64'?22:12;
  return {id:'near',codec,point_count:points,data:Buffer.alloc(points*record,7).toString('base64'),bounds_min:[-10,-10,-2],bounds_max:[10,10,20],lod:0};
}
function artifact(){
  return {
    schema:1,engine:P.ENGINE,input_signature:P.sceneSignature(marker,profile,[]),
    target:{marker_id:'7',establishment_id:marker.establishment_id,venue_id:marker.venue_id},
    origin:[37,55,0],anchor:{building_id:'hero',geometry_key:S.geometryKey(ring)},
    representation:'gaussian-splats-v2',chunks:[chunk()],
    alignment:{method:'gps-similarity',rms_m:.8},quality:{coverage_radius_m:190},sources:[],stats:{frames:8,backend:'test'}
  };
}

test('photoreal input signature is pinned to geometry and enabled source revision',()=>{
  const before=config.REALCITY_PHOTOREAL_USE_OWNER_ASSETS;
  try{
    config.REALCITY_PHOTOREAL_USE_OWNER_ASSETS=false;
    const a=P.sceneSignature(marker,profile,[]);
    const moved={...profile,scene:{...profile.scene,buildings:[{...profile.scene.buildings[0],ring:[[37,55],[37.0002,55],[37.0002,55.0001],[37,55.0001],[37,55]]}]}};
    assert.notEqual(a,P.sceneSignature(marker,moved,[]));
    const privateAssets=[{id:'p1',sha256:'abc',category:'main_building',subtype:'facade',priority:4}];
    assert.equal(a,P.sceneSignature(marker,profile,privateAssets),'disabled private photos must not invalidate an open-only world');
    config.REALCITY_PHOTOREAL_USE_OWNER_ASSETS=true;
    assert.notEqual(a,P.sceneSignature(marker,profile,privateAssets),'opted-in private photos must bind the reconstruction signature');
  }finally{config.REALCITY_PHOTOREAL_USE_OWNER_ASSETS=before}
});

test('RCSP2 validates exact binary layout and bounds',()=>{
  const ok=P._internals.validateChunk(chunk());
  assert.equal(ok.codec,'rcsp2-base64');
  assert.equal(ok.point_count,100);
  const bad={...chunk(),data:Buffer.alloc(100*22-1).toString('base64')};
  assert.throws(()=>P._internals.validateChunk(bad),/photoreal_invalid_bytes/);
});

test('callback HMAC changes when one artifact byte changes',()=>{
  const before=config.REALCITY_RECONSTRUCTION_SECRET;config.REALCITY_RECONSTRUCTION_SECRET='unit-test-secret';
  try{
    const a=artifact(),body={job_id:'rc_test',input_signature:a.input_signature,status:'ready',artifact:a};
    const s1=P.resultSignature(body);
    const raw=Buffer.from(a.chunks[0].data,'base64');raw[0]^=1;
    const b={...body,artifact:{...a,chunks:[{...a.chunks[0],data:raw.toString('base64')}]}};
    assert.notEqual(s1,P.resultSignature(b));
    assert.equal(s1,P.resultSignature(body));
  }finally{config.REALCITY_RECONSTRUCTION_SECRET=before}
});

test('photoreal artifact binds to exact marker and hero footprint',()=>{
  const a=artifact();
  assert.equal(S.boundPhotoreal({...a,status:'ready'},marker,profile.scene),true);
  assert.equal(S.boundPhotoreal({...a,status:'ready',target:{...a.target,venue_id:'other'}},marker,profile.scene),false);
  assert.equal(S.boundPhotoreal({...a,status:'ready',anchor:{...a.anchor,geometry_key:'wrong'}},marker,profile.scene),false);
});

test('public summary never contains binary splat payload',()=>{
  const a={...artifact(),status:'ready',generated_at:new Date().toISOString(),stats:{frames:9,points:100,backend:'test',gpu:'gpu'}};
  const summary=P.publicSummary(a);
  assert.equal(summary.points,100);assert.equal(summary.frames,9);
  assert.equal(JSON.stringify(summary).includes(a.chunks[0].data),false);
});


test('RCSP2 browser decoder preserves anisotropic scale and quaternion',()=>{
  const raw=Buffer.alloc(22);
  raw.writeInt16LE(0,0);raw.writeInt16LE(0,2);raw.writeInt16LE(0,4);
  raw[6]=128;raw[7]=64;raw[8]=32;
  raw.writeUInt16LE(1200,9);raw.writeUInt16LE(450,11);raw.writeUInt16LE(90,13);
  raw.writeInt8(127,15);raw.writeInt8(0,16);raw.writeInt8(0,17);raw.writeInt8(0,18);
  raw[19]=220;raw[20]=240;raw[21]=2;
  const out=R.decodeChunk({id:'x',codec:'rcsp2-base64',point_count:1,data:raw.toString('base64'),bounds_min:[-2,-4,0],bounds_max:[2,4,8]});
  assert.equal(out.length,16);
  assert.equal(out[0],0);assert.equal(out[1],0);assert.equal(out[2],4);
  assert.ok(Math.abs(out[6]-1.2)<1e-5);
  assert.ok(Math.abs(out[7]-.45)<1e-5);
  assert.ok(Math.abs(out[8]-.09)<1e-5);
  assert.ok(Math.abs(out[9]-1)<1e-5);
  assert.ok(out[13]>.85&&out[14]>.9);
  assert.equal(out[15],2);
});


test('photoreal candidate sweep does not inherit two-image Commons cap',()=>{
  const rows=Array.from({length:48},(_,i)=>({
    id:'commons-'+i,source:'wikimedia',coordinates:[37+(i%12)*.00015,55+Math.floor(i/12)*.00015],
    image_url:'https://upload.wikimedia.org/'+i+'.jpg',license:'CC BY-SA 4.0'
  }));
  const picked=P._internals.photorealCandidates(rows,marker,72,360);
  assert.ok(picked.length>2);
  assert.ok(picked.length<=32);
  assert.ok(picked.every(x=>Number.isFinite(x.distance_m)));
});

test('photoreal source sweep rejects distant unrelated imagery',()=>{
  const near={id:'near',source:'wikimedia',coordinates:[37.0002,55.0001],image_url:'https://upload.wikimedia.org/near.jpg',license:'CC BY-SA 4.0'};
  const far={id:'far',source:'wikimedia',coordinates:[37.03,55.03],image_url:'https://upload.wikimedia.org/far.jpg',license:'CC BY-SA 4.0'};
  const picked=P._internals.photorealCandidates([near,far],marker,72,320);
  assert.equal(picked.some(x=>x.id==='near'),true);
  assert.equal(picked.some(x=>x.id==='far'),false);
});

test('photoreal worker keeps commercial VGGT cache and metric fallback contracts',()=>{
  const fs=require('node:fs'),src=fs.readFileSync(require('node:path').join(__dirname,'../../reconstruction-worker/app.py'),'utf8');
  assert.match(src,/model=VGGT\.from_pretrained\(VGGT_MODEL\)\.to\(device\)\.eval\(\)/);
  assert.match(src,/model=get_vggt\(device\)/);
  assert.match(src,/Depth-Anything-V2-Metric-Outdoor-Small-hf/);
  assert.doesNotMatch(src,/def get_vggt\([\s\S]{0,500}?model=get_vggt\(device\)/);
});


test('Gaussian depth bucket order is back-to-front and deterministic',()=>{
  const vertices=new Float32Array(3*16);
  vertices[2]=-.5;
  vertices[16+2]=.2;
  vertices[32+2]=.8;
  const I=new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
  const order=R.depthBucketOrder(vertices,I,3,32);
  assert.deepEqual([...order],[2,1,0]);
  assert.deepEqual([...R.depthBucketOrder(vertices,I,3,32)],[...order]);
});


test('transient worker outages bypass retry cooldown policy',()=>{
  assert.equal(P._internals.transientWorkerFailure('worker_http_502'),true);
  assert.equal(P._internals.transientWorkerFailure('worker_http_503'),true);
  assert.equal(P._internals.transientWorkerFailure('worker_timeout'),true);
  assert.equal(P._internals.transientWorkerFailure('UND_ERR_CONNECT_TIMEOUT'),true);
  assert.equal(P._internals.transientWorkerFailure('This operation was aborted'),true);
  assert.equal(P._internals.transientWorkerFailure('AbortError'),true);
  assert.equal(P._internals.transientWorkerFailure('metric_fallback_too_sparse'),false);
});

test('worker contract tries MapAnything from one view and keeps VGGT for three-plus views',()=>{
  const fs=require('node:fs'),src=fs.readFileSync(require('node:path').join(__dirname,'../../reconstruction-worker/app.py'),'utf8');
  assert.match(src,/requested=max\(1,min\(/);
  assert.match(src,/if len\(paths\)<1:/);
  assert.match(src,/no_decodable_views/);
  assert.match(src,/mapanything_reconstruct/);
  assert.match(src,/len\(paths\)>=3/);
  assert.match(src,/vggt_reconstruct/);
  assert.match(src,/len\(job\.sources\)<1/);
  assert.match(src,/MAX paths unavailable; using metric depth fallback/);
});


test('worker retries preview and original source URLs with diagnostics',()=>{
  const fs=require('node:fs'),src=fs.readFileSync(require('node:path').join(__dirname,'../../reconstruction-worker/app.py'),'utf8');
  assert.match(src,/source\.get\("fallback_url"\)/);
  assert.match(src,/async def load_source_image/);
  assert.match(src,/RealCity source rejected/);
  assert.match(src,/no_decodable_views:/);
  assert.match(src,/ShaurmegRealCity\/1\.0/);
});


test('lightweight CPU photoplane avoids ML runtime while MAX GPU path remains available',()=>{
  const fs=require('node:fs'),path=require('node:path');
  const src=fs.readFileSync(path.join(__dirname,'../../reconstruction-worker/app.py'),'utf8');
  const req=fs.readFileSync(path.join(__dirname,'../../reconstruction-worker/requirements-cpu.txt'),'utf8');
  assert.match(src,/LIGHTWEIGHT_CPU/);
  assert.match(src,/def facade_plane_reconstruct/);
  assert.match(src,/open-pixel-osm-facade-projection/);
  assert.match(src,/osm-facade-ray-projection/);
  assert.match(src,/if LIGHTWEIGHT_CPU:/);
  assert.doesNotMatch(req,/torch|transformers|safetensors/i);
  assert.match(src,/def vggt_reconstruct/);
  assert.match(src,/Depth-Anything-V2-Metric-Outdoor-Small-hf/);
});


test('MAX worker prefers Apache MapAnything metric 3D before VGGT fallback',()=>{
  const fs=require('node:fs'),path=require('node:path');
  const src=fs.readFileSync(path.join(__dirname,'../../reconstruction-worker/app.py'),'utf8');
  const req=fs.readFileSync(path.join(__dirname,'../../reconstruction-worker/requirements.txt'),'utf8');
  const docker=fs.readFileSync(path.join(__dirname,'../../reconstruction-worker/Dockerfile'),'utf8');
  assert.match(src,/facebook\/map-anything-apache/);
  assert.match(src,/def mapanything_reconstruct/);
  assert.match(src,/memory_efficient_inference=True/);
  assert.match(src,/minibatch_size=1/);
  assert.match(src,/arr\("pts3d"\)/);
  assert.match(src,/arr\("camera_poses"\)/);
  assert.match(src,/arr\("intrinsics"\)/);
  assert.match(src,/mapanything-apache-1b/);
  assert.match(src,/MAX_BACKEND in \("mapanything","auto"\)/);
  assert.match(docker,/pip install --no-deps git\+https:\/\/github\.com\/facebookresearch\/map-anything\.git@3d10cf7a3016fc0f9bb13a071ee66c47b10be0d9/);
  assert.doesNotMatch(req,/rerun-sdk|tensorboard/i);
});

test('partial photoreal uses a volumetric support shell while true photogrammetry stays pure',()=>{
  const fs=require('node:fs'),path=require('node:path');
  const src=fs.readFileSync(path.join(__dirname,'../../frontend/map.js'),'utf8');
  assert.match(src,/realcity-photoreal-shell/);
  assert.match(src,/isTruePhotogrammetry=authored\.model\?\.quality\?\.photogrammetric===true/);
  assert.match(src,/if\(!isTruePhotogrammetry\)/);
  assert.match(src,/setProgress\(v\)\{shell\.setProgress\?\.\(v\);splat\.setProgress\?\.\(v\)\}/);
  assert.match(src,/REAL CITY · PHOTOGRAMMETRY/);
  assert.match(src,/REAL CITY · PHOTO 3D/);
});


test('MapAnything single-view stays metric and is attempted before low-view fallback',()=>{
  const fs=require('node:fs'),path=require('node:path');
  const src=fs.readFileSync(path.join(__dirname,'../../reconstruction-worker/app.py'),'utf8');
  assert.match(src,/mapanything_requires_one_view/);
  assert.match(src,/def anchor_metric_points/);
  assert.match(src,/gps-heading-metric/);
  assert.match(src,/gps-rigid-metric/);
  assert.match(src,/metric_reconstruction/);
  const dispatch=src.indexOf('MapAnything is metric and explicitly supports monocular');
  const lowFallback=src.indexOf('MAX paths unavailable; using metric depth fallback');
  assert.ok(dispatch>0&&lowFallback>dispatch);
  assert.doesNotMatch(src,/elif len\(paths\)<3:[\s\S]{0,260}?gps_depth_reconstruct/);
});


test('compute tier invalidates a photoreal signature only when explicitly set',()=>{
  const before=config.REALCITY_RECONSTRUCTION_TIER;
  try{
    config.REALCITY_RECONSTRUCTION_TIER='';
    const base=P.sceneSignature(marker,profile,[]);
    config.REALCITY_RECONSTRUCTION_TIER='max';
    const max=P.sceneSignature(marker,profile,[]);
    assert.notEqual(base,max);
    config.REALCITY_RECONSTRUCTION_TIER='lite';
    assert.notEqual(max,P.sceneSignature(marker,profile,[]));
  }finally{config.REALCITY_RECONSTRUCTION_TIER=before}
});


test('MapAnything applies full OpenCV-to-ENU 3D basis alignment to points and splat rotations',()=>{
  const fs=require('node:fs'),path=require('node:path');
  const src=fs.readFileSync(path.join(__dirname,'../../reconstruction-worker/app.py'),'utf8');
  assert.match(src,/OpenCV camera axes are \+X right, \+Y down, \+Z forward/);
  assert.match(src,/desired_basis=desired_camera_basis/);
  assert.match(src,/Rbase=desired_basis@model_basis\.T/);
  assert.match(src,/gps-heading-metric-3d/);
  assert.match(src,/gps-rigid-metric-3d/);
  assert.match(src,/rotation_matrix/);
  assert.match(src,/def rotate_quats_matrix/);
  assert.match(src,/quats=rotate_quats_matrix/);
});


test('bundle-adjusted camera basis feeds final ENU alignment',()=>{
  const fs=require('node:fs'),path=require('node:path');
  const src=fs.readFileSync(path.join(__dirname,'../../reconstruction-worker/app.py'),'utf8');
  assert.match(src,/def invert_w2c/);
  assert.match(src,/anchor_c2w=invert_w2c\(ex\)/);
  assert.match(src,/anchor_metric_points\(pts,centers,anchor_c2w/);
});


test('RealCity world palette visibly replaces the dark city theme and restores on exit',()=>{
  const fs=require('node:fs'),path=require('node:path');
  const src=fs.readFileSync(path.join(__dirname,'../../frontend/map.js'),'utf8');
  assert.match(src,/function setRealCityWorldPalette\(active\)/);
  assert.match(src,/background-color','#9da5a7'/);
  assert.match(src,/fill-color','#7898a5'/);
  assert.match(src,/line-color','#55585a'/);
  assert.match(src,/setRealCityWorldPalette\(!!astraLayer\)/);
  assert.match(src,/setRealCityWorldPalette\(false\)/);
  assert.match(src,/zoom:19\.05,pitch:67/);
});

test('MapAnything does not request multiview confidence for a single observation',()=>{
  const fs=require('node:fs'),path=require('node:path');
  const src=fs.readFileSync(path.join(__dirname,'../../reconstruction-worker/app.py'),'utf8');
  assert.match(src,/use_multiview_confidence=len\(views\)>1/);
  assert.match(src,/realcity-photoreal-worker-v4/);
});


test('high-memory CPU MAX removes the six-frame ceiling',()=>{
  const fs=require('node:fs'),path=require('node:path');
  const src=fs.readFileSync(path.join(__dirname,'../../reconstruction-worker/app.py'),'utf8');
  assert.match(src,/HIGH_MEMORY_CPU/);
  assert.match(src,/if HIGH_MEMORY_CPU:return min\(requested,32\)/);
  assert.match(src,/not HIGH_MEMORY_CPU and os\.getenv\("REALCITY_ALLOW_CPU_MAPANYTHING"/);
  assert.match(src,/"high_memory_cpu":HIGH_MEMORY_CPU/);
});

test('MAX source sweep reaches beyond the old narrow street radius',()=>{
  const fs=require('node:fs'),path=require('node:path');
  const open=fs.readFileSync(path.join(__dirname,'../src/realcity-open-world.js'),'utf8');
  const photo=fs.readFileSync(path.join(__dirname,'../src/realcity-photoreal.js'),'utf8');
  assert.match(open,/bbox\(marker,520\)/);
  assert.match(open,/radius:'520'/);
  assert.match(open,/ggsradius:'650'/);
  assert.match(photo,/Math\.min\(520,\(Number\(profile\?\.scene\?\.radius_m\)\|\|190\)\*2\.35\)/);
  assert.match(photo,/photorealCandidates\(await openWorld\.collectCandidates\(marker\),marker,88,maxDistance\)/);
});
