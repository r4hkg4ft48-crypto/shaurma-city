'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const sha=require('../src/coordinator-shaurmeg-language');
const catalog=[
 {kind:'item',id:'cheese-shawarma',code:'P111',name:'Сырная шаурма'},
 {kind:'item',id:'classic-shawarma',code:'P112',name:'Классическая шаурма'},
 {kind:'item',id:'classic-shawarma2',code:'P113',name:'Классическая шаурма'},
 {kind:'item',id:'burger',code:'P221',name:'Бургер'},
 {kind:'ingredient',id:JSON.stringify(['cheese-shawarma','ingredient','сыр']),code:'I101',name:'Сырная шаурма · Сыр'},
 {kind:'ingredient',id:JSON.stringify(['classic-shawarma','ingredient','сыр']),code:'I102',name:'Классическая шаурма · Сыр'},
 {kind:'category',id:'cat1',code:'C101',name:'Напитки'},
 {kind:'group',id:'group1',code:'G101',name:'Бургер · добавки'}
];
const proposal=(text)=>sha.resolve(text,catalog);
test('Shaurmeg dish can be renamed by normal Russian speech',()=>{
 const r=proposal('Переименуй сырную шаурму в Сырная шаурма XL');
 assert.equal(r.type,'proposal');assert.equal(r.item.id,'cheese-shawarma');
 assert.equal(r.command,'название Сырная шаурма XL');
});
test('Natural recipe adds ingredient only to matched dish',()=>{
 const r=proposal('Добавь халапеньо в сырную шаурму');
 assert.equal(r.type,'proposal');assert.equal(r.item.code,'P111');
 assert.equal(r.command,'состав + халапеньо');
});
test('Ingredient removal resolves the code owned by that very dish',()=>{
 const r=proposal('Убери сыр из сырной шаурмы');
 assert.equal(r.type,'proposal');assert.equal(r.item.code,'P111');
 assert.equal(r.command,'состав I101 убрать');
});
test('Duplicate dish titles fail closed, never pick arbitrary dish',()=>{
 const r=proposal('Добавь халапеньо в классическую шаурму');
 assert.equal(r.type,'ambiguous');assert.equal(r.items.length,2);
});
test('Foreign ingredient cannot be removed by a dish command',()=>{
 const r=proposal('Убери сыр из бургера');
 assert.equal(r.type,'ambiguous');assert.notEqual(r.type,'proposal');
});
test('Existing search and sale actions still work',()=>{
 assert.equal(proposal('Найди сырную шаурму').type,'found');
 assert.equal(proposal('Убери сырную шаурму').command,'стоп лист');
});
test('Category stop operation cannot stop an identically named item',()=>{
 const r=proposal('Отключи раздел Напитки');
 assert.equal(r.type,'proposal');assert.equal(r.item.kind,'category');assert.equal(r.command,'стоп лист');
});
test('Full composition replacement preserves punctuation and exact target',()=>{
 const r=proposal('Замени состав сырной шаурмы на курица, помидор, сыр');
 assert.equal(r.type,'proposal');assert.equal(r.command,'состав = курица, помидор, сыр');
});
test('Description and visibility changes use the legacy executor',()=>{
 assert.equal(proposal('Измени описание сырной шаурмы на Без лука').command,'описание Без лука');
 assert.equal(proposal('Скрой сырную шаурму').command,'скрыть');
 assert.equal(proposal('Покажи в меню сырную шаурму').command,'показать');
});
test('Unsupported timing is still rejected',()=>{
 assert.equal(proposal('Убери сырную шаурму до завтра').type,'unsupported');
});
test('Separate menu rejects a foreign dish',()=>{
 const other=[{kind:'item',id:'myitem',code:'P999',name:'Шаурма другая'}];
 assert.notEqual(sha.resolve('Добавь сыр в сырную шаурму',other).type,'proposal');
});
