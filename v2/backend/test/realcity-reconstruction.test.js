'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');

const R=require('../src/realcity-reconstruction');

test('photogrammetry package source strips to deterministic reconstruction fields',()=>{
  const p=R._internals.sourcePackage({
    id:'img-1',source:'wikimedia',source_id:'42',
    coordinates:[37.6,55.7],heading:123.4,fov:74,panoramic:false,
    captured_at:'2026-01-02T00:00:00Z',license:'CC BY-SA 4.0',
    attribution:'Example author',image_url:'https://upload.wikimedia.org/a.jpg',
    page_url:'https://commons.wikimedia.org/wiki/File:A.jpg',distance_m:31.2,
    match:{building_id:'osm-1',edge_index:2,distance_m:29.9,heading_error_deg:4.2,quality:.82},
    ignored_secret:'nope'
  });
  assert.equal(p.source,'wikimedia');
  assert.equal(p.match.building_id,'osm-1');
  assert.equal(p.match.edge_index,2);
  assert.equal(p.match.quality,.82);
  assert.equal(p.ignored_secret,undefined);
});

test('reconstruction revision changes when spatial truth changes',()=>{
  const marker={id:5,establishment_id:'SC-MSK-5E435A0F67',venue_id:'v',lon:37.8,lat:55.7};
  const profile={version:14,scene:{buildings:[{id:'b',ring:[[1,1],[2,1],[2,2],[1,1]],height:9}]}};
  const src=[{id:'x',source:'wikimedia',source_id:'1',coordinates:[37.8,55.7],heading:0,captured_at:null,license:'CC BY-SA 4.0'}];
  const a=R._internals.revision(marker,profile,src);
  const b=R._internals.revision(marker,{...profile,scene:{buildings:[{...profile.scene.buildings[0],height:12}]}},src);
  assert.match(a,/^[a-f0-9]{64}$/);
  assert.notEqual(a,b);
});

test('photoreal freshness is tied to RealCity profile version',()=>{
  const fresh={version:14,photoreal:{status:'ready',profile_version:14,generated_at:new Date().toISOString()}};
  assert.equal(R.shouldEnqueue(fresh),false);
  assert.equal(R.shouldEnqueue({...fresh,version:15}),true);
  assert.equal(R.shouldEnqueue({version:14}),true);
});
