'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {parseCommand,findNamed,venueShortKey}=require('./venue-command');

test('parses menu commands',()=>{
  assert.deepEqual(parseCommand('цена Классическая шаурма 390'),{intent:'menu_price',item:'Классическая шаурма',price:390});
  assert.deepEqual(parseCommand('выключи блюдо Айран'),{intent:'menu_toggle',item:'Айран',enabled:false});
  assert.deepEqual(parseCommand('включи блюдо Айран'),{intent:'menu_toggle',item:'Айран',enabled:true});
  assert.deepEqual(parseCommand('добавь блюдо Айран | Напитки | 150 | Домашний айран'),{
    intent:'menu_add',name:'Айран',category:'Напитки',price:150,description:'Домашний айран'
  });
  assert.deepEqual(parseCommand('переименуй блюдо Айран -> Тан'),{intent:'menu_rename',item:'Айран',name:'Тан'});
  assert.deepEqual(parseCommand('измени цену на Классическая шаурма до 410'),{intent:'menu_price',item:'Классическая шаурма',price:410});
  assert.deepEqual(parseCommand('убери Айран из меню'),{intent:'menu_toggle',item:'Айран',enabled:false});
  assert.deepEqual(parseCommand('верни Айран в меню'),{intent:'menu_toggle',item:'Айран',enabled:true});
  assert.deepEqual(parseCommand('добавь Морс в Напитки за 170'),{intent:'menu_add',name:'Морс',category:'Напитки',price:170,description:''});
});

test('parses venue commands',()=>{
  assert.deepEqual(parseCommand('адрес ул. Примерная, 10'),{intent:'venue_address',value:'ул. Примерная, 10'});
  assert.deepEqual(parseCommand('режим работы 10:00–23:00'),{intent:'venue_hours',value:'10:00–23:00'});
  assert.deepEqual(parseCommand('доставка вкл'),{intent:'delivery_toggle',enabled:true});
  assert.deepEqual(parseCommand('самовывоз выкл'),{intent:'pickup_toggle',enabled:false});
  assert.deepEqual(parseCommand('конструктор вкл'),{intent:'builder_toggle',enabled:true});
});

test('parses categories and order status',()=>{
  assert.deepEqual(parseCommand('добавь категорию Десерты'),{intent:'category_add',name:'Десерты'});
  assert.deepEqual(parseCommand('выключи категорию Выпечка'),{intent:'category_toggle',category:'Выпечка',enabled:false});
  assert.deepEqual(parseCommand('заказ 42 готов'),{intent:'order_status',order_id:'42',status:'ready'});
});

test('supports venue selection and fuzzy unique lookup',()=>{
  assert.deepEqual(parseCommand('выбери точку Лепёшка'),{intent:'venue_select',query:'Лепёшка'});
  const list=[{n:'Шаурма классическая'},{n:'Шаурма сырная'},{n:'Айран'}];
  assert.equal(findNamed(list,'айран',x=>x.n).item.n,'Айран');
  assert.equal(findNamed(list,'сырная',x=>x.n).item.n,'Шаурма сырная');
  assert.equal(findNamed(list,'шаурма',x=>x.n).item,null);
});


test('selects venue by short key syntax',()=>{
  assert.equal(venueShortKey('SC-MSK-5E435A0F67'),'5E435A');
  assert.deepEqual(parseCommand('/use 5E435A'),{intent:'venue_select',query:'5E435A'});
  assert.deepEqual(parseCommand('5E435A'),{intent:'venue_select',query:'5E435A'});
  assert.deepEqual(parseCommand('выбери точку Лепёшка'),{intent:'venue_select',query:'Лепёшка'});
});


test('parses conversational menu editor',()=>{
  assert.deepEqual(parseCommand('работаем с сырной шаурмой'),{intent:'menu_item_select',item:'сырной шаурмой'});
  assert.deepEqual(parseCommand('цена 420'),{intent:'menu_price_context',price:420});
  assert.deepEqual(parseCommand('нет в наличии'),{intent:'menu_available',item:'',available:false});
  assert.deepEqual(parseCommand('верни в наличие'),{intent:'menu_available',available:true});
  assert.deepEqual(parseCommand('бейдж Хит'),{intent:'menu_badge',value:'Хит'});
  assert.deepEqual(parseCommand('сделай главной'),{intent:'menu_featured',enabled:true});
  assert.deepEqual(parseCommand('перенеси в категорию Напитки'),{intent:'menu_category_move',category:'Напитки'});
  assert.deepEqual(parseCommand('минимум 1 шт'),{intent:'menu_qty',field:'min_qty',value:1});
});

test('parses configurable item buttons',()=>{
  assert.deepEqual(parseCommand('добавь выбор Размер'),{intent:'choice_group_add',name:'Размер'});
  assert.deepEqual(parseCommand('работаем с выбором Размер'),{intent:'choice_group_select',group:'Размер'});
  assert.deepEqual(parseCommand('сделай обязательным'),{intent:'choice_group_required',required:true});
  assert.deepEqual(parseCommand('можно несколько'),{intent:'choice_group_type',type:'multiple'});
  assert.deepEqual(parseCommand('можно выбрать до 2'),{intent:'choice_group_limit',field:'max',value:2});
  assert.deepEqual(parseCommand('минимум 1'),{intent:'choice_group_limit',field:'min',value:1});
  assert.deepEqual(parseCommand('добавь вариант Большая +80'),{intent:'choice_option_add',name:'Большая',price_delta:80});
  assert.deepEqual(parseCommand('доплата варианта Большая 100'),{intent:'choice_option_price',option:'Большая',price_delta:100});
});

test('matches Russian inflections and word order',()=>{
  const list=[{n:'Шаурма классическая'},{n:'Шаурма сырная'},{n:'Айран'}];
  assert.equal(findNamed(list,'сырной шаурмой',x=>x.n).item.n,'Шаурма сырная');
  assert.equal(findNamed(list,'айраном',x=>x.n).item.n,'Айран');
  assert.equal(findNamed(list,'шаурма',x=>x.n).item,null);
});
