'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const S=require('../../frontend/realcity-spatial');
const pro=require('../src/realcity-pro');
const P=require('../src/realcity-photo');
const ring=[[37.84,55.70],[37.84025,55.70],[37.84025,55.70014],[37.84,55.70014],[37.84,55.70]];
const b={id:'hero-1',role:'hero',ring,height:27,base_m:0};
const row={id:123,establishment_id:'SC-MSK-1234567890',venue_id:'SC-MSK-1234567890',lon:37.84008,lat:55.69995,
 realcity_profile:{scene:{hero_building_id:'hero-1',buildings:[b]}}};
test('RealCity Pro remains separate from Astra and refuses synthetic fill',()=>{
 assert.equal(pro.settings.mode,'realcity-pro');
 assert.equal(pro.settings.procedural_facades,false);
 assert.equal(pro.settings.synthetic_windows,false);
 assert.equal(pro.settings.generated_images_as_geometry,false);
});
test('RealCity Pro validates map-bound convex photo corners and rejects stale edges',()=>{
 const mani=pro.manifest(row);assert.equal(mani.buildings[0].building_id,'hero-1');
 assert.ok(mani.buildings[0].edges.length>=3);
 const q=[[.15,.2],[.81,.18],[.85,.88],[.13,.85]];
 const v={asset_id:'pro_123',building_id:'hero-1',geometry_key:mani.buildings[0].geometry_key,edge_index:0,
  source_quad:q,exclude:[],flip_u:false,confirmed:true};
 assert.deepEqual(pro.validCalibration(v,mani).source_quad,q);
 assert.throws(()=>pro.validCalibration({...v,geometry_key:'wrong'},mani),/pro_geometry_revision_mismatch/);
 assert.throws(()=>pro.validCalibration({...v,source_quad:[[0,0],[1,1],[1,0],[0,1]]},mani));
 assert.throws(()=>pro.validCalibration({...v,edge_index:100},mani),/pro_edge_not_in_map/);
});
test('RealCity Pro cannot publish a single wall and does not invent hidden geometry',()=>{
 const m=pro.manifest(row),qa=pro.qualityGate(row,[{building_id:'hero-1',edge_index:0,confirmed:true}],[{quality:{missing_fraction:0}}]);
 assert.equal(qa.ready,false);
 const full=pro.qualityGate(row,[{building_id:'hero-1',edge_index:0,confirmed:true},{building_id:'hero-1',edge_index:1,confirmed:true}],
 [{quality:{missing_fraction:0}},{quality:{missing_fraction:0}}]);
 assert.equal(full.ready,true);
 const material=(c)=>({id:pro.surfaceId(c),mode:'facade',rectified:true,source_asset_id:id,data_url:'data:image/webp;base64,YQ==',width:512,height:512,
  roughness:1,metalness:0,lighting_mix:0});
 const cs=[0,1].map((edge_index)=>({asset_id:'pro'+edge_index,building_id:'hero-1',geometry_key:m.buildings[0].geometry_key,
   edge_index,flip_u:false,confirmed:true}));
 const model=pro.outputModel(row,cs,cs.map(material),'rev-1',full);
 assert.notEqual(pro.surfaceId(cs[0]),pro.surfaceId(cs[1]));
 assert.equal(model.mode,'realcity-pro');
 assert.equal(model.buildings.length,1);
 assert.equal(model.buildings[0].facades.length,2);
 assert.equal(model.buildings[0].facades[0].modules.length,0);
 assert.equal(model.environment.fences,undefined);
 assert.equal(S.bound(model,{id:row.id,establishment_id:row.establishment_id,venue_id:row.venue_id,lon:row.lon,lat:row.lat},row.realcity_profile.scene),true);
});
test('RealCity Pro renderer and Mini App honor approved photo-only data',()=>{
 const layer=fs.readFileSync(path.join(__dirname,'../../frontend/realcity-layer.js'),'utf8');
 const map=fs.readFileSync(path.join(__dirname,'../../frontend/map.js'),'utf8');
 const admin=fs.readFileSync(path.join(__dirname,'../../../backend/master-admin.html'),'utf8');
 const server=fs.readFileSync(path.join(__dirname,'../../../backend/server.js'),'utf8');
 assert.match(layer,/astra\.mode==='realcity-pro'&&\(!f\|\|!f\.surfaces\?\.length\)continue/);
 assert.match(layer,/if\(astra\.mode==='realcity-pro'\)continue/);
 assert.match(map,/mode:'pro',model:j\.profile\?\.pro/);
 assert.match(map,/RealCityProStudio\?\.previewData/);
 assert.match(admin,/RealCity Pro · Фото/);
 assert.match(server,/realcity-pro'\)\.install/);
});

test('RealCity Pro editor inline JavaScript parses and avoids all-photo marker payload',()=>{
 const vm=require('node:vm');
 const adminPage=fs.readFileSync(path.join(__dirname,'../../../backend/realcity-pro.html'),'utf8');
 const found=adminPage.match(/<script>([\s\S]*?)<\/script>/);
 assert.ok(found,'RealCity Pro UI must have executable client code');
 assert.doesNotThrow(()=>new vm.Script(found[1],{filename:'realcity-pro.html'}));
 const routes=fs.readFileSync(path.join(__dirname,'../src/routes.js'),'utf8');
 assert.match(routes,/m\.realcity_profile - ARRAY\['astra','real_world','pro','photoreal'\]/);
 assert.match(routes,/router\.get\('\/map\/markers\/:id\/realcity'/);
});

test('One photograph may calibrate two different map walls without sharing photo textures',()=>{
 const b=pro.manifest(row).buildings[0];
 const a={asset_id:'same-photo',building_id:b.building_id,edge_index:0};
 const c={...a,edge_index:1};
 assert.notEqual(pro.surfaceId(a),pro.surfaceId(c));
 const src=fs.readFileSync(path.join(__dirname,'../src/realcity-pro.js'),'utf8');
 assert.match(src,/PRIMARY KEY\(marker_id,asset_id,building_id,edge_index\)/);
 assert.match(src,/ON CONFLICT\(marker_id,asset_id,building_id,edge_index\)/);
});

test('Different real photographs share one rectified surface per map edge',()=>{
 const sameWall={building_id:'hero-1',edge_index:0};
 assert.equal(pro.surfaceId({...sameWall,asset_id:'one'}),pro.surfaceId({...sameWall,asset_id:'two'}));
 const src=fs.readFileSync(path.join(__dirname,'../src/realcity-pro.js'),'utf8');
 assert.match(src,/const groups=new Map\(\)/);
 assert.match(src,/pro_max_four_views_per_surface/);
 assert.match(src,/views:views\.map\(v=>\(/);
 assert.match(src,/used\.push\(\.\.\.views\)/);
});

test('RealCity Pro runs CPU rectification off-thread, persists progress and fails closed on missing textures',()=>{
 const api=fs.readFileSync(path.join(__dirname,'../src/realcity-pro.js'),'utf8');
 const worker=fs.readFileSync(path.join(__dirname,'../src/realcity-pro-worker.js'),'utf8');
 const map=fs.readFileSync(path.join(__dirname,'../../frontend/map.js'),'utf8');
 const layer=fs.readFileSync(path.join(__dirname,'../../frontend/realcity-layer.js'),'utf8');
 assert.match(api,/new Worker\(require\.resolve\('\.\/realcity-pro-worker'\)/);
 assert.match(api,/res\.status\(202\)\.json\(\{queued:true/);
 assert.match(api,/realcity_pro_jobs/);
 assert.match(api,/buildOffThread\(\{/);
 assert.match(api,/UPDATE realcity_pro_jobs SET status='ready'/);
 assert.match(worker,/P\.buildMaterial\(workerData\.spec/);
 assert.match(layer,/if\(astra\.mode==='realcity-pro'&&atlas\.photos\.failures\.length\)/);
 assert.match(layer,/astra\.mode==='realcity-pro'&&!this\.photoReady/);
 assert.match(layer,/onError\(new Error\('pro_photo_texture_failed:/);
 assert.match(map,/astraLayer\.photoPromise\?\.then\(visible\)/);
});

test('Photo-archive import is scoped to one marker, copies originals, and does not edit Astra data',()=>{
 const api=fs.readFileSync(path.join(__dirname,'../src/realcity-pro.js'),'utf8');
 const editor=fs.readFileSync(path.join(__dirname,'../../../backend/realcity-pro.html'),'utf8');
 assert.match(api,/app\.post\(base\+'\/import-astra',admin/);
 assert.match(api,/FROM realcity_astra_originals WHERE marker_id=\$1/);
 assert.match(api,/INSERT INTO realcity_pro_assets/);
 assert.match(api,/o\.asset_id=ANY\(\$3::text\[\]\)/);
 assert.match(api,/ON CONFLICT\(marker_id,sha256\) DO NOTHING/);
 assert.doesNotMatch(api,/UPDATE realcity_astra_originals|DELETE FROM realcity_astra_originals/);
 assert.match(editor,/id="importAstra"/);
 assert.match(editor,/endpoint\('\/import-astra'\)/);
});

test('RealCity Pro uses authenticated full-resolution photo and refuses filename-based role guesses',()=>{
 const api=fs.readFileSync(path.join(__dirname,'../src/realcity-pro.js'),'utf8');
 const ui=fs.readFileSync(path.join(__dirname,'../../../backend/realcity-pro.html'),'utf8');
 const vm=require('node:vm');
 const inline=ui.match(/<script>([\s\S]*?)<\/script>/);
 assert.ok(inline);
 assert.doesNotThrow(()=>new vm.Script(inline[1],{filename:'realcity-pro.html'}));
 assert.match(api,/base\+'\/assets\/:assetId\/original'/);
 assert.match(api,/base\+'\/assets\/:assetId\/role'/);
 assert.match(api,/SELECT content,mime FROM realcity_pro_assets WHERE marker_id=\$1 AND asset_id=\$2/);
 assert.match(api,/DELETE FROM realcity_pro_calibrations WHERE marker_id=\$1 AND asset_id=\$2/);
 assert.match(ui,/sourceObjectUrl=URL\.createObjectURL\(blob\)/);
 assert.ok(ui.includes("$('#editRole')"));
 assert.doesNotMatch(ui,/const sourceMap/);
 assert.match(ui,/const f=files\[i\],role=\$\('#role'\)\.value/);
});
