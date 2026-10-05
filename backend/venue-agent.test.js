'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createVenueDialogAgent,similarity,normalize,inferFreeform}=require('./venue-agent');
const {parseCommand}=require('./venue-command');

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
  assert.deepEqual(inferFreeform('пусть сырная будет 430 рублей'),{
    kind:'command',command:{intent:'menu_price',item:'сырная',price:430}
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


test('clarifies ambiguous item before executing and accepts ordinal reply',async()=>{
  const ctx={};
  const venue={
    establishment_id:'SC-MSK-ABCDEF1234',
    name:'Лепёшка',
    config:{menu_sections:[{id:'shawarma',name:'Шаурма',active:true,order:0}]},
    menu:[
      {id:'cheese',n:'Шаурма сырная',c:'shawarma',p:350,active:true},
      {id:'cheese_xl',n:'Шаурма сырная XL',c:'shawarma',p:450,active:true},
      {id:'classic',n:'Шаурма классическая',c:'shawarma',p:320,active:true}
    ]
  };
  const aliases=[];
  const DB={
    async query(sql,args=[]){
      if(sql.includes('FROM shaurma_venue_admins a'))return {rows:[{...venue,role:'owner',permissions:['menu','profile','orders']}]};
      if(sql.startsWith('SELECT * FROM shaurma_owner_command_context'))return {rows:Object.keys(ctx).length?[{...ctx}]:[]};
      if(sql.startsWith('INSERT INTO shaurma_owner_command_context')){
        ctx.telegram_user_id=String(args[0]);ctx.establishment_id=String(args[1]);return {rows:[]};
      }
      if(sql.startsWith('UPDATE shaurma_owner_command_context SET ')){
        const m=sql.match(/^UPDATE shaurma_owner_command_context SET ([a-z_]+)=/);
        if(m){
          const key=m[1];
          ctx[key]=(key==='pending_payload'||key==='pending_candidates')&&typeof args[1]==='string'?JSON.parse(args[1]):args[1];
        }
        return {rows:[]};
      }
      if(sql.startsWith('SELECT entity_id,alias,normalized_alias FROM shaurma_menu_aliases'))return {rows:aliases.filter(x=>x.entity_type===args[1])};
      if(sql.startsWith('INSERT INTO shaurma_menu_aliases')){aliases.push({entity_type:args[1],entity_id:args[2],alias:args[3],normalized_alias:args[4]});return {rows:[]}}
      throw new Error('Unexpected SQL in mock: '+sql);
    }
  };
  const calls=[];
  const commandBus={async handle(x){calls.push(x.text);return {handled:true,text:'EXEC '+x.text}}};
  const agent=createVenueDialogAgent({DB,commandBus});
  const user={id:123};

  const first=await agent.handle({user,text:'у сырной сделай цену 420'});
  assert.equal(first.handled,true);
  assert.match(first.text,/Какую именно позицию/);
  assert.equal(calls.length,0);
  assert.ok(Array.isArray(first.reply_markup.inline_keyboard));

  const second=await agent.handle({user,text:'вторая'});
  assert.equal(second.handled,true);
  assert.equal(calls.length,1);
  assert.equal(calls[0],'поставь цену на Шаурма сырная XL 420');
  assert.equal(parseCommand(calls[0]).intent,'menu_price');
});

test('ambiguous remove action asks whether to hide or mark unavailable',async()=>{
  const ctx={telegram_user_id:'123',establishment_id:'SC-MSK-ABCDEF1234'};
  const venue={
    establishment_id:'SC-MSK-ABCDEF1234',name:'Лепёшка',
    config:{menu_sections:[{id:'drinks',name:'Напитки',active:true,order:0}]},
    menu:[{id:'ayran',n:'Айран',c:'drinks',p:150,active:true}]
  };
  const DB={async query(sql,args=[]){
    if(sql.includes('FROM shaurma_venue_admins a'))return {rows:[{...venue,role:'owner',permissions:['menu']}]};
    if(sql.startsWith('SELECT * FROM shaurma_owner_command_context'))return {rows:[{...ctx}]};
    if(sql.startsWith('INSERT INTO shaurma_owner_command_context')){
      if(!ctx.telegram_user_id){ctx.telegram_user_id=String(args[0]);ctx.establishment_id=args[1]??ctx.establishment_id??null}
      return {rows:[]};
    }
    if(sql.startsWith('UPDATE shaurma_owner_command_context SET ')){const m=sql.match(/^UPDATE shaurma_owner_command_context SET ([a-z_]+)=/);if(m){const key=m[1];ctx[key]=(key==='pending_payload'||key==='pending_candidates')&&typeof args[1]==='string'?JSON.parse(args[1]):args[1]}return {rows:[]}}
    if(sql.startsWith('SELECT entity_id,alias,normalized_alias FROM shaurma_menu_aliases'))return {rows:[]};
    throw new Error('Unexpected SQL in mock: '+sql);
  }};
  const calls=[],commandBus={async handle(x){calls.push(x.text);return {handled:true,text:x.text}}};
  const agent=createVenueDialogAgent({DB,commandBus}),user={id:123};
  const first=await agent.handle({user,text:'убери айран'});
  assert.match(first.text,/Что именно сделать/);
  assert.equal(calls.length,0);
});


test('stores pending venue clarification before any venue is selected',async()=>{
  const ctx={};
  const venues=[
    {establishment_id:'SC-MSK-AAAAAA1111',name:'Лепёшка Центр',menu:[],config:{},role:'owner',permissions:['menu']},
    {establishment_id:'SC-MSK-BBBBBB2222',name:'Лепёшка Север',menu:[],config:{},role:'owner',permissions:['menu']}
  ];
  const DB={async query(sql,args=[]){
    if(sql.includes('FROM shaurma_venue_admins a'))return {rows:venues.map(x=>({...x}))};
    if(sql.startsWith('SELECT * FROM shaurma_owner_command_context'))return {rows:Object.keys(ctx).length?[{...ctx}]:[]};
    if(sql.startsWith('INSERT INTO shaurma_owner_command_context')){
      if(!Object.keys(ctx).length){ctx.telegram_user_id=String(args[0]);ctx.establishment_id=args[1]??null}
      else if(args.length>1&&args[1]!==null&&args[1]!==undefined)ctx.establishment_id=String(args[1]);
      return {rows:[]};
    }
    if(sql.startsWith('UPDATE shaurma_owner_command_context SET ')){
      const m=sql.match(/^UPDATE shaurma_owner_command_context SET ([a-z_]+)=/);
      if(m){
        const key=m[1];
        ctx[key]=(key==='pending_payload'||key==='pending_candidates')&&typeof args[1]==='string'?JSON.parse(args[1]):args[1];
      }
      return {rows:[]};
    }
    if(sql.startsWith('SELECT entity_id,alias,normalized_alias FROM shaurma_menu_aliases'))return {rows:[]};
    throw new Error('Unexpected SQL in mock: '+sql);
  }};
  const calls=[];
  const commandBus={async handle(x){calls.push(x.text);return {handled:true,text:'EXEC '+x.text}}};
  const agent=createVenueDialogAgent({DB,commandBus}),user={id:777};

  const first=await agent.handle({user,text:'найди меню'});
  assert.equal(first.handled,true);
  assert.match(first.text,/Сначала выберите заведение/);
  assert.equal(ctx.pending_kind,'venue_select');
  assert.equal(ctx.establishment_id,null);
  assert.equal(calls.length,0);

  const second=await agent.handle({user,text:'вторая'});
  assert.equal(second.handled,true);
  assert.equal(ctx.establishment_id,'SC-MSK-BBBBBB2222');
  assert.equal(calls.at(-1),'/use SC-MSK-BBBBBB2222');
});


test('clarified builder option deletion remains executable after confirmation',()=>{
  const parsed=parseCommand('удали соус Барбекю');
  assert.equal(parsed.intent,'builder_option_delete');
});
