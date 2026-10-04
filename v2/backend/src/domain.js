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

const MENU_CATEGORY_DEFAULTS=[
  {id:'shawarma_doner',name:'Шаурма и донеры',emoji:'🥙',cover:'https://images.unsplash.com/photo-1529006557810-274b9b2fc783?auto=format&fit=crop&w=1200&q=85',
    settings:{meats:['Курица','Говядина','Баранина','Индейка','Фалафель'],sizes:['S','M','L'],bases:['Лаваш','Пита','Тарелка'],sauces:['Чесночный','Сырный','BBQ','Острый','Гранатовый'],extras:['Сыр','Двойное мясо','Халапеньо','Маринованный лук','Картофель фри'],required_fields:['Фото','Вес','Описание','Состав','Цена']}},
  {id:'burgers_sandwiches',name:'Бургеры и сэндвичи',emoji:'🍔',cover:'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&w=1200&q=85',
    settings:{meats:['Говядина','Курица','Индейка','Вегетарианская котлета'],sizes:['S','M','L'],bases:['Булочка бриошь','Классическая булочка','Тостовый хлеб','Панини'],sauces:['Бургер-соус','Сырный','BBQ','Острый','Чесночный'],extras:['Сыр','Бекон','Халапеньо','Лук','Доп. котлета'],required_fields:['Фото','Вес','Описание','Состав','Цена']}},
  {id:'bakery_hotdogs',name:'Выпечка и хот-доги',emoji:'🥐',cover:'https://images.unsplash.com/photo-1509440159596-0249088772ff?auto=format&fit=crop&w=1200&q=85',
    settings:{meats:['Курица','Говядина','Сосиска','Без мяса'],sizes:['S','M','L'],bases:['Слоёное тесто','Дрожжевое тесто','Булочка'],sauces:['Кетчуп','Горчица','Сырный','BBQ'],extras:['Сыр','Халапеньо','Лук','Зелень'],required_fields:['Фото','Вес','Описание','Начинка','Цена']}},
  {id:'pizza_rolls_quesadilla',name:'Пицца, роллы и кесадильи',emoji:'🍕',cover:'https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?auto=format&fit=crop&w=1200&q=85',
    settings:{meats:['Курица','Говядина','Пепперони','Без мяса'],sizes:['25 см','30 см','35 см'],bases:['Тонкое тесто','Классическое тесто','Тортилья','Рис'],sauces:['Томатный','Сырный','Терияки','BBQ'],extras:['Сыр','Грибы','Халапеньо','Овощи'],required_fields:['Фото','Вес','Описание','Состав','Цена']}},
  {id:'snacks',name:'Закуски',emoji:'🍟',cover:'https://images.unsplash.com/photo-1573080496219-bb080dd4f877?auto=format&fit=crop&w=1200&q=85',
    settings:{meats:['Курица','Без мяса'],sizes:['S','M','L'],bases:['Фри','Панировка','Запечённое'],sauces:['Кетчуп','Сырный','BBQ','Чесночный'],extras:['Сыр','Специи','Халапеньо'],required_fields:['Фото','Вес','Описание','Цена']}},
  {id:'salads_plates',name:'Салаты и тарелки',emoji:'🥗',cover:'https://images.unsplash.com/photo-1540189549336-e6e99c3679fe?auto=format&fit=crop&w=1200&q=85',
    settings:{meats:['Курица','Говядина','Фалафель','Без мяса'],sizes:['S','M','L'],bases:['Салат','Рис','Картофель','Пита'],sauces:['Цезарь','Чесночный','Йогуртовый','Оливковое масло'],extras:['Сыр','Овощи','Оливки','Халапеньо'],required_fields:['Фото','Вес','Описание','Состав','Цена']}},
  {id:'sauces_addons',name:'Соусы и добавки',emoji:'🥫',cover:'https://images.unsplash.com/photo-1472476443507-c7a5948772fc?auto=format&fit=crop&w=1200&q=85',
    settings:{meats:[],sizes:['30 мл','50 мл','100 мл'],bases:['Соус','Добавка'],sauces:['Чесночный','Сырный','BBQ','Кетчуп','Острый','Гранатовый'],extras:['Сыр','Двойное мясо','Халапеньо','Маринованный лук'],required_fields:['Фото','Объём','Описание','Цена']}},
  {id:'cold_drinks',name:'Холодные напитки',emoji:'🥤',cover:'https://images.unsplash.com/photo-1544145945-f90425340c7e?auto=format&fit=crop&w=1200&q=85',
    settings:{meats:[],sizes:['0.3 л','0.5 л','1 л'],bases:['Лимонад','Морс','Сок','Вода','Молочный напиток'],sauces:[],extras:['Лёд','Лимон','Мята','Сироп'],required_fields:['Фото','Объём','Описание','Цена']}},
  {id:'coffee_tea_desserts',name:'Кофе, чай и десерты',emoji:'☕',cover:'https://images.unsplash.com/photo-1509042239860-f550ce710b93?auto=format&fit=crop&w=1200&q=85',
    settings:{meats:[],sizes:['S','M','L'],bases:['Кофе','Чай','Десерт'],sauces:[],extras:['Сироп','Молоко','Сливки','Топпинг'],required_fields:['Фото','Объём / вес','Описание','Цена']}}
];
const DEFAULT_CATEGORY_IMAGE=Object.fromEntries(MENU_CATEGORY_DEFAULTS.map(x=>[x.id,x.cover]));
const MENU_ITEM_DEFAULTS=[
  ['shawarma_doner','Шаурма классическая','Курица, овощи, чесночный соус',259],
  ['shawarma_doner','Шаурма сырная','Курица, сыр, овощи и сливочный соус',289],
  ['shawarma_doner','Шаурма острая','Курица, халапеньо, овощи и острый соус',279],
  ['shawarma_doner','Шаурма BBQ','Курица, овощи и соус BBQ',289],
  ['shawarma_doner','Фирменная шаурма','Двойное мясо, свежие овощи и фирменный соус',329],
  ['shawarma_doner','Донер в пите','Мясо на гриле, овощи и соус в пите',299],
  ['shawarma_doner','Шаурма в тарелке','Мясо, овощи, фри и соус',349],
  ['shawarma_doner','Фалафель-ролл','Фалафель, овощи и тахини',269],
  ['burgers_sandwiches','Классический бургер','Говяжья котлета, овощи и соус',289],
  ['burgers_sandwiches','Чизбургер','Говяжья котлета, сыр, овощи и соус',309],
  ['burgers_sandwiches','Двойной бургер','Две котлеты, сыр, овощи и фирменный соус',389],
  ['burgers_sandwiches','Куриный бургер','Хрустящая курица, овощи и соус',299],
  ['burgers_sandwiches','Острый бургер','Котлета, халапеньо, сыр и острый соус',319],
  ['burgers_sandwiches','Клаб-сэндвич','Курица, бекон, овощи и соус',289],
  ['burgers_sandwiches','Панини с курицей','Курица, сыр, томаты и соус',279],
  ['burgers_sandwiches','Сэндвич с ветчиной и сыром','Ветчина, сыр, овощи и соус',249],
  ['bakery_hotdogs','Самса с курицей','Слоёное тесто и сочная куриная начинка',159],
  ['bakery_hotdogs','Самса с говядиной','Слоёное тесто и говяжья начинка',179],
  ['bakery_hotdogs','Чебурек','Хрустящее тесто и мясная начинка',169],
  ['bakery_hotdogs','Беляш','Жареное тесто и мясная начинка',159],
  ['bakery_hotdogs','Хачапури','Сыр, тесто и яйцо',299],
  ['bakery_hotdogs','Сосиска в тесте','Сосиска и румяное тесто',149],
  ['bakery_hotdogs','Хот-дог классический','Сосиска, булочка, кетчуп и горчица',229],
  ['bakery_hotdogs','Хот-дог сырный','Сосиска, сырный соус и хрустящий лук',249],
  ['pizza_rolls_quesadilla','Пицца Маргарита','Томаты, моцарелла и базилик',399],
  ['pizza_rolls_quesadilla','Пицца Пепперони','Пепперони, сыр и томатный соус',449],
  ['pizza_rolls_quesadilla','Пицца 4 сыра','Смесь четырёх сыров',479],
  ['pizza_rolls_quesadilla','Кесадилья с курицей','Курица, сыр, овощи и тортилья',329],
  ['pizza_rolls_quesadilla','Кесадилья с говядиной','Говядина, сыр, овощи и тортилья',349],
  ['pizza_rolls_quesadilla','Ролл Цезарь','Курица, рис, салат и соус Цезарь',329],
  ['pizza_rolls_quesadilla','Ролл с курицей терияки','Курица терияки, рис и овощи',349],
  ['pizza_rolls_quesadilla','Тортилья овощная','Овощи, зелень и соус',269],
  ['snacks','Картофель фри','Золотистый хрустящий картофель',149],
  ['snacks','Картофель по-деревенски','Картофельные дольки со специями',169],
  ['snacks','Наггетсы','Куриное филе в хрустящей панировке',199],
  ['snacks','Куриные стрипсы','Куриное филе в панировке',229],
  ['snacks','Крылышки BBQ','Куриные крылышки в соусе BBQ',279],
  ['snacks','Сырные палочки','Сыр в хрустящей панировке',239],
  ['snacks','Луковые кольца','Луковые кольца в панировке',189],
  ['snacks','Фалафель','Фалафель с соусом',219],
  ['salads_plates','Цезарь с курицей','Курица, салат, томаты, сыр и соус Цезарь',299],
  ['salads_plates','Греческий салат','Овощи, фета и оливки',279],
  ['salads_plates','Овощной салат','Свежие овощи и зелень',229],
  ['salads_plates','Донер-тарелка','Мясо, фри, овощи, пита и соус',379],
  ['salads_plates','Шаурма-тарелка','Курица, овощи, фри и соус',369],
  ['salads_plates','Рис с курицей','Рис, курица и овощи',329],
  ['salads_plates','Плов с говядиной','Рис, говядина, морковь и специи',349],
  ['salads_plates','Чечевичный суп','Чечевица, овощи и специи',249],
  ['sauces_addons','Чесночный соус','Сливочно-чесночный соус',59],
  ['sauces_addons','Сырный соус','Насыщенный сырный соус',69],
  ['sauces_addons','Барбекю','Классический соус BBQ',59],
  ['sauces_addons','Кетчуп','Томатный кетчуп',49],
  ['sauces_addons','Острый соус','Острый перечный соус',59],
  ['sauces_addons','Гранатовый соус','Кисло-сладкий гранатовый соус',69],
  ['sauces_addons','Двойное мясо','Дополнительная порция мяса',109],
  ['sauces_addons','Сыр','Дополнительный сыр',59],
  ['sauces_addons','Халапеньо','Острый перец халапеньо',49],
  ['sauces_addons','Маринованный лук','Маринованный красный лук',39],
  ['cold_drinks','Лимонад классический','Лимон, мята и лёд',129],
  ['cold_drinks','Лимонад ягодный','Ягоды, цитрус и лёд',149],
  ['cold_drinks','Айран','Освежающий кисломолочный напиток',109],
  ['cold_drinks','Морс','Ягодный морс',119],
  ['cold_drinks','Компот','Домашний компот',109],
  ['cold_drinks','Сок апельсиновый','Апельсиновый сок',139],
  ['cold_drinks','Вода без газа','Питьевая вода',89],
  ['cold_drinks','Газированная вода','Газированная вода',89],
  ['cold_drinks','Холодный чай','Чай со льдом и лимоном',129],
  ['cold_drinks','Молочный коктейль','Молочный коктейль',199],
  ['coffee_tea_desserts','Эспрессо','Классический эспрессо',119],
  ['coffee_tea_desserts','Американо','Чёрный кофе',129],
  ['coffee_tea_desserts','Капучино','Эспрессо и молочная пена',169],
  ['coffee_tea_desserts','Латте','Эспрессо и молоко',189],
  ['coffee_tea_desserts','Чай черный','Чёрный листовой чай',119],
  ['coffee_tea_desserts','Чай зеленый','Зелёный листовой чай',119],
  ['coffee_tea_desserts','Чизкейк','Сливочный чизкейк',229],
  ['coffee_tea_desserts','Медовик','Медовые коржи и нежный крем',229],
  ['coffee_tea_desserts','Пахлава','Слоёное тесто, орехи и мёд',199],
  ['coffee_tea_desserts','Маффин','Мягкий маффин с шоколадом',169]
];
function slugMenu(v,fallback='item'){
  const s=String(v||'').trim().toLowerCase().replace(/ё/g,'e').replace(/[^a-z0-9а-я]+/gi,'_').replace(/^_+|_+$/g,'');
  return (s||fallback).slice(0,64);
}
function menuOptionList(input,limit=40){
  return (Array.isArray(input)?input:[]).slice(0,limit).map((x,i)=>{
    if(typeof x==='string')return {id:slugMenu(x,'opt_'+i),name:String(x).trim().slice(0,100),price:0,active:true,default:i===0};
    const v=x&&typeof x==='object'?x:{};
    return {id:slugMenu(v.id||v.name,'opt_'+i),name:String(v.name||v.n||v.id||'Опция').trim().slice(0,100),price:clamp(Number(v.price??v.price_delta)||0,-100000,100000),active:v.active!==false,default:v.default===true,image:String(v.image||'').trim().slice(0,300000)};
  }).filter(x=>x.name);
}
function normalizeChoiceGroups(input){
  if(!Array.isArray(input))return [];
  return input.slice(0,20).map((g,gi)=>{
    const options=(Array.isArray(g?.options)?g.options:[]).slice(0,60).map((o,oi)=>({
      id:slugMenu(o?.id||o?.name,'option_'+oi),
      name:String(o?.name||o?.n||'Вариант').trim().slice(0,120),
      price_delta:clamp(Number(o?.price_delta??o?.price??0)||0,-100000,100000),
      active:o?.active!==false,
      default:o?.default===true,
      image:String(o?.image||'').trim().slice(0,300000)
    })).filter(o=>o.id&&o.name);
    const type=String(g?.type||'single')==='multiple'?'multiple':'single';
    const min=clamp(Math.floor(Number(g?.min)||0),0,60);
    const max=type==='single'?1:clamp(Math.floor(Number(g?.max)||Math.max(1,options.length)),Math.max(1,min),60);
    return {
      id:slugMenu(g?.id||g?.name,'group_'+gi),
      name:String(g?.name||g?.n||'Выбор').trim().slice(0,120),
      type,required:g?.required===true||min>0,
      min:g?.required===true&&min===0?1:min,max,
      active:g?.active!==false,options
    };
  }).filter(g=>g.id&&g.name);
}
function defaultMenuCategories(){
  return MENU_CATEGORY_DEFAULTS.map((x,i)=>({
    id:x.id,name:x.name,emoji:x.emoji,active:true,order:i,cover:x.cover,
    color:'#0B2945',accent:'#FF463D',manual_sort:true,
    settings:{...x.settings}
  }));
}
function normalizeMenuSections(input,menu=[],fallbackToDefaults=true){
  const defaults=defaultMenuCategories(),base=new Map(defaults.map(x=>[x.id,x]));
  const raw=Array.isArray(input)?input:[];
  const out=[];
  if(raw.length){
    for(let i=0;i<raw.length&&out.length<60;i++){
      const v=raw[i]&&typeof raw[i]==='object'?raw[i]:{},id=slugMenu(v.id||v.name,'section_'+i);
      const d=base.get(id)||{};
      const settings=v.settings&&typeof v.settings==='object'&&!Array.isArray(v.settings)?v.settings:{};
      out.push({
        id,name:String(v.name||d.name||id).trim().slice(0,100),emoji:String(v.emoji||d.emoji||'').slice(0,8),
        active:v.active!==false,order:Number.isFinite(Number(v.order))?Number(v.order):i,
        cover:String(v.cover||d.cover||'').trim().slice(0,700000),
        color:hex(v.color||d.color,'#0B2945'),accent:hex(v.accent||d.accent,'#FF463D'),
        manual_sort:v.manual_sort!==false,
        settings:{
          meats:(Array.isArray(settings.meats)?settings.meats:d.settings?.meats||[]).map(String).slice(0,30),
          sizes:(Array.isArray(settings.sizes)?settings.sizes:d.settings?.sizes||[]).map(String).slice(0,30),
          bases:(Array.isArray(settings.bases)?settings.bases:d.settings?.bases||[]).map(String).slice(0,30),
          sauces:(Array.isArray(settings.sauces)?settings.sauces:d.settings?.sauces||[]).map(String).slice(0,40),
          extras:(Array.isArray(settings.extras)?settings.extras:d.settings?.extras||[]).map(String).slice(0,60),
          required_fields:(Array.isArray(settings.required_fields)?settings.required_fields:d.settings?.required_fields||[]).map(String).slice(0,30)
        }
      });
    }
  }else if(fallbackToDefaults){
    out.push(...defaults);
  }
  const seen=new Set(out.map(x=>x.id));
  for(const item of (Array.isArray(menu)?menu:[])){
    const id=slugMenu(item?.c||item?.category||'shawarma_doner','shawarma_doner');
    if(seen.has(id))continue;seen.add(id);
    const d=base.get(id);
    out.push(d?{...d,order:out.length}:{id,name:id,emoji:'',active:true,order:out.length,cover:'',color:'#0B2945',accent:'#FF463D',manual_sort:true,settings:{meats:[],sizes:[],bases:[],sauces:[],extras:[],required_fields:['Фото','Описание','Цена']}});
  }
  return out.sort((a,b)=>Number(a.order)-Number(b.order)).map((x,i)=>({...x,order:i}));
}
function menuSections(config={},menu=[]){
  return normalizeMenuSections(config.menu_sections,menu,true).filter(x=>x.active!==false);
}
function menuSectionsAll(config={},menu=[]){
  return normalizeMenuSections(config.menu_sections,menu,true);
}
function defaultMenuSeed(){
  const sections=defaultMenuCategories();
  const sectionMap=new Map(sections.map(x=>[x.id,x]));
  const counters={};
  const menu=MENU_ITEM_DEFAULTS.map((row,i)=>{
    const [c,n,d,p]=row,countersN=(counters[c]=(counters[c]||0)+1),section=sectionMap.get(c);
    const settings=section?.settings||{};
    const mk=list=>menuOptionList((list||[]).map((name,j)=>({name,price:0,default:j===0})));
    return {
      id:c+'_'+String(countersN).padStart(2,'0'),n,c,d,p,image:DEFAULT_CATEGORY_IMAGE[c]||'',gallery:[],badge:'',
      featured:countersN===1,display:countersN===1?'main':'auto',image_fit:'cover',active:true,weight:'',
      sku:(c.slice(0,3)+'-'+String(countersN).padStart(3,'0')).toUpperCase(),stock:null,schedule:{enabled:false,days:[],from:'',to:''},
      tags:[section?.name||c],card_color:'#FFFFFF',recommended:countersN===1,
      options:{meats:mk(settings.meats),sizes:mk(settings.sizes),bases:mk(settings.bases),sauces:mk(settings.sauces),extras:mk(settings.extras),required_groups:[]}
    };
  });
  return {sections,menu};
}
function normalizeMenu(input){
  if(!Array.isArray(input))return [];
  return input.slice(0,400).map((x,i)=>{
    const c=slugMenu(x.c||x.category||'shawarma_doner','shawarma_doner');
    const opts=x.options&&typeof x.options==='object'&&!Array.isArray(x.options)?x.options:{};
    const schedule=x.schedule&&typeof x.schedule==='object'&&!Array.isArray(x.schedule)?x.schedule:{};
    return {
      id:String(x.id||'item_'+i).trim().slice(0,100),
      n:String(x.n||x.name||'Позиция').trim().slice(0,160),
      c,d:String(x.d||x.description||'').trim().slice(0,900),
      p:clamp(Number(x.p??x.price)||0,0,100000),
      image:String(x.image||x.i||'').trim().slice(0,700000),
      gallery:(Array.isArray(x.gallery)?x.gallery:[]).map(v=>String(v||'').trim().slice(0,700000)).filter(Boolean).slice(0,12),
      badge:String(x.badge||x.tag||'').trim().slice(0,40),
      featured:x.featured===true,recommended:x.recommended===true,
      display:['auto','main','compact'].includes(String(x.display||''))?String(x.display):'auto',
      image_fit:['cover','contain'].includes(String(x.image_fit||''))?String(x.image_fit):'cover',
      active:x.active!==false,
      weight:String(x.weight||'').trim().slice(0,40),
      sku:String(x.sku||'').trim().slice(0,80),
      stock:x.stock===null||x.stock===''||x.stock===undefined?null:clamp(Math.floor(Number(x.stock)||0),0,1000000),
      tags:(Array.isArray(x.tags)?x.tags:[]).map(v=>String(v).trim().slice(0,40)).filter(Boolean).slice(0,20),
      card_color:hex(x.card_color||'#FFFFFF','#FFFFFF'),
      composition:String(x.composition||x.ingredients||'').trim().slice(0,1200),
      schedule:{enabled:schedule.enabled===true,days:(Array.isArray(schedule.days)?schedule.days:[]).map(Number).filter(v=>v>=0&&v<=6).slice(0,7),from:String(schedule.from||'').slice(0,5),to:String(schedule.to||'').slice(0,5)},
      options:{
        meats:menuOptionList(opts.meats),sizes:menuOptionList(opts.sizes),bases:menuOptionList(opts.bases),sauces:menuOptionList(opts.sauces),extras:menuOptionList(opts.extras,60),
        required_groups:(Array.isArray(opts.required_groups)?opts.required_groups:[]).map(v=>String(v)).filter(v=>['meats','sizes','bases','sauces','extras'].includes(v)).slice(0,5)
      },
      min_qty:clamp(Math.floor(Number(x.min_qty)||1),1,50),
      max_qty:clamp(Math.floor(Number(x.max_qty)||50),1,50),
      choice_groups:normalizeChoiceGroups(x.choice_groups||[])
    };
  }).map(x=>({...x,max_qty:Math.max(x.min_qty,x.max_qty)})).filter(x=>x.id&&x.n);
}
function menuSelectionPrice(item,selection={}){
  const src=normalizeMenu([item])[0];if(!src)return null;
  const sel=selection&&typeof selection==='object'&&!Array.isArray(selection)?selection:{};
  let total=Number(src.p)||0;const details=[];
  for(const group of ['meats','sizes','bases','sauces','extras']){
    const list=src.options[group]||[],raw=sel[group],ids=Array.isArray(raw)?raw.map(String):raw?[String(raw)]:[];
    const chosen=ids.map(id=>list.find(x=>x.active!==false&&x.id===id)).filter(Boolean);
    if(chosen.length!==ids.length)return null;
    if(src.options.required_groups.includes(group)&&!chosen.length){
      const def=list.find(x=>x.active!==false&&x.default)||list.find(x=>x.active!==false);
      if(!def)return null;chosen.push(def);
    }
    for(const opt of chosen){total+=Number(opt.price)||0;details.push(opt.name)}
  }
  return {price:clamp(total,0,100000),detail:details.join(' · ')};
}
function priceMenuItem(item,payload={}){
  const src=normalizeMenu([item])[0];if(!src)return {error:'item_not_in_menu'};
  if(src.stock===0)return {error:'item_unavailable',item_id:String(src.id||'')};
  const q=Math.floor(Number(payload.q)||1);
  const minQty=Math.max(1,Math.min(50,Math.floor(Number(src.min_qty)||1)));
  const maxQty=Math.max(minQty,Math.min(50,Math.floor(Number(src.max_qty)||50)));
  if(q<minQty||q>maxQty)return {error:'invalid_quantity',item_id:String(src.id||''),min_qty:minQty,max_qty:maxQty};
  if(Number.isFinite(Number(src.stock))&&src.stock!==null&&q>Number(src.stock))return {error:'insufficient_stock',item_id:String(src.id||''),stock:Number(src.stock)};
  const rawSelection=payload.selection&&typeof payload.selection==='object'&&!Array.isArray(payload.selection)?payload.selection:{};
  for(const group of ['meats','sizes','bases']){
    const raw=rawSelection[group],ids=Array.isArray(raw)?raw:(raw?[raw]:[]);
    if(ids.length>1)return {error:'too_many_choices',item_id:String(src.id||''),group_id:group};
  }
  const fixed=menuSelectionPrice(src,rawSelection);
  if(!fixed)return {error:'invalid_item_selection',item_id:String(src.id||'')};
  let price=Number(fixed.price)||0;
  const details=fixed.detail?[fixed.detail]:[];
  const rawChoices=payload.choices&&typeof payload.choices==='object'&&!Array.isArray(payload.choices)?payload.choices:{};
  const choices={};
  for(const group of (src.choice_groups||[]).filter(g=>g.active!==false)){
    const options=(group.options||[]).filter(o=>o.active!==false),map=new Map(options.map(o=>[String(o.id),o]));
    let selected=rawChoices[String(group.id)];
    selected=Array.isArray(selected)?selected:(selected?[selected]:[]);
    selected=[...new Set(selected.map(String))];
    const min=Math.max(group.required?1:0,Math.floor(Number(group.min)||0));
    const max=group.type==='single'?1:Math.max(min,Math.floor(Number(group.max)||Math.max(1,options.length)));
    if(group.type==='single'&&selected.length>1)return {error:'too_many_choices',item_id:src.id,group_id:group.id};
    if(selected.length<min||selected.length>max)return {error:'invalid_choice_count',item_id:src.id,group_id:group.id,min,max};
    const picked=[];
    for(const id of selected){
      const opt=map.get(id);if(!opt)return {error:'invalid_choice',item_id:src.id,group_id:group.id,option_id:id};
      price+=Number(opt.price_delta)||0;picked.push(opt);
    }
    if(selected.length)choices[group.id]=selected;
    if(picked.length)details.push(String(group.name||'Выбор')+': '+picked.map(o=>String(o.name)+(Number(o.price_delta)?' ('+(Number(o.price_delta)>0?'+':'')+Number(o.price_delta)+' ₽)':'')).join(', '));
  }
  return {item:{id:String(src.id),n:String(src.n||src.name||'Позиция'),p:clamp(Math.round(price),0,100000),q,detail:details.filter(Boolean).join(' · ').slice(0,500),selection:rawSelection,choices}};
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
  const defaultTypes=normalizeBuilderOptionList(LEGACY_LEPESH_BUILDER.types,{priceMode:'base',prefix:'type'});
  const types=has('types')?(parsedTypes.length?parsedTypes:defaultTypes):defaultTypes;
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
module.exports={venueId,establishmentId,establishmentIdForVenue,markerId,markerStyle,menuSections,menuSectionsAll,normalizeMenuSections,defaultMenuCategories,defaultMenuSeed,normalizeChoiceGroups,normalizeMenu,menuSelectionPrice,priceMenuItem,normalizeBuilderConfig,builderConfig,priceBuilder,normalizeSiteCustomization,LEGACY_LEPESH_BUILDER,orderNumber,clamp,venueThemeKey,VENUE_THEME_KEYS,normalizeVenueTheme,DEFAULT_VENUE_THEME};