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
 const material=(id)=>({id:'pro_'+id,mode:'facade',rectified:true,source_asset_id:id,data_url:'data:image/webp;base64,YQ==',width:512,height:512,
  roughness:1,metalness:0,lighting_mix:0});
 const cs=[0,1].map((edge_index)=>({asset_id:'pro'+edge_index,building_id:'hero-1',geometry_key:m.buildings[0].geometry_key,
   edge_index,flip_u:false,confirmed:true}));
 const model=pro.outputModel(row,cs,cs.map(c=>material(c.asset_id)),'rev-1',full);
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
