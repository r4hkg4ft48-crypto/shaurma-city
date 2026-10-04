'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),sharp=require('sharp');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const P=require('../src/realcity-photo'),A=require('../src/realcity-astra'),S=require('../../frontend/realcity-spatial');
const square=[[0,0],[1,0],[1,1],[0,1]];
const image=async color=>sharp({create:{width:256,height:128,channels:3,background:color}}).png().toBuffer();
const spec={id:'facade',width_m:4,height_m:2,pixels_per_m:64,sharpen:0,views:[{source_asset_id:'front',source_quad:square}]};
function fixture(){
 const ring=[[37.8,55.68],[37.8004,55.68],[37.8004,55.6802],[37.8,55.6802],[37.8,55.68]];
 const row={id:'3139',establishment_id:'SC-MSK-9342972B1F',venue_id:'b5fe327852468ac7',lon:37.8002,lat:55.67999,realcity_astra_assets:[{id:'front',src:'private'},{id:'alternate',src:'private'}],realcity_astra_config:{},realcity_profile:{scene:{hero_building_id:'hero',buildings:[{id:'hero',ring,height:12,role:'hero',palette:{wall:'#888888'}}]}}};
 const output={version:2,target:{marker_id:row.id,establishment_id:row.establishment_id,venue_id:row.venue_id,coordinates:[row.lon,row.lat]},buildings:[{building_id:'hero',geometry_key:S.geometryKey(ring),height_m:12,facades:[{edge_index:0,edge:[ring[0],ring[1]],evidence:'observed',reference_ids:['front','alternate'],surfaces:[{material_id:'facade',u_m:1,z_m:1,width_m:4,height_m:2,confirmed:true,flip_u:false,openings:[{u_m:1,z_m:.4,width_m:.8,height_m:1,depth_m:.15,glass:true}]}]}]}]};
 return {row,output};
}
test('original inspection preserves byte identity, orientation and reports screening limits',async()=>{
 const original=await sharp({create:{width:80,height:160,channels:3,background:'#888888'}}).withMetadata({orientation:6}).jpeg().toBuffer();
 const before=Buffer.from(original),q=await P.inspect(original);
 assert.deepEqual(original,before);assert.equal(q.sha256,P.hash(original));assert.equal(q.metadata.width,160);assert.equal(q.metadata.height,80);
 assert.ok(q.metadata.has_exif);assert.ok(q.metadata.warnings.includes('low_resolution'));assert.ok(q.metadata.warnings.includes('check_focus'));
 await assert.rejects(()=>P.inspect(Buffer.from('invalid')),/photo_decode_failed/);
});
test('crossed, concave and degenerate facade quads are rejected before sampling',()=>{
 for(const q of [[[0,0],[1,1],[1,0],[0,1]],[[0,0],[1,0],[.1,.1],[0,1]],[[0,0],[.2,0],[.4,0],[.6,0]]])assert.throws(()=>P.quad(q));
 assert.equal(P.quad(square).length,9);
});
test('rectification preserves individual image sides and limits resolution to measured source',async()=>{
 const raw=Buffer.alloc(256*128*3);for(let y=0;y<128;y++)for(let x=0;x<256;x++){const i=(y*256+x)*3;raw[i]=x<128?230:15;raw[i+2]=x<128?15:230;}
 const original=await sharp(raw,{raw:{width:256,height:128,channels:3}}).png().toBuffer();
 const m=await P.buildMaterial({...spec,pixels_per_m:200},async()=>original);
 assert.ok(m.width<=256&&m.height<=128);assert.ok(m.quality.warnings.includes('source_resolution_limited'));
 const decoded=await sharp(Buffer.from(m.data_url.split(',')[1],'base64')).removeAlpha().raw().toBuffer({resolveWithObject:true});
 assert.ok(decoded.data[(30*decoded.info.width+20)*3]>180);assert.ok(decoded.data[(30*decoded.info.width+decoded.info.width-20)*3+2]>180);
 const reused=await P.buildMaterial({...spec,pixels_per_m:200},async()=>original,m);assert.equal(reused.cache_hit,true);assert.equal(reused.data_url,m.data_url);
 const changed=await P.buildMaterial({...spec,pixels_per_m:200},async()=>image('#00ff00'),m);assert.notEqual(changed.build_key,m.build_key);
});
test('masked occlusion uses the registered alternate, with remaining gaps explicitly reported',async()=>{
 const red=await image('#ff0000'),blue=await image('#0000ff'),exclude=[[[0,0],[.5,0],[.5,1],[0,1]]];
 const recipe={...spec,views:[{...spec.views[0],exclude},{source_asset_id:'alternate',source_quad:square}]};
 const m=await P.buildMaterial(recipe,async id=>id==='front'?red:blue);
 assert.equal(m.quality.missing_fraction,0);assert.ok(m.quality.source_pixels.every(n=>n>0));
 const data=await sharp(Buffer.from(m.data_url.split(',')[1],'base64')).ensureAlpha().raw().toBuffer();
 assert.ok(data[2]>200);assert.ok(data[(m.width-1)*4]>200);
 const incomplete=await P.buildMaterial({...recipe,views:recipe.views.slice(0,1)},async()=>red);
 assert.ok(incomplete.quality.missing_fraction>.4);assert.ok(incomplete.quality.warnings.includes('occluded_pixels_unfilled'));
});
test('photo surfaces retain exact building identity, evidence, direction and recess bounds',async()=>{
 const m=await P.buildMaterial(spec,async()=>image('#cabbaa')),{row,output}=fixture();output.materials=[m];
 const compiled=A.compile(output,row);assert.equal(compiled.materials[0].mode,'facade');assert.equal(compiled.buildings[0].facades[0].surfaces[0].openings[0].depth_m,.15);assert.ok(S.bound(compiled,row,row.realcity_profile.scene));
 for(const edit of [s=>delete s.flip_u,s=>s.confirmed=false,s=>s.u_m=999,s=>s.openings[0].u_m=4,s=>s.openings[0].depth_m=-1]){
  const invalid=structuredClone(output);edit(invalid.buildings[0].facades[0].surfaces[0]);assert.throws(()=>A.compile(invalid,row),/astra_/);
 }
 const unrelated=structuredClone(output);unrelated.buildings[0].facades[0].reference_ids=['alternate'];assert.throws(()=>A.compile(unrelated,row),/surface_evidence/);
 const overlap=structuredClone(output);overlap.buildings[0].facades[0].surfaces.push(overlap.buildings[0].facades[0].surfaces[0]);assert.throws(()=>A.compile(overlap,row),/overlapping/);
});
test('mesh cuts windows out of photo surfaces and keeps atlas UV orientation under polygon winding',async()=>{
 const {row,output}=fixture();output.materials=[await P.buildMaterial(spec,async()=>image('#998877'))];
 const astra=A.compile(output,row),context={RealCitySpatial:S,earcut:require('../../frontend/vendor/earcut.min.js'),Float32Array};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../../frontend/realcity-layer.js'),'utf8'),context);
 const slot={u0:.1,u1:.9,v0:.2,v1:.8,texture:20,oriented:true},atlas={slots:new Map([['facade',slot]])};
 const mesh=context.RealCityLayer.buildMesh(row,row.realcity_profile.scene,astra,atlas);assert.ok(mesh.vertices.every(Number.isFinite));
 const kinds=[];for(let i=11;i<mesh.vertices.length;i+=14)kinds.push(mesh.vertices[i]);assert.ok(kinds.includes(20));assert.ok(kinds.includes(40));
 const rects=context.RealCityLayer.subtractRectangles([0,0,10,10],[[2,2,2,3],[6,6,3,2]]);assert.equal(rects.reduce((n,p)=>n+p[2]*p[3],0),88);
 // At equal world vertices a flip must reverse U, not the edge coordinates.
 astra.buildings[0].facades[0].surfaces[0].flip_u=true;const flipped=context.RealCityLayer.buildMesh(row,row.realcity_profile.scene,astra,atlas);
 for(let i=0;i<mesh.vertices.length;i+=14){assert.deepEqual(Array.from(mesh.vertices.slice(i,i+3)),Array.from(flipped.vertices.slice(i,i+3)));if(mesh.vertices[i+11]>=20)assert.ok(Math.abs(mesh.vertices[i+9]+flipped.vertices[i+9]-1)<1e-6);}
});
module.exports={fixture,spec,image};
