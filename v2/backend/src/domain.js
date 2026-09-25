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
const VENUE_THEME_KEYS=['emerald','amber','cobalt','cherry','violet','graphite','ocean','citrus'];
function venueThemeKey(seed){
  const s=String(seed||'shaurmeg');
  let h=2166136261;
  for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)}
  return VENUE_THEME_KEYS[Math.abs(h) % VENUE_THEME_KEYS.length];
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
const LEGACY_LEPESH_BUILDER={
  types:[{id:'shawarma',name:'Шаурма',price:330},{id:'flatbread',name:'Лепёшка',price:320}],
  sauces:[
    {id:'standard',name:'Стандартные соусы'},{id:'big_tasty',name:'Биг Тейсти'},{id:'bbq',name:'Барбекю'},
    {id:'pomegranate',name:'Гранатовый'},{id:'cheese',name:'Сырный'},{id:'garlic',name:'Чесночный'}
  ],
  extras:[
    {id:'fries',name:'Картошка фри'},{id:'jalapeno',name:'Халапеньо'},{id:'onion',name:'Лук'},{id:'cheese',name:'Сыр'}
  ],
  min_sauces:1,max_sauces:6,max_extras:4
};
function builderConfig(config={}){
  if(config.builder_enabled!==true&&!config.builder)return null;
  const raw=config.builder&&typeof config.builder==='object'?config.builder:null;
  if(!raw)return JSON.parse(JSON.stringify(LEGACY_LEPESH_BUILDER));
  const norm=(arr,withPrice=false)=>(Array.isArray(arr)?arr:[]).slice(0,30).map((x,i)=>({
    id:String(x.id||'opt_'+i).trim().slice(0,60),
    name:String(x.name||x.n||x.id||'Опция').trim().slice(0,100),
    ...(withPrice?{price:clamp(Number(x.price??x.p)||0,0,100000)}:{})
  })).filter(x=>x.id&&x.name);
  const types=norm(raw.types,true),sauces=norm(raw.sauces),extras=norm(raw.extras);
  if(!types.length||!sauces.length)return null;
  return {types,sauces,extras,min_sauces:clamp(Number(raw.min_sauces)||1,1,10),max_sauces:clamp(Number(raw.max_sauces)||sauces.length,1,sauces.length),max_extras:clamp(Number(raw.max_extras)||extras.length,0,extras.length)};
}
function priceBuilder(config,payload={}){
  const cfg=builderConfig(config);if(!cfg)return null;
  const type=cfg.types.find(x=>x.id===String(payload.type||''));if(!type)return null;
  const sauceIds=[...new Set(Array.isArray(payload.sauces)?payload.sauces.map(String):[])];
  const extraIds=[...new Set(Array.isArray(payload.extras)?payload.extras.map(String):[])];
  const sauces=sauceIds.map(id=>cfg.sauces.find(x=>x.id===id)).filter(Boolean);
  const extras=extraIds.map(id=>cfg.extras.find(x=>x.id===id)).filter(Boolean);
  if(sauces.length!==sauceIds.length||extras.length!==extraIds.length)return null;
  if(sauces.length<cfg.min_sauces||sauces.length>cfg.max_sauces||extras.length>cfg.max_extras)return null;
  const detail='Соусы: '+sauces.map(x=>x.name).join(', ')+' · Добавки: '+(extras.length?extras.map(x=>x.name).join(', '):'без добавок');
  return {id:'custom_builder',n:type.name+' · своя сборка',p:type.price,detail,builder:{type:type.id,sauces:sauceIds,extras:extraIds}};
}
function orderNumber(){return 'SC-'+Date.now().toString().slice(-7)+'-'+Math.floor(10+Math.random()*90)}
module.exports={venueId,establishmentId,establishmentIdForVenue,markerId,markerStyle,menuSections,normalizeMenu,builderConfig,priceBuilder,LEGACY_LEPESH_BUILDER,orderNumber,clamp,venueThemeKey,VENUE_THEME_KEYS};
