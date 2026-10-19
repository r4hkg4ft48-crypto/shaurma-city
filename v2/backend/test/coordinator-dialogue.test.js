'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const dialog=require('../src/coordinator-dialogue');
const catalog=[
 {kind:'item',id:'cheeseA',code:'P111',name:'Сырная шаурма'},
 {kind:'item',id:'cheeseB',code:'P112',name:'Сырная шаурма большая'},
 {kind:'item',id:'classic',code:'P113',name:'Классическая шаурма'},
 {kind:'item',id:'burger',code:'P211',name:'Бургер'},
 {kind:'ingredient',id:'ingredient-cheese',code:'I111',name:'Сыр'}
];
test('Local agent greets and states its finite capabilities',()=>{
 let r=dialog.step('Привет',catalog);
 assert.equal(r.type,'reply');
 assert.match(r.text,/локальный/);
 r=dialog.step('Что ты умеешь?',catalog);
 assert.match(r.text,/стоп-листе/);
});
test('Partial dish name forces clarification, numeric answer resolves exact immutable identity',()=>{
 const r=dialog.step('Убери сырную',catalog);
 assert.equal(r.type,'clarify');
 assert.equal(r.state.wait.mode,'choose');
 assert.equal(r.state.wait.options.length,2);
 const second=dialog.step('вторую',catalog,r.state);
 assert.equal(second.type,'proposal');
 assert.equal(second.item.id,'cheeseB');
 assert.equal(second.item.code,'P112');
 assert.equal(second.command,'стоп лист');
});
test('Selected dish supports safe contextual follow-up on same exact catalog identity',()=>{
 const r=dialog.step('Найди классическую шаурму',catalog);
 assert.equal(r.type,'reply');
 const set=dialog.step('Поставь 400',catalog,r.state);
 assert.equal(set.type,'proposal');
 assert.equal(set.item.id,'classic');
 assert.equal(set.command,'цена 400');
 const stop=dialog.step('Убери её',catalog,set.state);
 assert.equal(stop.type,'proposal');
 assert.equal(stop.item.id,'classic');
 assert.equal(stop.command,'стоп лист');
});
test('No context => ask for dish rather than guessing price update',()=>{
 const r=dialog.step('Поставь цену 350',catalog);
 assert.equal(r.type,'clarify');
 assert.equal(r.state.wait.mode,'target');
 const second=dialog.step('Бургер',catalog,r.state);
 assert.equal(second.type,'proposal');
 assert.equal(second.command,'цена 350');
 assert.equal(second.item.id,'burger');
});
test('Info can be requested about a dish and answered after clarification',()=>{
 const r=dialog.step('Сколько стоит сырная?',catalog);
 assert.equal(r.type,'clarify');
 const second=dialog.step('2',catalog,r.state);
 assert.equal(second.type,'info');
 assert.equal(second.topic,'price');
 assert.equal(second.item.id,'cheeseB');
});
test('Reports use menu-specific topics and never fabricate figures in the parser',()=>{
 for(const [input,topic] of [['Сколько блюд в меню?','menu'],['Что в стоп-листе?','stopped'],['Что изменилось?','audit']]){
  const r=dialog.step(input,catalog);
  assert.equal(r.type,'report');
  assert.equal(r.topic,topic);
  assert.equal(r.text,undefined);
 }
});
test('Old context cannot resolve deleted or remapped item',()=>{
 const first=dialog.step('Найди классическую шаурму',catalog);
 const changed=catalog.filter(x=>x.id!=='classic');
 const r=dialog.step('Поставь 350',changed,first.state);
 assert.notEqual(r.type,'proposal');
});
test('Memory resets on cancel and cannot cross an establishment with a different item set',()=>{
 const first=dialog.step('Найди классическую шаурму',catalog);
 assert.ok(first.state.last);
 const reset=dialog.step('Сброс',catalog,first.state);
 assert.deepEqual(reset.state,dialog.fresh());
 const other=[{kind:'item',id:'other',name:'Классическая шаурма',code:'P700'}];
 const r=dialog.step('Поставь 350',other,first.state);
 assert.notEqual(r.type,'proposal');
});
test('Ambiguous matches never execute an incorrect ingredient or dish',()=>{
 const r=dialog.step('Убери сыр',catalog);
 assert.notEqual(r.type,'proposal');
 const other=dialog.step('Убери сырную',catalog);
 const wrong=dialog.step('1000',catalog,other.state);
 assert.notEqual(wrong.type,'proposal');
});
test('Reports and low-context casual phrases do not create writes',()=>{
 assert.equal(dialog.step('Спасибо',catalog).type,'reply');
 assert.equal(dialog.step('Что ты сделал?',catalog).type,'report');
 assert.equal(dialog.step('Верни',catalog).type,'clarify');
});
test('Dangerous time-limited commands remain unsupported',()=>{
 const r=dialog.step('Убери сырную шаурму до завтра',catalog);
 assert.notEqual(r.type,'proposal');
 assert.match(r.text,/Временные команды/);
});
