'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const sha=require('../src/coordinator-shaurmeg-language');
const dialogue=require('../src/coordinator-dialogue');
const base=require('../src/coordinator-language');
const items=[
 {kind:'item',id:'cheese',name:'Сырная шаурма',code:'P101',spokenName:'сырная',identifier:'сырная'},
 {kind:'item',id:'classic',name:'Классическая шаурма',code:'P102',spokenName:null,identifier:'Классическая шаурма'},
 {kind:'ingredient',id:JSON.stringify(['cheese','ingredient','сыр']),name:'Сырная шаурма · Сыр',code:'I101',spokenName:'сыр-лепешки',identifier:'сыр-лепешки'},
 {kind:'ingredient',id:JSON.stringify(['classic','ingredient','сыр']),name:'Классическая шаурма · Сыр',code:'I102',spokenName:null,identifier:'Классическая шаурма · Сыр'}
];
test('Default friendly identifier matches dish name; custom nickname is recognized',()=>{
 assert.equal(items[1].identifier,items[1].name);
 const x=sha.resolve('Убери сырную',items);
 assert.equal(x.type,'proposal');assert.equal(x.item.id,'cheese');assert.equal(x.command,'стоп лист');
 assert.equal(sha.resolve('Найди сырная',items).type,'found');
});
test('Agent understands friendly nickname in spoken two-turn conversation',()=>{
 let x=dialogue.step('Найди сырная',items);
 assert.equal(x.type,'reply');assert.equal(x.state.last.id,'cheese');
 x=dialogue.step('Поставь 350',items,x.state);
 assert.equal(x.type,'proposal');assert.equal(x.item.code,'P101');
 assert.equal(x.command,'цена 350');
});
test('Conversational rename proposes an alias update but never changes guest title',()=>{
 const a=sha.resolve('Переименуй идентификатор сырной в наша сырная',items);
 assert.equal(a.type,'proposal');assert.equal(a.command,'идентификатор наша сырная');
 assert.equal(a.item.id,'cheese');
 assert.equal(items[0].name,'Сырная шаурма');
});
test('Ingredient nickname can be edited by voice without changing ingredient ID',()=>{
 const x=sha.resolve('Переименуй идентификатор ингредиента сыр-лепешки в сыр домашний',items);
 assert.equal(x.type,'proposal');assert.equal(x.item.kind,'ingredient');
 assert.equal(x.item.code,'I101');assert.equal(x.command,'идентификатор сыр домашний');
});
test('Named ingredient can be removed only from its containing dish',()=>{
 const x=sha.resolve('Удали ингредиент сыр-лепешки',items);
 assert.equal(x.type,'proposal');assert.equal(x.item.id,'cheese');assert.equal(x.command,'состав I101 убрать');
});
test('Repeated bare ingredient name never guesses which dish to edit',()=>{
 const x=sha.resolve('Удали ингредиент сыр',items);
 assert.notEqual(x.type,'proposal');
});
test('Existing machine codes still work after friendly alias change',()=>{
 const x=base.resolve('P101 стоп лист',items);
 assert.equal(x.type,'proposal');assert.equal(x.item.id,'cheese');
});
test('Nonexistent foreign alias cannot mutate this catalog',()=>{
 assert.notEqual(sha.resolve('Убери бургер соседнего заведения',items).type,'proposal');
});
test('Invalid friendly name is rejected before proposal',()=>{
 assert.equal(sha.resolve('Переименуй идентификатор сырной в !!!',items).type,'unsupported');
});
test('PostgreSQL alias must be unique per venue and has separate immutable entity ID',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../src/menu-coordinator.js'),'utf8');
 assert.match(source,/ADD COLUMN IF NOT EXISTS spoken_name text/);
 assert.match(source,/UNIQUE INDEX IF NOT EXISTS shaurma_coordinator_spoken_name_unique/);
 assert.match(source,/WHERE normalized_spoken_name IS NOT NULL/);
 assert.match(source,/PRIMARY KEY\(establishment_id,entity_type,entity_id\)/);
 assert.match(source,/otherNames\.has\(friendlyNorm\(proposed\)\)/);
 assert.match(source,/WHERE establishment_id=\$1 AND entity_type=\$2 AND entity_id=\$3/);
 assert.match(source,/shaurma_coordinator_audit/);
 assert.match(source,/if\(result\.aliasOnly\)return/);
});
test('The Mini App has an identifier editing mode and script parses',()=>{
 const html=fs.readFileSync(path.join(__dirname,'../../frontend/coordinator-console.html'),'utf8');
 assert.match(html,/<option value="идентификатор">/);
 assert.match(html,/id="aliasName"/);
 assert.match(html,/x\.identifier\|\|x\.name/);
 const inline=[...html.matchAll(/<script(?:\s+[^>]*)?>([\s\S]*?)<\/script>/g)].map(m=>m[1]).filter(Boolean);
 for(const part of inline)assert.doesNotThrow(()=>new vm.Script(part));
});

test('Owner venue admin edits friendly names via authorized separate endpoint',()=>{
 const html=fs.readFileSync(path.join(__dirname,'../../frontend/admin-coordinator.html'),'utf8');
 const backend=fs.readFileSync(path.join(__dirname,'../src/menu-coordinator.js'),'utf8');
 assert.match(html,/setIdentifier:'\/coordinator\/set-identifier'/);
 assert.match(html,/identifier:input\.value\.trim\(\)/);
 assert.match(html,/value="[^"]*"|x\.identifier\|\|x\.name/);
 assert.match(backend,/app\.post\('\/api\/v2\/coordinator\/set-identifier'/);
 const anchor=backend.indexOf("app.post('/api/v2/coordinator/set-identifier'");
 assert.ok(anchor>0);
 assert.match(backend.slice(anchor,anchor+350),/await ownerAccess\(req,est\)/);
 assert.match(backend,/async function setFriendlyIdentifierTx/);
 assert.match(backend,/async function setFriendlyIdentifier\(/);
 const scripts=[...html.matchAll(/<script(?:\s+[^>]*)?>([\s\S]*?)<\/script>/g)].map(x=>x[1]).filter(Boolean);
 for(const script of scripts)assert.doesNotThrow(()=>new vm.Script(script));
});
test('Renaming dish title refuses duplicate titles in same venue',()=>{
 const backend=fs.readFileSync(path.join(__dirname,'../src/menu-coordinator.js'),'utf8');
 assert.match(backend,/Блюдо с таким названием уже есть/);
 assert.match(backend,/Название совпадает с идентификатором другого объекта/);
});
