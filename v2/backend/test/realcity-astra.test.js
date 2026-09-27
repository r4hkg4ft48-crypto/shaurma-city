'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const A=require('../src/realcity-astra'),S=require('../../frontend/realcity-spatial');
const ring=[[37.8,55.68],[37.8004,55.68],[37.8004,55.6802],[37.8,55.6802],[37.8,55.68]];
function fixture(){
 const row={id:'3139',establishment_id:'SC-MSK-9342972B1F',venue_id:'b5fe327852468ac7',lon:37.8002,lat:55.67999,realcity_astra_assets:[{id:'front',src:'private-reference'}],realcity_astra_config:{notes:'front view'},realcity_profile:{scene:{hero_building_id:'osm-hero',buildings:[{id:'osm-hero',ring,height:12,levels:4,role:'hero',palette:{wall:'#aaaaaa'}}]}}};
 const output={version:2,target:{marker_id:row.id,establishment_id:row.establishment_id,venue_id:row.venue_id,coordinates:[row.lon,row.lat]},buildings:[{building_id:'osm-hero',geometry_key:S.geometryKey(ring),height_m:12,facades:[{edge_index:0,edge:[ring[0],ring[1]],evidence:'observed',reference_ids:['front'],grids:[{columns:4,rows:3,spacing_x_m:3,spacing_z_m:3,u_m:1,z_m:1,width_m:1.3,height_m:1.6}]}]}]};
 return {row,output};
}
test('compiles measured modules without mutating scene or private references',()=>{
 const {row,output}=fixture(),before=JSON.stringify(row),result=A.compile(output,row);
 assert.equal(result.buildings[0].facades[0].modules.length,12);assert.equal(result.coverage.observed_edges,1);
 assert.equal(JSON.stringify(row),before);assert.equal(JSON.stringify(result).includes('private-reference'),false);
 assert.equal(S.bound(result,{...row},row.realcity_profile.scene),true);
 assert.equal(S.bound(result,{...row,id:'3140'},row.realcity_profile.scene),false);
});
test('venue, marker, coordinates, polygon and edge bindings fail closed',()=>{
 for(const change of [o=>o.target.marker_id='999',o=>o.target.venue_id='another',o=>o.target.establishment_id='SC-MSK-0000000000',o=>o.target.coordinates[0]+=.001,o=>o.buildings[0].geometry_key='other',o=>o.buildings[0].facades[0].edge_index=1]){
  const {row,output}=fixture();change(output);assert.throws(()=>A.compile(output,row),/astra_/);
 }
});
test('unobserved hero, unknown photos and openings outside an edge are rejected',()=>{
 for(const change of [o=>o.buildings[0].facades[0].evidence='inferred',o=>o.buildings[0].facades[0].reference_ids=['missing'],o=>o.buildings[0].facades[0].grids[0].columns=80,o=>o.buildings[0].facades[0].grids[0].rows=50]){
  const {row,output}=fixture();change(output);assert.throws(()=>A.compile(output,row),/astra_/);
 }
});
test('geometry identity survives start vertex rotation and winding; outward normals stay outward',()=>{
 const open=ring.slice(0,-1),rot=[...open.slice(2),...open.slice(0,2)];
 assert.equal(S.geometryKey(ring),S.geometryKey(rot));assert.equal(S.geometryKey(ring),S.geometryKey([...open].reverse()));
 for(const r of [ring,[...open].reverse()]){
  const edges=S.edges(r,[37.8002,55.6801]);
  for(const e of edges)assert.ok(((e.a[0]+e.b[0])/2)*e.normal[0]+((e.a[1]+e.b[1])/2)*e.normal[1]>0);
 }
});
test('reload revision detects photo, notes and geometry changes but not workflow status',()=>{
 const {row}=fixture(),rev=A.revision(row);row.realcity_astra_config.status='review';row.realcity_astra_config.updated_at='tomorrow';assert.equal(A.revision(row),rev);
 row.realcity_astra_config.notes='different angle';assert.notEqual(A.revision(row),rev);
});
test('client rejects stale facade edge order and non-finite marker coordinates',()=>{
 const {row,output}=fixture(),result=A.compile(output,row);
 const reversed={...row.realcity_profile.scene,buildings:row.realcity_profile.scene.buildings.map(b=>({...b,ring:[...b.ring].reverse()}))};
 assert.equal(S.bound(result,row,reversed),false);
 assert.equal(S.bound({...result,target:{...result.target,coordinates:[NaN,row.lat]}},row,row.realcity_profile.scene),false);
 assert.equal(S.bound(result,{...row,lon:'invalid'},row.realcity_profile.scene),false);
});
test('local frame round-trips coordinates and buffer expands concave facade corners',()=>{
 const f=S.frame(ring[0]);for(const p of ring)f.fromLocal(f.toLocal(p)).forEach((v,i)=>assert.ok(Math.abs(v-p[i])<1e-10));
 const concave=[[0,0],[20,0],[20,20],[12,20],[12,10],[8,10],[8,20],[0,20],[0,0]].map(f.fromLocal);
 const enlarged=S.bufferRing(concave,1).slice(0,-1).map(f.toLocal);
 assert.ok(enlarged[0][0]<-.99&&enlarged[0][1]<-.99);
 assert.ok(enlarged[4][0]<11.01&&enlarged[4][1]>10.99);
});
test('atomic output save changes only astra and rejects stale input',async()=>{
 const {row,output}=fixture(),queries=[];const client={query:async(...q)=>queries.push(q)};
 await assert.rejects(()=>A.save(client,row,{expected_revision:'old',output}),/astra_inputs_changed/);assert.equal(queries.length,0);
 await A.save(client,row,{expected_revision:A.revision(row),output});assert.equal(queries.length,1);
 assert.match(queries[0][0],/jsonb_set\(COALESCE\(realcity_profile/);assert.match(queries[0][0],/'\{astra\}'/);
 assert.equal(queries[0][1][0],row.id);
});
test('vector fallback actually fetches binary tile bytes and rejects HTTP failures',async()=>{
 const {fetchBuffer}=require('../src/realcity-analyzer');const previous=global.fetch;
 try{global.fetch=async()=>({ok:true,arrayBuffer:async()=>new Uint8Array([1,7,9]).buffer});assert.deepEqual([...await fetchBuffer('https://tiles.example/tile')],[1,7,9]);
 global.fetch=async()=>({ok:false,status:503});await assert.rejects(()=>fetchBuffer('https://tiles.example/tile'),/vector_tile_503/);
 }finally{global.fetch=previous}
});
test('perspective material maps the four source corners without a billboard',async()=>{
 const {homography,rectify}=require('../src/realcity-material');
 const quad=[[.1,.2],[.9,.1],[.8,.9],[.2,.8]],h=homography(quad),uv=[[0,0],[1,0],[1,1],[0,1]];
 uv.forEach(([u,v],i)=>{const d=h[6]*u+h[7]*v+1;assert.ok(Math.abs((h[0]*u+h[1]*v+h[2])/d-quad[i][0])<1e-10);assert.ok(Math.abs((h[3]*u+h[4]*v+h[5])/d-quad[i][1])<1e-10)});
 const sharp=require('sharp'),src='data:image/png;base64,'+(await sharp({create:{width:40,height:40,channels:3,background:'#cc8855'}}).png().toBuffer()).toString('base64');
 const result=await rectify(src,quad,64,32),meta=await sharp(Buffer.from(result.split(',')[1],'base64')).metadata();assert.equal(meta.width,64);assert.equal(meta.height,32);
});
test('renderer uses the map coordinate frame and stops oversized meshes before unbounded allocation',()=>{
 const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
 const context={RealCitySpatial:S,earcut:require('../../frontend/vendor/earcut.min.js'),Float32Array};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../../frontend/realcity-layer.js'),'utf8'),context);
 const {row,output}=fixture(),astra=A.compile(output,row),atlas={slots:new Map()};
 const mesh=context.RealCityLayer.buildMesh(row,row.realcity_profile.scene,astra,atlas);
 assert.ok(mesh.triangles>0);assert.equal(mesh.vertices.length,mesh.triangles*3*14);
 assert.equal(mesh.vertices.every(Number.isFinite),true);
 const identity=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],matrix=context.RealCityLayer.localMatrix(identity,mesh.origin,mesh.scale);
 assert.ok(Math.abs(matrix[12]-mesh.origin[0])<1e-7);assert.ok(matrix[5]<0&&matrix[0]>0&&matrix[10]>0);
 const f=astra.buildings[0].facades[0];f.modules=Array.from({length:4000},()=>f.modules[0]);
 assert.throws(()=>context.RealCityLayer.buildMesh(row,row.realcity_profile.scene,astra,atlas),/astra_geometry_budget/);
});
test('photo release keeps the exact venue, map footprints and studio priority',()=>{
 const R=require('../src/realcity-releases/zhulebino'),G=require('../src/realcity-releases/zhulebino-geometry.json');
 const row={id:R.TARGET.marker_id,establishment_id:R.TARGET.establishment_id,venue_id:R.TARGET.venue_id,lon:R.TARGET.coordinates[0],lat:R.TARGET.coordinates[1],realcity_profile:{custom:'keep',scene:G.scene}};
 const before=JSON.stringify(row),p=R.build(row);
 assert.ok(S.bound(p.astra,row,p.scene));assert.equal(p.scene,row.realcity_profile.scene);
 assert.equal(JSON.stringify(row),before);assert.equal(p.custom,'keep');assert.equal(p.astra.references.length,10);
 assert.equal(p.astra.references.find(r=>r.number==='1').file,'IMG_7096.jpeg');
 assert.equal(p.astra.references.find(r=>r.number==='10').file,'IMG_7110.jpeg');
 assert.equal(p.astra.materials.length,0);assert.ok(!JSON.stringify(p.astra).includes('data:image'));
 assert.equal(R.build({...row,id:'3140'}),null);assert.equal(R.build({...row,lon:row.lon+.001}),null);
 assert.equal(R.build({...row,realcity_profile:p}),null);
 assert.equal(R.build({...row,realcity_profile:{...p,astra:{version:2,status:'ready',notes:'studio'}}}),null);
 const hero=p.astra.buildings[0];assert.equal(hero.parts.length,3);
 assert.equal(S.geometryKey(hero.parts[0].ring),S.geometryKey(G.scene.buildings[0].ring));
 assert.ok(hero.parts.every(part=>S.containsRing(G.scene.buildings[0].ring,part.ring)));
 assert.ok(hero.parts[1].facades.find(f=>f.edge_index===2).modules.some(m=>m.kind==='medical-heart'));
 const reordered=structuredClone(row);
 reordered.realcity_profile.scene.buildings=reordered.realcity_profile.scene.buildings.map(b=>({...b,ring:[...b.ring].reverse()}));
 const r=R.build(reordered);assert.ok(S.bound(r.astra,reordered,r.scene));
 assert.equal(JSON.stringify(r.astra.buildings[0].parts),JSON.stringify(hero.parts));
 const imported=A.compile(p.astra,{...row,realcity_profile:p});
 assert.deepEqual(imported.environment,p.astra.environment);assert.deepEqual(imported.camera,p.astra.camera);
});
test('photo-authored quarter stays within the mobile mesh and finite-coordinate budget',()=>{
 const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),R=require('../src/realcity-releases/zhulebino');
 const row={id:R.TARGET.marker_id,establishment_id:R.TARGET.establishment_id,venue_id:R.TARGET.venue_id,lon:R.TARGET.coordinates[0],lat:R.TARGET.coordinates[1],realcity_profile:{}};
 const p=R.build(row),context={RealCitySpatial:S,earcut:require('../../frontend/vendor/earcut.min.js'),Float32Array};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../../frontend/realcity-layer.js'),'utf8'),context);
 const mesh=context.RealCityLayer.buildMesh(row,p.scene,p.astra,{slots:new Map()});
 assert.ok(mesh.triangles<100000);assert.ok(mesh.vertices.byteLength<18000000);assert.ok(mesh.vertices.every(Number.isFinite));
});
test('roof subdivisions cannot leave a concave map footprint or nest more geometry',()=>{
 const {row,output}=fixture();const main=output.buildings[0];
 main.parts=[{ring,height_m:6,facades:main.facades.map(f=>({...f,grids:[]}))},{ring:S.bufferRing(ring,2),height_m:10,facades:[]}];
 assert.throws(()=>A.compile(output,row),/astra_part_outside_footprint/);
 const frame=S.frame(ring[0]),outer=[[0,0],[20,0],[20,20],[12,20],[12,10],[8,10],[8,20],[0,20],[0,0]].map(frame.fromLocal);
 const crossing=[[2,15],[18,15],[18,17],[2,17],[2,15]].map(frame.fromLocal);
 assert.equal(S.containsRing(outer,crossing),false);
 main.parts=[{ring,height_m:6,facades:main.facades.map(f=>({...f,grids:[]})),parts:[]}];
 assert.throws(()=>A.compile(output,row),/astra_part_limit/);
});
