'use strict';
const crypto=require('crypto');
const db=require('./db');
const auth=require('./auth');
const payment=require('./yookassa');
const config=require('./config');
const quick=require('./quick-order-bot');
async function ensureSchema(){
 if(!db.configured)return;
 await db.query("ALTER TABLE shaurma_users ADD COLUMN IF NOT EXISTS autopay_max_rub INT NOT NULL DEFAULT 0");
 await db.query("ALTER TABLE shaurma_users ADD COLUMN IF NOT EXISTS autopay_consent_at TIMESTAMPTZ");
 await db.query("ALTER TABLE shaurma_users ADD COLUMN IF NOT EXISTS autopay_consent_version TEXT");
 await db.query("CREATE TABLE IF NOT EXISTS shaurma_payment_bindings (id UUID PRIMARY KEY, telegram_user_id TEXT NOT NULL, payment_method_id TEXT, state TEXT NOT NULL DEFAULT 'pending', max_order_rub INT NOT NULL, consent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW()+INTERVAL '1 day', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
 await db.query("CREATE INDEX IF NOT EXISTS idx_shaurma_payment_bindings_user ON shaurma_payment_bindings(telegram_user_id,created_at DESC)");
}
function install(app){
 const base='/api/v2/me/autopay';
 app.get(base+'/status',auth.requireSession('client'),async(req,res)=>{
  try{
   const uid=String(req.session.sub);
   const u=await db.query('SELECT payment_provider,payment_card_brand,payment_card_last4,autopay_enabled,autopay_max_rub,autopay_consent_at FROM shaurma_users WHERE telegram_user_id=$1',[uid]);
   const user=u.rows[0]||{};
   const pending=await db.query("SELECT id FROM shaurma_payment_bindings WHERE telegram_user_id=$1 AND state='pending' AND expires_at>NOW() ORDER BY created_at DESC LIMIT 1",[uid]);
   const linked=!!(user.autopay_enabled&&user.payment_provider==='yookassa'&&user.payment_card_last4&&payment.enabled());
   res.setHeader('Cache-Control','no-store');
   res.json({configured:payment.enabled(),linked,provider:user.payment_provider||null,card_brand:user.payment_card_brand||null,
    card_last4:user.payment_card_last4||null,maximum:Number(user.autopay_max_rub)||0,
    pending_binding_id:pending.rows[0]?.id||null,terms:'quick-orders-v1'});
  }catch(e){res.status(500).json({error:'autopay_status_failed'})}
 });
 app.post(base+'/bind',auth.requireSession('client'),async(req,res)=>{
  try{
   if(!payment.enabled())return res.status(503).json({error:'payment_provider_not_configured'});
   const uid=String(req.session.sub),accept=req.body?.accept_recurring_terms===true;
   const max=Number(req.body?.max_order_rub);
   if(!accept||!Number.isInteger(max)||max<100||max>5000)return res.status(400).json({error:'invalid_autopay_consent_or_limit'});
   const id=crypto.randomUUID(),url=new URL('/index.html',config.PUBLIC_APP_URL);
   url.searchParams.set('autopay_return','1');
   await db.query("INSERT INTO shaurma_payment_bindings(id,telegram_user_id,max_order_rub,consent_at) VALUES($1,$2,$3,NOW())",[id,uid,max]);
   const card=await payment.createBinding(id,uid,url.toString());
   if(!payment.uuid(card?.id)||!/^https:\/\//.test(String(card?.confirmation?.confirmation_url||''))){
    return res.status(502).json({error:'card_binding_unavailable'});
   }
   await db.query("UPDATE shaurma_payment_bindings SET payment_method_id=$2,updated_at=NOW() WHERE id=$1",[id,card.id]);
   res.setHeader('Cache-Control','no-store');
   res.json({ok:true,confirmation_url:card.confirmation.confirmation_url,binding_id:id,maximum:max});
  }catch(e){console.error('autopay bind',String(e.message).slice(0,100));res.status(502).json({error:'card_binding_failed'})}
 });
 app.post(base+'/confirm',auth.requireSession('client'),async(req,res)=>{
  try{
   const uid=String(req.session.sub);
   const q=await db.query("SELECT * FROM shaurma_payment_bindings WHERE telegram_user_id=$1 AND state='pending' AND expires_at>NOW() AND payment_method_id IS NOT NULL ORDER BY created_at DESC LIMIT 1",[uid]);
   const binding=q.rows[0];
   if(!binding)return res.status(404).json({error:'no_pending_card_binding'});
   const card=await payment.getBinding(binding.payment_method_id);
   if(card?.status!=='active'||card?.saved!==true||card.type!=='bank_card')return res.status(409).json({error:'card_not_confirmed'});
   if(card?.metadata?.binding_id!==binding.id||card?.metadata?.telegram_user_id!==uid)return res.status(409).json({error:'card_binding_identity_mismatch'});
   const summary=payment.cardSummary(card);
   if(!/^\d{4}$/.test(summary.last4))return res.status(409).json({error:'card_details_missing'});
   await db.tx(async c=>{
    const updated=await c.query("UPDATE shaurma_payment_bindings SET state='active',updated_at=NOW() WHERE id=$1 AND state='pending' RETURNING id",[binding.id]);
    if(!updated.rows.length)return;
    await c.query("UPDATE shaurma_payment_bindings SET state='replaced',updated_at=NOW() WHERE telegram_user_id=$1 AND id<>$2 AND state='active'",[uid,binding.id]);
    await c.query("UPDATE shaurma_users SET payment_provider='yookassa',payment_method_id=$2,payment_card_brand=$3,payment_card_last4=$4,autopay_enabled=TRUE,autopay_max_rub=$5,autopay_consent_at=$6,autopay_consent_version='quick-orders-v1',updated_at=NOW() WHERE telegram_user_id=$1",
      [uid,card.id,summary.brand,summary.last4,binding.max_order_rub,binding.consent_at]);
   });
   res.json({ok:true,card_brand:summary.brand,card_last4:summary.last4,maximum:binding.max_order_rub});
  }catch(e){console.error('autopay confirm',String(e.message).slice(0,100));res.status(502).json({error:'card_confirmation_failed'})}
 });
 app.post(base+'/disable',auth.requireSession('client'),async(req,res)=>{
  try{
   const uid=String(req.session.sub);
   await db.tx(async c=>{
    await c.query("UPDATE shaurma_users SET autopay_enabled=FALSE,payment_method_id=NULL,payment_card_last4=NULL,payment_card_brand=NULL,autopay_max_rub=0,autopay_consent_at=NULL,autopay_consent_version=NULL,updated_at=NOW() WHERE telegram_user_id=$1",[uid]);
    await c.query("UPDATE shaurma_payment_bindings SET state='revoked',updated_at=NOW() WHERE telegram_user_id=$1 AND state IN ('pending','active')",[uid]);
   });
   res.json({ok:true,linked:false});
  }catch(e){res.status(500).json({error:'autopay_disable_failed'})}
 });
 // A YooKassa callback is untrusted until payment details have been verified
 // by fetching the payment from the configured merchant account.
 app.post('/api/v2/payments/yookassa/webhook',async(req,res)=>{
  try{
   const event=String(req.body?.event||''),obj=req.body?.object||{};
   if(!['payment.succeeded','payment.canceled','payment.waiting_for_capture'].includes(event)||!payment.uuid(obj?.id))return res.sendStatus(200);
   await quick.reconcileProviderPayment(obj.id);
   res.sendStatus(200);
  }catch(e){console.error('yookassa webhook processing',String(e.message).slice(0,120));res.sendStatus(503)}
 });
}
module.exports={ensureSchema,install};
