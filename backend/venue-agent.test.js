'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {similarity,normalize,inferFreeform}=require('./venue-agent');

test('normalization tolerates common food slang and inflection',()=>{
  assert.equal(normalize('Сырной шавухой'),'сыр шаурма');
  assert.ok(similarity('сырной шаурмой','Шаурма сырная')>.9);
  assert.ok(similarity('класическая шаурма','Шаурма классическая')>.75);
  assert.ok(similarity('чесночный','Чесночный соус')>.75);
});

test('freeform price and stock phrases become structured intents',()=>{
  assert.deepEqual(inferFreeform('у сырной сделай цену 420'),{
    kind:'command',command:{intent:'menu_price',item:'сырной',price:420}
  });
  assert.deepEqual(inferFreeform('для айрана остаток 7'),{
    kind:'command',command:{intent:'menu_stock',item:'айрана',value:7}
  });
});

test('ambiguous remove request requests action clarification',()=>{
  const x=inferFreeform('убери айран');
  assert.equal(x.kind,'action_clarify');
  assert.equal(x.item,'айран');
  assert.equal(x.actions.length,2);
  assert.equal(x.actions[0].command.intent,'menu_available');
  assert.equal(x.actions[1].command.intent,'menu_toggle');
});

test('plain navigation and aliases are recognized',()=>{
  assert.deepEqual(inferFreeform('найди сырную'),{kind:'navigate_item',query:'сырную'});
  assert.deepEqual(inferFreeform('покажи напитки'),{kind:'navigate_category',query:'напитки'});
  assert.deepEqual(inferFreeform('запомни что большая сырная это сырная XL'),{
    kind:'alias',alias:'большая сырная',target:'сырная XL'
  });
});
