'use strict';
const owner=new Set(),users=new Map(),venues=new Map();
function frame(event,payload){return 'event: '+event+'\ndata: '+JSON.stringify(payload)+'\n\n'}
function add(set,res){set.add(res);const timer=setInterval(()=>{try{res.write(': ping\n\n')}catch{}},20000);return()=>{clearInterval(timer);set.delete(res)}}
function send(set,event,payload){const data=frame(event,payload);for(const r of set){try{r.write(data)}catch{set.delete(r)}}}
function group(map,key){key=String(key);if(!map.has(key))map.set(key,new Set());return map.get(key)}
module.exports={
 stream(res,set){res.setHeader('Content-Type','text/event-stream');res.setHeader('Cache-Control','no-cache,no-transform');res.setHeader('Connection','keep-alive');res.flushHeaders?.();res.write(frame('ready',{ok:true}));return add(set,res)},
 ownerStream:owner,userSet:id=>group(users,id),venueSet:id=>group(venues,id),
 pushOwner:(e,p)=>send(owner,e,p),pushUser:(id,e,p)=>send(group(users,id),e,p),pushVenue:(id,e,p)=>send(group(venues,id),e,p)
};
