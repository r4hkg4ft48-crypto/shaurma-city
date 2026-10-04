'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const V=require('../src/voice-assistant');

test('parses natural Russian kitchen status commands',()=>{
  assert.deepEqual(V.parseLocalIntent('Последний заказ уже готов'),{
    intent:'set_status',target:'latest',order_ref:'',status:'ready'
  });
  assert.deepEqual(V.parseLocalIntent('Начинай готовить заказ 42'),{
    intent:'set_status',target:'id',order_ref:'42',status:'cooking'
  });
  assert.deepEqual(V.parseLocalIntent('Заказ SC-1234567-45 выполнен'),{
    intent:'set_status',target:'order_number',order_ref:'SC-1234567-45',status:'done'
  });
});

test('parses queue and read commands',()=>{
  assert.equal(V.parseLocalIntent('Покажи активные заказы').intent,'list_active');
  assert.equal(V.parseLocalIntent('Повтори последний заказ').intent,'read_order');
  assert.equal(V.parseLocalIntent('Какой статус заказа 21').intent,'read_order');
});

test('sanitizes AI output to the supported command surface',()=>{
  assert.deepEqual(
    V.sanitizeAiIntent({intent:'set_status',target:'latest',status:'ready',order_ref:''}),
    {intent:'set_status',target:'latest',order_ref:'',status:'ready'}
  );
  assert.equal(V.sanitizeAiIntent({intent:'delete_order',target:'latest'}).intent,'unknown');
  assert.equal(V.sanitizeAiIntent({intent:'set_status',status:'cancelled'}).intent,'unknown');
});

test('extracts Responses API text',()=>{
  const payload={output:[{content:[{type:'output_text',text:'{"intent":"help"}'}]}]};
  assert.equal(V.extractResponseText(payload),'{"intent":"help"}');
  assert.deepEqual(V.parseJsonObject('ok\n{"intent":"help"}'),{intent:'help'});
});
