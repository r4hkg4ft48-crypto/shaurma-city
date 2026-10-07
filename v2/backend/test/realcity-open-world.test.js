'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const sharp=require('sharp');
const O=require('../src/realcity-open-world');
const S=require('../../frontend/realcity-spatial');

const marker={id:'17',establishment_id:'SC-MSK-5E435A0F67',venue_id:'lepyoshka',lat:55,lon:37};
const heroRing=[[36.9999,54.99995],[37.0001,54.99995],[37.0001,55.00005],[36.9999,55.00005],[36.9999,54.99995]];
const neighborRing=[[37.00018,54.99996],[37.00031,54.99996],[37.00031,55.00005],[37.00018,55.00005],[37.00018,54.99996]];
const scene={
  radius_m:190,hero_building_id:'hero',
  buildings:[
    {id:'hero',ring:heroRing,height:18,base_m:0,levels:6,distance:0,role:'hero',style:'brick_midrise',palette:{wall:'#b58f78',accent:'#765747',windows:'#29343d',roof:'#9d8879'}},
    {id:'neighbor',ring:neighborRing,height:12,base_m:0,levels:4,distance:18,role:'nearby',style:'mixed_residential',palette:{wall:'#c6c2b8',accent:'#99958c',windows:'#36434a',roof:'#aaa8a0'}}
  ],
  trees:[{lon:37.00032,lat:55.00008,source:'osm'}],
  roads:[[[36.9997,54.9998],[37.0004,54.9998]]],
  greens:[[[37.00025,55.00008],[37.00035,55.00008],[37.00035,55.00014],[37.00025,55.00014],[37.00025,55.00008]]]
};

test('open-world compiler preserves exact map geometry and target binding',()=>{
  const obs=[{
    reference_id:'panoramax:p1',building_id:'hero',edge_index:0,quality:.82,
    analysis:{wall:'#a97962',accent:'#745041',windows:'#28353c',material:'brick',col_peaks:5,row_peaks:5,storefront_score:.42,balcony_score:.51,facade_likelihood:.9}
  }];
  const refs=[{id:'panoramax:p1',source:'panoramax',source_id:'p1',license:'CC BY-SA 4.0',attribution:'Panoramax contributor',page_url:'https://example.org/p1'}];
  const model=O.compileModel(marker,scene,obs,refs);
  assert.equal(model.version,2);
  assert.equal(model.status,'ready');
  assert.equal(model.target.marker_id,'17');
  assert.equal(model.target.establishment_id,marker.establishment_id);
  assert.equal(model.target.venue_id,marker.venue_id);
  assert.ok(S.bound(model,marker,scene));
  const hero=model.buildings.find(x=>x.building_id==='hero');
  assert.equal(hero.geometry_key,S.geometryKey(heroRing));
  assert.equal(hero.facades[0].evidence,'observed');
  assert.deepEqual(hero.facades[0].reference_ids,['panoramax:p1']);
  assert.ok(hero.facades[0].modules.some(x=>x.kind==='window'));
  assert.ok(hero.facades[0].modules.some(x=>x.kind==='entrance'));
});

test('generated facade modules never escape their map edge or building height',()=>{
  const model=O.compileModel(marker,scene,[],[]);
  assert.equal(model.reconstruction.mode,'constrained_generated_facades');
  for(const building of model.buildings){
    const base=scene.buildings.find(x=>String(x.id)===building.building_id);
    const edges=S.edges(base.ring,[marker.lon,marker.lat]);
    for(const facade of building.facades){
      const edge=edges[facade.edge_index];
      for(const m of facade.modules){
        assert.ok(m.u_m>=0);
        assert.ok(m.z_m>=building.base_m-.001);
        assert.ok(m.u_m+m.width_m<=edge.length+.01);
        assert.ok(m.z_m+m.height_m<=building.height_m+.01);
      }
    }
  }
});

test('street observation is matched to a concrete building edge',()=>{
  const candidate={source:'panoramax',id:'p1',coordinates:[37,54.99978],heading:0};
  const analysis={facade_likelihood:.9,wall:'#b58f78',accent:'#765747',windows:'#29343d',material:'brick'};
  const hit=O.nearestAssignment(candidate,analysis,scene);
  assert.ok(hit);
  assert.equal(hit.building.id,'hero');
  assert.ok(Number.isInteger(hit.edge.index));
  assert.ok(hit.quality>0);
});


test('derived open image becomes a bounded facade material on exactly one edge',async()=>{
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="900" height="560">
    <rect width="900" height="560" fill="#b4775f"/>
    <rect y="430" width="900" height="130" fill="#33383a"/>
    <g fill="#263844" stroke="#e0d4c5" stroke-width="11">
      <rect x="90" y="85" width="130" height="110"/><rect x="385" y="85" width="130" height="110"/><rect x="680" y="85" width="130" height="110"/>
      <rect x="90" y="250" width="130" height="110"/><rect x="385" y="250" width="130" height="110"/><rect x="680" y="250" width="130" height="110"/>
    </g>
  </svg>`;
  const buffer=await sharp(Buffer.from(svg)).jpeg({quality:92}).toBuffer();
  const candidate={source:'panoramax',id:'p-texture',coordinates:[37,54.99978],heading:0,fov:78,panoramic:false,license:'etalab-2.0',attribution:'Panoramax test'};
  const analysis=await O.analyzeImage(buffer),hit=O.nearestAssignment(candidate,analysis,scene);
  assert.ok(hit);
  const material=await O.buildFacadeMaterial(buffer,candidate,hit,'panoramax:p-texture');
  assert.ok(material);
  assert.equal(material.mode,'facade');
  assert.match(material.data_url,/^data:image\/webp;base64,/);
  assert.ok(material.width<=640);
  assert.ok(material.height>=300&&material.height<=960);

  const obs=[{reference_id:'panoramax:p-texture',building_id:String(hit.building.id),edge_index:hit.edge.index,quality:.82,analysis,material_id:material.id,material}];
  const refs=[{id:'panoramax:p-texture',source:'panoramax',source_id:'p-texture',license:'etalab-2.0',attribution:'Panoramax test',page_url:'https://api.panoramax.xyz/'}];
  const model=O.compileModel(marker,scene,obs,refs);
  assert.equal(model.materials.length,1);
  const facade=model.buildings.find(x=>x.building_id===String(hit.building.id)).facades.find(x=>x.edge_index===hit.edge.index);
  assert.equal(facade.material_id,material.id);
  assert.equal(facade.evidence,'observed');
  assert.equal(facade.modules.length,0);
});


test('licensed Commons imagery may become a bounded facade derivative',async()=>{
  assert.equal(O._internals.canPersistAdaptation({source:'wikimedia',license:'CC BY-SA 4.0'}),true);
  assert.equal(O._internals.canPersistAdaptation({source:'wikimedia',license:'All Rights Reserved'}),false);
  const candidate={source:'wikimedia',id:'commons-1',coordinates:[37,54.99978],heading:null,fov:78,panoramic:false,license:'CC BY-SA 4.0',attribution:'Commons test'};
  const analysis={facade_likelihood:.9,wall:'#b77f62',accent:'#6f5144',windows:'#263944',material:'brick',row_peaks:5,col_peaks:3,storefront_score:.3,balcony_score:.1};
  const hit=O.nearestAssignment(candidate,analysis,scene);
  assert.ok(hit);
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="900" height="560"><rect width="900" height="560" fill="#b4775f"/><g fill="#263844"><rect x="100" y="100" width="160" height="120"/><rect x="370" y="100" width="160" height="120"/><rect x="640" y="100" width="160" height="120"/></g></svg>`;
  const buffer=await sharp(Buffer.from(svg)).jpeg({quality:92}).toBuffer();
  const material=await O.buildFacadeMaterial(buffer,candidate,hit,'wikimedia:commons-1');
  assert.ok(material);
  assert.match(material.data_url,/^data:image\/webp;base64,/);
  assert.equal(material.license,'CC BY-SA 4.0');
});


test('Wikimedia candidate preserves an original-image fallback for reconstruction',()=>{
  const candidate=O._internals.candidateBase(
    'wikimedia','commons-42',[37,55],
    'https://thumb.wikimedia.org/wikipedia/commons/thumb/a/a0/example.jpg/1600px-example.jpg',
    'https://commons.wikimedia.org/wiki/File:Example.jpg',
    {fallback_image_url:'https://upload.wikimedia.org/wikipedia/commons/a/a0/example.jpg',license:'CC BY-SA 4.0'}
  );
  assert.equal(candidate.image_url.includes('thumb.wikimedia.org'),true);
  assert.equal(candidate.fallback_image_url,'https://upload.wikimedia.org/wikipedia/commons/a/a0/example.jpg');
  assert.equal(O._internals.canPersistAdaptation(candidate),true);
});


test('environment v17 refreshes roads independently while preserving saved building anchors',()=>{
  const A=require('../src/realcity-analyzer');
  assert.equal(A.PROFILE_VERSION,17);
  const saved={
    radius_m:190,hero_building_id:'hero',
    buildings:[{id:'hero',ring:[[37,55],[37.0001,55],[37.0001,55.0001],[37,55.0001],[37,55]],height:18}],
    roads:[],greens:[],trees:[]
  };
  const fresh={
    radius_m:190,hero_building_id:'fresh-hero',
    buildings:[{id:'other'}],
    roads:[[[37,55],[37.001,55.001]]],
    sidewalks:[[[37,55.0001],[37.001,55.0001]]],
    greens:[[[37,55],[37.0002,55],[37.0002,55.0002],[37,55]]],
    trees:[{lon:37.0001,lat:55.0001,source:'osm'}],
    barriers:[{kind:'fence',coordinates:[[37,55],[37.0001,55]]}],
    street_objects:[{kind:'street_lamp',lon:37.0001,lat:55.0001,source:'osm'}],
    environment_revision:3
  };
  const merged=A._internals.mergeFreshEnvironment(saved,fresh);
  assert.deepEqual(merged.buildings,saved.buildings);
  assert.equal(merged.hero_building_id,'hero');
  assert.deepEqual(merged.roads,fresh.roads);
  assert.deepEqual(merged.sidewalks,fresh.sidewalks);
  assert.deepEqual(merged.greens,fresh.greens);
  assert.deepEqual(merged.barriers,fresh.barriers);
  assert.deepEqual(merged.street_objects,fresh.street_objects);
  assert.equal(merged.environment_revision,3);
});

test('photoreal map keeps real environment visible instead of blanking it',()=>{
  const fs=require('node:fs'),path=require('node:path');
  const src=fs.readFileSync(path.join(__dirname,'../../frontend/map.js'),'utf8');
  assert.doesNotMatch(src,/features:photoreal\?\[\]:data\.greens/);
  assert.doesNotMatch(src,/features:photoreal\?\[\]:data\.roads/);
  assert.match(src,/realcity-barriers/);
  assert.match(src,/visibleTrees=photoreal\?data\.trees\.filter/);
  assert.match(src,/fill-opacity',photoreal\?\.18/);
});


test('OpenFreeMap environment fallback survives Overpass outages by contract',()=>{
  const fs=require('node:fs'),path=require('node:path');
  const A=require('../src/realcity-analyzer');
  const src=fs.readFileSync(path.join(__dirname,'../src/realcity-analyzer.js'),'utf8');
  assert.equal(typeof A.fetchVectorEnvironment,'function');
  assert.deepEqual(A._internals.geoLines({type:'LineString',coordinates:[[37,55],[37.1,55.1]]}),[[[37,55],[37.1,55.1]]]);
  assert.match(src,/tile\.layers\?\.transportation/);
  assert.match(src,/collectGreen\('park'/);
  assert.match(src,/collectGreen\('landcover'/);
  assert.match(src,/fetchVectorEnvironment\(marker,radius\)/);
  assert.match(src,/Overpass outage can no longer erase roads\/greens/);
  assert.match(src,/constrained-green-density/);
  assert.doesNotMatch(src,/source:'procedural-density'/);
});
