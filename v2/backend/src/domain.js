'use strict';
const crypto=require('crypto');

function venueId(v){
  const id=String(v||'').trim().toLowerCase().replace(/^venue_/,'');
  return /^[a-z0-9_-]{1,64}$/.test(id)?id:null;
}
function establishmentIdForVenue(v){
  const id=venueId(v);if(!id)return null;
  return 'SC-MSK-'+crypto.createHash('md5').update(id).digest('hex').slice(0,10).toUpperCase();
}
function establishmentId(v){
  const id=String(v||'').trim().toUpperCase();
  return /^SC-MSK-[A-F0-9]{10}$/.test(id)?id:null;
}
function markerId(v){
  const id=String(v||'').trim();
  return /^\d{1,20}$/.test(id)?id:null;
}
function clamp(n,min,max){return Math.max(min,Math.min(max,n))}
function hex(v,fallback){
  const s=String(v||'').trim().toLowerCase();
  return /^#[0-9a-f]{6}$/.test(s)?s:fallback;
}
function markerStyle(value={}){
  const v=value&&typeof value==='object'&&!Array.isArray(value)?value:{};
  return {
    icon:String(v.icon||'🥙').slice(0,8),
    background:hex(v.background,'#10221b'),
    border:hex(v.border,'#f6f3e9'),
    text:hex(v.text,'#ffffff'),
    glow:hex(v.glow,'#7ee3a8'),
    shape:['pin','circle','rounded','square'].includes(v.shape)?v.shape:'rounded',
    size:clamp(Number(v.size)||44,28,72),
    scale:clamp(Number(v.scale)||1,.65,1.8),
    opacity:clamp(Number(v.opacity)||1,.3,1),
    pulse:v.pulse!==false,
    label_visible:v.label_visible!==false
  };
}
function menuSections(config={},menu=[]){
  const raw=Array.isArray(config.menu_sections)?config.menu_sections:[];
  if(raw.length)return raw.filter(x=>x&&x.active!==false).map((x,i)=>({id:String(x.id||'section_'+i),name:String(x.name||x.id||'Раздел'),emoji:String(x.emoji||''),order:i}));
  const ids=[...new Set((Array.isArray(menu)?menu:[]).map(x=>String(x.c||x.category||'shawarma')))];
  return ids.map((id,i)=>({id,name:id==='shawarma'?'Шаурма':id==='drinks'?'Напитки':id==='extras'?'Допы':id==='bakery'?'Выпечка':id,emoji:'',order:i}));
}
function normalizeMenu(input){
  if(!Array.isArray(input))return [];
  return input.slice(0,250).map((x,i)=>({
    id:String(x.id||'item_'+i).trim().slice(0,100),
    n:String(x.n||x.name||'Позиция').trim().slice(0,160),
    c:String(x.c||x.category||'shawarma').trim().toLowerCase().replace(/[^a-z0-9а-я_-]+/gi,'_').slice(0,64)||'shawarma',
    d:String(x.d||x.description||'').trim().slice(0,700),
    p:clamp(Number(x.p??x.price)||0,0,100000),
    image:String(x.image||x.i||'').trim().slice(0,700000),
    active:x.active!==false
  })).filter(x=>x.id&&x.n);
}
function orderNumber(){return 'SC-'+Date.now().toString().slice(-7)+'-'+Math.floor(10+Math.random()*90)}
module.exports={venueId,establishmentId,establishmentIdForVenue,markerId,markerStyle,menuSections,normalizeMenu,orderNumber,clamp};
