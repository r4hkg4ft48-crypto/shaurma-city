'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const express=require('express'),sharp=require('sharp');
const Studio=require('../src/realcity-studio'),A=require('../src/realcity-astra'),S=require('../../frontend/realcity-spatial');
// HTTP contract fixture. Production uses PostgreSQL; this store isolates the
// private-source, stale-revision and scoped-capability boundaries under test.
function store(){
 const ring=[[37.8,55.68],[37.8004,55.68],[37.8004,55.6802],[37.8,55.6802],[37.8,55.68]];
 const state={row:{id:'3139',establishment_id:'SC-MSK-9342972B1F',venue_id:'venue',lon:37.8002,lat:55.67999,realcity_astra_assets:[],realcity_astra_config:{},realcity_profile:{scene:{hero_building_id:'hero',buildings:[{id:'hero',ring,height:12,role:'hero',palette:{wall:'#aaaaaa'}}]}}},originals:[],access:null,draft:null};
 const db={connect:async()=>({...db,release(){}}),async query(sql,p=[]){
  if(/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql))return {rows:[]};
  if(sql.startsWith('SELECT m.* FROM realcity_astra_access'))return {rows:state.access?.token_hash===p[0]&&new Date(state.access.expires_at)>new Date()?[structuredClone(state.row)]:[]};
  if(sql.startsWith('SELECT * FROM shaurmeg_markers'))return {rows:(p.length===1?p[0]===state.row.establishment_id:String(p[0])===state.row.id&&p[1]===state.row.establishment_id&&(p.length<3||p[2]===state.row.venue_id))?[structuredClone(state.row)]:[]};
  if(sql.startsWith('SELECT asset_id FROM realcity_astra_originals'))return {rows:state.originals.filter(x=>x.marker_id===p[0]&&x.sha256===p[1])};
  if(sql.startsWith('SELECT COALESCE(SUM'))return {rows:[{bytes:state.originals.reduce((n,x)=>n+x.content.length,0)}]};
  if(sql.startsWith('INSERT INTO realcity_astra_originals')){state.originals.push({marker_id:p[0],asset_id:p[1],sha256:p[2],mime:p[3],content:p[4],metadata:JSON.parse(p[5]),preview:p[6]});return {rows:[]};}
  if(sql.startsWith('SELECT content,mime'))return {rows:state.originals.filter(x=>x.marker_id===p[0]&&x.asset_id===p[1])};
  if(sql.startsWith('UPDATE shaurmeg_markers SET realcity_astra_assets')){state.row.realcity_astra_assets=JSON.parse(p[1]);state.row.realcity_astra_config=JSON.parse(p[2]);state.row.realcity_profile.astra_input=JSON.parse(p[3]);if(p[4]&&state.row.realcity_profile.astra)state.row.realcity_profile.astra.status='stale';return {rows:[structuredClone(state.row)]};}
  if(sql.startsWith('INSERT INTO realcity_astra_access')){state.access={token_hash:p[1],expires_at:new Date(Date.now()+86400000).toISOString()};return {rows:[state.access]};}
  if(sql.startsWith('DELETE FROM realcity_astra_access')){state.access=null;return {rows:[]};}
  if(sql.startsWith('INSERT INTO realcity_astra_drafts')){state.draft={marker_id:p[0],input_revision:p[1],recipe:JSON.parse(p[2]),output:JSON.parse(p[3]),report:JSON.parse(p[4]),updated_at:new Date().toISOString()};return {rows:[]};}
  if(sql.includes('FROM realcity_astra_drafts WHERE marker_id'))return {rows:state.draft?[structuredClone(state.draft)]:[]};
  if(sql.startsWith('UPDATE shaurmeg_markers SET realcity_profile=jsonb_set')){state.row.realcity_profile.astra=JSON.parse(p[1]);return {rows:[]};}
  throw new Error('Unexpected query '+sql);
 }};return {db,state,ring};
}
test('original upload → scoped Astra read → material draft → guarded publication → revoke',async t=>{
 const {db,state,ring}=store(),app=express();app.use(express.json({limit:'24mb'}));
 Studio.install(app,{db,authorize:req=>req.get('Authorization')==='Bearer admin-test',manifest:row=>({geometry:A.geometryManifest(row)}),normalizeAssets:a=>structuredClone(a||[]),normalizeConfig:c=>({...c}),readiness:a=>({main_count:a.length})});
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>server.close());
 const root='http://127.0.0.1:'+server.address().port,base='/api/shaurma/admin/astra-realcity/'+state.row.establishment_id;
 const request=(url,body,method='POST',admin=true)=>fetch(root+url,{method,headers:{...(admin?{Authorization:'Bearer admin-test'}:{}),'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
 assert.equal((await request(base+'?marker_id=3139',null,'GET',false)).status,401);
 assert.equal((await request(base+'/access',{marker_id:'3140'})).status,404);
 const original=await sharp({create:{width:256,height:128,channels:3,background:'#cc8844'}}).png().toBuffer();
 const upload=()=>fetch(root+base+'/assets?marker_id=3139&category=main_building&filename=front.png',{method:'POST',headers:{Authorization:'Bearer admin-test','Content-Type':'application/octet-stream'},body:original});
 assert.equal((await upload()).status,200);assert.equal((await upload()).status,200);assert.equal(state.originals.length,1);assert.equal(state.row.realcity_astra_assets.length,1);
 const uploaded=state.row.realcity_astra_assets[0],before=JSON.stringify(state.row.realcity_profile.scene);
 const access=await (await request(base+'/access',{marker_id:'3139'})).json();assert.equal(access.publish,false);assert.ok(!JSON.stringify(state.access).includes(access.path.split('/').at(-1)));
 const pack=await (await request(access.path,null,'GET',false)).json();assert.equal(pack.permissions.publish,false);assert.equal(pack.manifest.processing.method,'photo-facades-v3');
 const file=await request(pack.assets[0].original_path,null,'GET',false);assert.deepEqual(Buffer.from(await file.arrayBuffer()),original);
 assert.equal((await request(access.path+'/assets/not-in-dataset',null,'GET',false)).status,404);
 const recipe={version:3,expected_revision:pack.manifest.geometry.revision,materials:[{id:'front',width_m:4,height_m:2,views:[{source_asset_id:uploaded.id,source_quad:[[0,0],[1,0],[1,1],[0,1]]}]}],output:{version:2,target:{marker_id:'3139',establishment_id:state.row.establishment_id,venue_id:'venue',coordinates:[state.row.lon,state.row.lat]},buildings:[{building_id:'hero',geometry_key:S.geometryKey(ring),facades:[{edge_index:0,edge:[ring[0],ring[1]],evidence:'observed',reference_ids:[uploaded.id],surfaces:[{material_id:'front',u_m:1,z_m:1,width_m:4,height_m:2,confirmed:true,flip_u:false}]}]}]}};
 const built=await request(access.path+'/draft',recipe,'POST',false);assert.equal(built.status,200,JSON.stringify(await built.clone().json()));assert.equal(state.row.realcity_profile.astra,undefined);assert.ok(state.draft.output.materials.length);
 assert.equal((await request(access.path+'/publish',{},'POST',false)).status,404);
 assert.equal((await request(base+'/publish',{marker_id:'3139',expected_revision:recipe.expected_revision,expected_draft_updated_at:'old'})).status,409);
 const publish={marker_id:'3139',expected_revision:recipe.expected_revision,expected_draft_updated_at:state.draft.updated_at};
 assert.equal((await request(base+'/publish',publish)).status,200);assert.equal(state.row.realcity_profile.astra.status,'ready');assert.equal(JSON.stringify(state.row.realcity_profile.scene),before);
 assert.equal((await request(base,{marker_id:'3139',expected_revision:'old',assets:[],config:{}},'PUT')).status,409);assert.equal(state.row.realcity_astra_assets.length,1);
 const assets=structuredClone(state.row.realcity_astra_assets);assets[0].sha256='foreign';
 assert.equal((await request(base,{marker_id:'3139',expected_revision:A.revision(state.row),assets,config:{}},'PUT')).status,422);
 state.row.realcity_astra_config.notes='new observation';assert.equal((await request(base+'/publish',publish)).status,409);
 assert.equal((await request(base+'/access?marker_id=3139',null,'DELETE')).status,200);assert.equal((await request(access.path,null,'GET',false)).status,401);
});
