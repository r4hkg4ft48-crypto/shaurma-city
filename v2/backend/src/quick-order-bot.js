'use strict';
const crypto=require('crypto');
const db=require('./db');
const D=require('./domain');
const rt=require('./realtime');
const telegram=require('./telegram');
const config=require('./config');
const payment=require('./yookassa');
const {parseRequest,matchFavorites}=require('./quick-order-core');
const PAYMENT_TOKEN=String(process.env.SHAURMEG_PAYMENT_PROVIDER_TOKEN||'').trim();
const amount=n=>Math.round(Number(n)||0);
const privateMessage=m=>!!(m&&m.chat?.type==='private'&&String(m.chat.id)===String(m.from?.id)&&/^\d+$/.test(String(m.from.id)));
const say=(api,uid,text,reply_markup)=>api('sendMessage',{chat_id:uid,text,...(reply_markup?{reply_markup}:{})});
const mapButton=()=>({inline_keyboard:[[{text:'Открыть избранное',web_app:{url:config.PUBLIC_APP_URL+'/index.html'}}]]});
async function ensureSchema(){
 if(!db.configured)return;
 await db.query("CREATE TABLE IF NOT EXISTS shaurma_quick_order_intents (id UUID PRIMARY KEY, telegram_user_id TEXT NOT NULL, source_message_id BIGINT NOT NULL, establishment_id TEXT, venue_id TEXT, marker_id BIGINT, item_id TEXT, quantity INT NOT NULL DEFAULT 1, items JSONB NOT NULL DEFAULT '[]'::jsonb, choices JSONB NOT NULL DEFAULT '[]'::jsonb, total INT NOT NULL DEFAULT 0, state TEXT NOT NULL DEFAULT 'selecting', expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW()+INTERVAL '15 minutes', invoice_message_id BIGINT, telegram_payment_charge_id TEXT, provider_payment_charge_id TEXT, order_id BIGINT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(telegram_user_id,source_message_id))");
 await db.query("CREATE UNIQUE INDEX IF NOT EXISTS quick_order_payment_charge_unique ON shaurma_quick_order_intents(telegram_payment_charge_id) WHERE telegram_payment_charge_id IS NOT NULL");
}
async function candidatesFor(uid){
 const r=await db.query('SELECT favorites,first_name,username FROM shaurma_users WHERE telegram_user_id=$1',[uid]);
 const user=r.rows[0],refs=(Array.isArray(user?.favorites)?user.favorites:[]).filter(x=>x?.establishment_id&&x?.item_id).slice(0,200);
 if(!refs.length)return [];
 const ids=[...new Set(refs.map(x=>D.establishmentId(x.establishment_id)).filter(Boolean))];
 if(!ids.length)return [];
 const q=await db.query('SELECT v.establishment_id,v.venue_id,v.name,v.menu,v.config,m.id marker_id FROM shaurma_venues v JOIN shaurmeg_markers m ON m.establishment_id=v.establishment_id AND m.venue_id=v.venue_id WHERE v.establishment_id=ANY($1::text[]) AND v.is_active=TRUE AND m.is_active=TRUE AND COALESCE(m.source_suppressed,FALSE)=FALSE ORDER BY v.establishment_id,m.id',[ids]);
 const found=[];
 for(const ref of refs){
  const est=D.establishmentId(ref.establishment_id),id=String(ref.item_id);
  const markers=q.rows.filter(v=>v.establishment_id===est);
  const v=ref.builder_data?markers.find(x=>String(x.marker_id)===String(ref.marker_id)&&x.venue_id===String(ref.venue_id)):markers[0];
  if(!v)continue;
  let item=null,min=1,max=10;
  if(ref.builder_data){
    const built=D.priceBuilder(v.config||{},ref.builder_data);
    if(built&&/^custom_[a-z0-9_-]+$/i.test(id))item={id,n:built.n,p:built.p,q:1,detail:built.detail,builder:built.builder};
  }else{
    const menu=Array.isArray(v.menu)?v.menu:[],src=menu.find(x=>String(x?.id)===id);
    const sections=new Set(D.menuSections(v.config||{},menu).map(s=>String(s.id)));
    if(!src||!sections.has(String(src.c||src.category||''))||!D.menuItemAvailableNow(src,v.config?.timezone||'Europe/Moscow'))continue;
    const priced=D.menuSelectionPrice(src,{},{});
    if(!priced)continue; // Do not guess required menu modifiers.
    item={id,n:String(src.n||src.name||''),p:priced.price,q:1,detail:String(priced.detail||''),selection:{},choices:{}};
    min=Math.max(1,Math.floor(Number(src.min_qty)||1));
    max=Math.max(min,Math.min(50,Math.floor(Number(src.max_qty)||50)));
  }
  if(!item||!Number.isFinite(Number(item.p))||item.p<=0)continue;
  found.push({establishment_id:est,venue_id:v.venue_id,marker_id:String(v.marker_id),item_id:id,name:item.n,
    venue_name:v.name,detail:item.detail,item,price:amount(item.p),min,max});
 }
 return found;
}
const snapshot=c=>({establishment_id:c.establishment_id,venue_id:c.venue_id,marker_id:c.marker_id,item_id:c.item_id,
 name:c.name,venue_name:c.venue_name,item:c.item,price:c.price});
async function makeIntent(uid,messageId,matches,quantity){
 const single=matches.length===1,c=single?matches[0]:null,item=c?{...c.item,q:quantity}:null,id=crypto.randomUUID();
 const q=await db.query('INSERT INTO shaurma_quick_order_intents(id,telegram_user_id,source_message_id,establishment_id,venue_id,marker_id,item_id,quantity,items,choices,total,state) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11,$12) ON CONFLICT(telegram_user_id,source_message_id) DO NOTHING RETURNING *',
  [id,uid,messageId,c?.establishment_id||null,c?.venue_id||null,c?.marker_id||null,c?.item_id||null,quantity,
   JSON.stringify(item?[item]:[]),JSON.stringify(matches.map(snapshot)),item?amount(item.p*quantity):0,single?'draft':'selecting']);
 return q.rows[0]||null;
}
async function invoice(id,uid,api){
 if(await attemptAutopay(id,uid,api))return;
 const q=await db.query("UPDATE shaurma_quick_order_intents SET state='invoicing',updated_at=NOW() WHERE id=$1 AND telegram_user_id=$2 AND state='draft' AND expires_at>NOW() RETURNING *",[id,uid]);
 const x=q.rows[0];if(!x)return;
 if(!PAYMENT_TOKEN){
  await db.query("UPDATE shaurma_quick_order_intents SET state='payment_unavailable' WHERE id=$1",[id]);
  await say(api,uid,'🥙 '+x.items[0].n+' × '+x.quantity+' · '+x.total+' ₽\n\nПлатёжный провайдер не подключён. Заказ НЕ создан, деньги НЕ списаны. Можно оформить заказ через Mini App.',mapButton());
  return;
 }
 try{
  const receipt=await api('sendInvoice',{chat_id:uid,title:String(x.items[0].n).slice(0,32),
   description:('Shaurmeg · '+x.quantity+' × '+x.items[0].n+' · '+String(x.choices[0]?.venue_name||'')+' · самовывоз').slice(0,255),
   payload:id,provider_token:PAYMENT_TOKEN,currency:'RUB',
   prices:[{label:'Избранное блюдо',amount:x.total*100}]});
  await db.query("UPDATE shaurma_quick_order_intents SET state='invoiced',invoice_message_id=$2,updated_at=NOW() WHERE id=$1 AND state='invoicing'",[id,receipt?.message_id||null]);
 }catch(e){
  console.error('quick_order_invoice',id,e.message);
  await db.query("UPDATE shaurma_quick_order_intents SET state='payment_unavailable' WHERE id=$1",[id]).catch(()=>{});
  await say(api,uid,'Не удалось выставить счёт. Заказ не создан, списания нет.');
 }
}

async function afterPaidOrder(order,uid,api,method){
 rt.pushOwner('order',order);
 rt.pushVenue(order.establishment_id,'order',order);
 rt.pushUser(uid,'order',order);
 telegram.notifyKitchenOrder(order).catch(e=>console.error('quick_order_kitchen',order.id,e.message));
 await say(api,uid,'✅ '+(method==='yookassa'?'Автоплатёж':'Оплата')+' прошёл · '+order.order_number+
   '\n'+order.venue_name+'\n'+order.items.map(i=>'• '+i.n+' × '+i.q).join('\n')+
   '\nИтого: '+order.total+' ₽\nПолучение: самовывоз. Заказ отправлен на кухню.');
}
async function reconcileProviderPayment(paymentId,api=null){
 if(!payment.uuid(paymentId))return false;
 const paid=await payment.getCharge(paymentId);
 const intentId=String(paid?.metadata?.quick_order_id||''),uid=String(paid?.metadata?.telegram_user_id||'');
 if(!payment.uuid(intentId)||!/^\d+$/.test(uid))return false;
 const result=await db.tx(async client=>{
  const q=await client.query('SELECT * FROM shaurma_quick_order_intents WHERE id=$1 FOR UPDATE',[intentId]);
  const x=q.rows[0];
  if(!x||x.telegram_user_id!==uid||x.telegram_payment_charge_id||
      x.provider_payment_charge_id&&x.provider_payment_charge_id!==paymentId||
      !['charging','charge_pending','completed'].includes(x.state))return {invalid:true};
  if(x.state==='completed')return {duplicate:true};
  if(paid.status==='canceled'){
   await client.query("UPDATE shaurma_quick_order_intents SET state='payment_failed',provider_payment_charge_id=$2,updated_at=NOW() WHERE id=$1",[intentId,paymentId]);
   return {failed:true,uid};
  }
  if(!payment.validatedCharge(paid,{intentId,userId:uid,total:x.total,paymentId})){
   if(paid.status==='pending'||paid.status==='waiting_for_capture'){
    await client.query("UPDATE shaurma_quick_order_intents SET state='charge_pending',provider_payment_charge_id=$2,updated_at=NOW() WHERE id=$1",[intentId,paymentId]);
    return {pending:true,uid};
   }
   return {invalid:true};
  }
  const userq=await client.query('SELECT first_name,username FROM shaurma_users WHERE telegram_user_id=$1',[uid]);
  const user=userq.rows[0]||{},choice=x.choices[0]||{};
  const num='SC-Q-'+Date.now().toString(36).toUpperCase()+'-'+crypto.randomBytes(3).toString('hex').toUpperCase();
  const oq=await client.query("INSERT INTO shaurma_orders(order_number,items,total,customer_name,status,source,telegram_user_id,telegram_username,telegram_first_name,fulfillment_type,payment_status,payment_method,venue_id,venue_name,establishment_id,marker_id) VALUES($1,$2::jsonb,$3,$4,'new','telegram-autopay',$5,$6,$7,'cafe','paid','card',$8,$9,$10,$11) RETURNING *",
   [num,JSON.stringify(x.items),x.total,String(user.first_name||'Гость').slice(0,120),uid,user.username||null,
    user.first_name||null,x.venue_id,choice.venue_name||'Заведение',x.establishment_id,x.marker_id]);
  const order=oq.rows[0];
  await client.query("UPDATE shaurma_quick_order_intents SET state='completed',order_id=$2,provider_payment_charge_id=$3,updated_at=NOW() WHERE id=$1",[intentId,order.id,paymentId]);
  return {order,uid};
 });
 if(result.order){
  // Telegram notification uses the same kitchen/status path as the Mini App.
  const notify=api||((method,body)=>telegram.sendClientMessage(body.chat_id,body.text,body.reply_markup));
  await afterPaidOrder(result.order,uid,notify,'yookassa');
 }
 if(result.failed){
  const notifier=api||((method,body)=>telegram.sendClientMessage(body.chat_id,body.text,body.reply_markup));
  await say(notifier,uid,'❌ Автоплатёж отклонён. Заказ не отправлен.');
 }
 return result;
}
async function attemptAutopay(id,uid,api){
 if(!payment.enabled())return false;
 const uq=await db.query("SELECT payment_provider,payment_method_id,autopay_enabled,autopay_max_rub,autopay_consent_at,autopay_consent_version FROM shaurma_users WHERE telegram_user_id=$1",[uid]);
 const u=uq.rows[0]||{};
 if(!u.autopay_enabled||u.payment_provider!=='yookassa'||!payment.uuid(u.payment_method_id)||
    u.autopay_consent_version!=='quick-orders-v1'||!u.autopay_consent_at)return false;
 const currentQ=await db.query("SELECT * FROM shaurma_quick_order_intents WHERE id=$1 AND telegram_user_id=$2 AND state='draft' AND expires_at>NOW()",[id,uid]);
 const draft=currentQ.rows[0];
 if(!draft)return true;
 const choices=await candidatesFor(uid);
 const item=choices.find(v=>v.establishment_id===draft.establishment_id&&v.venue_id===draft.venue_id&&
   v.item_id===draft.item_id&&v.marker_id===String(draft.marker_id));
 if(!item||draft.quantity<item.min||draft.quantity>item.max||item.price*draft.quantity!==Number(draft.total)){
  await db.query("UPDATE shaurma_quick_order_intents SET state='stale',updated_at=NOW() WHERE id=$1 AND state='draft'",[id]);
  await say(api,uid,'Цена или доступность избранного блюда изменились. Заказ не оплачен. Отправьте команду ещё раз.');
  return true;
 }
 const claimed=await db.query("UPDATE shaurma_quick_order_intents SET state='charging',updated_at=NOW() WHERE id=$1 AND telegram_user_id=$2 AND state='draft' AND expires_at>NOW() AND total>0 AND total<=$3 RETURNING *",[id,uid,Number(u.autopay_max_rub)||0]);
 const x=claimed.rows[0];
 if(!x){
  await say(api,uid,'Сумма заказа превышает установленный лимит автосписания. Вы можете оформить заказ через обычную оплату.');
  return false; // Fallback to invoice when available.
 }
 try{
  const result=await payment.createCharge({id,userId:uid,amount:x.total,methodId:u.payment_method_id,description:'Shaurmeg · '+String(x.items[0]?.n||'Заказ')});
  if(!payment.uuid(result?.id))throw new Error('no_gateway_payment_id');
  // Must commit the gateway charge ID before processing the success event.
  await db.query("UPDATE shaurma_quick_order_intents SET provider_payment_charge_id=$2,updated_at=NOW() WHERE id=$1 AND state='charging'",[id,result.id]);
  const status=await reconcileProviderPayment(result.id,api);
  if(status?.pending){
   const link=String(result?.confirmation?.confirmation_url||'');
   await say(api,uid,'💳 Платёж проходит проверку. Заказ на кухню будет отправлен только после подтверждения оплаты.'+
    (link&&/^https:\/\//.test(link)?'\nДополнительное подтверждение: '+link:''));
  }
  return true;
 }catch(e){
  // This might be an indeterminate network result. NEVER issue a second charge
  // with a different idempotency key or silently submit an unpaid order.
  console.error('quick_order_charge_uncertain',id,String(e.message).slice(0,100));
  await say(api,uid,'💳 Проверяем результат оплаты. Пока нет подтверждения, заказ не отправлен. Не повторяйте команду до проверки статуса.');
  return true;
 }
}

async function onMessage(m,api){
 if(!privateMessage(m))return false;
 if(m.successful_payment){await onPayment(m,api);return true}
 const parsed=parseRequest(m.text);if(!parsed)return false;
 const uid=String(m.from.id);
 if(parsed.error){await say(api,uid,'Уточните количество и название: «Закажи две лепёшки с сыром».');return true}
 const fav=await candidatesFor(uid);
 if(!fav.length){await say(api,uid,'Добавьте блюдо в избранное внутри Шаурмега, затем напишите «Закажи ...».',mapButton());return true}
 const matches=matchFavorites(parsed,fav).filter(x=>parsed.quantity>=x.min&&parsed.quantity<=x.max);
 if(!matches.length){await say(api,uid,'Точного совпадения среди доступных избранных блюд нет. Уточните название.',mapButton());return true}
 if(matches.length>6){await say(api,uid,'Нашлось слишком много вариантов. Уточните заведение и название.');return true}
 if(matches.length===1){
  const match=matches[0];
  const repeated=await db.query("SELECT id FROM shaurma_quick_order_intents WHERE telegram_user_id=$1 AND establishment_id=$2 AND item_id=$3 AND quantity=$4 AND state IN ('draft','charging','charge_pending','invoiced','completed') AND created_at>NOW()-INTERVAL '30 seconds' LIMIT 1",[uid,match.establishment_id,match.item_id,parsed.quantity]);
  if(repeated.rows.length){await say(api,uid,'Похожий заказ уже оформляется или только что оформлен. Проверьте сообщения и историю заказов.');return true}
 }
 const x=await makeIntent(uid,m.message_id,matches,parsed.quantity);
 if(!x)return true; // Deduplicate Telegram redelivery.
 if(matches.length===1){await invoice(x.id,uid,api);return true}
 await say(api,uid,'Есть несколько совпадений. Выберите конкретное заведение и блюдо:',
  {inline_keyboard:matches.map((c,i)=>[{text:(c.venue_name+' · '+c.name+' · '+amount(c.price*parsed.quantity)+' ₽').slice(0,64),
    callback_data:'qf:'+x.id+':'+i}])});
 return true;
}
async function onCallback(cb,api){
 const m=String(cb?.data||'').match(/^qf:([a-f0-9-]{36}):([0-5])$/);
 if(!m)return false;
 const uid=String(cb.from?.id||'');
 const q=await db.query("SELECT * FROM shaurma_quick_order_intents WHERE id=$1 AND telegram_user_id=$2 AND state='selecting' AND expires_at>NOW()",[m[1],uid]);
 const x=q.rows[0],saved=x?.choices?.[Number(m[2])];
 if(!saved){
  await api('answerCallbackQuery',{callback_query_id:cb.id,text:'Выбор устарел. Напишите заказ снова.',show_alert:true});return true;
 }
 const candidates=await candidatesFor(uid);
 const c=candidates.find(z=>z.establishment_id===saved.establishment_id&&z.item_id===saved.item_id&&z.marker_id===String(saved.marker_id));
 if(!c||x.quantity<c.min||x.quantity>c.max){
  await api('answerCallbackQuery',{callback_query_id:cb.id,text:'Блюдо недоступно. Создайте заказ заново.',show_alert:true});return true;
 }
 const item={...c.item,q:x.quantity};
 const u=await db.query("UPDATE shaurma_quick_order_intents SET state='draft',establishment_id=$3,venue_id=$4,marker_id=$5,item_id=$6,items=$7::jsonb,choices=$8::jsonb,total=$9,updated_at=NOW() WHERE id=$1 AND telegram_user_id=$2 AND state='selecting' RETURNING id",
  [x.id,uid,c.establishment_id,c.venue_id,c.marker_id,c.item_id,JSON.stringify([item]),JSON.stringify([snapshot(c)]),amount(item.p*item.q)]);
 await api('answerCallbackQuery',{callback_query_id:cb.id,text:u.rows[0]?'Выбрано':'Уже обработано'});
 if(u.rows[0])await invoice(x.id,uid,api);
 return true;
}
async function onPreCheckout(p,api){
 const uid=String(p?.from?.id||''),id=String(p?.invoice_payload||'');
 let ok=false,error='Счёт устарел. Создайте заказ заново.';
 if(/^[a-f0-9-]{36}$/.test(id)){
  const q=await db.query("SELECT * FROM shaurma_quick_order_intents WHERE id=$1 AND telegram_user_id=$2 AND state='invoiced' AND expires_at>NOW()",[id,uid]);
  const x=q.rows[0];
  if(x&&p.currency==='RUB'&&Number(p.total_amount)===x.total*100){
   const candidates=await candidatesFor(uid);
   ok=candidates.some(c=>c.establishment_id===x.establishment_id&&c.item_id===x.item_id&&c.marker_id===String(x.marker_id)&&c.price*x.quantity===x.total);
   if(!ok)error='Цена или наличие блюда изменились. Отправьте команду заново.';
  }
 }
 await api('answerPreCheckoutQuery',{pre_checkout_query_id:p.id,ok,...(ok?{}:{error_message:error})});
 return true;
}
async function onPayment(m,api){
 if(!privateMessage(m))return;
 const p=m.successful_payment,uid=String(m.from.id),id=String(p.invoice_payload||'');
 if(!/^[a-f0-9-]{36}$/.test(id))return;
 const result=await db.tx(async client=>{
  const q=await client.query('SELECT * FROM shaurma_quick_order_intents WHERE id=$1 FOR UPDATE',[id]),x=q.rows[0];
  if(!x||x.telegram_user_id!==uid||p.currency!=='RUB'||Number(p.total_amount)!==x.total*100||
     !['invoiced','completed'].includes(x.state))return {error:true};
  if(x.state==='completed')return {duplicate:true};
  const userq=await client.query('SELECT first_name,username FROM shaurma_users WHERE telegram_user_id=$1',[uid]);
  const user=userq.rows[0]||{},choice=x.choices[0]||{};
  const num='SC-Q-'+Date.now().toString(36).toUpperCase()+'-'+crypto.randomBytes(3).toString('hex').toUpperCase();
  const oq=await client.query("INSERT INTO shaurma_orders(order_number,items,total,customer_name,status,source,telegram_user_id,telegram_username,telegram_first_name,fulfillment_type,payment_status,payment_method,venue_id,venue_name,establishment_id,marker_id) VALUES($1,$2::jsonb,$3,$4,'new','telegram-quick-order',$5,$6,$7,'cafe','paid','card',$8,$9,$10,$11) RETURNING *",
   [num,JSON.stringify(x.items),x.total,String(user.first_name||'Гость').slice(0,120),uid,user.username||null,
    user.first_name||null,x.venue_id,choice.venue_name||'Заведение',x.establishment_id,x.marker_id]);
  const order=oq.rows[0];
  await client.query("UPDATE shaurma_quick_order_intents SET state='completed',order_id=$2,telegram_payment_charge_id=$3,provider_payment_charge_id=$4,updated_at=NOW() WHERE id=$1",
   [id,order.id,p.telegram_payment_charge_id||null,p.provider_payment_charge_id||null]);
  return {order};
 });
 if(result.error){
  console.error('QUICK_ORDER_PAID_REQUIRES_REVIEW',id,uid,String(p.telegram_payment_charge_id||''));
  await say(api,uid,'Платёж получен, но оформление заказа требует проверки. Сообщите поддержке ID платежа: '+String(p.telegram_payment_charge_id||''));return;
 }
 if(!result.order)return;
 const o=result.order;
 rt.pushOwner('order',o);rt.pushVenue(o.establishment_id,'order',o);rt.pushUser(uid,'order',o);
 telegram.notifyKitchenOrder(o).catch(e=>console.error('quick_order_kitchen',o.id,e.message));
 await say(api,uid,'✅ Оплачено · '+o.order_number+'\n'+o.venue_name+'\n'+o.items.map(i=>'• '+i.n+' × '+i.q).join('\n')+
  '\nИтого: '+o.total+' ₽\nПолучение: самовывоз. Заказ отправлен на кухню.');
}
async function handleUpdate(update,api){
 if(update?.pre_checkout_query)return onPreCheckout(update.pre_checkout_query,api);
 if(update?.callback_query)return onCallback(update.callback_query,api);
 if(update?.message)return onMessage(update.message,api);
 return false;
}
module.exports={ensureSchema,handleUpdate,candidatesFor,onMessage,onCallback,onPreCheckout,reconcileProviderPayment};
