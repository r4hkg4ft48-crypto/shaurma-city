'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createVenueDialogAgent,similarity,normalize,inferFreeform,inferContextAction,inferItemActionPlan,inferContextActionPlan,splitActionClauses}=require('./venue-agent');
const {parseCommand}=require('./venue-command');

test('normalization tolerates common food slang and inflection',()=>{
  assert.equal(normalize('Сырной шавухой'),'сырной шаурма');
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
  const executed=[];
  const commandBus={
    async execute({command}){executed.push(command);return {handled:true,text:'EXEC '+command.intent}},
    async handle(x){return {handled:true,text:'LEGACY '+String(x.text||'')}}
  };
  const agent=createVenueDialogAgent({DB,commandBus});
  const user={id:123};

  const first=await agent.handle({user,text:'у сырной сделай цену 420'});
  assert.equal(first.handled,true);
  assert.match(first.text,/Как(?:ую именно позицию|ое именно блюдо)/);
  assert.equal(executed.length,0);
  assert.ok(Array.isArray(first.reply_markup.inline_keyboard));

  const second=await agent.handle({user,text:'вторая'});
  assert.equal(second.handled,true);
  assert.equal(executed.length,1);
  assert.equal(executed[0].intent,'menu_price_context');
  assert.equal(executed[0].target_item_id,'cheese_xl');
  assert.equal(executed[0].price,420);
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


test('explicit venue selection overrides stale clarification',async()=>{
  const ctx={
    telegram_user_id:'900',
    establishment_id:'SC-MSK-AAAAAA1111',
    pending_kind:'item_select',
    pending_payload:{token:'12345678'},
    pending_candidates:[{id:'x',label:'Старая позиция',type:'item'}]
  };
  const venues=[
    {establishment_id:'SC-MSK-AAAAAA1111',name:'Лепёшка Центр',menu:[],config:{},role:'owner',permissions:['menu']},
    {establishment_id:'SC-MSK-BBBBBB2222',name:'Лепёшка Север',menu:[],config:{},role:'owner',permissions:['menu']}
  ];
  const DB={async query(sql,args=[]){
    if(sql.includes('FROM shaurma_venue_admins a'))return {rows:venues.map(x=>({...x}))};
    if(sql.startsWith('SELECT * FROM shaurma_owner_command_context'))return {rows:[{...ctx}]};
    if(sql.startsWith('INSERT INTO shaurma_owner_command_context')){
      if(args.length>1&&args[1]!==null&&args[1]!==undefined)ctx.establishment_id=String(args[1]);
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
  const commandBus={async handle(x){calls.push(x.text);return {handled:true,text:x.text}}};
  const agent=createVenueDialogAgent({DB,commandBus}),user={id:900};

  const result=await agent.handle({user,text:'выбери точку Лепёшка Север'});
  assert.equal(result.handled,true);
  assert.equal(ctx.establishment_id,'SC-MSK-BBBBBB2222');
  assert.equal(ctx.pending_kind,null);
  assert.equal(calls.at(-1),'/use SC-MSK-BBBBBB2222');
});

test('unknown venue query falls back to accessible venue list',async()=>{
  const ctx={};
  const venues=[
    {establishment_id:'SC-MSK-AAAAAA1111',name:'Лепёшка Центр',menu:[],config:{},role:'owner',permissions:['menu']},
    {establishment_id:'SC-MSK-BBBBBB2222',name:'Лепёшка Север',menu:[],config:{},role:'owner',permissions:['menu']}
  ];
  const DB={async query(sql,args=[]){
    if(sql.includes('FROM shaurma_venue_admins a'))return {rows:venues.map(x=>({...x}))};
    if(sql.startsWith('SELECT * FROM shaurma_owner_command_context'))return {rows:Object.keys(ctx).length?[{...ctx}]:[]};
    if(sql.startsWith('INSERT INTO shaurma_owner_command_context')){
      if(!ctx.telegram_user_id){ctx.telegram_user_id=String(args[0]);ctx.establishment_id=args[1]??null}
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
  const commandBus={async handle(x){return {handled:true,text:x.text}}};
  const agent=createVenueDialogAgent({DB,commandBus}),user={id:901};

  const result=await agent.handle({user,text:'выбери точку абракадабра'});
  assert.equal(result.handled,true);
  assert.match(result.text,/Выберите из доступных/);
  assert.equal(result.reply_markup.inline_keyboard.length,3);
});


test('full dish phrase beats ingredient-only item and executes exact item id',async()=>{
  const ctx={telegram_user_id:'501',establishment_id:'SC-MSK-FOOD001234'};
  const venue={
    establishment_id:'SC-MSK-FOOD001234',
    name:'Тестовая точка',
    config:{menu_sections:[
      {id:'shawarma',name:'Шаурма',active:true,order:0},
      {id:'extras',name:'Добавки',active:true,order:1}
    ]},
    menu:[
      {id:'cheese_shawarma',n:'Шаурма сырная',c:'shawarma',p:390,active:true},
      {id:'cheese',n:'Сыр',c:'extras',p:50,active:true},
      {id:'classic',n:'Шаурма классическая',c:'shawarma',p:350,active:true}
    ]
  };
  const DB={async query(sql,args=[]){
    if(sql.includes('FROM shaurma_venue_admins a'))return {rows:[{...venue,role:'owner',permissions:['menu']}]};
    if(sql.startsWith('SELECT * FROM shaurma_owner_command_context'))return {rows:[{...ctx}]};
    if(sql.startsWith('INSERT INTO shaurma_owner_command_context'))return {rows:[]};
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
  const executed=[];
  const commandBus={
    async execute({command}){executed.push(command);return {handled:true,text:'OK'}},
    async handle(){throw new Error('resolved action must not be reparsed as text')}
  };
  const agent=createVenueDialogAgent({DB,commandBus});
  const result=await agent.handle({user:{id:501},text:'работаем с сырной шаурмой'});

  assert.equal(result.handled,true);
  assert.equal(executed.length,1);
  assert.equal(executed[0].intent,'menu_item_select');
  assert.equal(executed[0].target_item_id,'cheese_shawarma');
  assert.equal(ctx.selected_item_id,'cheese_shawarma');
});

test('multiword dish query scores far above ingredient-only item',()=>{
  assert.ok(similarity('сырной шаурмой','Шаурма сырная')>.95);
  assert.ok(similarity('сырной шаурмой','Сыр')<.75);
});


test('executes a natural multi-action sentence on one exact dish',async()=>{
  const ctx={telegram_user_id:'601',establishment_id:'SC-MSK-PLAN001234'};
  const venue={
    establishment_id:'SC-MSK-PLAN001234',
    name:'Тестовая точка',
    config:{menu_sections:[{id:'shawarma',name:'Шаурма',active:true,order:0},{id:'extras',name:'Добавки',active:true,order:1}]},
    menu:[
      {id:'cheese_shawarma',n:'Шаурма сырная',c:'shawarma',p:390,active:true,available:true},
      {id:'cheese',n:'Сыр',c:'extras',p:50,active:true,available:true}
    ]
  };
  const DB={async query(sql,args=[]){
    if(sql.includes('FROM shaurma_venue_admins a'))return {rows:[{...venue,role:'owner',permissions:['menu']}]};
    if(sql.startsWith('SELECT * FROM shaurma_owner_command_context'))return {rows:[{...ctx}]};
    if(sql.startsWith('INSERT INTO shaurma_owner_command_context'))return {rows:[]};
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
  const executed=[];
  const commandBus={
    async execute({command}){executed.push(command);return {handled:true,text:'OK '+command.intent}},
    async handle(){throw new Error('natural plan must not be reparsed as text')}
  };
  const agent=createVenueDialogAgent({DB,commandBus});
  const result=await agent.handle({
    user:{id:601},
    text:'у сырной шаурмы поставь цену 420 и временно убери из продажи, но не скрывай из меню'
  });

  assert.equal(result.handled,true);
  assert.deepEqual(executed.map(x=>x.intent),['menu_price_context','menu_available','menu_toggle']);
  assert.ok(executed.every(x=>x.target_item_id==='cheese_shawarma'));
  assert.equal(executed[0].price,420);
  assert.equal(executed[1].available,false);
  assert.equal(executed[2].enabled,true);
});

test('uses current dish for pronoun follow-up without asking again',async()=>{
  const ctx={
    telegram_user_id:'602',
    establishment_id:'SC-MSK-CTX001234',
    selected_item_id:'cheese_shawarma',
    selected_category_id:'shawarma'
  };
  const venue={
    establishment_id:'SC-MSK-CTX001234',
    name:'Тестовая точка',
    config:{menu_sections:[{id:'shawarma',name:'Шаурма',active:true,order:0}]},
    menu:[{id:'cheese_shawarma',n:'Шаурма сырная',c:'shawarma',p:390,active:true,available:true}]
  };
  const DB={async query(sql,args=[]){
    if(sql.includes('FROM shaurma_venue_admins a'))return {rows:[{...venue,role:'owner',permissions:['menu']}]};
    if(sql.startsWith('SELECT * FROM shaurma_owner_command_context'))return {rows:[{...ctx}]};
    if(sql.startsWith('INSERT INTO shaurma_owner_command_context'))return {rows:[]};
    if(sql.startsWith('UPDATE shaurma_owner_command_context SET ')){
      const m=sql.match(/^UPDATE shaurma_owner_command_context SET ([a-z_]+)=/);
      if(m)ctx[m[1]]=args[1];
      return {rows:[]};
    }
    if(sql.startsWith('SELECT entity_id,alias,normalized_alias FROM shaurma_menu_aliases'))return {rows:[]};
    throw new Error('Unexpected SQL in mock: '+sql);
  }};
  const executed=[];
  const commandBus={
    async execute({command}){executed.push(command);return {handled:true,text:'OK'}},
    async handle(){throw new Error('contextual action must stay structured')}
  };
  const agent=createVenueDialogAgent({DB,commandBus});
  const result=await agent.handle({user:{id:602},text:'там сделай цену 430 и временно убери из продажи'});

  assert.equal(result.handled,true);
  assert.deepEqual(executed.map(x=>x.intent),['menu_price_context','menu_available']);
  assert.ok(executed.every(x=>x.target_item_id==='cheese_shawarma'));
});


test('semantic planner splits conjunctions and pronouns',()=>{
  assert.deepEqual(
    splitActionClauses('поставь цену 420 и временно убери из продажи, но не скрывай из меню'),
    ['поставь цену 420','временно убери из продажи','не скрывай из меню']
  );
  const plan=inferItemActionPlan('у сырной шаурмы поставь цену 420 и временно убери из продажи, но не скрывай из меню');
  assert.ok(plan);
  assert.equal(plan.item,'сырной шаурмы');
  assert.deepEqual(plan.actions.map(x=>x.intent),['menu_price_context','menu_available','menu_toggle']);

  const contextPlan=inferContextActionPlan('там сделай цену 430 и временно убери из продажи');
  assert.ok(contextPlan);
  assert.deepEqual(contextPlan.actions.map(x=>x.intent),['menu_price_context','menu_available']);
  assert.deepEqual(inferContextAction('у неё подними цену на 50'),{intent:'menu_price_delta',delta:50});
});


test('natural multi-action sentence resolves one exact dish and builds one atomic plan',async()=>{
  const ctx={telegram_user_id:'601',establishment_id:'SC-MSK-TALK001234'};
  const venue={
    establishment_id:'SC-MSK-TALK001234',
    name:'Разговорная точка',
    config:{menu_sections:[
      {id:'shawarma',name:'Шаурма',active:true,order:0},
      {id:'extras',name:'Добавки',active:true,order:1}
    ]},
    menu:[
      {id:'cheese_shawarma',n:'Шаурма сырная',c:'shawarma',p:390,active:true,available:true},
      {id:'cheese',n:'Сыр',c:'extras',p:50,active:true,available:true}
    ]
  };
  const DB={async query(sql,args=[]){
    if(sql.includes('FROM shaurma_venue_admins a'))return {rows:[{...venue,role:'owner',permissions:['menu']}]};
    if(sql.startsWith('SELECT * FROM shaurma_owner_command_context'))return {rows:[{...ctx}]};
    if(sql.startsWith('INSERT INTO shaurma_owner_command_context'))return {rows:[]};
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
  const plans=[];
  const commandBus={
    async executeItemPlan(x){plans.push(x);return {handled:true,text:'OK'}},
    async execute(){throw new Error('multi-action request must use atomic plan')},
    async handle(){throw new Error('resolved request must not be reparsed')}
  };
  const agent=createVenueDialogAgent({DB,commandBus});
  const result=await agent.handle({
    user:{id:601},
    text:'у сырной шаурмы поставь цену 420 и пока убери из продажи, но не скрывай из меню'
  });

  assert.equal(result.handled,true);
  assert.equal(plans.length,1);
  assert.equal(plans[0].target_item_id,'cheese_shawarma');
  assert.deepEqual(plans[0].actions.map(x=>x.intent),[
    'menu_price_context','menu_available','menu_toggle'
  ]);
  assert.equal(plans[0].actions[0].price,420);
  assert.equal(plans[0].actions[1].available,false);
  assert.equal(plans[0].actions[2].enabled,true);
});

test('selected dish keeps conversational pronoun context for follow-up plan',async()=>{
  const ctx={
    telegram_user_id:'602',
    establishment_id:'SC-MSK-TALK001234',
    selected_item_id:'cheese_shawarma',
    selected_category_id:'shawarma'
  };
  const venue={
    establishment_id:'SC-MSK-TALK001234',
    name:'Разговорная точка',
    config:{menu_sections:[{id:'shawarma',name:'Шаурма',active:true,order:0}]},
    menu:[{id:'cheese_shawarma',n:'Шаурма сырная',c:'shawarma',p:390,active:true,available:true}]
  };
  const DB={async query(sql,args=[]){
    if(sql.includes('FROM shaurma_venue_admins a'))return {rows:[{...venue,role:'owner',permissions:['menu']}]};
    if(sql.startsWith('SELECT * FROM shaurma_owner_command_context'))return {rows:[{...ctx}]};
    if(sql.startsWith('INSERT INTO shaurma_owner_command_context'))return {rows:[]};
    if(sql.startsWith('UPDATE shaurma_owner_command_context SET ')){return {rows:[]}}
    if(sql.startsWith('SELECT entity_id,alias,normalized_alias FROM shaurma_menu_aliases'))return {rows:[]};
    throw new Error('Unexpected SQL in mock: '+sql);
  }};
  const plans=[];
  const commandBus={
    async executeItemPlan(x){plans.push(x);return {handled:true,text:'OK'}},
    async execute(){throw new Error('follow-up plan must stay atomic')},
    async handle(){throw new Error('follow-up must not be reparsed')}
  };
  const agent=createVenueDialogAgent({DB,commandBus});
  const result=await agent.handle({
    user:{id:602},
    text:'там подними цену на 20 и пока убери из продажи'
  });

  assert.equal(result.handled,true);
  assert.equal(plans.length,1);
  assert.equal(plans[0].target_item_id,'cheese_shawarma');
  assert.equal(plans[0].actions[0].intent,'menu_price_context');
  assert.equal(plans[0].actions[0].price,410);
  assert.equal(plans[0].actions[1].intent,'menu_available');
  assert.equal(plans[0].actions[1].available,false);
});


test('asks only for missing price and accepts spoken Russian number',async()=>{
  const ctx={telegram_user_id:'701',establishment_id:'SC-MSK-HUMAN01234'};
  const venue={
    establishment_id:'SC-MSK-HUMAN01234',
    name:'Человеческий диалог',
    config:{menu_sections:[{id:'shawarma',name:'Шаурма',active:true,order:0}]},
    menu:[
      {id:'cheese_shawarma',n:'Шаурма сырная',c:'shawarma',p:390,active:true},
      {id:'cheese',n:'Сыр',c:'shawarma',p:50,active:true}
    ]
  };
  const DB={async query(sql,args=[]){
    if(sql.includes('FROM shaurma_venue_admins a'))return {rows:[{...venue,role:'owner',permissions:['menu']}]};
    if(sql.startsWith('SELECT * FROM shaurma_owner_command_context'))return {rows:[{...ctx}]};
    if(sql.startsWith('INSERT INTO shaurma_owner_command_context'))return {rows:[]};
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
  const executed=[];
  const commandBus={
    async execute({command}){executed.push(command);return {handled:true,text:'OK'}},
    async handle(){throw new Error('missing-slot flow must not reparse text')}
  };
  const agent=createVenueDialogAgent({DB,commandBus}),user={id:701};

  const first=await agent.handle({user,text:'у сырной шаурмы поменяй цену'});
  assert.equal(first.handled,true);
  assert.match(first.text,/На какую цену/);
  assert.equal(ctx.pending_kind,'slot_value');
  assert.equal(ctx.selected_item_id,'cheese_shawarma');
  assert.equal(executed.length,0);

  const second=await agent.handle({user,text:'четыреста двадцать'});
  assert.equal(second.handled,true);
  assert.equal(executed.length,1);
  assert.equal(executed[0].intent,'menu_price_context');
  assert.equal(executed[0].target_item_id,'cheese_shawarma');
  assert.equal(executed[0].price,420);
  assert.equal(ctx.pending_kind,null);
});

test('selected dish can ask targeted follow-up without repeating its name',async()=>{
  const ctx={
    telegram_user_id:'702',
    establishment_id:'SC-MSK-HUMAN01234',
    selected_item_id:'cheese_shawarma',
    selected_category_id:'shawarma'
  };
  const venue={
    establishment_id:'SC-MSK-HUMAN01234',
    name:'Человеческий диалог',
    config:{menu_sections:[{id:'shawarma',name:'Шаурма',active:true,order:0}]},
    menu:[{id:'cheese_shawarma',n:'Шаурма сырная',c:'shawarma',p:390,active:true}]
  };
  const DB={async query(sql,args=[]){
    if(sql.includes('FROM shaurma_venue_admins a'))return {rows:[{...venue,role:'owner',permissions:['menu']}]};
    if(sql.startsWith('SELECT * FROM shaurma_owner_command_context'))return {rows:[{...ctx}]};
    if(sql.startsWith('INSERT INTO shaurma_owner_command_context'))return {rows:[]};
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
  const executed=[];
  const commandBus={
    async execute({command}){executed.push(command);return {handled:true,text:'OK'}},
    async handle(){throw new Error('context follow-up must stay structured')}
  };
  const agent=createVenueDialogAgent({DB,commandBus}),user={id:702};

  const first=await agent.handle({user,text:'поменяй цену'});
  assert.match(first.text,/На какую цену/);
  const second=await agent.handle({user,text:'на 410 рублей'});
  assert.equal(second.handled,true);
  assert.equal(executed[0].target_item_id,'cheese_shawarma');
  assert.equal(executed[0].price,410);
});
