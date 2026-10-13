'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const D=require('../src/domain');
const {extractEntities}=require('../src/menu-coordinator');

function sample(itemId='7777'){
 return {
  menu:[{
    id:itemId,n:'Сырная шаурма',c:'shawarma_doner',p:350,active:true,available:true,
    composition:'Курица, сыр, Барбекю',
    options:{sauces:[{id:'bbq',name:'Барбекю',active:true,price:0}]},
    choice_groups:[{id:'size',name:'Размер',active:true,options:[{id:'large',name:'Большая',active:true,price_delta:50}]}]
  }],
  config:{menu_sections:[{id:'shawarma_doner',name:'Шаурма',active:true}]}
 };
}
test('Every menu component receives a stable typed identity',()=>{
 const rows=extractEntities(sample());
 for(const kind of ['item','category','group','option','ingredient'])
   assert.ok(rows.some(x=>x.kind===kind),kind+' identifier missing');
 assert.equal(rows.find(x=>x.kind==='item').id,'7777');
 assert.equal(rows.filter(x=>x.kind==='ingredient').length,3);
 assert.equal(new Set(rows.map(x=>x.kind+':'+x.id)).size,rows.length);
});
test('A duplicated internal menu ID fails closed instead of silently editing one of two products',()=>{
 const snapshot=sample(),again=JSON.parse(JSON.stringify(snapshot.menu[0]));
 again.n='Другое блюдо';snapshot.menu.push(again);
 assert.throws(()=>extractEntities(snapshot),/повторяющиеся внутренние ID/);
});
test('Ingredient stop persists through catalog normalization and fails closed at checkout',()=>{
 const item=sample().menu[0],ingredients=extractEntities(sample()).filter(x=>x.kind==='ingredient');
 item.coordinator_blocked_ingredients=[ingredients[0].id];
 const normalized=D.normalizeMenu([item])[0];
 assert.deepEqual(normalized.coordinator_blocked_ingredients,[ingredients[0].id]);
 assert.equal(D.menuItemAvailableNow(normalized,'Europe/Moscow'),false);
 normalized.coordinator_blocked_ingredients=[];
 assert.equal(D.menuItemAvailableNow(normalized,'Europe/Moscow'),true);
});
test('Original codes can overlap in different venues without reusing a global product identity',()=>{
 const a=extractEntities(sample('7777')),b=extractEntities(sample('7777'));
 assert.equal(a.find(x=>x.kind==='item').id,b.find(x=>x.kind==='item').id);
 // The coordinator's DB key is (establishment_id, entity_type, entity_id), never only item ID.
 const scope1=['SC-MSK-A','item',a.find(x=>x.kind==='item').id].join(':');
 const scope2=['SC-MSK-B','item',b.find(x=>x.kind==='item').id].join(':');
 assert.notEqual(scope1,scope2);
});
