'use strict';
// Dedicated CPU worker: original photographs and rectification run outside
// the public HTTP event loop. No synthetic image infill or upscaling.
const {parentPort,workerData}=require('worker_threads');
const P=require('./realcity-photo');
(async()=>{
 const files=new Map((workerData.sources||[]).map(x=>[String(x.id),Buffer.from(x.content)]));
 const result=await P.buildMaterial(workerData.spec,async id=>files.get(String(id))||null);
 parentPort.postMessage({ok:true,material:result});
})().catch(e=>parentPort.postMessage({ok:false,error:String(e?.message||'photo_worker_failed').slice(0,250)}));
