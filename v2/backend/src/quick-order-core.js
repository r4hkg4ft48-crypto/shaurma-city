'use strict';
// Intent matching is intentionally conservative: only explicitly saved favorites
// can be ordered, and an ambiguous match must be disambiguated by the customer.
const STOP=new Set(['мне','пожалуйста','одну','один','одно','две','два','три','четыре','пять','штук','штуки','штуку','шт','с','со','и','из','в','во','на','у','мою','мой','мое','моё','моих','любимую','любимый','любимых','избранного','избранных','блюдо','еду','заказ']);
const NUMBERS={одну:1,один:1,одно:1,две:2,два:2,три:3,четыре:4,пять:5};
function stem(w){
  let s=String(w||'').toLowerCase().replace(/ё/g,'е');
  if(s.length>3)s=s.replace(/(остями|ениями|иями|ами|ями|ого|ему|ыми|ими|ость|овая|овое|овые|ение|ания|ание|ской|ская|ское|ские|ная|ное|ные|ный|ной|ную|ным|ных|ний|ние|ним|нем|шей|шего|шее|шая|шие|ский|ском|овых|ими|ем|ом|ой|ей|ам|ям|ах|ях|ов|ев|ия|ию|ие|ый|ий|ая|яя|ое|ее|ые|а|я|у|ю|ы|и|е|о)$/u,'');
  if(s==='сырн')return 'сыр';
  if(s==='шаверм')return 'шаурм';
  return s;
}
function tokens(text){
  return [...new Set(String(text||'').toLowerCase().replace(/ё/g,'е').match(/[а-яa-z]+/giu)?.filter(w=>!STOP.has(w)).map(stem).filter(w=>w.length>1)||[])];
}
function parseRequest(text){
  const source=String(text||'').trim().slice(0,500);
  const match=source.match(/^(?:закажи|заказать|оформи|оформить|хочу\s+заказать|повтори\s+заказ)(?:\s+|$)/iu);
  if(!match)return null;
  let tail=source.slice(match[0].length).trim();
  let quantity=1;
  const digits=tail.match(/^(?:мне\s+)?(\d{1,2})(?:\s+|$)/iu);
  const num=tail.match(/^(?:мне\s+)?(одну|один|одно|две|два|три|четыре|пять)(?:\s+|$)/iu);
  if(digits){quantity=Number(digits[1]);tail=tail.slice(digits[0].length)}
  else if(num){quantity=NUMBERS[num[1].toLowerCase()];tail=tail.slice(num[0].length)}
  if(!Number.isInteger(quantity)||quantity<1||quantity>10)return {error:'invalid_quantity'};
  const venueSplit=tail.match(/^(.*?)\s+(?:в|во|из|у)\s+([а-яёa-z0-9 -]+)$/iu);
  const dish=venueSplit?venueSplit[1]:tail;
  const venueTerms=venueSplit?tokens(venueSplit[2]):[];
  const terms=tokens(dish);
  if(!terms.length)return {error:'empty_query'};
  return {quantity,terms,venueTerms,text:tail};
}
function matchFavorites(request,candidates){
  if(!request||!request.terms||!Array.isArray(candidates))return [];
  const matches=[];
  for(const c of candidates){
    if(request.venueTerms?.length&&!request.venueTerms.every(v=>tokens(c.venue_name).includes(v)))continue;
    const nameTokens=tokens(c.name);
    const allTokens=tokens([c.name,c.detail,c.venue_name].filter(Boolean).join(' '));
    if(!request.terms.every(q=>allTokens.some(t=>t===q||t.startsWith(q)&&q.length>=5)))continue;
    const exactName=request.terms.every(q=>nameTokens.includes(q));
    const nameHits=request.terms.filter(q=>nameTokens.includes(q)).length;
    const score=(exactName?100:0)+nameHits*10+request.terms.length*3;
    matches.push({...c,match_score:score});
  }
  matches.sort((a,b)=>b.match_score-a.match_score||String(a.name).localeCompare(String(b.name),'ru'));
  // Do not silently pick a venue, variant or product when there is a choice.
  return matches;
}
module.exports={stem,tokens,parseRequest,matchFavorites};
