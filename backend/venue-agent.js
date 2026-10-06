'use strict';

const crypto=require('crypto');
const {parseCommand,norm,venueShortKey}=require('./venue-command');

const STOP=new Set(['и','в','во','на','с','со','из','для','по','к','ко','у','а','но','же','это','тот','та','то','эту','этот','этом','там','мне','нам','пока']);
const SYN=[
  [/шаверм[а-яa-z0-9]*/g,'шаурма'],
  [/шавух[а-яa-z0-9]*/g,'шаурма'],
  [/\bшава\b/g,'шаурма'],
  [/картош[а-яa-z0-9]*/g,'картофель'],
  [/клас+ич[а-яa-z0-9]*/g,'классика'],
  [/говяж[а-яa-z0-9]*/g,'говядина'],
  [/курин[а-яa-z0-9]*/g,'курица'],
  [/чесноч[а-яa-z0-9]*/g,'чеснок']
];

function clean(v){return String(v||'').trim()}
function normalize(v){
  let s=norm(v).replace(/[^a-z0-9а-я]+/gi,' ').replace(/\s+/g,' ').trim();
  for(const [re,to] of SYN)s=s.replace(re,to);
  return s;
}
function stem(w){
  let s=normalize(w);
  if(s.length<5)return s;
  const endings=['иями','ями','ами','ого','ему','ому','ими','ыми','ая','яя','ое','ее','ий','ый','ой','ую','юю','ов','ев','ам','ям','ах','ях','ом','ем','ы','и','а','я','у','ю','е','о','й','ь'];
  for(const e of endings)if(s.endsWith(e)&&s.length-e.length>=4)return s.slice(0,-e.length);
  return s;
}
function tokens(v){
  return normalize(v).split(' ').map(stem).filter(x=>x&&!STOP.has(x));
}
function levenshtein(a,b){
  a=String(a);b=String(b);
  if(a===b)return 0;
  if(!a.length)return b.length;if(!b.length)return a.length;
  const prev=Array.from({length:b.length+1},(_,i)=>i),cur=new Array(b.length+1);
  for(let i=1;i<=a.length;i++){
    cur[0]=i;
    for(let j=1;j<=b.length;j++)cur[j]=Math.min(cur[j-1]+1,prev[j]+1,prev[j-1]+(a[i-1]===b[j-1]?0:1));
    for(let j=0;j<=b.length;j++)prev[j]=cur[j];
  }
  return prev[b.length];
}
function similarity(a,b){
  const na=normalize(a),nb=normalize(b);
  if(!na||!nb)return 0;
  if(na===nb)return 1;
  const at=[...new Set(tokens(na))],bt=[...new Set(tokens(nb))];
  if(!at.length||!bt.length)return 0;

  const tokenSim=(x,y)=>{
    if(x===y)return 1;
    const edit=1-levenshtein(x,y)/Math.max(x.length,y.length);
    if(x.length>=4&&y.length>=4&&(x.startsWith(y)||y.startsWith(x)))return Math.max(.92,edit);
    return Math.max(0,edit);
  };
  const bestFor=(src,dst)=>src.map(x=>{
    let best=0;
    for(const y of dst)best=Math.max(best,tokenSim(x,y));
    return best;
  });

  const qScores=bestFor(at,bt),cScores=bestFor(bt,at);
  const queryCoverage=qScores.reduce((s,x)=>s+x,0)/at.length;
  const candidateCoverage=cScores.reduce((s,x)=>s+x,0)/bt.length;
  const strongQuery=qScores.filter(x=>x>=.88).length/at.length;
  const strongCandidate=cScores.filter(x=>x>=.88).length/bt.length;
  const edit=1-levenshtein(na,nb)/Math.max(na.length,nb.length);
  const exactContain=na.includes(nb)||nb.includes(na);

  // Query coverage dominates: "сырная шаурма" must not collapse to an item matching only "сыр".
  let score=queryCoverage*.67+candidateCoverage*.20+Math.max(0,edit)*.13;
  if(strongQuery===1)score=Math.max(score,.90+strongCandidate*.08);
  if(exactContain&&strongQuery>=.5)score=Math.max(score,.84+strongQuery*.10);
  if(at.length>=2&&strongQuery<1)score*=.78;
  return Math.max(0,Math.min(1,score));
}
function itemText(item,categoryName=''){
  return [
    item?.n,item?.name,item?.d,item?.description,item?.composition,item?.sku,
    ...(Array.isArray(item?.tags)?item.tags:[]),categoryName
  ].filter(Boolean).join(' ');
}
function ordinal(v){
  const s=normalize(v);
  if(/^(1|перв[а-яa-z0-9]*)$/.test(s))return 0;
  if(/^(2|втор[а-яa-z0-9]*)$/.test(s))return 1;
  if(/^(3|трет[а-яa-z0-9]*)$/.test(s))return 2;
  if(/^(4|четверт[а-яa-z0-9]*)$/.test(s))return 3;
  if(/^(5|пят[а-яa-z0-9]*)$/.test(s))return 4;
  if(/^(6|шест[а-яa-z0-9]*)$/.test(s))return 5;
  const n=Number(s);return Number.isInteger(n)&&n>0&&n<=9?n-1:-1;
}
function isCancel(v){return /^(нет|не то|не это|отмена|отмени|стоп|назад)$/i.test(normalize(v))}
function isYes(v){return /^(да|ага|верно|точно|оно|он|она|подтверждаю|делай)$/i.test(normalize(v))}
function token8(){return crypto.randomBytes(4).toString('hex')}
function dialogHelpText(){
  return [
    '🤖 Диалоговый помощник точки',
    '',
    'Можно писать обычным языком — точные команды запоминать не нужно.',
    'Если я не уверен в точке, разделе, блюде, группе или варианте, я сначала уточню и ничего не изменю.',
    '',
    'Примеры:',
    '• «найди сырную шаурму»',
    '• «у сырной сделай цену 420»',
    '• «покажи напитки»',
    '• «убери айран» — уточню: скрыть или временно снять с продажи',
    '• «добавь выбор Острота»',
    '• «добавь вариант Острая +30»',
    '• «где мы?»',
    '• «назад»',
    '• «к разделам»',
    '',
    'Можно обучать коротким названиям:',
    '• «запомни что большая сырная это сырная XL»',
    '',
    'Удаляющие действия требуют отдельного подтверждения.'
  ].join('\n');
}

function candidateButtons(token,candidates){
  const rows=[];
  for(let i=0;i<candidates.length&&i<6;i++)rows.push([{text:String(candidates[i].label).slice(0,52),callback_data:'va:'+token+':'+i}]);
  rows.push([{text:'Отмена',callback_data:'va:'+token+':x'}]);
  return {inline_keyboard:rows};
}
function clarifyText(title,candidates){
  const lines=[title,''];
  candidates.slice(0,6).forEach((x,i)=>lines.push((i+1)+'. '+x.label));
  lines.push('','Можно нажать кнопку или ответить «первая», «вторая», названием. Если не подходит — «не это».');
  return lines.join('\n');
}

function commandItemQuery(command){
  if(!command||typeof command!=='object')return '';
  return clean(command.item||'');
}
function commandNeedsItem(command){
  return new Set([
    'menu_item_select','menu_item_show','menu_price','menu_toggle','menu_available','menu_rename','menu_description',
    'menu_badge','menu_featured','menu_display','menu_image_remove','menu_image_fit','menu_category_move','menu_delete',
    'menu_duplicate','menu_qty','menu_weight','menu_composition','menu_sku','menu_stock','menu_tags','menu_recommended',
    'menu_card_color','menu_schedule','fixed_option_add','fixed_option_delete','fixed_option_price','fixed_option_toggle',
    'fixed_option_default','choice_group_add','choice_group_select','choice_group_delete','choice_group_rename',
    'choice_group_toggle','choice_group_required','choice_group_type','choice_group_limit','choice_option_add',
    'choice_option_price','choice_option_toggle','choice_option_delete','choice_option_rename','choice_option_default'
  ]).has(command?.intent);
}
function destructive(command){
  return new Set(['menu_delete','category_delete','choice_group_delete','choice_option_delete','fixed_option_delete','builder_option_delete']).has(command?.intent);
}
function canonicalText(command,itemName=''){
  const i=itemName||command.item||'';
  switch(command.intent){
    case 'menu_item_select': return 'работаем с '+i;
    case 'menu_item_show': return i?'покажи настройки позиции '+i:'покажи настройки позиции';
    case 'menu_price': return 'поставь цену на '+i+' '+command.price;
    case 'menu_price_context': return 'цена '+command.price;
    case 'menu_toggle': return (command.enabled?'верни в меню ':'скрой блюдо ')+i;
    case 'menu_available': return command.available?(i?'верни '+i+' в наличие':'верни в наличие'):('нет в наличии'+(i?' '+i:''));
    case 'menu_rename': return 'переименуй блюдо '+i+' -> '+command.name;
    case 'menu_description': return 'описание блюда '+i+' = '+command.description;
    case 'menu_badge': return command.value?'бейдж '+command.value:'убери бейдж';
    case 'menu_featured': return command.enabled?'сделай главной':'убери из главных';
    case 'menu_display': return 'карточка '+(command.display==='main'?'главная':command.display==='compact'?'компактная':'авто');
    case 'menu_category_move': return i?('перенеси '+i+' в категорию '+command.category):('перенеси в категорию '+command.category);
    case 'menu_delete': return i?'удали блюдо '+i:'удали позицию';
    case 'menu_duplicate': return i?'дублируй блюдо '+i:'дублируй позицию';
    case 'menu_qty': return (command.field==='min_qty'?'минимум ':'максимум ')+command.value+' шт';
    case 'menu_weight': return 'вес '+command.value;
    case 'menu_composition': return 'состав '+command.value;
    case 'menu_sku': return 'SKU '+command.value;
    case 'menu_stock': return command.value===null?'остаток безлимит':'остаток '+command.value;
    case 'menu_tags': return 'теги '+(command.value||[]).join(', ');
    case 'menu_recommended': return command.enabled?'рекомендовать':'не рекомендовать';
    case 'menu_card_color': return 'цвет карточки '+command.value;
    case 'menu_schedule': return command.enabled?('расписание с '+command.from+' до '+command.to):'расписание выкл';
    case 'choice_group_add': return 'добавь выбор '+command.name;
    case 'choice_group_select': return 'открой выбор '+command.group;
    case 'choice_group_delete': return 'удали выбор '+(command.group||'');
    case 'choice_group_required': return command.required?'сделай выбор обязательным':'сделай выбор необязательным';
    case 'choice_group_type': return command.type==='multiple'?'можно несколько':'один вариант';
    case 'choice_group_limit': return command.field==='max'?('можно выбрать до '+command.value):('нужно выбрать минимум '+command.value);
    case 'choice_option_add': return 'добавь вариант '+command.name+(Number(command.price_delta)?' '+(Number(command.price_delta)>0?'+':'')+command.price_delta:'');
    case 'choice_option_price': return 'доплата варианта '+command.option+' '+command.price_delta;
    case 'choice_option_toggle': return (command.enabled?'включи вариант ':'выключи вариант ')+command.option;
    case 'choice_option_delete': return 'удали вариант '+command.option;
    case 'choice_option_rename': return 'переименуй вариант '+command.option+' -> '+command.name;
    case 'choice_option_default': return 'сделай вариант '+command.option+' по умолчанию';
    case 'choice_group_rename': return 'переименуй выбор '+command.group+' -> '+command.name;
    case 'choice_group_toggle': return (command.enabled?'включи выбор ':'выключи выбор ')+command.group;
    case 'category_toggle': return (command.enabled?'включи категорию ':'выключи категорию ')+command.category;
    case 'category_rename': return 'переименуй категорию '+command.category+' -> '+command.name;
    case 'category_delete': return 'удали категорию '+command.category;
    case 'category_emoji': return 'иконка категории '+command.category+' '+command.emoji;
    case 'category_order': return 'категория '+command.category+' номер '+command.order;
    case 'fixed_option_add': return 'добавь вариант '+command.group+' '+command.name+(Number(command.price)?' '+(Number(command.price)>0?'+':'')+command.price:'');
    case 'fixed_option_delete': return 'удали вариант '+command.group+' '+command.option;
    case 'fixed_option_price': return 'доплата варианта '+command.group+' '+command.option+' '+command.price;
    case 'fixed_option_toggle': return (command.enabled?'включи вариант ':'выключи вариант ')+command.group+' '+command.option;
    case 'fixed_option_default': return 'сделай вариант '+command.group+' '+command.option+' по умолчанию';
    case 'builder_option_delete': return 'удали '+command.group+' '+command.option;
    default:return '';
  }
}

function inferFreeform(text){
  const raw=clean(text),s=normalize(raw);let m;
  if(!raw)return null;

  if(/^(?:где мы|что выбрано|что сейчас выбрано|текущий контекст|контекст)$/i.test(raw))return {kind:'context_status'};
  if(/^(?:назад|вернись назад|на уровень выше|выйди назад)$/i.test(raw))return {kind:'back'};
  if(/^(?:к категориям|к разделам|в корень меню|корень меню)$/i.test(raw))return {kind:'menu_root'};
  if(/^(?:что здесь|покажи блюда|покажи позиции|что в этом разделе)$/i.test(raw))return {kind:'list_here'};

  m=raw.match(/^(?:найди|открой|выбери|давай|перейди к)\s+(?:блюдо|позицию|товар)?\s*(.+)$/i);
  if(m)return {kind:'navigate_item',query:clean(m[1])};

  m=raw.match(/^(?:покажи|открой|перейди в|зайди в)\s+(?:раздел|категорию)?\s*(.+)$/i);
  if(m&&!/^(меню|настройки|заказы|статистику)$/i.test(clean(m[1])))return {kind:'navigate_category',query:clean(m[1])};

  m=raw.match(/^у\s+(.+?)\s+(?:сделай|поставь|измени|поменяй)\s+цен[ау]?\s*(?:на|до|по)?\s*(\d+(?:[.,]\d+)?)\s*(?:₽|р\.?|руб[а-я]*)?$/i);
  if(m)return {kind:'command',command:{intent:'menu_price',item:clean(m[1]),price:Number(String(m[2]).replace(',','.'))}};

  m=raw.match(/^(?:сделай|поставь|измени|поменяй)\s+(?:цен[ау]\s+)?(?:у|для)\s+(.+?)\s+(?:на|до|по)\s*(\d+(?:[.,]\d+)?)\s*(?:₽|р\.?|руб[а-я]*)?$/i);
  if(m)return {kind:'command',command:{intent:'menu_price',item:clean(m[1]),price:Number(String(m[2]).replace(',','.'))}};

  m=raw.match(/^(?:пусть\s+)?(.+?)\s+(?:будет|теперь)\s+(\d+(?:[.,]\d+)?)\s*(?:₽|р\.?|руб[а-я]*)$/i);
  if(m)return {kind:'command',command:{intent:'menu_price',item:clean(m[1]),price:Number(String(m[2]).replace(',','.'))}};

  m=raw.match(/^(?:у|для)\s+(.+?)\s+(?:остаток|осталось)\s+(\d+)$/i);
  if(m)return {kind:'command',command:{intent:'menu_stock',item:clean(m[1]),value:Number(m[2])}};

  m=raw.match(/^(?:у|для)\s+(.+?)\s+(?:нет|не осталось|закончил[а-яa-z0-9]*)$/i);
  if(m)return {kind:'command',command:{intent:'menu_available',item:clean(m[1]),available:false}};

  m=raw.match(/^(?:верни|добавь обратно)\s+(.+?)\s+(?:в продажу|в наличие)$/i);
  if(m)return {kind:'command',command:{intent:'menu_available',item:clean(m[1]),available:true}};

  m=raw.match(/^(?:убери|сними)\s+(.+)$/i);
  if(m)return {kind:'action_clarify',item:clean(m[1]),actions:[
    {label:'Временно нет в наличии',command:{intent:'menu_available',item:clean(m[1]),available:false}},
    {label:'Скрыть из меню',command:{intent:'menu_toggle',item:clean(m[1]),enabled:false}}
  ]};

  m=raw.match(/^(?:запомни[, ]+)?(?:что\s+)?(.+?)\s+(?:это|значит|=)\s+(.+)$/i);
  if(m&&/^запомни/i.test(raw))return {kind:'alias',alias:clean(m[1]),target:clean(m[2])};

  if(!/[0-9]|цен|остат|вес|состав|добав|удал|скры|верн|сдел|постав|измени|поменяй|бейдж|тег|sku|артикул|распис/i.test(s)){
    return {kind:'bare_entity',query:raw};
  }
  return null;
}


const ACTION_HEAD='(?:сделай|поставь|установи|измени|поменяй|подними|увеличь|снизь|уменьши|убери|сними|верни|добавь|оставь|скрой|покажи|выключи|включи|пометь|назначь)';

function splitActionClauses(v){
  const raw=clean(v).replace(/[.;]+/g,',');
  return raw.split(new RegExp('\\s*(?:,|\\s+(?:и\\s+потом|а\\s+потом|потом|затем|а\\s+еще|а\\s+ещё|и))\\s*(?='+ACTION_HEAD+'\\b)','i'))
    .map(clean).filter(Boolean);
}
function inferContextAction(text){
  const raw=clean(text),s=normalize(raw);let m;
  if(!raw)return null;

  m=raw.match(/^(?:сделай|поставь|установи|измени|поменяй)?\s*(?:цен[ау])?\s*(?:на|до|по)?\s*(\d+(?:[.,]\d+)?)\s*(?:₽|р\.?|руб[а-я]*)?$/i);
  if(m)return {intent:'menu_price_context',price:Number(String(m[1]).replace(',','.'))};

  m=raw.match(/^(?:сделай|поставь|установи|измени|поменяй)\s+цен[ау]\s*(?:на|до|по)?\s*(\d+(?:[.,]\d+)?)\s*(?:₽|р\.?|руб[а-я]*)?$/i);
  if(m)return {intent:'menu_price_context',price:Number(String(m[1]).replace(',','.'))};

  m=raw.match(/^(?:подними|увеличь)\s+(?:цен[ау]\s+)?(?:на\s+)?(\d+(?:[.,]\d+)?)\s*(?:₽|р\.?|руб[а-я]*)?$/i);
  if(m)return {intent:'menu_price_delta',delta:Math.abs(Number(String(m[1]).replace(',','.')))};

  m=raw.match(/^(?:снизь|уменьши)\s+(?:цен[ау]\s+)?(?:на\s+)?(\d+(?:[.,]\d+)?)\s*(?:₽|р\.?|руб[а-я]*)?$/i);
  if(m)return {intent:'menu_price_delta',delta:-Math.abs(Number(String(m[1]).replace(',','.')))};

  if(/^(?:(?:временно|пока)\s+)?(?:убери|сними|выключи)\s+(?:ее|её|его|позицию|блюдо)?\s*(?:из\s+)?(?:продажи|наличия)$/i.test(raw)||
     /^(?:пока\s+)?(?:не\s+продаем|не\s+продаём|не\s+продавай|нет\s+в\s+наличии|закончил[а-яa-z0-9]*)$/i.test(raw))
    return {intent:'menu_available',available:false};

  if(/^(?:верни|включи|добавь\s+обратно)\s+(?:ее|её|его|позицию|блюдо)?\s*(?:в\s+)?(?:продажу|наличие)$/i.test(raw)||
     /^(?:снова|опять)\s+(?:есть|продаем|продаём)\s*(?:в\s+наличии)?$/i.test(raw))
    return {intent:'menu_available',available:true};

  if(/^(?:скрой|убери)\s+(?:ее|её|его|позицию|блюдо)?\s*(?:из\s+меню)?$/i.test(raw))return {intent:'menu_toggle',enabled:false};
  if(/^(?:покажи|верни|включи)\s+(?:ее|её|его|позицию|блюдо)?\s*(?:в\s+меню)$/i.test(raw))return {intent:'menu_toggle',enabled:true};

  m=raw.match(/^(?:остаток|оставь|пусть\s+останется)\s*(\d+)\s*(?:шт|штук|штуки)?$/i);
  if(m)return {intent:'menu_stock',value:Number(m[1])};
  if(/^(?:остаток|запас)\s+(?:безлимит|без\s+ограничений|не\s+считать)$/i.test(raw))return {intent:'menu_stock',value:null};

  m=raw.match(/^(?:вес|сделай\s+вес|поставь\s+вес)\s*(.+)$/i);
  if(m)return {intent:'menu_weight',value:clean(m[1])};

  m=raw.match(/^(?:бейдж|метка|пометь\s+как)\s+(.+)$/i);
  if(m)return {intent:'menu_badge',value:clean(m[1])};

  if(/^(?:сделай\s+)?(?:рекомендованн[а-я]*|в\s+рекомендации)$/i.test(raw))return {intent:'menu_recommended',enabled:true};
  if(/^(?:убери|сними)\s+(?:из\s+)?рекомендаци[йи]$/i.test(raw))return {intent:'menu_recommended',enabled:false};

  m=raw.match(/^(?:состав|сделай\s+состав|поставь\s+состав)\s*(?:=|:)?\s*(.+)$/i);
  if(m)return {intent:'menu_composition',value:clean(m[1])};

  m=raw.match(/^(?:теги|метки)\s*(?:=|:)?\s*(.+)$/i);
  if(m)return {intent:'menu_tags',value:clean(m[1]).split(/[,;]+/).map(clean).filter(Boolean)};

  if(/^не\s+скрывай\s+(?:из\s+меню)?$/i.test(raw)||/^оставь\s+(?:ее|её|его)?\s*в\s+меню$/i.test(raw))
    return {intent:'menu_toggle',enabled:true};

  return null;
}
function inferItemActionPlan(text){
  const raw=clean(text);if(!raw)return null;
  let item='',rest='',m;

  m=raw.match(new RegExp('^(?:у|для)\\s+(.+?)\\s+('+ACTION_HEAD+'\\b.*)$','i'));
  if(m){item=clean(m[1]);rest=clean(m[2])}

  if(!item){
    m=raw.match(/^(?:работаем\s+с|работать\s+с|возьми|открой|перейди\s+к)\s+(.+?)[,;]\s*(.+)$/i);
    if(m){item=clean(m[1]);rest=clean(m[2])}
  }

  if(!item)return null;
  const clauses=splitActionClauses(rest);
  if(!clauses.length)return null;
  const actions=[];
  for(const clause of clauses){
    const parsed=parseCommand(clause);
    let action=parsed.intent!=='unknown'&&commandNeedsItem(parsed)?parsed:inferContextAction(clause);
    if(!action)return null;
    const copy={...action};
    delete copy.item;
    actions.push(copy);
  }
  return actions.length?{kind:'item_plan',item,actions,source:raw}:null;
}

function createVenueDialogAgent({DB,commandBus}){
  async function accesses(userId){
    const q=await DB.query(
      'SELECT a.establishment_id,a.role,a.permissions,v.name,v.menu,v.config FROM shaurma_venue_admins a '+
      'JOIN shaurma_venues v ON v.establishment_id=a.establishment_id WHERE a.telegram_user_id=$1 AND a.is_active=TRUE AND v.is_active=TRUE ORDER BY v.name',
      [String(userId)]
    );
    return q.rows;
  }
  async function context(userId){
    const q=await DB.query('SELECT * FROM shaurma_owner_command_context WHERE telegram_user_id=$1',[String(userId)]);
    return q.rows[0]||{};
  }
  async function ensureContext(userId,est){
    await DB.query(
      'INSERT INTO shaurma_owner_command_context(telegram_user_id,establishment_id,updated_at) VALUES($1,$2,NOW()) '+
      'ON CONFLICT(telegram_user_id) DO UPDATE SET establishment_id=EXCLUDED.establishment_id,updated_at=NOW()',
      [String(userId),est]
    );
  }
  async function patchContext(userId,fields={}){
    await DB.query(
      'INSERT INTO shaurma_owner_command_context(telegram_user_id,establishment_id,updated_at) VALUES($1,NULL,NOW()) '+
      'ON CONFLICT(telegram_user_id) DO NOTHING',
      [String(userId)]
    );
    const allowed=['selected_category_id','selected_item_id','selected_group_id','pending_kind','dialog_summary'];
    for(const key of allowed)if(Object.prototype.hasOwnProperty.call(fields,key)){
      await DB.query('UPDATE shaurma_owner_command_context SET '+key+'=$2,updated_at=NOW() WHERE telegram_user_id=$1',[String(userId),fields[key]===undefined?null:fields[key]]);
    }
    if(Object.prototype.hasOwnProperty.call(fields,'pending_payload')){
      await DB.query('UPDATE shaurma_owner_command_context SET pending_payload=$2::jsonb,updated_at=NOW() WHERE telegram_user_id=$1',[String(userId),JSON.stringify(fields.pending_payload||{})]);
    }
    if(Object.prototype.hasOwnProperty.call(fields,'pending_candidates')){
      await DB.query('UPDATE shaurma_owner_command_context SET pending_candidates=$2::jsonb,updated_at=NOW() WHERE telegram_user_id=$1',[String(userId),JSON.stringify(fields.pending_candidates||[])]);
    }
  }
  async function clearPending(userId){
    await patchContext(userId,{pending_kind:null,pending_payload:{},pending_candidates:[]});
  }
  async function aliases(est,type){
    const q=await DB.query('SELECT entity_id,alias,normalized_alias FROM shaurma_menu_aliases WHERE establishment_id=$1 AND entity_type=$2',[est,type]);
    return q.rows;
  }
  async function addAlias(userId,est,type,id,alias){
    const a=clean(alias),n=normalize(alias);
    if(!a||!n)return;
    await DB.query(
      'INSERT INTO shaurma_menu_aliases(establishment_id,entity_type,entity_id,alias,normalized_alias,telegram_user_id) VALUES($1,$2,$3,$4,$5,$6) '+
      'ON CONFLICT(establishment_id,entity_type,normalized_alias) DO UPDATE SET entity_id=EXCLUDED.entity_id,alias=EXCLUDED.alias,telegram_user_id=EXCLUDED.telegram_user_id',
      [est,type,String(id),a,n,String(userId)]
    );
  }

  function sections(venue){
    if(typeof require('../v2/backend/src/domain').normalizeMenuSections==='function'){
      return require('../v2/backend/src/domain').normalizeMenuSections(venue?.config?.menu_sections,venue?.menu||[],true);
    }
    return Array.isArray(venue?.config?.menu_sections)?venue.config.menu_sections:[];
  }

  async function rankItems(venue,query){
    const menu=Array.isArray(venue?.menu)?venue.menu:[],secs=sections(venue),als=await aliases(venue.establishment_id,'item');
    const aliasMap=new Map();
    for(const a of als){if(!aliasMap.has(String(a.entity_id)))aliasMap.set(String(a.entity_id),[]);aliasMap.get(String(a.entity_id)).push(a.alias)}
    return menu.map(item=>{
      const section=secs.find(x=>String(x.id)===String(item.c||item.category||''));
      const names=[item?.n,item?.name,...(aliasMap.get(String(item.id))||[])].filter(Boolean);
      let titleScore=0,source='';
      for(const n of names){const s=similarity(query,n);if(s>titleScore){titleScore=s;source=n}}
      const metadataScore=similarity(query,itemText(item,section?.name||''))*.72;
      const score=Math.max(titleScore,metadataScore);
      return {id:String(item.id),label:String(item.n||item.name||'Позиция'),score,titleScore,source,type:'item',category_id:String(item.c||item.category||'')};
    }).filter(x=>x.score>=.35).sort((a,b)=>b.score-a.score).slice(0,8);
  }
  async function rankCategories(venue,query){
    const secs=sections(venue),als=await aliases(venue.establishment_id,'category');
    const aliasMap=new Map();
    for(const a of als){if(!aliasMap.has(String(a.entity_id)))aliasMap.set(String(a.entity_id),[]);aliasMap.get(String(a.entity_id)).push(a.alias)}
    return secs.map(x=>{
      const names=[x.name,x.id,...(aliasMap.get(String(x.id))||[])].filter(Boolean);
      let score=0;for(const n of names)score=Math.max(score,similarity(query,n));
      return {id:String(x.id),label:String(x.name||x.id),score,type:'category'};
    }).filter(x=>x.score>=.35).sort((a,b)=>b.score-a.score).slice(0,8);
  }
  function decisive(ranked){
    if(!ranked.length)return null;
    const a=ranked[0],b=ranked[1];
    if(a.score>=.995)return a;
    if(a.score>=.965&&(!b||a.score-b.score>=.12))return a;
    if(a.titleScore>=.97&&(!b||a.titleScore-(b.titleScore||b.score)>=.16))return a;
    return null;
  }
  async function ask(userId,kind,payload,candidates,title){
    const token=token8();
    const list=candidates.slice(0,6).map(x=>({id:x.id,label:x.label,type:x.type||kind,score:x.score,command:x.command||null,category_id:x.category_id||''}));
    await patchContext(userId,{pending_kind:kind,pending_payload:{...(payload||{}),token},pending_candidates:list});
    return {handled:true,text:clarifyText(title,list),reply_markup:candidateButtons(token,list)};
  }
  async function selectVenue(user,query){
    const list=await accesses(user.id);
    if(!list.length)return {handled:true,text:'У вас нет доступных заведений.'};
    const ranked=list.map(v=>({
      id:v.establishment_id,label:v.name+' · '+venueShortKey(v.establishment_id),type:'venue',
      score:Math.max(similarity(query,v.name),similarity(query,venueShortKey(v.establishment_id)),similarity(query,v.establishment_id))
    })).sort((a,b)=>b.score-a.score);
    const hit=decisive(ranked);
    if(hit){
      await ensureContext(user.id,hit.id);
      await patchContext(user.id,{selected_category_id:null,selected_item_id:null,selected_group_id:null});
      return commandBus.handle({user,text:'/use '+hit.id});
    }
    const candidates=ranked.filter(x=>x.score>=.3);
    if(candidates.length)return ask(user.id,'venue_select',{query},candidates,'Какое заведение выбрать?');
    return ask(user.id,'venue_select',{query},list.map(v=>({
      id:v.establishment_id,label:v.name+' · '+venueShortKey(v.establishment_id),type:'venue',score:1
    })),'По такому названию точку не нашёл. Выберите из доступных:');
  }
  async function activeVenue(user){
    const list=await accesses(user.id);
    if(!list.length)return {error:'У вас нет доступных заведений.'};
    const ctx=await context(user.id);
    let venue=list.find(x=>x.establishment_id===ctx.establishment_id);
    if(!venue&&list.length===1){venue=list[0];await ensureContext(user.id,venue.establishment_id)}
    if(!venue)return {needsVenue:true,list};
    return {venue,ctx};
  }
  async function chooseItem(user,venue,query,payload,title='Какую именно позицию вы имеете в виду?'){
    const ranked=await rankItems(venue,query),hit=decisive(ranked);
    if(hit)return {item:hit};
    if(!ranked.length)return {error:'Не нашёл подходящую позицию. Напишите название чуть подробнее или сначала откройте категорию.'};
    return {ask:await ask(user.id,'item_select',payload,ranked,title)};
  }

  function fixedGroupKey(v){
    const s=normalize(v);
    if(/мяс/.test(s))return 'meats';
    if(/размер/.test(s))return 'sizes';
    if(/основ/.test(s))return 'bases';
    if(/соус/.test(s))return 'sauces';
    if(/добав/.test(s))return 'extras';
    return '';
  }
  function rankNamed(list,query,getLabel=x=>x?.name||x?.label||'',type='entity'){
    return (Array.isArray(list)?list:[]).map(x=>({
      id:String(x.id),label:String(getLabel(x)||x.id),score:similarity(query,getLabel(x)||x.id),type,raw:x
    })).filter(x=>x.score>=.35).sort((a,b)=>b.score-a.score).slice(0,8);
  }
  function currentItem(venue,ctx){
    return (Array.isArray(venue?.menu)?venue.menu:[]).find(x=>String(x.id)===String(ctx?.selected_item_id||''))||null;
  }
  function currentGroup(item,ctx){
    return (Array.isArray(item?.choice_groups)?item.choice_groups:[]).find(x=>String(x.id)===String(ctx?.selected_group_id||''))||null;
  }
  function needsCategoryResolution(command){
    return new Set(['menu_category_move','category_toggle','category_rename','category_delete','category_emoji','category_order']).has(command?.intent);
  }
  function needsCustomGroup(command){
    return new Set([
      'choice_group_select','choice_group_delete','choice_group_rename','choice_group_toggle','choice_group_required',
      'choice_group_type','choice_group_limit','choice_option_add','choice_option_price','choice_option_toggle',
      'choice_option_delete','choice_option_rename','choice_option_default'
    ]).has(command?.intent);
  }
  function needsCustomOption(command){
    return new Set(['choice_option_price','choice_option_toggle','choice_option_delete','choice_option_rename','choice_option_default']).has(command?.intent);
  }
  function needsFixedOption(command){
    return new Set(['fixed_option_delete','fixed_option_price','fixed_option_toggle','fixed_option_default']).has(command?.intent);
  }

  async function askCommandEntity(user,command,slot,candidates,title,item){
    return ask(user.id,'command_entity',{
      command,slot,item_id:item?.id||'',item_label:String(item?.n||item?.name||'')
    },candidates,title);
  }

  async function resolveNestedCommand(user,venue,ctx,command,item){
    let cmd={...command,...(item?.id?{target_item_id:String(item.id)}:{})};

    if(cmd.intent==='menu_category_move'&&clean(cmd.category)){
      const ranked=await rankCategories(venue,cmd.category),hit=decisive(ranked);
      if(hit){cmd.category=hit.label;cmd.target_category_id=hit.id;}
      else if(ranked.length)return askCommandEntity(user,cmd,'category',ranked,'В какую категорию перенести позицию?',item);
      else return {handled:true,text:'Категорию «'+cmd.category+'» не нашёл. Чтобы не создать лишний раздел из-за опечатки, сначала явно создайте её: «добавь категорию '+cmd.category+'».'};
    }

    if(needsCustomGroup(cmd)){
      const groups=Array.isArray(item?.choice_groups)?item.choice_groups:[];
      let group=null;
      if(clean(cmd.group)){
        const ranked=rankNamed(groups,cmd.group,x=>x.name,'group'),hit=decisive(ranked);
        if(hit){group=groups.find(x=>String(x.id)===hit.id);cmd.group=hit.label;cmd.target_group_id=hit.id}
        else if(ranked.length)return askCommandEntity(user,cmd,'group',ranked,'Какую группу выбора вы имеете в виду?',item);
        else return {handled:true,text:'Группу «'+cmd.group+'» у позиции «'+String(item?.n||item?.name||'')+'» не нашёл. Ничего не меняю.'};
      }else{
        group=currentGroup(item,ctx);
        if(!group&&groups.length===1)group=groups[0];
        if(!group&&groups.length>1){
          const ranked=groups.map(x=>({id:String(x.id),label:String(x.name||x.id),score:1,type:'group'}));
          return askCommandEntity(user,cmd,'group',ranked,'С какой группой выбора работаем?',item);
        }
        if(!group&&groups.length===0&&cmd.intent!=='choice_group_add'){
          return {handled:true,text:'У этой позиции пока нет произвольных групп выбора. Можно сказать: «добавь выбор Размер».'};
        }
        if(group){cmd.group=String(group.name||group.id);cmd.target_group_id=String(group.id)}
      }
      if(group)await patchContext(user.id,{selected_group_id:String(group.id)});

      if(needsCustomOption(cmd)){
        const g=group||currentGroup(item,await context(user.id));
        if(!g)return {handled:true,text:'Сначала выберите группу параметров.'};
        const ranked=rankNamed(g.options||[],cmd.option,x=>x.name,'option'),hit=decisive(ranked);
        if(hit){cmd.option=hit.label;cmd.target_option_id=hit.id;}
        else if(ranked.length)return askCommandEntity(user,cmd,'option',ranked,'Какой именно вариант изменить?',item);
        else return {handled:true,text:'Вариант «'+String(cmd.option||'')+'» в группе «'+String(g.name||'')+'» не найден. Ничего не меняю.'};
      }
    }

    if(needsFixedOption(cmd)){
      const key=fixedGroupKey(cmd.group),list=Array.isArray(item?.options?.[key])?item.options[key]:[];
      if(!key)return {handled:true,text:'Не понял тип варианта. Уточните: мясо, размер, основа, соус или добавка.'};
      const ranked=rankNamed(list,cmd.option,x=>x.name,'fixed_option'),hit=decisive(ranked);
      if(hit){cmd.option=hit.label;cmd.target_option_id=hit.id;}
      else if(ranked.length)return askCommandEntity(user,cmd,'option',ranked,'Какой именно вариант '+normalize(cmd.group)+' изменить?',item);
      else return {handled:true,text:'Не нашёл вариант «'+String(cmd.option||'')+'». Ничего не меняю.'};
    }

    if(destructive(cmd))return confirmDanger(user,cmd,String(item?.n||item?.name||''));
    return executeResolved(user,cmd,String(item?.n||item?.name||''));
  }

  async function resolveCategoryCommand(user,venue,command){
    const ranked=await rankCategories(venue,command.category),hit=decisive(ranked);
    if(hit){
      const cmd={...command,category:hit.label,target_category_id:hit.id};
      if(destructive(cmd))return confirmDanger(user,cmd,'');
      return executeResolved(user,cmd,'');
    }
    if(ranked.length)return askCommandEntity(user,command,'category',ranked,'Какую именно категорию изменить?',null);
    return {handled:true,text:'Категорию «'+String(command.category||'')+'» не нашёл. Ничего не меняю.'};
  }
  async function executeResolved(user,command,itemLabel=''){
    const structured={...command};
    if(itemLabel&&!structured.item)structured.item=itemLabel;
    if(typeof commandBus.execute==='function')return commandBus.execute({user,command:structured});
    // Compatibility fallback only; the dialog agent itself never reparses when execute() exists.
    const text=canonicalText(structured,itemLabel);
    if(!text)return {handled:false};
    return commandBus.handle({user,text});
  }
  async function confirmDanger(user,command,itemLabel){
    const token=token8(),candidates=[
      {id:'yes',label:'Да, выполнить',type:'confirm',command:{command,itemLabel}},
      {id:'no',label:'Отмена',type:'confirm'}
    ];
    await patchContext(user.id,{pending_kind:'confirm',pending_payload:{token,command,itemLabel},pending_candidates:candidates});
    return {handled:true,text:'Это удаляющее действие. Подтвердить?\n\n'+canonicalText(command,itemLabel),reply_markup:candidateButtons(token,candidates)};
  }

  async function consumePending(user,text,callbackIndex=null,callbackToken=''){
    const ctx=await context(user.id),kind=String(ctx.pending_kind||'');
    if(!kind)return null;
    const payload=ctx.pending_payload&&typeof ctx.pending_payload==='object'?ctx.pending_payload:{};
    const candidates=Array.isArray(ctx.pending_candidates)?ctx.pending_candidates:[];
    if(callbackToken&&payload.token!==callbackToken)return {handled:true,text:'Это уточнение уже устарело. Напишите запрос ещё раз.'};
    if(isCancel(text)||callbackIndex==='x'){await clearPending(user.id);return {handled:true,text:'Хорошо, ничего не меняю.'}}

    let idx=callbackIndex===null?ordinal(text):Number(callbackIndex);
    if(kind==='confirm'&&callbackIndex===null&&isYes(text))idx=candidates.findIndex(x=>x.id==='yes');
    if(!(idx>=0&&idx<candidates.length)){
      const n=normalize(text);
      const scored=candidates.map((x,i)=>({i,score:similarity(n,x.label)})).sort((a,b)=>b.score-a.score);
      if(scored[0]?.score>=.9&&(scored.length===1||scored[0].score-scored[1].score>=.15))idx=scored[0].i;
    }
    if(!(idx>=0&&idx<candidates.length)){
      return {handled:true,text:clarifyText('Не смог однозначно понять ответ. Выберите один вариант:',candidates),reply_markup:candidateButtons(payload.token,candidates)};
    }
    const chosen=candidates[idx];

    if(kind==='confirm'){
      await clearPending(user.id);
      if(chosen.id!=='yes')return {handled:true,text:'Отменено.'};
      return executeResolved(user,payload.command,payload.itemLabel||'');
    }

    if(kind==='venue_select'){
      await clearPending(user.id);
      await ensureContext(user.id,chosen.id);
      await patchContext(user.id,{selected_category_id:null,selected_item_id:null,selected_group_id:null});
      return commandBus.handle({user,text:'/use '+chosen.id});
    }

    if(kind==='category_nav'){
      await clearPending(user.id);
      await patchContext(user.id,{selected_category_id:chosen.id,selected_item_id:null,selected_group_id:null});
      const active=await activeVenue(user),menu=Array.isArray(active.venue?.menu)?active.venue.menu:[];
      const items=menu.filter(x=>String(x.c||x.category||'')===String(chosen.id)&&x.active!==false);
      return {handled:true,text:'Открыта категория «'+chosen.label+'».\n\n'+(items.length?items.slice(0,30).map(x=>'• '+String(x.n||x.name)+' · '+Number(x.p??x.price??0)+' ₽').join('\n'):'В категории пока нет активных позиций.')+'\n\nМожно написать название блюда или что нужно изменить.'};
    }

    if(kind==='alias_select'){
      await clearPending(user.id);
      const active=await activeVenue(user);
      if(!active.venue)return {handled:true,text:'Активная точка не найдена.'};
      await addAlias(user.id,active.venue.establishment_id,chosen.type,chosen.id,payload.alias);
      return {handled:true,text:'Запомнил: «'+payload.alias+'» = «'+chosen.label+'» для этой точки.'};
    }

    if(kind==='item_select'){
      await clearPending(user.id);
      await patchContext(user.id,{selected_item_id:chosen.id,selected_group_id:null,...(chosen.category_id?{selected_category_id:chosen.category_id}:{})});
      const cmd=payload.command;
      if(payload.alias){
        const active=await activeVenue(user);
        await addAlias(user.id,active.venue.establishment_id,'item',chosen.id,payload.alias);
        return {handled:true,text:'Запомнил: «'+payload.alias+'» = «'+chosen.label+'» для этой точки.'};
      }
      if(cmd){
        const active=await activeVenue(user),fresh=await context(user.id);
        const item=(active.venue?.menu||[]).find(x=>String(x.id)===String(chosen.id));
        if(!item)return {handled:true,text:'Позиция уже изменилась или удалена. Повторите запрос.'};
        return resolveNestedCommand(user,active.venue,fresh,{...cmd,target_item_id:chosen.id},item);
      }
      return executeResolved(user,{intent:'menu_item_select',item:chosen.label,target_item_id:chosen.id},chosen.label);
    }

    if(kind==='entity_nav'){
      await clearPending(user.id);
      if(chosen.type==='category'){
        await patchContext(user.id,{selected_category_id:chosen.id,selected_item_id:null,selected_group_id:null});
        const active=await activeVenue(user),menu=Array.isArray(active.venue?.menu)?active.venue.menu:[];
        const items=menu.filter(x=>String(x.c||x.category||'')===String(chosen.id)&&x.active!==false);
        return {handled:true,text:'Открыта категория «'+chosen.label+'».\n\n'+(items.length?items.slice(0,30).map(x=>'• '+String(x.n||x.name)+' · '+Number(x.p??x.price??0)+' ₽').join('\n'):'В категории пока пусто.')+'\n\nМожно написать название позиции.'};
      }
      await patchContext(user.id,{selected_item_id:chosen.id,selected_group_id:null,...(chosen.category_id?{selected_category_id:chosen.category_id}:{})});
      return executeResolved(user,{intent:'menu_item_select',item:chosen.label,target_item_id:chosen.id},chosen.label);
    }

    if(kind==='command_entity'){
      await clearPending(user.id);
      const active=await activeVenue(user);
      if(!active.venue)return {handled:true,text:'Активная точка не найдена.'};
      const cmd={...(payload.command||{})};
      if(payload.slot==='category'){cmd.category=chosen.label;cmd.target_category_id=chosen.id;}
      if(payload.slot==='group'){
        cmd.group=chosen.label;cmd.target_group_id=chosen.id;
        await patchContext(user.id,{selected_group_id:chosen.id});
      }
      if(payload.slot==='option'){cmd.option=chosen.label;cmd.target_option_id=chosen.id;}
      const fresh=await context(user.id);
      const item=(active.venue.menu||[]).find(x=>String(x.id)===String(payload.item_id||fresh.selected_item_id||''));
      if(item)return resolveNestedCommand(user,active.venue,fresh,cmd,item);
      if(needsCategoryResolution(cmd))return resolveCategoryCommand(user,active.venue,cmd);
      if(destructive(cmd))return confirmDanger(user,cmd,'');
      return executeResolved(user,cmd,'');
    }

    if(kind==='action'){
      await clearPending(user.id);
      const action=chosen.command;
      if(!action)return {handled:true,text:'Ничего не меняю.'};
      const active=await activeVenue(user);
      const item=await chooseItem(user,active.venue,action.item,{command:action},'Какую позицию изменить?');
      if(item.error)return {handled:true,text:item.error};
      if(item.ask)return item.ask;
      await patchContext(user.id,{selected_item_id:item.item.id,selected_group_id:null,...(item.item.category_id?{selected_category_id:item.item.category_id}:{})});
      const fresh=await context(user.id);
      const row=(active.venue?.menu||[]).find(x=>String(x.id)===String(item.item.id));
      return resolveNestedCommand(user,active.venue,fresh,action,row);
    }

    return null;
  }

  async function handle({user,text}){
    const raw=clean(text);if(!user?.id||!raw)return {handled:false};

    const parsed=parseCommand(raw);
    const ctx0=await context(user.id);
    if(ctx0.pending_kind){
      const explicitOverride=new Set(['help','venues_show','venue_select']).has(parsed.intent);
      if(explicitOverride)await clearPending(user.id);
      else{
        const pending=await consumePending(user,raw);
        if(pending)return pending;
      }
    }

    if(parsed.intent==='help')return {handled:true,text:dialogHelpText()};
    if(parsed.intent==='venues_show')return commandBus.handle({user,text:raw});
    if(parsed.intent==='venue_select')return selectVenue(user,parsed.query);

    const active=await activeVenue(user);
    if(active.error)return {handled:true,text:active.error};
    if(active.needsVenue){
      const ranked=active.list.map(v=>({id:v.establishment_id,label:v.name+' · '+venueShortKey(v.establishment_id),type:'venue',score:1}));
      return ask(user.id,'venue_select',{query:''},ranked,'Сначала выберите заведение:');
    }
    const {venue,ctx}=active;

    const free=parsed.intent==='unknown'?inferFreeform(raw):null;

    if(free?.kind==='context_status'){
      const secs=sections(venue);
      const item=currentItem(venue,ctx);
      const cat=secs.find(x=>String(x.id)===String(ctx.selected_category_id||item?.c||item?.category||''));
      const group=currentGroup(item,ctx);
      return {handled:true,text:[
        'Сейчас выбрано:',
        'Точка: '+String(venue.name),
        'Раздел: '+String(cat?.name||'—'),
        'Позиция: '+String(item?.n||item?.name||'—'),
        'Группа выбора: '+String(group?.name||'—')
      ].join('\n')};
    }

    if(free?.kind==='menu_root'){
      await patchContext(user.id,{selected_category_id:null,selected_item_id:null,selected_group_id:null});
      return commandBus.handle({user,text:'покажи категории'});
    }

    if(free?.kind==='list_here'){
      const item=currentItem(venue,ctx);
      if(item)return commandBus.handle({user,text:'покажи настройки позиции'});
      if(ctx.selected_category_id){
        const sec=sections(venue).find(x=>String(x.id)===String(ctx.selected_category_id));
        const items=(venue.menu||[]).filter(x=>String(x.c||x.category||'')===String(ctx.selected_category_id)&&x.active!==false);
        return {handled:true,text:'Раздел «'+String(sec?.name||ctx.selected_category_id)+'»:\n\n'+(items.length?items.slice(0,30).map(x=>'• '+String(x.n||x.name)+' · '+Number(x.p??x.price??0)+' ₽').join('\n'):'Пока пусто.')};
      }
      return commandBus.handle({user,text:'покажи категории'});
    }

    if(free?.kind==='back'){
      const item=currentItem(venue,ctx);
      if(ctx.selected_group_id&&item){
        await patchContext(user.id,{selected_group_id:null});
        return commandBus.handle({user,text:'покажи настройки позиции'});
      }
      if(item){
        const categoryId=String(ctx.selected_category_id||item.c||item.category||'');
        await patchContext(user.id,{selected_item_id:null,selected_group_id:null,selected_category_id:categoryId||null});
        if(categoryId){
          const sec=sections(venue).find(x=>String(x.id)===categoryId);
          const items=(venue.menu||[]).filter(x=>String(x.c||x.category||'')===categoryId&&x.active!==false);
          return {handled:true,text:'Вернулись в раздел «'+String(sec?.name||categoryId)+'».\n\n'+(items.length?items.slice(0,30).map(x=>'• '+String(x.n||x.name)+' · '+Number(x.p??x.price??0)+' ₽').join('\n'):'Пока пусто.')};
        }
      }
      if(ctx.selected_category_id){
        await patchContext(user.id,{selected_category_id:null,selected_item_id:null,selected_group_id:null});
        return commandBus.handle({user,text:'покажи категории'});
      }
      return {handled:true,text:'Вы уже на верхнем уровне точки «'+String(venue.name)+'». Напишите «мои заведения», чтобы переключить точку.'};
    }
    if(free?.kind==='alias'){
      const itemRank=await rankItems(venue,free.target),catRank=await rankCategories(venue,free.target);
      const ih=decisive(itemRank),ch=decisive(catRank);
      if(ih&&(!ch||ih.score>ch.score+.08)){
        await addAlias(user.id,venue.establishment_id,'item',ih.id,free.alias);
        return {handled:true,text:'Запомнил: «'+free.alias+'» = «'+ih.label+'».'};
      }
      if(ch&&(!ih||ch.score>ih.score+.08)){
        await addAlias(user.id,venue.establishment_id,'category',ch.id,free.alias);
        return {handled:true,text:'Запомнил: «'+free.alias+'» = раздел «'+ch.label+'».'};
      }
      const merged=[...itemRank.slice(0,4),...catRank.slice(0,3)].sort((a,b)=>b.score-a.score);
      if(!merged.length)return {handled:true,text:'Не нашёл, к чему привязать «'+free.alias+'». Сначала назовите точное блюдо или раздел.'};
      return ask(user.id,'alias_select',{alias:free.alias},merged,'Что именно вы называете «'+free.alias+'»?');
    }
    if(free?.kind==='action_clarify'){
      const token=token8(),candidates=free.actions.map((x,i)=>({id:String(i),label:x.label,type:'action',command:x.command}));
      await patchContext(user.id,{pending_kind:'action',pending_payload:{token},pending_candidates:candidates});
      return {handled:true,text:'Что именно сделать с «'+free.item+'»?',reply_markup:candidateButtons(token,candidates)};
    }
    if(free?.kind==='navigate_category'){
      const ranked=await rankCategories(venue,free.query),hit=decisive(ranked);
      if(hit){
        await patchContext(user.id,{selected_category_id:hit.id,selected_item_id:null,selected_group_id:null});
        const items=(venue.menu||[]).filter(x=>String(x.c||x.category||'')===hit.id&&x.active!==false);
        return {handled:true,text:'Открыта категория «'+hit.label+'».\n\n'+(items.length?items.slice(0,30).map(x=>'• '+String(x.n||x.name)+' · '+Number(x.p??x.price??0)+' ₽').join('\n'):'В категории пока пусто.')+'\n\nМожно написать название позиции.'};
      }
      if(ranked.length)return ask(user.id,'category_nav',{query:free.query},ranked,'Какую категорию открыть?');
    }
    if(free?.kind==='navigate_item'||free?.kind==='bare_entity'){
      const query=free.query;
      const itemRank=await rankItems(venue,query),catRank=await rankCategories(venue,query);
      const ih=decisive(itemRank),ch=decisive(catRank);
      if(ih&&(!ch||ih.score>ch.score+.08)){
        await patchContext(user.id,{selected_item_id:ih.id,selected_group_id:null,...(ih.category_id?{selected_category_id:ih.category_id}:{})});
        return executeResolved(user,{intent:'menu_item_select',item:ih.label,target_item_id:ih.id},ih.label);
      }
      if(ch&&(!ih||ch.score>ih.score+.08)){
        await patchContext(user.id,{selected_category_id:ch.id,selected_item_id:null,selected_group_id:null});
        const items=(venue.menu||[]).filter(x=>String(x.c||x.category||'')===ch.id&&x.active!==false);
        return {handled:true,text:'Открыта категория «'+ch.label+'».\n\n'+(items.length?items.slice(0,30).map(x=>'• '+String(x.n||x.name)+' · '+Number(x.p??x.price??0)+' ₽').join('\n'):'В категории пока пусто.')};
      }
      const merged=[...itemRank.slice(0,4),...catRank.slice(0,3)].sort((a,b)=>b.score-a.score);
      if(merged.length){
        const token=token8();
        await patchContext(user.id,{pending_kind:'entity_nav',pending_payload:{token},pending_candidates:merged});
        return {handled:true,text:clarifyText('Что вы имели в виду — блюдо или раздел?',merged),reply_markup:candidateButtons(token,merged)};
      }
    }

    const command=free?.kind==='command'?free.command:parsed;
    if(command?.intent&&command.intent!=='unknown'){
      if(commandNeedsItem(command)){
        const q=commandItemQuery(command);
        if(q){
          const picked=await chooseItem(user,venue,q,{command},'Какую именно позицию изменить?');
          if(picked.error)return {handled:true,text:picked.error};
          if(picked.ask)return picked.ask;
          await patchContext(user.id,{selected_item_id:picked.item.id,selected_group_id:null,...(picked.item.category_id?{selected_category_id:picked.item.category_id}:{})});
          const fresh=await context(user.id);
          const item=(venue.menu||[]).find(x=>String(x.id)===String(picked.item.id));
          if(!item)return {handled:true,text:'Позиция уже изменилась или удалена. Повторите запрос.'};
          return resolveNestedCommand(user,venue,fresh,{...command,target_item_id:picked.item.id},item);
        }
        const fresh=await context(user.id);
        if(!fresh.selected_item_id){
          return {handled:true,text:'Сначала уточним блюдо. Напишите его название или, например, «покажи напитки». Ничего не меняю, пока позиция не определена точно.'};
        }
        const current=(venue.menu||[]).find(x=>String(x.id)===String(fresh.selected_item_id));
        if(!current)return {handled:true,text:'Выбранная ранее позиция больше не найдена. Назовите блюдо ещё раз.'};
        return resolveNestedCommand(user,venue,fresh,{...command,target_item_id:String(current.id)},current);
      }
      if(needsCategoryResolution(command))return resolveCategoryCommand(user,venue,command);
      if(destructive(command))return confirmDanger(user,command,'');
      if(typeof commandBus.execute==='function')return commandBus.execute({user,command});
      return commandBus.handle({user,text:raw});
    }

    const salvageItems=await rankItems(venue,raw),salvageCats=await rankCategories(venue,raw);
    const salvage=[...salvageItems.slice(0,4),...salvageCats.slice(0,3)].sort((a,b)=>b.score-a.score);
    if(salvage.length&&salvage[0].score>=.45){
      const token=token8();
      await patchContext(user.id,{pending_kind:'entity_nav',pending_payload:{token},pending_candidates:salvage});
      return {
        handled:true,
        text:clarifyText('Действие сформулировано неоднозначно. Ничего не меняю. Но похоже, речь об одном из этих объектов — выберите, и продолжим:',salvage),
        reply_markup:candidateButtons(token,salvage)
      };
    }

    return {handled:true,text:'Я не уверен, что понял задачу, поэтому ничего не меняю.\n\nМожно написать естественно, например:\n«найди сырную шаурму»\n«у сырной сделай цену 420»\n«покажи напитки»\n«убери айран» — я уточню, скрыть его или поставить в стоп-лист.\n\nЕсли хотите, просто напишите название блюда — начнём с точного поиска.'};
  }

  async function handleCallback({user,data}){
    const m=String(data||'').match(/^va:([a-f0-9]{8}):(x|\d+)$/);
    if(!m||!user?.id)return {handled:false};
    return consumePending(user,'',m[2]==='x'?'x':Number(m[2]),m[1]);
  }

  return {handle,handleCallback,similarity,normalize};
}

module.exports={createVenueDialogAgent,similarity,normalize,inferFreeform};
