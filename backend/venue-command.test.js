'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createVenueCommandBus,parseCommand,findNamed,venueShortKey}=require('./venue-command');

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


test('parses conversational deep menu editing',()=>{
  assert.deepEqual(parseCommand('работаем с сырной шаурмой'),{intent:'menu_item_select',item:'сырной шаурмой'});
  assert.deepEqual(parseCommand('цена 420'),{intent:'menu_price_context',price:420});
  assert.deepEqual(parseCommand('нет в наличии'),{intent:'menu_available',item:'',available:false});
  assert.deepEqual(parseCommand('вес 450 г'),{intent:'menu_weight',value:'450 г'});
  assert.deepEqual(parseCommand('состав курица, овощи, чесночный соус'),{intent:'menu_composition',value:'курица, овощи, чесночный соус'});
  assert.deepEqual(parseCommand('остаток 12'),{intent:'menu_stock',value:12});
  assert.deepEqual(parseCommand('теги острое, хит'),{intent:'menu_tags',value:['острое','хит']});
  assert.deepEqual(parseCommand('добавь выбор Размер'),{intent:'choice_group_add',name:'Размер'});
  assert.deepEqual(parseCommand('добавь вариант Большая +80'),{intent:'choice_option_add',name:'Большая',price_delta:80});
  assert.deepEqual(parseCommand('добавь вариант мяса Говядина +100'),{intent:'fixed_option_add',group:'мяса',name:'Говядина',price:100});
});


test('structured executor changes exact item id without fuzzy re-resolution',async()=>{
  const ctx={establishment_id:'SC-MSK-STRUCT1234',selected_item_id:''};
  const venue={
    establishment_id:'SC-MSK-STRUCT1234',
    venue_id:'VENUE-1',
    name:'Тестовая точка',
    is_active:true,
    config:{menu_sections:[{id:'shawarma',name:'Шаурма',active:true,order:0},{id:'extras',name:'Добавки',active:true,order:1}]},
    menu:[
      {id:'cheese_shawarma',n:'Шаурма сырная',c:'shawarma',p:390,active:true},
      {id:'cheese',n:'Сыр',c:'extras',p:50,active:true}
    ]
  };
  let savedMenu=null;
  const DB={async query(sql,args=[]){
    if(sql.includes('FROM shaurma_venue_admins a JOIN shaurma_venues v'))return {rows:[{
      establishment_id:venue.establishment_id,role:'owner',permissions:['menu'],name:venue.name,venue_id:venue.venue_id,config:venue.config,menu:venue.menu,marker_id:'m1'
    }]};
    if(sql.startsWith('INSERT INTO shaurma_owner_command_context')){ctx.establishment_id=String(args[1]||ctx.establishment_id);return {rows:[]}}
    if(sql.startsWith('SELECT establishment_id,selected_item_id,selected_group_id FROM shaurma_owner_command_context'))return {rows:[{...ctx,selected_group_id:''}]};
    if(sql.startsWith('UPDATE shaurma_owner_command_context SET selected_item_id=')){ctx.selected_item_id=String(args[1]||'');return {rows:[]}}
    if(sql.includes('SELECT v.*,m.id marker_id'))return {rows:[{...venue,address:'',description:'',hours:'',marker_id:'m1'}]};
    if(sql.startsWith('UPDATE shaurma_venues SET menu=')){
      savedMenu=JSON.parse(args[1]);
      return {rows:[{...venue,menu:savedMenu,config:JSON.parse(args[2])}]};
    }
    if(sql.startsWith('INSERT INTO shaurma_venue_audit'))return {rows:[]};
    if(sql.startsWith('SELECT establishment_id FROM shaurma_owner_command_context'))return {rows:[{establishment_id:ctx.establishment_id}]};
    throw new Error('Unexpected SQL in structured executor mock: '+sql);
  }};
  const bus=createVenueCommandBus({DB,publishVenue:()=>{},pushOwner:()=>{}});
  const result=await bus.execute({
    user:{id:77},
    command:{intent:'menu_price_context',price:420,target_item_id:'cheese_shawarma'}
  });

  assert.equal(result.handled,true);
  assert.ok(savedMenu);
  assert.equal(savedMenu.find(x=>x.id==='cheese_shawarma').p,420);
  assert.equal(savedMenu.find(x=>x.id==='cheese').p,50);
});
