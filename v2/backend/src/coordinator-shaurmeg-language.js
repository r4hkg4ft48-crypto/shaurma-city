'use strict';

// Extra conversational commands for Shaurmeg only. No other project's catalog is read.
// This module produces proposals, NEVER performs writes.
const base=require('./coordinator-language');
const normalize=base.normalize;
const same=(a,b)=>normalize(a)===normalize(b)||base.key(a)===base.key(b);
const clean=x=>String(x||'').trim();
const unsafe=x=>!x||/[\u0000-\u001f]/.test(x);
const message='Точное совпадение не найдено. Назовите блюдо и его разновидность точнее.';
const stdAlias=x=>/^[\p{L}\p{N} _-]+$/u.test(x);
function choose(catalog,name,kinds){
  const prefix=/^(?:(?:раздел|категорию|категория|блюдо|позицию|позиция)\s+)/i;
  const target=clean(name).replace(prefix,'');
  const scoped=catalog.filter(x=>kinds.includes(x.kind));
  const matches=scoped.filter(x=>same(x.name,target)||(x.spokenName&&same(x.spokenName,target))||same(x.code,target));
  if(matches.length===1)return {type:'match',item:matches[0]};
  if(matches.length>1)return {type:'ambiguous',message:'Несколько объектов с похожим названием. Уточните полное название:',items:matches.slice(0,8)};
  const words=base.key(target).split(' ').filter(Boolean);
  const candidates=scoped.filter(x=>words.some(w=>[...base.key(x.name).split(' '),...(x.spokenName?base.key(x.spokenName).split(' '):[])].includes(w))).slice(0,8);
  return {type:'ambiguous',message,items:candidates};
}
function proposal(item,command){
  return {type:'proposal',item:{kind:item.kind,id:String(item.id),code:item.code,name:item.name},command,
    text:'Подтвердите изменение: «'+item.name+'» → '+command+'.'};
}
function forTarget(catalog,name,kinds,command){
  const match=choose(catalog,name,kinds);
  return match.type==='match'?proposal(match.item,command):match;
}
function ingredientOf(catalog,dish,ingredient){
  const owned=catalog.filter(x=>{
    if(x.kind!=='ingredient')return false;
    try{const identity=JSON.parse(x.id);return Array.isArray(identity)&&String(identity[0])===String(dish.id)&&identity[1]==='ingredient'}
    catch{return false}
  });
  const found=owned.filter(x=>same(String(x.name).split(' · ').pop(),ingredient)||(x.spokenName&&same(x.spokenName,ingredient)));
  if(found.length===1)return {type:'match',item:found[0]};
  return {type:'ambiguous',message:'Ингредиент не найден однозначно в составе выбранного блюда. Уточните:',items:owned.slice(0,8)};
}
function advanced(input,items){
  const raw=clean(input),s=normalize(raw);
  if(!raw||raw.length>1200||/[\u0000-\u001f]/.test(raw))return null;
  const catalog=(Array.isArray(items)?items:[]).filter(x=>x?.code&&x?.name);
  let m;
  // The human-friendly identifier is a separate venue-local alias. It never
  // changes the immutable menu ID or guest-facing dish name.
  m=raw.match(/^(?:переименуй|измени|задай|установи|назови)\s+(?:идентификатор|псевдоним|обращение)(?:\s+(?:для|у))?\s+(.+?)\s+(?:в|на|как)\s+(.+)$/i);
  if(m){
    const newName=clean(m[2]).replace(/^[«"']|[»"']$/g,'');
    if(newName.length<2||newName.length>80||!stdAlias(newName))
      return {type:'unsupported',message:'Укажите короткое имя от 2 до 80 символов: буквы, цифры, пробел, дефис или _.'};
    const target=clean(m[1]);
    const ingredient=/^ингредиента?\s+/i.test(target);
    const kind=ingredient?['ingredient']:['item','ingredient','category','group','option'];
    return forTarget(catalog,target.replace(/^ингредиента?\s+/i,''),kind,'идентификатор '+newName);
  }
  // Explicit category requests cannot accidentally match an identically named dish.
  m=s.match(/^(?:убери|отключи|останови|выключи|поставь в стоп)\s+(?:раздел|категорию|категория)\s+(.+)$/);
  if(m)return forTarget(catalog,m[1],['category'],'стоп лист');
  m=s.match(/^(?:верни|включи|возобнови)\s+(?:раздел|категорию|категория)\s+(.+)$/);
  if(m)return forTarget(catalog,m[1],['category'],'в наличии');
  m=s.match(/^(?:скрой|спрячь|убери из меню)\s+(.+)$/);
  if(m)return forTarget(catalog,m[1],['item','category','option','group'],'скрыть');
  m=s.match(/^(?:покажи в меню|отобрази в меню)\s+(.+)$/);
  if(m)return forTarget(catalog,m[1],['item','category','option','group'],'показать');

  // Original user text (not normalized) is needed for new names, descriptions and recipes.
  m=raw.match(/^(?:переименуй|измени название)\s+(?:категорию|раздел)\s+(.+?)\s+(?:в|на)\s+(.+)$/i);
  if(m){
    const name=clean(m[2]);if(unsafe(name)||name.length>120)return {type:'unsupported',message:'Название должно содержать от 1 до 120 символов.'};
    return forTarget(catalog,m[1],['category'],'название '+name);
  }
  m=raw.match(/^(?:переименуй|измени название)\s+(.+?)\s+(?:в|на)\s+(.+)$/i);
  if(m){
    const name=clean(m[2]);if(unsafe(name)||name.length>120)return {type:'unsupported',message:'Название должно содержать от 1 до 120 символов.'};
    return forTarget(catalog,m[1],['item','option','group'],'название '+name);
  }
  m=raw.match(/^(?:измени|установи|запиши)\s+описание\s+(?:для\s+)?(.+?)\s+(?:на|:)\s+(.+)$/i);
  if(m){
    const description=clean(m[2]);if(unsafe(description)||description.length>900)return {type:'unsupported',message:'Описание должно содержать от 1 до 900 символов.'};
    return forTarget(catalog,m[1],['item'],'описание '+description);
  }
  m=raw.match(/^(?:замени состав|установи состав|состав для)\s+(.+?)\s+на\s+(.+)$/i);
  if(m){
    const recipe=clean(m[2]);if(unsafe(recipe)||recipe.length>1200)return {type:'unsupported',message:'Состав должен содержать от 1 до 1200 символов.'};
    return forTarget(catalog,m[1],['item'],'состав = '+recipe);
  }
  // A unique, named ingredient can be removed from its own dish by its
  // friendly identifier. Bare repeated ingredients require disambiguation.
  m=raw.match(/^(?:убери|удали|исключи)\s+ингредиент(?:а)?\s+(.+)$/i);
  if(m){
    const found=choose(catalog,clean(m[1]),['ingredient']);
    if(found.type!=='match')return found;
    let parts;try{parts=JSON.parse(found.item.id)}catch{return {type:'unsupported',message:'Уточните блюдо для ингредиента.'}}
    const parent=catalog.find(x=>x.kind==='item'&&String(x.id)===String(parts[0]));
    if(!parent||parts[1]!=='ingredient')return {type:'unsupported',message:'Ингредиент не связан с текущим блюдом.'};
    return proposal(parent,'состав '+found.item.code+' убрать');
  }
  // Check ownership of an ingredient BEFORE constructing an executor command.
  m=raw.match(/^(?:убери|удали|исключи)\s+(.+?)\s+из\s+(.+)$/i);
  if(m){
    const dish=choose(catalog,m[2],['item']);
    if(dish.type!=='match')return dish;
    const ingredient=ingredientOf(catalog,dish.item,clean(m[1]));
    if(ingredient.type!=='match')return ingredient;
    return proposal(dish.item,'состав '+ingredient.item.code+' убрать');
  }
  m=raw.match(/^(?:добавь|добавить|положи)\s+(.+?)\s+(?:в|для)\s+(.+)$/i);
  if(m){
    const ingredient=clean(m[1]);
    if(unsafe(ingredient)||ingredient.length>120||/[,;|]/.test(ingredient))
      return {type:'unsupported',message:'Название ингредиента должно быть коротким, без запятых и разделителей.'};
    return forTarget(catalog,m[2],['item'],'состав + '+ingredient);
  }
  m=raw.match(/^добавь вариант\s+(.+?)\s+в группу\s+(.+)$/i);
  if(m){
    const name=clean(m[1]);if(unsafe(name)||name.length>120||/[|;]/.test(name))return {type:'unsupported',message:'Уточните название варианта.'};
    return forTarget(catalog,m[2],['group'],'добавить вариант '+name+' | 0');
  }
  // Staff often use the old "IDENTIFIER action" syntax. Allow precisely
  // named dishes and spoken aliases in that position, including spaces:
  // "сырная шаурма стоп лист", "сырная цена 350", "сырная скрыть".
  // Resolve to the immutable item before creating a confirmation proposal.
  m=raw.match(/^(.+?)\s+(стоп(?:[\s-]+лист)?|стоп|нет в наличии|в наличии|снять стоп|скрыть|показать|цена\s+\d{1,7}(?:[.,]\d{1,2})?)$/i);
  if(m){
    let action=normalize(m[2]);
    if(action==='стоп'||action==='стоп лист'||action==='стоп-лист'||action==='нет в наличии')action='стоп лист';
    else if(action==='снять стоп')action='в наличии';
    if(action.startsWith('цена ')){
      const price=Number(action.replace(/^цена\s+/,'').replace(',','.'));
      if(!Number.isFinite(price)||price>1000000)return {type:'unsupported',message:'Недопустимая цена.'};
      action='цена '+String(price);
    }
    return forTarget(catalog,m[1],['item','category','option','group','ingredient'],action);
  }
  m=raw.match(/^(.+?)\s+(идентификатор|название|описание|состав)\s+(.+)$/i);
  if(m){
    const verb=normalize(m[2]);
    const value=clean(m[3]);
    if(verb==='идентификатор'){
      if(value.length<2||value.length>80||!stdAlias(value))
        return {type:'unsupported',message:'Понятное имя: от 2 до 80 букв, цифр, пробелов, дефисов или _.'};
    }else if(value.length>1200)return {type:'unsupported',message:'Слишком длинная команда.'};
    return forTarget(catalog,m[1],['item','category','option','group','ingredient'],verb+' '+value);
  }
  return null;
}
function resolve(input,items){
  const existing=base.resolve(input,items);
  if(existing.type==='unsupported')return existing;
  return advanced(input,items)||existing;
}
module.exports={resolve,advanced,choose,ingredientOf};
