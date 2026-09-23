'use strict';

const OVERPASS_ENDPOINTS=[
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter'
];

const MOSCOW_BBOX='55.1390,36.8030,56.0220,38.0330';
const FOOD_NAME_RE=/(шаурм|шаверм|донер|кебаб|kebab|doner|shawarma|гирос|gyros|самс|тандыр|выпеч|пекарн|леп[её]ш|чебур|хачапур|пирож|бурек|borek)/i;
const SHAWARMA_RE=/(шаурм|шаверм|shawarma)/i;
const DONER_RE=/(донер|doner|кебаб|kebab|гирос|gyros)/i;
const BAKERY_RE=/(выпеч|пекарн|самс|тандыр|леп[её]ш|чебур|хачапур|пирож|бурек|borek)/i;
const CUISINE_RE=/(shawarma|kebab|doner_kebab|turkish|middle_eastern|arab|lebanese|uzbek|caucasian|georgian)/i;

function clamp(n,a,b){return Math.max(a,Math.min(b,n))}
function normalizeSpace(v){return String(v||'').replace(/\s+/g,' ').trim()}
function lower(v){return normalizeSpace(v).toLowerCase()}
function parseDate(v){
  if(!v)return null;
  const s=String(v).trim();
  const m=s.match(/^(\d{4})(?:[-/](\d{1,2})(?:[-/](\d{1,2}))?)?/);
  if(!m)return null;
  const d=new Date(Date.UTC(Number(m[1]),Math.max(0,Number(m[2]||1)-1),Number(m[3]||1)));
  return Number.isNaN(d.getTime())?null:d;
}
function haversine(lat1,lon1,lat2,lon2){
  const R=6371000,p1=lat1*Math.PI/180,p2=lat2*Math.PI/180,dp=(lat2-lat1)*Math.PI/180,dl=(lon2-lon1)*Math.PI/180;
  const a=Math.sin(dp/2)**2+Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;
  return 2*R*Math.asin(Math.sqrt(a));
}
function isClosed(tags={}){
  const truthy=v=>/^(yes|true|1)$/i.test(String(v||''));
  if(truthy(tags.disused)||truthy(tags.abandoned)||truthy(tags.demolished)||truthy(tags.closed))return true;
  if(Object.keys(tags).some(k=>/^(disused|abandoned|demolished):/.test(k)))return true;
  const state=lower(tags.status||tags.lifecycle||'');
  return /closed|disused|abandoned|demolished|ruin/.test(state);
}
function pointOf(el){
  const lat=Number(el.lat??el.center?.lat),lon=Number(el.lon??el.center?.lon);
  return Number.isFinite(lat)&&Number.isFinite(lon)?{lat,lon}:null;
}
function countUsefulTags(tags={}){
  return ['name','opening_hours','phone','contact:phone','website','contact:website','cuisine','shop','amenity','addr:street','addr:housenumber','check_date','survey:date'].reduce((n,k)=>n+(tags[k]?1:0),0);
}
function categoryOf(tags={}){
  const name=String(tags.name||''),cuisine=String(tags.cuisine||''),shop=String(tags.shop||'');
  if(SHAWARMA_RE.test(name)||/shawarma/i.test(cuisine))return 'shawarma';
  if(DONER_RE.test(name)||/(kebab|doner_kebab)/i.test(cuisine))return 'doner_kebab';
  if(shop==='bakery'||shop==='pastry'||BAKERY_RE.test(name))return 'bakery';
  if(/turkish|middle_eastern|arab|lebanese|uzbek|caucasian|georgian/i.test(cuisine))return 'middle_eastern';
  return 'related_food';
}
function relevanceOf(tags={}){
  const category=categoryOf(tags);
  let s=category==='shawarma'?1:category==='doner_kebab'?.95:category==='bakery'?.78:category==='middle_eastern'?.66:.52;
  if(tags.opening_hours)s+=.04;
  if(tags.takeaway==='yes'||tags.delivery==='yes')s+=.02;
  return clamp(s,0,1);
}
function verificationOf(tags={}){
  let score=.34;
  const reasons=['OpenStreetMap object exists'];
  const name=normalizeSpace(tags.name);
  if(name){score+=.12;reasons.push('name')}
  if(tags.opening_hours){score+=.14;reasons.push('opening hours')}
  if(tags.phone||tags['contact:phone']){score+=.08;reasons.push('phone')}
  if(tags.website||tags['contact:website']){score+=.08;reasons.push('website')}
  if(tags.cuisine||tags.shop){score+=.08;reasons.push('category/cuisine')}
  const checked=parseDate(tags.check_date||tags['check_date:opening_hours']||tags['survey:date']||tags.survey_date);
  if(checked){
    const age=(Date.now()-checked.getTime())/86400000;
    if(age<365){score+=.13;reasons.push('checked < 1 year')}
    else if(age<730){score+=.08;reasons.push('checked < 2 years')}
  }
  if(tags.source&&/survey|local knowledge|website/i.test(String(tags.source))){score+=.04;reasons.push('source tag')}
  score=clamp(score,0,1);
  const status=score>=.78?'source_verified':score>=.58?'source_supported':'needs_review';
  return {score:Number(score.toFixed(2)),status,reasons,checked_at:checked?checked.toISOString():null};
}
function addressOf(tags={}){
  const street=normalizeSpace(tags['addr:street']||tags['addr:place']||'');
  const house=normalizeSpace(tags['addr:housenumber']||'');
  const city=normalizeSpace(tags['addr:city']||'Москва');
  const parts=[];
  if(city)parts.push(city);
  if(street)parts.push(street+(house?' '+house:''));
  else if(house)parts.push(house);
  return parts.join(', ');
}
function descriptionOf(tags={},category){
  const labels={shawarma:'Шаурма',doner_kebab:'Донер / кебаб',bakery:'Выпечка / пекарня',middle_eastern:'Восточная кухня',related_food:'Стрит-фуд'};
  const bits=[labels[category]||'Стрит-фуд'];
  if(tags.cuisine)bits.push('кухня: '+String(tags.cuisine).replace(/;/g,', '));
  if(tags.takeaway==='yes')bits.push('на вынос');
  if(tags.delivery==='yes')bits.push('доставка');
  return bits.join(' · ').slice(0,1400);
}
function appearanceFor(category){
  const base={shape:'pin',size:42,scale:1,opacity:1,pulse:false,label_visible:false};
  if(category==='shawarma')return {...base,icon:'🥙',background:'#f1c96f',border:'#fff7df',text:'#24190d',glow:'#e8bd59',pulse:true};
  if(category==='doner_kebab')return {...base,icon:'🥙',background:'#d99b58',border:'#fff2df',text:'#25180d',glow:'#d79245'};
  if(category==='bakery')return {...base,icon:'🥐',background:'#c9a676',border:'#f7ead8',text:'#2b2117',glow:'#b88e5e'};
  if(category==='middle_eastern')return {...base,icon:'🍽️',background:'#a88d67',border:'#eee5d6',text:'#241f18',glow:'#9b815f'};
  return {...base,icon:'•',background:'#8f9585',border:'#eef0e8',text:'#182018',glow:'#78846f'};
}
function stableVenueId(el){
  const type=String(el.type||'node').slice(0,1).toLowerCase();
  return ('osm_'+type+'_'+String(el.id)).slice(0,64);
}
function safeSourceData(el,tags,point){
  const keep=['name','amenity','shop','cuisine','opening_hours','phone','contact:phone','website','contact:website','takeaway','delivery','check_date','check_date:opening_hours','survey:date','source','addr:city','addr:street','addr:housenumber','brand','operator'];
  const picked={};
  for(const k of keep)if(tags[k]!=null)picked[k]=String(tags[k]).slice(0,800);
  return {
    osm_type:String(el.type||''),
    osm_id:String(el.id||''),
    osm_url:'https://www.openstreetmap.org/'+String(el.type||'node')+'/'+String(el.id||''),
    original_lat:point.lat,
    original_lon:point.lon,
    tags:picked
  };
}
function recordFrom(el){
  const tags=el.tags||{};if(isClosed(tags))return null;
  const point=pointOf(el);if(!point)return null;
  const name=normalizeSpace(tags.name||tags.brand||'');
  if(!name)return null;
  const cat=categoryOf(tags),relevance=relevanceOf(tags);
  const explicit=(tags.shop==='bakery'||tags.shop==='pastry'||FOOD_NAME_RE.test(name)||CUISINE_RE.test(tags.cuisine||''));
  if(!explicit||relevance<.5)return null;
  const verification=verificationOf(tags);
  return {
    source_provider:'openstreetmap',
    source_id:String(el.type||'node')+':'+String(el.id),
    venue_id:stableVenueId(el),
    name,
    address:addressOf(tags),
    description:descriptionOf(tags,cat),
    lat:point.lat,
    lon:point.lon,
    hours:normalizeSpace(tags.opening_hours||''),
    category:cat,
    relevance_score:Number(relevance.toFixed(2)),
    verification_status:verification.status,
    verification_score:verification.score,
    verification_details:{reasons:verification.reasons,osm_checked_at:verification.checked_at},
    source_data:safeSourceData(el,tags,point),
    marker_style:appearanceFor(cat)
  };
}
function dedupe(records){
  const sorted=records.slice().sort((a,b)=>b.verification_score-a.verification_score||b.relevance_score-a.relevance_score);
  const out=[];
  for(const r of sorted){
    const n=lower(r.name);
    const dup=out.find(x=>{
      const d=haversine(r.lat,r.lon,x.lat,x.lon);
      if(d>18)return false;
      const xn=lower(x.name);
      return n===xn||n.includes(xn)||xn.includes(n);
    });
    if(!dup)out.push(r);
  }
  return out;
}
async function fetchOverpass(query,timeoutMs=175000){
  let last;
  for(const endpoint of OVERPASS_ENDPOINTS){
    const ac=new AbortController(),timer=setTimeout(()=>ac.abort(),timeoutMs);
    try{
      const r=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8','User-Agent':'Shaurmeg-Moscow-Discovery/1.0'},body:'data='+encodeURIComponent(query),signal:ac.signal});
      if(!r.ok)throw new Error('overpass_'+r.status);
      const j=await r.json();
      if(!Array.isArray(j.elements))throw new Error('bad_overpass_response');
      return j.elements;
    }catch(e){last=e}finally{clearTimeout(timer)}
  }
  throw last||new Error('overpass_unavailable');
}
function queryFor(area=true){
  const region=area
    ? 'area["boundary"="administrative"]["name"="Москва"]["admin_level"="4"]->.m;'
    : '';
  const scope=area?'(area.m)':'('+MOSCOW_BBOX+')';
  return '[out:json][timeout:160];'+region+'('+
    'nwr'+scope+'["shop"~"^(bakery|pastry)$"];'+
    'nwr'+scope+'["amenity"~"^(fast_food|cafe|restaurant|food_court)$"]["cuisine"~"shawarma|kebab|doner_kebab|turkish|middle_eastern|arab|lebanese|uzbek|caucasian|georgian",i];'+
    'nwr'+scope+'["amenity"~"^(fast_food|cafe|restaurant|food_court)$"]["name"~"шаурм|шаверм|донер|кебаб|kebab|doner|shawarma|гирос|gyros|самс|тандыр|выпеч|пекарн|леп[её]ш|чебур|хачапур|пирож|бурек|borek",i];'+
    'nwr'+scope+'["shop"~"^(convenience|deli)$"]["name"~"шаурм|шаверм|донер|кебаб|kebab|doner|shawarma|самс|тандыр|выпеч|пекарн|леп[её]ш|чебур|хачапур",i];'+
  ');out center tags;';
}
async function discoverMoscowVenues(){
  let elements=[],scope='moscow_admin_area';
  try{
    elements=await fetchOverpass(queryFor(true));
    if(elements.length<40)throw new Error('area_query_too_small');
  }catch(e){
    scope='moscow_bbox_fallback';
    elements=await fetchOverpass(queryFor(false));
  }
  const raw=elements.map(recordFrom).filter(Boolean);
  const records=dedupe(raw);
  const counts={};
  for(const r of records)counts[r.category]=(counts[r.category]||0)+1;
  return {provider:'openstreetmap',scope,queried_at:new Date().toISOString(),raw_count:raw.length,count:records.length,counts,records};
}

module.exports={discoverMoscowVenues,appearanceFor};
