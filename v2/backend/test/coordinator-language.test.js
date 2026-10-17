'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {resolve,parseText}=require('../src/coordinator-language');
const catalog=[
 {kind:'item',id:'shaw-cheese',code:'P111',name:'Сырная шаурма'},
 {kind:'item',id:'shaw-classic',code:'P112',name:'Классическая шаурма с сыром'},
 {kind:'ingredient',id:'ing-cheese',code:'I111',name:'Сыр'},
 {kind:'item',id:'coffee',code:'P201',name:'Капучино'},
 {kind:'item',id:'coffee2',code:'P202',name:'Капучино'}
];
test('Russian inflection resolves full item and never picks ingredient',()=>{
 const r=resolve('Убери сырную шаурму',catalog);
 assert.equal(r.type,'proposal');
 assert.equal(r.item.id,'shaw-cheese');
 assert.equal(r.command,'стоп лист');
});
test('Ingredient name cannot shadow a dish',()=>{
 const r=resolve('убери сыр',catalog);
 assert.notEqual(r.type,'proposal');
 assert.equal(r.type,'ambiguous');
});
test('Ambiguous identical menu names always require clarification',()=>{
 const r=resolve('Убери капучино',catalog);
 assert.equal(r.type,'ambiguous');
 assert.equal(r.items.length,2);
});
test('Exact code is unambiguous despite duplicate names',()=>{
 const r=resolve('P201 стоп лист',catalog);
 assert.equal(r.type,'proposal');
 assert.equal(r.item.id,'coffee');
});
test('Duration is never silently discarded',()=>{
 assert.equal(parseText('Убери сырную шаурму до завтра').type,'unsupported');
 assert.equal(resolve('Поставь сырную шаурму в стоп на два часа',catalog).type,'ambiguous');
});
test('Natural price command is previewed, not executed',()=>{
 const r=resolve('Установи цену на сырную шаурму 400',catalog);
 assert.equal(r.type,'proposal');
 assert.equal(r.command,'цена 400');
});
test('Unsupported and invented commands do not create a mutation',()=>{
 assert.equal(resolve('Убери случайный сырный бургер',catalog).type,'ambiguous');
 assert.equal(resolve('Выключи все кофейни',catalog).type,'ambiguous');
 assert.equal(resolve('Почисти всю базу',catalog).type,'unknown');
});
test('Search is read only',()=>{
 const r=resolve('Найди сырную шаурму',catalog);
 assert.equal(r.type,'found');
});
test('Different venue catalog cannot resolve a foreign code',()=>{
 const another=[{kind:'item',id:'p1',code:'P999',name:'Капучино'}];
 assert.equal(resolve('P111 стоп лист',another).type,'unknown');
});
