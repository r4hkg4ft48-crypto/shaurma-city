'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const rich=require('./telegram-rich');

test('escapes untrusted names, comments and HTML entities',()=>{
  const html=rich.textToHtml('🥙 Новый заказ\n\n• Шаурма <сырная> & соус\n• "Острый"');
  assert.match(html,/<h3>🥙 Новый заказ<\/h3>/);
  assert.match(html,/&lt;сырная&gt; &amp; соус/);
  assert.match(html,/&quot;Острый&quot;/);
  assert.doesNotMatch(html,/<сырная>/);
});

test('converts callback and Mini App controls without changing callback data',()=>{
  const input={chat_id:100,text:'🛡 Админка\n\nУправление заведением',reply_markup:{inline_keyboard:[
    [{text:'Приготовить',callback_data:'ko:1042:cooking'}],
    [{text:'Карта',web_app:{url:'https://example.org/index.html?est=1&v=2'}}]
  ]}};
  const result=rich.prepare('sendMessage',input);
  assert.equal(result.method,'sendRichMessage');
  assert.match(result.body.rich_message.html,/data="ko:1042:cooking"/);
  assert.match(result.body.rich_message.html,/type="web_app"/);
  assert.match(result.body.rich_message.html,/&amp;v=2/);
  assert.equal(result.body.reply_markup,undefined);
  assert.deepEqual(input.reply_markup.inline_keyboard[0][0],{text:'Приготовить',callback_data:'ko:1042:cooking'});
});

test('leaves unsupported buttons as an original inline keyboard',()=>{
  const keyboard={inline_keyboard:[[{text:'Игнорировать',switch_inline_query:'shaurmeg'}]]};
  const result=rich.prepare('sendMessage',{chat_id:1,text:'Выбор',reply_markup:keyboard});
  assert.deepEqual(result.body.reply_markup,keyboard);
  assert.doesNotMatch(result.body.rich_message.html,/<tg-button/);
});

test('status edit retains exact Telegram message and order callback',()=>{
  const input={chat_id:42,message_id:3139,text:'Заказ #1042',reply_markup:{inline_keyboard:[
    [{text:'✅ Готово',callback_data:'ko:1042:ready'}]
  ]}};
  const result=rich.prepare('editMessageText',input);
  assert.equal(result.method,'editMessageText');
  assert.equal(result.body.chat_id,42);
  assert.equal(result.body.message_id,3139);
  assert.equal(result.body.text,undefined);
  assert.match(result.body.rich_message.html,/data="ko:1042:ready"/);
});

test('order card is structured, encoded and displays status',()=>{
  const order={id:7,order_number:'SC-0000007-12',venue_name:'В Лепёшке',status:'cooking',total:890,
    items:[{n:'Шаурма сырная',q:2,detail:'Без <лука>'}],fulfillment_type:'cafe'};
  const html=rich.orderHtml(order);
  assert.match(html,/<table bordered compact>/);
  assert.match(html,/Состав и пожелания/);
  assert.match(html,/&lt;лука&gt;/);
  assert.match(html,/🔥 Готовится/);
  assert.match(html,/890 ₽/);
});

test('falls back exactly once to the original message on Telegram 400',async()=>{
  const sent=[];
  const input={chat_id:99,text:'Заказ сохранён',reply_markup:{inline_keyboard:[[{text:'Назад',callback_data:'back'}]]}};
  const result=await rich.withRich('sendMessage',input,async(method,payload)=>{
    sent.push({method,payload});
    if(method==='sendRichMessage')throw Object.assign(new Error('Bad Request: malformed rich markup'),{status:400});
    return {message_id:55};
  });
  assert.equal(result.message_id,55);
  assert.deepEqual(sent.map(x=>x.method),['sendRichMessage','sendMessage']);
  assert.equal(sent[1].payload.text,input.text);
  assert.deepEqual(sent[1].payload.reply_markup,input.reply_markup);
  assert.equal(sent[1].payload.__rich_html,undefined);
});

test('does not duplicate messages after ambiguous network errors',async()=>{
  let count=0;
  await assert.rejects(rich.withRich('sendMessage',{chat_id:1,text:'Привет'},async()=>{count++;throw Object.assign(new Error('timeout'),{status:504});}),/timeout/);
  assert.equal(count,1);
});

test('owner HTML fallback retains original parse_mode while rich parses clean version',async()=>{
  const calls=[];
  await rich.withRich('sendMessage',{chat_id:1,text:'Доступ <b>подключён</b>',parse_mode:'HTML',__rich_html:'<h3>Доступ подключён</h3>'},async(method,payload)=>{
    calls.push({method,payload});
    if(method==='sendRichMessage')throw Object.assign(new Error('Bad Request'),{status:400});
    return {message_id:11};
  });
  assert.equal(calls[0].method,'sendRichMessage');
  assert.equal(calls[0].payload.parse_mode,undefined);
  assert.equal(calls[1].payload.parse_mode,'HTML');
  assert.equal(calls[1].payload.text,'Доступ <b>подключён</b>');
});
