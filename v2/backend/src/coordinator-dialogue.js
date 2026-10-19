'use strict';

// Local, deterministic conversational agent. The agent suggests ONLY scoped,
// immutable catalog commands. Execution remains outside this module.
const base=require('./coordinator-language');
const sha=require('./coordinator-shaurmeg-language');
const norm=base.normalize;
const words=x=>base.key(x).split(' ').filter(Boolean);
const clean=x=>String(x||'').trim();
const shorten=(s,n=180)=>clean(s).slice(0,n);
const MAX_OPTIONS=8;
const menuKinds=['item','category','option','group'];
const ordinals={первую:1,первый:1,первое:1,первой:1,один:1,первую:1,вторую:2,второй:2,второе:2,вторую:2,два:2,третью:3,третий:3,третье:3,три:3,четвертую:4,четвертый:4,четыре:4,пятую:5,пятый:5,пять:5,шестую:6,шестой:6,шесть:6,седьмую:7,седьмой:7,семь:7,восьмую:8,восьмой:8,восемь:8};
const fresh=()=>({wait:null,last:null});
function lookup(catalog,ref){
 if(!ref||!Array.isArray(catalog))return null;
 return catalog.find(x=>x&&x.code===ref.code&&x.kind===ref.kind&&String(x.id)===String(ref.id))||null;
}
function ref(x){return {code:x.code,kind:x.kind,id:String(x.id)};}
function optionsText(items){
 const counts=new Map();
 for(const x of items){const label=norm(x.name);counts.set(label,(counts.get(label)||0)+1);}
 return items.map((x,i)=>{
  const label=x.identifier||x.name, repeated=(counts.get(norm(x.name))||0)>1;
  const price=Number(x.price);
  const priced=x.price!==null&&x.price!==undefined&&x.price!==''&&Number.isFinite(price);
  return (i+1)+'. '+label+(label!==x.name?' ('+x.name+')':'')+
    (priced?' · '+price.toLocaleString('ru-RU')+' ₽':'')+
    (repeated?' · отдельная карточка №'+(i+1):'');
 }).join('\n');
}
function choose(catalog,term,allowed=['item']){
 const raw=norm(term).replace(/^(?:позицию|блюдо|напиток|продукт|раздел|категорию)\s+/,'');
 const pool=catalog.filter(x=>allowed.includes(x.kind));
 const exact=pool.filter(x=>norm(x.code)===raw||norm(x.name)===raw||base.key(x.name)===base.key(raw)||(x.spokenName&&(norm(x.spokenName)===raw||base.key(x.spokenName)===base.key(raw))));
 if(exact.length===1)return {exact:exact[0],items:exact};
 if(exact.length>1)return {items:exact.slice(0,MAX_OPTIONS)};
 const query=words(raw);if(!query.length)return {items:[]};
 const ranked=pool.map(x=>{
  const w=[...new Set([...words(x.name),...(x.spokenName?words(x.spokenName):[])])];
  const common=query.filter(q=>w.includes(q)||w.some(v=>v.startsWith(q)&&q.length>=3)).length;
  return {x,score:common*10-Math.abs(w.length-query.length)};
 }).filter(o=>o.score>0).sort((a,b)=>b.score-a.score);
 return {items:ranked.slice(0,MAX_OPTIONS).map(o=>o.x)};
}
function safeContextAction(text,previous){
 if(!previous)return null;
 const s=norm(text);
 if(/^(?:его|ее|её|эту|этот)\s+/.test(s))return safeContextAction(s.replace(/^(?:его|ее|её|эту|этот)\s+/,''),previous);
 if(/^(?:верни|включи|восстанови|снова в продаже|в наличии|пусть продается|сними стоп)$/i.test(s))
   return 'в наличии';
 if(/^(?:убери|сними с продажи|отключи|стоп|стоп лист|нет в наличии|выключи)$/i.test(s))
   return 'стоп лист';
 const p=s.match(/^(?:поставь|установи|сделай|цена|измени цену|сделай цену)\s+(\d{1,7})(?:\s+руб(?:лей|ля|ль)?)?$/);
 if(p&&Number(p[1])<=1000000)return 'цена '+p[1];
 return null;
}
function actionWithIncompleteTarget(input){
 const s=norm(input);
 if(/^(?:убери|останови продажу|сними с продажи|выключи|в стоп)(?:\s+(?:его|ее|её|это))?$/.test(s))return 'стоп лист';
 if(/^(?:верни|включи)(?:\s+(?:его|ее|её|это))?$/.test(s))return 'в наличии';
 const price=s.match(/^(?:поставь|установи|измени|сделай)\s+цену\s+(\d{1,7})$/);
 if(price&&Number(price[1])<=1000000)return 'цена '+price[1];
 return null;
}
function intent(input){
 const raw=clean(input),s=norm(raw);
 if(!raw||raw.length>1200||/[\u0000-\u001f]/.test(raw))return {type:'reply',text:'Скажите короткую команду или вопрос о меню.'};
 if(/^(?:привет|здравствуй|здравствуйте|добрый день|добрый вечер|начнем|начнём)$/.test(s))
   return {type:'reply',text:'Здравствуйте! Я локальный помощник «Шаурмега». Могу найти блюдо, назвать цену и состав, показать стоп-лист и историю изменений, уточнить позицию и подготовить изменение меню.'};
 if(/^(?:спасибо|благодарю|отлично|понятно)$/.test(s))
   return {type:'reply',text:'Пожалуйста! Могу продолжить работу с меню вашего заведения.'};
 if(/^(?:что ты умеешь|помощь|как с тобой работать|команды|что можно спросить)$/.test(s))
   return {type:'reply',text:'Попробуйте: «Что сейчас в стоп-листе?», «Сколько блюд в меню?», «Какой состав сырной шаурмы?», «Что изменили за сутки?», «Убери сырную». Если блюдо неясно, я уточню. Любая запись в меню требует отдельного подтверждения.'};
 if(/^(?:отмена|отмени|сброс|сбрось контекст|забудь это|начнем заново|начнём заново)$/.test(s))
   return {type:'reset',text:'Контекст разговора сброшен. Меню не изменено.'};
 if(/(?:что изменилось|последние изменения|история изменений|журнал изменений|что ты сделал|что мы поменяли|отчет об изменениях|отчёт об изменениях)/.test(s))
   return {type:'report',topic:/(?:за сутки|за день|за последние 24 часа|сегодня)/.test(s)?'audit24h':'audit'};
 if(/(?:стоп лист|стоп-лист|снято с продажи|не продает|не продаётся|нет в наличии)/.test(s)&&/^(?:что|покажи|какие|сколько|отчет|отчёт|список)/.test(s))
   return {type:'report',topic:'stopped'};
 if(/(?:отчет по меню|отчёт по меню|состояние меню|сколько блюд|сколько позиций|статистика меню|сводка по меню|отчет о меню|отчёт о меню)/.test(s))
   return {type:'report',topic:'menu'};
 let m=raw.match(/^(?:сколько стоит|какая цена(?: у)?|цену(?: для)?|скажи цену(?: на)?)(?:\s+(.+))?$/i);
 if(m)return {type:'info_query',topic:'price',name:clean(m[1])};
 m=raw.match(/^(?:какой состав(?: у)?|из чего состоит|что входит в|расскажи состав|состав(?: у)?)(?:\s+(.+))?$/i);
 if(m)return {type:'info_query',topic:'composition',name:clean(m[1])};
 m=raw.match(/^(?:есть ли в меню|есть ли в наличии|продается ли|продаётся ли|доступна ли|доступен ли)(?:\s+(.+))?$/i);
 if(m)return {type:'info_query',topic:'availability',name:clean(m[1])};
 m=raw.match(/^(?:расскажи(?: мне)?(?: про| о)|информация о|что за блюдо)(?:\s+(.+))?$/i);
 if(m)return {type:'info_query',topic:'details',name:clean(m[1])};
 m=s.match(/^(?:убери|убрать|выключи|отключи|сними с продажи|поставь в стоп|верни|включи|возобнови продажу)\s+(.+)$/);
 if(m){
  const stop=/^(?:убери|убрать|выключи|отключи|сними с продажи|поставь в стоп)/.test(s);
  return {type:'partial_write',command:stop?'стоп лист':'в наличии',name:m[1]};
 }
 m=s.match(/^(?:поставь|измени|установи|сделай)\s+цену\s+(?:на\s+)?(.+?)\s+(?:на\s+)?(\d{1,7})(?:\s+руб(?:лей|ля|ль)?)?$/);
 if(m&&Number(m[2])<=1000000)return {type:'partial_write',command:'цена '+m[2],name:m[1]};
 return {type:'unhandled'};
}
function select(wait,text,catalog){
 if(!wait||!Array.isArray(wait.options)||!wait.options.length)return null;
 const s=norm(text);
 let n=/^(?:номер\s+|вариант\s+|позиция\s+)?([1-8])$/.exec(s);
 const digit=n?Number(n[1]):ordinals[s];
 if(digit&&digit<=wait.options.length)return lookup(catalog,wait.options[digit-1]);
 const list=wait.options.map(x=>lookup(catalog,x)).filter(Boolean);
 const exact=list.filter(x=>norm(x.code)===s||norm(x.name)===s||base.key(x.name)===base.key(s)||(x.spokenName&&(norm(x.spokenName)===s||base.key(x.spokenName)===base.key(s))));
 return exact.length===1?exact[0]:null;
}
function requestSelection(candidates,task,catalog){
 const unique=candidates.slice(0,MAX_OPTIONS).filter(x=>lookup(catalog,ref(x)));
 if(!unique.length)return {type:'reply',state:fresh(),text:'Не нашёл подходящих позиций в меню вашего заведения. Назовите полное название.'};
 const repeated=new Set(unique.map(x=>norm(x.name))).size<unique.length;
 return {type:'clarify',state:{wait:{mode:'choose',options:unique.map(ref),task},last:null},
 text:(repeated?'В меню несколько отдельных карточек с одинаковым названием. Выберите номер нужной карточки; дубли рекомендуется объединить в админке.\n':'Уточните позицию по номеру или полному названию:\n')+optionsText(unique)};
}
function resultFor(item,task,catalog){
 if(!item)return {type:'reply',text:'Позиция была изменена или удалена. Назовите её заново.',state:fresh()};
 const state={wait:null,last:item.kind==='item'?ref(item):null};
 if(task.type==='write')return {type:'proposal',item:{kind:item.kind,id:String(item.id),code:item.code,name:item.name},command:task.command,state};
 if(task.type==='remove_ingredient'||task.type==='remove_ingredient_ref'){
  let ingredient=item;
  if(task.type==='remove_ingredient'){
   if(item.kind!=='item')return {type:'reply',text:'Уточните блюдо.',state:fresh()};
   const found=sha.ingredientOf(catalog,item,task.ingredient);
   if(found.type!=='match'){
    if(found.items?.length)return requestSelection(found.items,{type:'remove_ingredient_ref'},catalog);
    return {type:'reply',text:'Ингредиент не найден в составе выбранного блюда.',state:fresh()};
   }
   ingredient=found.item;
  }
  if(ingredient.kind!=='ingredient')return {type:'reply',text:'Уточните ингредиент.',state:fresh()};
  let parts;try{parts=JSON.parse(ingredient.id)}catch{return {type:'reply',text:'Состав блюда изменился. Повторите команду.',state:fresh()}}
  if(!Array.isArray(parts)||parts[1]!=='ingredient')return {type:'reply',text:'Нельзя подтвердить принадлежность ингредиента.',state:fresh()};
  const dish=catalog.find(x=>x.kind==='item'&&String(x.id)===String(parts[0]));
  if(!dish)return {type:'reply',text:'Блюдо этого ингредиента не найдено.',state:fresh()};
  return {type:'proposal',item:{kind:'item',id:String(dish.id),code:dish.code,name:dish.name},command:'состав '+ingredient.code+' убрать',state:{wait:null,last:ref(dish)}};
 }
 return {type:'info',topic:task.topic,item:ref(item),state};
}
function step(input,catalog,previous={}){
 const raw=clean(input),parsed=intent(raw);
 let state=previous&&typeof previous==='object'?previous:fresh();
 if(parsed.type==='reset')return {...parsed,state:fresh()};
 if(parsed.type==='reply')return {...parsed,state};
 if(parsed.type==='report')return {...parsed,state:{...state,wait:null}};
 // A fresh, explicit action overrides an earlier unanswered clarification.
 // Conversely, a bare name below only selects an object without writing.
 const first=sha.resolve(raw,catalog);
 if(first.type==='proposal'){
  const item=lookup(catalog,first.item);
  if(item)return resultFor(item,{type:'write',command:first.command},catalog);
 }
 // Explicit new natural-language request supersedes any prior clarification.
 if(state.wait?.mode==='choose'&&parsed.type==='unhandled'){
  const item=select(state.wait,raw,catalog);
  if(item)return resultFor(item,state.wait.task,catalog);
  if(/^(?:нет|ни одну|не то|заново|отмена)$/i.test(norm(raw)))return {type:'reply',state:fresh(),text:'Уточнение отменено. Скажите новое название.'};
  return {type:'clarify',state,text:'Не удалось однозначно выбрать позицию. Ответьте её номером, кодом или полным названием:\n'+optionsText(state.wait.options.map(x=>lookup(catalog,x)).filter(Boolean))};
 }
 if(state.wait?.mode==='target'&&parsed.type==='unhandled'){
  const pick=choose(catalog,raw,['item']);
  if(pick.exact)return resultFor(pick.exact,state.wait.task,catalog);
  return requestSelection(pick.items,state.wait.task,catalog);
 }
 if(first.type==='found'){
  const list=first.items||[];
  return {type:'reply',state:{wait:null,last:list.length===1?ref(list[0]):null},
   text:'Нашёл: '+list.map(x=>x.identifier||x.name).join(', ')};
 }
 if(first.type==='unsupported')return {type:'reply',state,text:first.message};
 // Specific ingredient actions must retain their intent during clarification.
 if(first.type==='ambiguous'&&first.followup)
  return requestSelection(first.items||[],first.followup,catalog);
 if(parsed.type==='info_query'){
  const task={type:'info',topic:parsed.topic};
  if(!parsed.name){
   if(state.last){
    const prev=lookup(catalog,state.last);
    if(prev&&prev.kind==='item')return resultFor(prev,task,catalog);
   }
   return {type:'clarify',text:'Какое блюдо вас интересует? Назовите его полное название или код.',state:{wait:{mode:'target',task},last:state.last||null}};
  }
  const pick=choose(catalog,parsed.name,['item']);
  if(pick.exact)return resultFor(pick.exact,task,catalog);
  return requestSelection(pick.items,task,catalog);
 }
 if(parsed.type==='partial_write'){
  const task={type:'write',command:parsed.command};
  const pronoun=/^(?:его|ее|её|это|эту|его же|ту же)$/i.test(norm(parsed.name));
  if(pronoun){
   const prev=lookup(catalog,state.last);
   if(prev&&prev.kind==='item')return resultFor(prev,task,catalog);
   return {type:'clarify',state:{wait:{mode:'target',task},last:null},text:'Какое блюдо нужно изменить? Назовите его полное название или код.'};
  }
  const pick=choose(catalog,parsed.name,['item']);
  if(pick.exact)return resultFor(pick.exact,task,catalog);
  return requestSelection(pick.items,task,catalog);
 }
 const contextual=safeContextAction(raw,state.last);
 if(contextual){
  const prev=lookup(catalog,state.last);
  if(prev&&prev.kind==='item')return resultFor(prev,{type:'write',command:contextual},catalog);
  return {type:'clarify',state:{wait:{mode:'target',task:{type:'write',command:contextual}},last:null},
   text:'Уточните полное название блюда. Какую позицию меняем?'};
 }
 const missing=actionWithIncompleteTarget(raw);
 if(missing){
  const prev=lookup(catalog,state.last);
  if(prev&&prev.kind==='item')return resultFor(prev,{type:'write',command:missing},catalog);
  return {type:'clarify',state:{wait:{mode:'target',task:{type:'write',command:missing}},last:null},
   text:'Какое блюдо нужно изменить? Укажите название или код.'};
 }
 if(parsed.type==='unhandled'){
   const selected=choose(catalog,raw,['item']);
   if(selected.exact)return {type:'reply',state:{wait:null,last:ref(selected.exact)},
     text:'Выбрано блюдо: «'+selected.exact.name+'». Что нужно изменить? Например, скажите «стоп лист», «в наличии» или «поставь 350».'};
 }
 if(first.type==='ambiguous'&&first.items?.length){
  const task=first.type==='ambiguous'&&/^(?:найди|покажи|найти|какой код у)/.test(norm(raw))?{type:'info',topic:'details'}:null;
  if(task)return requestSelection(first.items,task,catalog);
  // Use the original conservative resolver as a fallback when uncertain.
  return {type:'reply',state,text:first.message+'\n'+optionsText(first.items)};
 }
 return {type:'unknown',state,text:'Я пока не понял смысл команды. Уточните блюдо и действие. Можно спросить: «Что в стоп-листе?», «Сколько стоит сырная шаурма?» или «Покажи последние изменения».'};
}
module.exports={step,intent,choose,lookup,fresh};
