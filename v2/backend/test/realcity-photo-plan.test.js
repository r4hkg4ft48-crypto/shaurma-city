'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const Plan=require('../../../backend/realcity-shot-plan');
test('guided RealCity plan covers thirty unique real vantage points in four groups',()=>{
 assert.equal(Plan.slots.length,30);
 assert.deepEqual(Plan.groups.map(g=>Plan.slots.filter(s=>s.group===g.id).length),[12,6,6,6]);
 assert.equal(new Set(Plan.slots.map(x=>x.id)).size,30);
 assert.equal(Plan.get('RC09').subject,'hero_entrance');
 for(const s of Plan.slots){
  assert.match(s.id,/^RC(?:0[1-9]|[12][0-9]|30)$/);
  assert.ok(s.position&&s.focus&&s.category&&s.subtype);
  assert.ok(s.links.length);
  for(const id of s.links)assert.ok(Plan.get(id),'missing linked frame '+id);
 }
});
test('photo assignments carry explicit scene objects, cross-view links and missing slots',()=>{
 const a=Plan.describe([{id:'photo-front',shot_id:'RC01'},{id:'photo-left',shot_id:'RC02'},{id:'old',shot_id:null}]);
 assert.equal(a.expected,30);assert.equal(a.filled,2);
 assert.equal(a.missing.length,28);
 assert.equal(a.slots[0].asset_id,'photo-front');
 assert.ok(a.links.some(x=>x.from==='RC01'&&x.to==='RC02'));
 assert.equal(a.geometry_verified,false);
 const b=Plan.describe([{id:'a',shot_id:'RC01'},{id:'b',shot_id:'RC01'}]);
 assert.deepEqual(b.duplicate_slots,['RC01']);
 assert.equal(b.filled,1);
});
test('RealCity master and guided upload client parse, remain integrated with Astra without touching Pro',()=>{
 const root=path.join(__dirname,'../../../backend');
 const master=fs.readFileSync(path.join(root,'master-admin.html'),'utf8');
 const guide=fs.readFileSync(path.join(root,'realcity-photo-guide.js'),'utf8');
 const plan=fs.readFileSync(path.join(root,'realcity-shot-plan.js'),'utf8');
 const studio=fs.readFileSync(path.join(__dirname,'../src/realcity-studio.js'),'utf8');
 const server=fs.readFileSync(path.join(root,'server.js'),'utf8');
 const inline=master.match(/<script>\s*([\s\S]*?)<\/script>/);
 assert.ok(inline);
 assert.doesNotThrow(()=>new vm.Script(inline[1]));
 assert.doesNotThrow(()=>new vm.Script(guide));
 assert.doesNotThrow(()=>new vm.Script(plan));
 assert.match(master,/id="rcGuideSlots"/);
 assert.match(master,/RealCityPhotoGuide\?\.render\(\)/);
 assert.match(master,/realcity-shot-plan\.js/);
 assert.match(studio,/photo_shot_already_filled/);
 assert.match(studio,/ShotPlan\.get\(req\.query\.shot_id\)/);
 assert.match(server,/shot_plan:RealCityShotPlan\.describe\(assets\)/);
 assert.match(server,/shot_id:shot\?\.id\|\|null/);
 assert.match(master,/id="proFrame"/);
});
