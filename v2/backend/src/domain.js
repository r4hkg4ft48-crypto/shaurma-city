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
const DEFAULT_VENUE_THEME={primary:'#D94343',secondary:'#13233B',tone:'balanced'};
function hexRgb(v){
  const s=hex(v,'#000000').slice(1);
  return [parseInt(s.slice(0,2),16),parseInt(s.slice(2,4),16),parseInt(s.slice(4,6),16)];
}
function colorDistance(a,b){
  const A=hexRgb(a),B=hexRgb(b);
  return Math.sqrt((A[0]-B[0])**2+(A[1]-B[1])**2+(A[2]-B[2])**2);
}
function normalizeVenueTheme(value={}){
  const v=value&&typeof value==='object'&&!Array.isArray(value)?value:{};
  let primary=hex(v.primary,DEFAULT_VENUE_THEME.primary).toUpperCase();
  let secondary=hex(v.secondary,DEFAULT_VENUE_THEME.secondary).toUpperCase();
  const tone=['dark','light','balanced'].includes(String(v.tone||'').toLowerCase())?String(v.tone).toLowerCase():DEFAULT_VENUE_THEME.tone;
  if(colorDistance(primary,secondary)<58){
    const navy=DEFAULT_VENUE_THEME.secondary,red=DEFAULT_VENUE_THEME.primary;
    secondary=colorDistance(primary,navy)>=58?navy:red;
  }
  return {primary,secondary,tone};
}
function markerStyle(value={}){
  const v=value&&typeof value==='object'&&!Array.isArray(value)?value:{};
  return {
    icon:String(v.icon||'🥙').slice(0,8),
    background:hex(v.background,'#D94343'),
    border:hex(v.border,'#F7F9FC'),
    text:hex(v.text,'#ffffff'),
    glow:hex(v.glow,'#E86565'),
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
    badge:String(x.badge||x.tag||'').trim().slice(0,40),
    featured:x.featured===true,
    display:['auto','main','compact'].includes(String(x.display||''))?String(x.display):'auto',
    image_fit:['cover','contain'].includes(String(x.image_fit||''))?String(x.image_fit):'cover',
    active:x.active!==false
  })).filter(x=>x.id&&x.n);
}
const LEGACY_LEPESH_BUILDER={
  title:'Собери свою шаурму',
  subtitle:'Выбери основу, лаваш, мясо, соусы и добавки',
  types:[{id:'shawarma',name:'Шаурма',price:330},{id:'flatbread',name:'Лепёшка',price:320}],
  breads:[{id:'classic_lavash',name:'Классический лаваш',price:0}],
  meats:[{id:'chicken',name:'Курица',price:0}],
  sauces:[
    {id:'standard',name:'Стандартные соусы',price:0},{id:'big_tasty',name:'Биг Тейсти',price:0},{id:'bbq',name:'Барбекю',price:0},
    {id:'pomegranate',name:'Гранатовый',price:0},{id:'cheese',name:'Сырный',price:0},{id:'garlic',name:'Чесночный',price:0}
  ],
  extras:[
    {id:'fries',name:'Картошка фри',price:0},{id:'jalapeno',name:'Халапеньо',price:0},{id:'onion',name:'Лук',price:0},{id:'cheese',name:'Сыр',price:0}
  ],
  min_sauces:1,max_sauces:6,max_extras:4
};
function builderOptionId(v,prefix,index){
  const raw=String(v||'').trim().toLowerCase().replace(/[^a-z0-9а-я_-]+/gi,'_').replace(/^_+|_+$/g,'').slice(0,48);
  return raw||prefix+'_'+index;
}
function normalizeBuilderOptionList(arr,{priceMode='delta',prefix='opt',limit=40}={}){
  return (Array.isArray(arr)?arr:[]).slice(0,limit).map((x,i)=>{
    const name=String(x?.name||x?.n||x?.id||'Опция').trim().slice(0,120);
    const id=builderOptionId(x?.id||name,prefix,i);
    const rawPrice=priceMode==='base'?(x?.price??x?.p):(x?.price_delta??x?.price??x?.p);
    const price=clamp(Number(rawPrice)||0,0,100000);
    return {id,name,price};
  }).filter(x=>x.id&&x.name);
}
function normalizeBuilderConfig(raw={}){
  const src=raw&&typeof raw==='object'&&!Array.isArray(raw)?raw:{};
  const has=k=>Object.prototype.hasOwnProperty.call(src,k)&&Array.isArray(src[k]);
  const parsedTypes=normalizeBuilderOptionList(src.types,{priceMode:'base',prefix:'type',limit:20});
  const parsedBreads=normalizeBuilderOptionList(src.breads,{priceMode:'delta',prefix:'bread',limit:30});
  const parsedMeats=normalizeBuilderOptionList(src.meats,{priceMode:'delta',prefix:'meat',limit:30});
  const parsedSauces=normalizeBuilderOptionList(src.sauces,{priceMode:'delta',prefix:'sauce',limit:40});
  const parsedExtras=normalizeBuilderOptionList(src.extras,{priceMode:'delta',prefix:'extra',limit:60});
  const types=has('types')?parsedTypes:normalizeBuilderOptionList(LEGACY_LEPESH_BUILDER.types,{priceMode:'base',prefix:'type'});
  const breads=has('breads')?parsedBreads:normalizeBuilderOptionList(LEGACY_LEPESH_BUILDER.breads,{prefix:'bread'});
  const meats=has('meats')?parsedMeats:normalizeBuilderOptionList(LEGACY_LEPESH_BUILDER.meats,{prefix:'meat'});
  const sauces=has('sauces')?parsedSauces:normalizeBuilderOptionList(LEGACY_LEPESH_BUILDER.sauces,{prefix:'sauce'});
  const extras=has('extras')?parsedExtras:normalizeBuilderOptionList(LEGACY_LEPESH_BUILDER.extras,{prefix:'extra'});
  const maxSauces=sauces.length?clamp(Number.isFinite(Number(src.max_sauces))?Number(src.max_sauces):sauces.length,0,sauces.length):0;
  const minSauces=clamp(Number.isFinite(Number(src.min_sauces))?Number(src.min_sauces):(sauces.length?1:0),0,maxSauces);
  return {
    title:String(src.title||LEGACY_LEPESH_BUILDER.title).trim().slice(0,100)||LEGACY_LEPESH_BUILDER.title,
    subtitle:String(src.subtitle||LEGACY_LEPESH_BUILDER.subtitle).trim().slice(0,180),
    types,breads,meats,sauces,extras,
    min_sauces:minSauces,
    max_sauces:maxSauces,
    max_extras:extras.length?clamp(Number.isFinite(Number(src.max_extras))?Number(src.max_extras):extras.length,0,extras.length):0
  };
}
function safeImage(v,limit=900000){
  const s=String(v||'').trim();
  if(!s)return '';
  if(!(s.startsWith('data:image/')||s.startsWith('https://')))return '';
  return s.slice(0,limit);
}
function normalizeSiteCustomization(raw={}){
  const src=raw&&typeof raw==='object'&&!Array.isArray(raw)?raw:{};
  const design=src.design&&typeof src.design==='object'&&!Array.isArray(src.design)?src.design:{};
  const menu=src.menu&&typeof src.menu==='object'&&!Array.isArray(src.menu)?src.menu:{};
  const result=src.builder_result&&typeof src.builder_result==='object'&&!Array.isArray(src.builder_result)?src.builder_result:{};
  const features=src.features&&typeof src.features==='object'&&!Array.isArray(src.features)?src.features:{};
  return {
    version:1,
    design:{
      mode:['cinematic','minimal','editorial','glass'].includes(String(design.mode||''))?String(design.mode):'cinematic',
      background_image:safeImage(design.background_image,900000),
      ambient_strength:clamp(Number.isFinite(Number(design.ambient_strength))?Number(design.ambient_strength):.16,0,.5),
      radius:clamp(Number(design.radius)||20,10,34),
      panel_opacity:clamp(Number.isFinite(Number(design.panel_opacity))?Number(design.panel_opacity):.9,.45,.99),
      contrast:clamp(Number.isFinite(Number(design.contrast))?Number(design.contrast):1,.8,1.3)
    },
    menu:{
      layout:['hero-2-3','hero-2','uniform-2','uniform-3'].includes(String(menu.layout||''))?String(menu.layout):'hero-2-3',
      card_style:['photo','glass','solid'].includes(String(menu.card_style||''))?String(menu.card_style):'photo',
      image_fit:['cover','contain'].includes(String(menu.image_fit||''))?String(menu.image_fit):'cover',
      show_descriptions:menu.show_descriptions!==false,
      hero_label:String(menu.hero_label||'НАША ГОРДОСТЬ').trim().slice(0,40)
    },
    builder_result:{
      enabled:result.enabled!==false,
      image:safeImage(result.image,900000),
      title:String(result.title||'Твоя шаурма готова').trim().slice(0,100),
      subtitle:String(result.subtitle||'Сборка завершена. Осталось добавить её в корзину.').trim().slice(0,180),
      singularity:result.singularity!==false,
      duration_ms:clamp(Number(result.duration_ms)||1050,650,1800)
    },
    features:{
      favorites:features.favorites!==false,
      menu_badges:features.menu_badges!==false,
      builder_result:features.builder_result!==false
    }
  };
}

function builderConfig(config={}){
  if(config.builder_enabled===false)return null;
  if(config.builder_enabled!==true&&!config.builder)return null;
  if(!config.builder)return JSON.parse(JSON.stringify(LEGACY_LEPESH_BUILDER));
  return normalizeBuilderConfig(config.builder);
}
function priceBuilder(config,payload={}){
  const cfg=builderConfig(config);if(!cfg)return null;
  const type=cfg.types.find(x=>x.id===String(payload.type||''));if(!type)return null;

  const breadId=String(payload.bread||cfg.breads[0]?.id||'');
  const meatId=String(payload.meat||cfg.meats[0]?.id||'');
  const bread=cfg.breads.find(x=>x.id===breadId),meat=cfg.meats.find(x=>x.id===meatId);
  if(cfg.breads.length&&!bread)return null;
  if(cfg.meats.length&&!meat)return null;

  const sauceIds=[...new Set(Array.isArray(payload.sauces)?payload.sauces.map(String):[])];
  const extraIds=[...new Set(Array.isArray(payload.extras)?payload.extras.map(String):[])];
  const sauces=sauceIds.map(id=>cfg.sauces.find(x=>x.id===id)).filter(Boolean);
  const extras=extraIds.map(id=>cfg.extras.find(x=>x.id===id)).filter(Boolean);
  if(sauces.length!==sauceIds.length||extras.length!==extraIds.length)return null;
  if(sauces.length<cfg.min_sauces||sauces.length>cfg.max_sauces||extras.length>cfg.max_extras)return null;

  const total=clamp(
    Number(type.price||0)+Number(bread?.price||0)+Number(meat?.price||0)+
    sauces.reduce((s,x)=>s+Number(x.price||0),0)+extras.reduce((s,x)=>s+Number(x.price||0),0),
    0,100000
  );
  const details=[
    bread?'Лаваш: '+bread.name:'',
    meat?'Мясо: '+meat.name:'',
    'Соусы: '+sauces.map(x=>x.name).join(', '),
    'Добавки: '+(extras.length?extras.map(x=>x.name).join(', '):'без добавок')
  ].filter(Boolean);
  return {
    id:'custom_builder',n:type.name+' · своя сборка',p:total,detail:details.join(' · '),
    builder:{type:type.id,bread:bread?.id||'',meat:meat?.id||'',sauces:sauceIds,extras:extraIds}
  };
}
function orderNumber(){return 'SC-'+Date.now().toString().slice(-7)+'-'+Math.floor(10+Math.random()*90)}
module.exports={venueId,establishmentId,establishmentIdForVenue,markerId,markerStyle,menuSections,normalizeMenu,normalizeBuilderConfig,builderConfig,priceBuilder,normalizeSiteCustomization,LEGACY_LEPESH_BUILDER,orderNumber,clamp,venueThemeKey,VENUE_THEME_KEYS,normalizeVenueTheme,DEFAULT_VENUE_THEME};
