'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const sha=require('../src/coordinator-shaurmeg-language');
const agent=require('../src/coordinator-dialogue');
const sample=[
 {kind:'item',id:'dish1',code:'P001',name:'Сырная шаурма',price:320},
 {kind:'ingredient',id:JSON.stringify(['dish1','ingredient','сыр']),code:'I001',name:'Сырная шаурма · сыр'},
 {kind:'item',id:'dish2',code:'P002',name:'Классическая шаурма',price:290},
 {kind:'ingredient',id:JSON.stringify(['dish2','ingredient','сыр']),code:'I002',name:'Классическая шаурма · сыр'},
 {kind:'category',id:'cat1',code:'C001',name:'Шаурма'},
 {kind:'group',id:JSON.stringify(['dish1','choice','options']),code:'G001',name:'Сырная шаурма · варианты'},
 {kind:'option',id:JSON.stringify(['dish1','choice','options','x']),code:'O001',name:'Сырная шаурма · сыр'}
];
const prop=x=>assert.equal(x.type,'proposal',JSON.stringify(x));
test('Remove ingredient does not accidentally disable whole dish',()=>{
 const r=agent.step('Убери сыр из сырной шаурмы',sample);
 prop(r);
 assert.equal(r.command,'состав I001 убрать');
 assert.equal(r.item.id,'dish1');
 assert.notEqual(r.command,'стоп лист');
});
test('Derived variations are not offered for a generic dish stop',()=>{
 const r=agent.step('Сырная шаурма стоп лист',sample);
 prop(r);assert.equal(r.item.kind,'item');assert.equal(r.item.id,'dish1');
 assert.equal(r.command,'стоп лист');
});
test('Duplicate named cards are distinct, not fake options or duplicate refs',()=>{
 const data=[
 ...sample,
 {kind:'item',id:'dish3',code:'P003',name:'Сырная шаурма',price:450},
 {kind:'ingredient',id:JSON.stringify(['dish3','ingredient','сыр']),code:'I003',name:'Сырная шаурма · сыр'}
 ];
 const first=agent.step('Убери сыр из сырной шаурмы',data);
 assert.equal(first.type,'clarify');
 assert.equal(first.state.wait.task.type,'remove_ingredient');
 assert.match(first.text,/отдельных карточек|отдельные карточки|несколько отдельных карточек/);
 assert.match(first.text,/320/);assert.match(first.text,/450/);
 const second=agent.step('Вторую',data,first.state);
 prop(second);
 assert.equal(second.item.id,'dish3');
 assert.equal(second.command,'состав I003 убрать');
});
test('Duplicate dish names and an add-on preserve add-ingredient intent',()=>{
 const data=sample.concat([{kind:'item',id:'dish3',code:'P003',name:'Сырная шаурма'}]);
 const first=agent.step('Добавь халапеньо в сырную шаурму',data);
 assert.equal(first.type,'clarify');
 assert.equal(first.state.wait.task.command,'состав + халапеньо');
 const answer=agent.step('2',data,first.state);
 prop(answer);
 assert.equal(answer.command,'состав + халапеньо');
 assert.equal(answer.item.id,'dish3');
});
test('Ambiguous ingredient nickname selects only ingredient parent dish',()=>{
 const data=sample.concat([{kind:'ingredient',id:JSON.stringify(['dish2','ingredient','халапеньо']),code:'I999',name:'Классическая шаурма · халапеньо'}]);
 const first=agent.step('Удали ингредиент сыр',data);
 assert.equal(first.type,'clarify');
 assert.equal(first.state.wait.task.type,'remove_ingredient_ref');
 const answer=agent.step('2',data,first.state);
 prop(answer);
 assert.equal(answer.item.id,'dish2');
 assert.equal(answer.command,'состав I002 убрать');
});
test('Search and report never modify menu when there are several variants',()=>{
 const search=agent.step('Найди сырную шаурму',sample);
 assert.notEqual(search.type,'proposal');
 const report=agent.step('Что в стоп-листе?',sample);
 assert.equal(report.type,'report');
});
test('Other venue ingredient is never removed from chosen dish',()=>{
 const wrong=sample.filter(x=>x.code!=='I001').concat([{kind:'ingredient',id:JSON.stringify(['foreign','ingredient','сыр']),code:'I555',name:'Чужая шаурма · сыр'}]);
 const r=agent.step('Убери сыр из сырной шаурмы',wrong);
 assert.notEqual(r.type,'proposal');
});
test('Timed ingredient removal is not converted to a permanent removal',()=>{
 const r=agent.step('Убери сыр из сырной шаурмы до завтра',sample);
 assert.notEqual(r.type,'proposal');
});
