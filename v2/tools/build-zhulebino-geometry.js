'use strict';
// Reproducible extraction; no photograph or generated appearance enters .scene.
// Usage: node v2/tools/build-zhulebino-geometry.js profile.json tile.pbf output.json
const fs=require('fs'),{VectorTile}=require('../backend/node_modules/@mapbox/vector-tile'),Pbf=require('../backend/node_modules/pbf');
const S=require('../frontend/realcity-spatial'),[profileFile,tileFile,out]=process.argv.slice(2);
const profile=JSON.parse(fs.readFileSync(profileFile)),tile=new VectorTile(new Pbf(fs.readFileSync(tileFile)));
const point=[37.852223461867,55.68545543282221],frame=S.frame(point),roads=[],greens=[],entrances=[];
const near=coordinates=>coordinates.some(p=>Math.hypot(...frame.toLocal(p))<280);
for(const name of ['transportation','landcover','landuse','poi']){
  const layer=tile.layers[name];if(!layer)continue;
  for(let i=0;i<layer.length;i++){
    const f=layer.feature(i).toGeoJSON(9914,5127,14),g=f.geometry,p=f.properties;
    if(name==='transportation'&&['minor','tertiary','secondary','primary','service','path'].includes(p.class)&&!p.brunnel){
      for(const line of g.type==='LineString'?[g.coordinates]:g.type==='MultiLineString'?g.coordinates:[])if(near(line))roads.push({coordinates:line,class:p.class,subclass:p.subclass||''});
    }
    if(['landcover','landuse'].includes(name)&&['grass','wood','park','garden','recreation_ground'].includes(p.class)){
      for(const polygon of g.type==='Polygon'?[g.coordinates]:g.type==='MultiPolygon'?g.coordinates:[])if(near(polygon[0]))greens.push(polygon[0]);
    }
    if(name==='poi'&&p.subclass==='subway_entrance'&&g.type==='Point'&&Math.hypot(...frame.toLocal(g.coordinates))<280)entrances.push(g.coordinates);
  }
}
const scene={...profile.scene,radius_m:244,roads:roads.map(x=>x.coordinates),greens,trees:[]};
fs.mkdirSync(require('path').dirname(out),{recursive:true});
fs.writeFileSync(out,JSON.stringify({source:{provider:'OpenFreeMap / OpenStreetMap contributors',license:'ODbL-1.0',tile:'planet/20260913_164504_pt/14/9914/5127.pbf',retrieved:'2026-09-27'},scene,roads,entrances},null,2)+'\n');
console.log({buildings:scene.buildings.length,roads:roads.length,greens:greens.length,entrances:entrances.length});
