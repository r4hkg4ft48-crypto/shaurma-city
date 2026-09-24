'use strict';
const express=require('express');
const config=require('./config');
const db=require('./db');
const {ensureSchema}=require('./schema');
const {router}=require('./routes');
const telegram=require('./telegram');
const realcity=require('./realcity-service');

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
app.use((req,res)=>res.status(404).json({error:'not_found'}));

ensureSchema()
 .then(()=>realcity.bootstrap())
 .then(()=>telegram.sync())
 .catch(e=>console.error('bootstrap',e.message))
 .finally(()=>app.listen(config.PORT,()=>console.log('Shaurmeg V2 API on '+config.PORT+' · db='+db.configured)));
