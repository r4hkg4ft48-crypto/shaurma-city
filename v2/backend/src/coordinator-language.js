'use strict';

// Conservative Russian-language command resolver. An LLM may suggest a phrase,
// but only an exact code or an unambiguous full-name match may authorize a write.
const normalize=value=>String(value||'').normalize('NFKC').toLowerCase().replace(/ё/g,'е')
  .replace(/[«»"“”'.,!?;:()[\]{}]/g,' ').replace(/\s+/g,' ').trim();
const endings=/(?:иями|ями|ами|ого|ему|ому|ыми|ими|ую|юю|ая|яя|ые|ие|ый|ий|ой|ых|их|ое|ее|ым|им|ем|ом|ам|ям|ах|ях|а|я|у|ю|ы|и)$/;
function stem(word){
  const w=normalize(word);
  return w.length>5?w.replace(endings,''):w;
}
function key(value){return normalize(value).split(' ').filter(Boolean).map(stem).sort().join(' ');}
function safeAction(s){
  const v=normalize(s);
  if(['стоп лист','стоп-лист','стоп','нет в наличии'].includes(v))return 'стоп лист';
  if(['в наличии','вернуть','снять стоп','включить'].includes(v))return 'в наличии';
  const m=v.match(/^цена\s+(\d{1,7})(?:[.,](\d{1,2}))?$/);
  if(m&&Number(m[1])<=1000000)return 'цена '+m[1]+(m[2]?'.'+m[2]:'');
  return '';
}
function parseText(input){
  const s=normalize(input);
  if(!s||s.length>280)return null;
  // Timed changes need an external scheduler; never silently ignore a duration.
  if(/(?:до завтра|до утра|на\s+(?:\d+|один|одну|два|две|три|полтора|несколько)\s*(?:час|минут|дн|сут)|через\s+\d+\s*(?:час|минут))/.test(s))
    return {type:'unsupported',message:'Временные команды пока не активированы. Укажите действие без срока.'};
  let m=s.match(/^([a-zа-я0-9_-]{1,32})\s+(стоп(?:\s+лист)?|стоп-лист|в наличии|цена\s+\d+(?:[.,]\d{1,2})?)$/i);
  if(m)return {type:'direct',code:m[1],command:safeAction(m[2])};
  m=s.match(/^(?:найди|покажи|найти|какой код у|покажи код)\s+(.+)$/);
  if(m)return {type:'search',name:m[1],command:''};
  m=s.match(/^(?:убери|убрать|отключи|выключи|заблокируй|сними с продажи|снять с продажи|останови продажу)\s+(.+?)(?:\s+из продажи)?$/);
  if(m)return {type:'write',name:m[1],command:'стоп лист'};
  m=s.match(/^поставь\s+(.+?)\s+в\s+стоп(?:\s+лист)?$/);
  if(m)return {type:'write',name:m[1],command:'стоп лист'};
  m=s.match(/^(.+?)\s+(?:закончилась|закончился|закончилось|закончились)$/);
  if(m)return {type:'write',name:m[1],command:'стоп лист'};
  m=s.match(/^(?:верни|вернуть|включи|включить|возобнови продажу)\s+(.+?)(?:\s+в продажу)?$/);
  if(m)return {type:'write',name:m[1],command:'в наличии'};
  m=s.match(/^(?:установи|измени|поставь|сделай)\s+цену\s+(?:на\s+)?(.+?)\s+(?:на\s+)?(\d{1,7})(?:\s+руб(?:лей|ля|ль)?)?$/);
  if(m&&Number(m[2])<=1000000)return {type:'write',name:m[1],command:'цена '+m[2]};
  m=s.match(/^(?:сделай|поставь)\s+(.+?)\s+по\s+(\d{1,7})(?:\s+руб(?:лей|ля|ль)?)?$/);
  if(m&&Number(m[2])<=1000000)return {type:'write',name:m[1],command:'цена '+m[2]};
  return null;
}
function resolve(input,items){
  const parsed=parseText(input);
  if(!parsed)return {type:'unknown',message:'Не понял команду. Например: «Убери сырную шаурму» или «Найди капучино».'};
  if(parsed.type==='unsupported')return parsed;
  const catalog=(Array.isArray(items)?items:[]).filter(x=>x&&x.code&&x.name);
  if(parsed.type==='direct'){
    const matches=catalog.filter(x=>normalize(x.code)===parsed.code);
    if(matches.length!==1||!parsed.command)return {type:'unknown',message:'Код не найден в вашем заведении или действие недоступно.'};
    return proposal(matches[0],parsed.command);
  }
  const explicitIngredient=/^(?:ингредиент|ингредиента)\s+/.test(parsed.name);
  const wanted=parsed.name.replace(/^(?:ингредиент|ингредиента)\s+/,'').trim();
  const objects=catalog.filter(x=>explicitIngredient?x.kind==='ingredient':(x.kind==='item'||x.kind==='product'));
  const strict=objects.filter(x=>normalize(x.name)===wanted||key(x.name)===key(wanted));
  if(strict.length===1)return parsed.type==='search'?{type:'found',items:strict}:proposal(strict[0],parsed.command);
  if(strict.length>1)return {type:'ambiguous',message:'Найдено несколько позиций. Уточните по коду:',items:strict.slice(0,8)};
  const words=key(wanted).split(' ').filter(Boolean);
  const candidates=objects.map(x=>{
    const parts=key(x.name).split(' ');
    const overlap=words.filter(w=>parts.includes(w)).length;
    const score=overlap*100-Math.abs(parts.length-words.length)*12;
    return {item:x,score};
  }).filter(x=>x.score>0).sort((a,b)=>b.score-a.score).slice(0,8).map(x=>x.item);
  return {type:'ambiguous',message:'Точного совпадения нет. Выберите позицию по коду или уточните название:',items:candidates};
}
function proposal(item,command){
  return {type:'proposal',item:{kind:item.kind,id:String(item.id),code:item.code,name:item.name},command,
    text:'Подтвердите изменение: «'+item.name+'» ('+item.code+') → '+command+'.'};
}
module.exports={normalize,key,parseText,resolve};
