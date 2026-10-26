'use strict';
const express=require('express');
const path=require('path');
const config=require('./config');
const db=require('./db');
const {ensureSchema}=require('./schema');
const {router}=require('./routes');
const telegram=require('./telegram');
const channelBot=require('./channel-bot');
const channelAssets=require('./channel-assets');
const realcity=require('./realcity-service');
const coordinator=require('./menu-coordinator');
const coordinatorBot=require('./coordinator-bot');

const app=express();
app.disable('x-powered-by');
app.use(express.json({limit:'18mb'}));
app.use((req,res,next)=>{
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Headers','Content-Type,Authorization,X-Owner-Token');
  res.setHeader('Access-Control-Allow-Methods','GET,POST,PUT,PATCH,DELETE,OPTIONS');
  if(req.method==='OPTIONS')return res.sendStatus(204);next();
});
app.use('/api/v2',router);
telegram.install(app);
require('./autopay').install(app);
coordinator.install(app);
coordinatorBot.install(app);
channelBot.install(app);
channelAssets.install(app);
if(config.UNIFIED_MODE){
  app.use(express.static(path.join(__dirname,'../../frontend'),{index:'index.html',setHeaders:res=>res.setHeader('Cache-Control','no-store')}));
  app.get('/admin',(req,res)=>res.redirect(302,'/admin-unified.html'));
}
app.use((req,res)=>res.status(404).json({error:'not_found'}));

ensureSchema()
 .then(()=>require('./quick-order-bot').ensureSchema())
 .then(()=>require('./autopay').ensureSchema())
 .then(()=>coordinator.ensureSchema())
 .then(()=>realcity.bootstrap())
 .then(()=>config.UNIFIED_MODE?null:channelBot.bootstrap())
 .then(()=>telegram.sync())
 .then(()=>config.UNIFIED_MODE?null:coordinatorBot.sync())
 .catch(e=>console.error('bootstrap',e.message))
 .finally(()=>app.listen(config.PORT,()=>{console.log('Shaurmeg V2 API on '+config.PORT+' · db='+db.configured);const quickOrderRetry=setInterval(()=>Promise.allSettled([require('./quick-order-bot').retryPendingKitchenOrders(),require('./quick-order-bot').reconcilePendingProviderPayments()]).catch(e=>console.error('quick order delivery recovery',e.message)),60000);quickOrderRetry.unref?.();(config.UNIFIED_MODE?Promise.resolve({enabled:false}):channelBot.sync().then(()=>channelBot.publishLaunchMissing())).then(r=>{if(r?.enabled)console.log('Channel launch publish · '+r.published+' published · '+(r.failed||0)+' failed')}).catch(e=>console.error('channel bot post-start sync',e.message))}));
