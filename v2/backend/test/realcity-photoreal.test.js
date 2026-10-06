'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const config=require('../src/config');
const P=require('../src/realcity-photoreal');
const S=require('../../frontend/realcity-spatial');

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

test('photoreal input signature is pinned to geometry and source revision',()=>{
  const a=P.sceneSignature(marker,profile,[]);
  const moved={...profile,scene:{...profile.scene,buildings:[{...profile.scene.buildings[0],ring:[[37,55],[37.0002,55],[37.0002,55.0001],[37,55.0001],[37,55]]}]}};
  assert.notEqual(a,P.sceneSignature(marker,moved,[]));
  assert.notEqual(a,P.sceneSignature(marker,profile,[{id:'p1',sha256:'abc',category:'main_building',subtype:'facade',priority:4}]));
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
