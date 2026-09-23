'use strict';

const sharp=require('sharp');

const OVERPASS_ENDPOINTS=[
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass-api.de/api/interpreter'
];
const KARTAVIEW_ENDPOINT='https://api.openstreetcam.org/2.0/photo/';

const NAMED_COLORS={
  white:'#dedbd4',grey:'#c9cbca',gray:'#c9cbca',silver:'#b7bbbd',beige:'#d7cbb8',
  brown:'#8a6a56',red:'#a9685a',yellow:'#d8bd7b',cream:'#ded2bc',black:'#343537',
  brick:'#a8745d',orange:'#c98b5d',blue:'#788d9e',green:'#7e8d78'
};
const DEFAULT_PALETTE={
  wall:'#d3d1cc',accent:'#8a7463',windows:'#29343d',storefront:'#24282b',roof:'#b7b4ae'
};
const LEPYOSHKA_PALETTE={
  wall:'#d5d5d1',accent:'#735845',windows:'#28343e',storefront:'#202429',roof:'#b9b9b4'
};

function clamp(n,a,b){return Math.max(a,Math.min(b,n))}
function hex2(n){return clamp(Math.round(n),0,255).toString(16).padStart(2,'0')}
function rgbHex(r,g,b){return '#'+hex2(r)+hex2(g)+hex2(b)}
function hexRgb(v){
  const s=String(v||'').trim();
  const m=s.match(/^#([0-9a-f]{6})$/i);if(!m)return null;
  return [parseInt(m[1].slice(0,2),16),parseInt(m[1].slice(2,4),16),parseInt(m[1].slice(4,6),16)];
}
function normalizeColor(v){
  if(!v)return null;const s=String(v).trim().toLowerCase();
  if(/^#[0-9a-f]{6}$/i.test(s))return s;
  if(/^#[0-9a-f]{3}$/i.test(s))return '#'+s.slice(1).split('').map(x=>x+x).join('');
  return NAMED_COLORS[s]||null;
}
function hsl(r,g,b){
  r/=255;g/=255;b/=255;const mx=Math.max(r,g,b),mn=Math.min(r,g,b),d=mx-mn;
  let h=0,s=0,l=(mx+mn)/2;
  if(d){s=l>.5?d/(2-mx-mn):d/(mx+mn);if(mx===r)h=((g-b)/d+(g<b?6:0))/6;else if(mx===g)h=((b-r)/d+2)/6;else h=((r-g)/d+4)/6}
  return {h:h*360,s,l};
}
function luminance(r,g,b){return .2126*r+.7152*g+.0722*b}
function colorDistance(a,b){const A=hexRgb(a),B=hexRgb(b);if(!A||!B)return 0;return Math.hypot(A[0]-B[0],A[1]-B[1],A[2]-B[2])}
function mixColors(items,fallback){
  const valid=items.map(x=>({rgb:hexRgb(x.color),w:Number(x.weight)||1})).filter(x=>x.rgb);
  if(!valid.length)return fallback;
  let r=0,g=0,b=0,w=0;for(const x of valid){r+=x.rgb[0]*x.w;g+=x.rgb[1]*x.w;b+=x.rgb[2]*x.w;w+=x.w}
  return rgbHex(r/w,g/w,b/w);
}
function uniqColors(colors,limit=7){
  const out=[];
  for(const c of colors){const n=normalizeColor(c);if(!n)continue;if(out.every(x=>colorDistance(x,n)>34))out.push(n);if(out.length>=limit)break}
  return out;
}
function dataUrlBuffer(v){
  const s=String(v||'');const m=s.match(/^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/s);if(!m)return null;
  try{return Buffer.from(m[1],'base64')}catch{return null}
}

async function extractPaletteFromBuffer(buf){
  const {data,info}=await sharp(buf,{failOn:'none'}).rotate().resize({width:72,height:72,fit:'inside',withoutEnlargement:true}).removeAlpha().raw().toBuffer({resolveWithObject:true});
  const bins=new Map();
  for(let i=0;i<data.length;i+=info.channels){
    const r=data[i],g=data[i+1],b=data[i+2],lum=luminance(r,g,b),hs=hsl(r,g,b);
    if(lum<18||lum>247)continue;
    if(hs.h>185&&hs.h<245&&hs.s>.28&&hs.l>.43)continue;
    if(hs.h>72&&hs.h<165&&hs.s>.30&&hs.l>.18)continue;
    const qr=Math.round(r/24)*24,qg=Math.round(g/24)*24,qb=Math.round(b/24)*24,key=qr+','+qg+','+qb;
    const rec=bins.get(key)||{n:0,r:0,g:0,b:0};rec.n++;rec.r+=r;rec.g+=g;rec.b+=b;bins.set(key,rec);
  }
  let colors=[...bins.values()].map(x=>({n:x.n,r:x.r/x.n,g:x.g/x.n,b:x.b/x.n})).sort((a,b)=>b.n-a.n).slice(0,24);
  if(!colors.length)return null;
  const enriched=colors.map(x=>({...x,lum:luminance(x.r,x.g,x.b),hs:hsl(x.r,x.g,x.b),hex:rgbHex(x.r,x.g,x.b)}));
  const score=(x,target,satPenalty=.6)=>x.n*(1-Math.min(1,Math.abs(x.lum-target)/170))*(1-Math.min(.72,x.hs.s*satPenalty));
  const wall=enriched.filter(x=>x.lum>105&&x.lum<232).sort((a,b)=>score(b,178)-score(a,178))[0]||enriched[0];
  const windows=enriched.filter(x=>x.lum>28&&x.lum<122).sort((a,b)=>b.n-a.n)[0]||enriched.slice().sort((a,b)=>a.lum-b.lum)[0];
  const accent=enriched.filter(x=>x.lum>55&&x.lum<205&&colorDistance(x.hex,wall.hex)>48).sort((a,b)=>(b.n*(.55+b.hs.s))-(a.n*(.55+a.hs.s)))[0]||enriched[Math.min(1,enriched.length-1)];
  const roof=enriched.filter(x=>x.lum>75&&x.lum<185&&x.hs.s<.45).sort((a,b)=>b.n-a.n)[0]||accent;
  const storefront=enriched.filter(x=>x.lum>24&&x.lum<105).sort((a,b)=>b.n-a.n)[0]||windows;
  return {
    wall:wall.hex,accent:accent.hex,windows:windows.hex,storefront:storefront.hex,roof:roof.hex,
    swatches:uniqColors(enriched.map(x=>x.hex),7)
  };
}
function mergePalettes(weighted,fallback=DEFAULT_PALETTE){
  const roles=['wall','accent','windows','storefront','roof'],out={};
  for(const role of roles)out[role]=mixColors(weighted.filter(x=>x.palette?.[role]).map(x=>({color:x.palette[role],weight:x.weight})),fallback[role]);
  out.swatches=uniqColors(weighted.flatMap(x=>x.palette?.swatches||[]),7);
  return out;
}
async function fetchJson(url,timeout=5500){
  const ac=new AbortController(),timer=setTimeout(()=>ac.abort(),timeout);
  try{const r=await fetch(url,{headers:{'User-Agent':'Shaurmeg-RealCity/2.0'},signal:ac.signal});if(!r.ok)throw new Error('http_'+r.status);return await r.json()}finally{clearTimeout(timer)}
}
async function fetchBuffer(url,timeout=5500){
  const ac=new AbortController(),timer=setTimeout(()=>ac.abort(),timeout);
  try{const r=await fetch(url,{headers:{'User-Agent':'Shaurmeg-RealCity/2.0'},signal:ac.signal});if(!r.ok)throw new Error('http_'+r.status);const ab=await r.arrayBuffer();if(ab.byteLength>5_000_000)throw new Error('image_too_large');return Buffer.from(ab)}finally{clearTimeout(timer)}
}
function haversine(lat1,lon1,lat2,lon2){
  const R=6371000,p1=lat1*Math.PI/180,p2=lat2*Math.PI/180,dp=(lat2-lat1)*Math.PI/180,dl=(lon2-lon1)*Math.PI/180;
  const a=Math.sin(dp/2)**2+Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;return 2*R*Math.asin(Math.sqrt(a));
}
function bearing(lat1,lon1,lat2,lon2){
  const p1=lat1*Math.PI/180,p2=lat2*Math.PI/180,dl=(lon2-lon1)*Math.PI/180;
  return (Math.atan2(Math.sin(dl)*Math.cos(p2),Math.cos(p1)*Math.sin(p2)-Math.sin(p1)*Math.cos(p2)*Math.cos(dl))*180/Math.PI+360)%360;
}
function angleDiff(a,b){const d=Math.abs(((a-b+540)%360)-180);return d}
async function analyzeKartaView(marker){
  const url=KARTAVIEW_ENDPOINT+'?lat='+encodeURIComponent(marker.lat)+'&lng='+encodeURIComponent(marker.lon)+'&zoomLevel=18&join=sequence&orderBy=id&orderDirection=desc';
  const j=await fetchJson(url,5000),rows=Array.isArray(j?.result?.data)?j.result.data:[];
  const scored=rows.map(x=>{
    const lat=Number(x.lat),lon=Number(x.lng);if(!Number.isFinite(lat)||!Number.isFinite(lon))return null;
    const d=haversine(marker.lat,marker.lon,lat,lon),target=bearing(lat,lon,marker.lat,marker.lon),head=Number(x.heading);
    const sphere=String(x.projection||'').toUpperCase()==='SPHERE',diff=Number.isFinite(head)?angleDiff(head,target):180;
    const score=d+(sphere?0:diff*.42);
    return {row:x,diff,d,score};
  }).filter(Boolean).filter(x=>x.d<220).sort((a,b)=>a.score-b.score);
  const picked=[],seq=new Set();
  for(const x of scored){
    const sid=String(x.row.sequence?.id||x.row.sequenceId||'');
    if(sid&&seq.has(sid)&&picked.length<2)continue;
    if(sid)seq.add(sid);picked.push(x);if(picked.length>=3)break;
  }
  const palettes=[],meta=[];
  for(const x of picked){
    const u=x.row.imageThUrl||x.row.imageLthUrl||x.row.fileurlTh||x.row.fileurlLTh;
    if(!u)continue;
    try{
      const p=await extractPaletteFromBuffer(await fetchBuffer(u,5000));
      if(p)palettes.push({palette:p,weight:1.5});
      meta.push({id:String(x.row.id||''),distance_m:Math.round(x.d),heading:Number(x.row.heading)||null,projection:x.row.projection||'',shot_date:x.row.shotDate||'',sequence_id:String(x.row.sequence?.id||'')});
    }catch{}
  }
  return {palettes,meta};
}
function numberTag(tags,...keys){for(const k of keys){const n=parseFloat(String(tags?.[k]??'').replace(',','.'));if(Number.isFinite(n))return n}return null}
async function analyzeOsm(marker){
  const q='[out:json][timeout:10];way["building"](around:190,'+marker.lat+','+marker.lon+');out tags center;';
  let elements=[];
  for(const endpoint of OVERPASS_ENDPOINTS){
    const ac=new AbortController(),timer=setTimeout(()=>ac.abort(),6500);
    try{
      const r=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8','User-Agent':'Shaurmeg-RealCity/2.0'},body:'data='+encodeURIComponent(q),signal:ac.signal});
      if(!r.ok)throw new Error('overpass_'+r.status);const j=await r.json();elements=Array.isArray(j.elements)?j.elements:[];if(elements.length)break;
    }catch{}finally{clearTimeout(timer)}
  }
  const colors=[],roofColors=[],materials={},levels=[];
  for(const e of elements){
    const t=e.tags||{},c=normalizeColor(t['building:colour']||t['building:color']||t.colour),r=normalizeColor(t['roof:colour']||t['roof:color']);
    if(c)colors.push(c);if(r)roofColors.push(r);
    const mat=String(t['building:material']||t.material||'').toLowerCase();if(mat)materials[mat]=(materials[mat]||0)+1;
    const lv=numberTag(t,'building:levels');if(lv)levels.push(lv);
  }
  const dominantMaterial=Object.entries(materials).sort((a,b)=>b[1]-a[1])[0]?.[0]||'';
  const avgLevels=levels.length?levels.reduce((a,b)=>a+b,0)/levels.length:null;
  const palette={...DEFAULT_PALETTE};
  if(colors.length)palette.wall=mixColors(colors.map(color=>({color,weight:1})),palette.wall);
  if(roofColors.length)palette.roof=mixColors(roofColors.map(color=>({color,weight:1})),palette.roof);
  if(dominantMaterial.includes('brick')){palette.wall=colors.length?palette.wall:'#b58f78';palette.accent='#765747';palette.roof=roofColors.length?palette.roof:'#9d8879'}
  if(dominantMaterial.includes('glass')){palette.wall='#8997a3';palette.windows='#1f2c35';palette.accent='#667887'}
  palette.swatches=uniqColors([...colors,...roofColors,palette.wall,palette.accent,palette.windows],7);
  return {palette,elements:elements.length,dominantMaterial,avgLevels,colors:uniqColors([...colors,...roofColors],7)};
}
function classifyStyle(osm,palette){
  const m=String(osm?.dominantMaterial||'');
  if(m.includes('glass'))return 'glass_modern';
  if(m.includes('brick'))return (osm?.avgLevels||0)>7?'brick_highrise':'brick_midrise';
  if((osm?.avgLevels||0)>=10)return 'panel_balconies';
  if((osm?.avgLevels||0)>=5)return 'mixed_residential';
  const w=hexRgb(palette.wall),s=w?hsl(...w).s:0;
  return s>.32?'mixed_storefront':'panel_simple';
}
async function analyzeUserReferences(marker){
  // Only photos explicitly marked as facade/environment references influence RealCity.
  // Menu/hero/gallery photos often contain food and would corrupt facade colors.
  const refs=(Array.isArray(marker.realcity_reference_images)?marker.realcity_reference_images:[]).filter(Boolean).slice(0,4);
  const palettes=[];
  for(const ref of refs){
    const buf=dataUrlBuffer(ref);if(!buf)continue;
    try{const p=await extractPaletteFromBuffer(buf);if(p)palettes.push({palette:p,weight:3.2})}catch{}
  }
  return palettes;
}
function lepyoshkaBias(palette,venueId){
  if(String(venueId||'').toLowerCase()!=='lepyoshka')return palette;
  // The first venue has verified facade references from the project.
  // Keep that known facade palette stable until dedicated new references are uploaded.
  return {...LEPYOSHKA_PALETTE,swatches:[LEPYOSHKA_PALETTE.wall,LEPYOSHKA_PALETTE.accent,LEPYOSHKA_PALETTE.windows,LEPYOSHKA_PALETTE.roof]};
}
async function analyzeRealCityProfile(marker){
  const safe={...marker,lat:Number(marker.lat),lon:Number(marker.lon)};
  const [userRes,streetRes,osmRes]=await Promise.allSettled([analyzeUserReferences(safe),analyzeKartaView(safe),analyzeOsm(safe)]);
  const user=userRes.status==='fulfilled'?userRes.value:[];
  const street=streetRes.status==='fulfilled'?streetRes.value:{palettes:[],meta:[]};
  const osm=osmRes.status==='fulfilled'?osmRes.value:{palette:{...DEFAULT_PALETTE},elements:0,dominantMaterial:'',avgLevels:null,colors:[]};
  const weighted=[];
  user.forEach(x=>weighted.push(x));
  street.palettes.forEach(x=>weighted.push({palette:x.palette,weight:2.1}));
  if(osm.elements)weighted.push({palette:osm.palette,weight:street.palettes.length||user.length?.65:1.25});
  let palette=mergePalettes(weighted.length?weighted:[{palette:osm.palette||DEFAULT_PALETTE,weight:1}],DEFAULT_PALETTE);
  palette=lepyoshkaBias(palette,safe.venue_id);
  const isLepe=String(safe.venue_id||'').toLowerCase()==='lepyoshka';
  const quality=user.length?'photo':isLepe?'photo':street.palettes.length?'street':osm.elements?'osm':'heuristic';
  const confidence=quality==='photo'?.92:quality==='street'?.80:quality==='osm'?.58:.36;
  const neighborhood=uniqColors([...(palette.swatches||[]),...(osm.colors||[]),palette.wall,palette.accent,palette.roof],8);
  return {
    version:2,
    generated_at:new Date().toISOString(),
    quality,
    confidence,
    palette:{wall:palette.wall,accent:palette.accent,windows:palette.windows,storefront:palette.storefront,roof:palette.roof},
    neighborhood_palette:neighborhood,
    building_style:classifyStyle(osm,palette),
    environment:{building_count:osm.elements||0,dominant_material:osm.dominantMaterial||null,average_levels:osm.avgLevels?Number(osm.avgLevels.toFixed(1)):null},
    camera:{zoom:18.15,pitch:63,bearing:-18},
    sources:{
      user_reference_images:user.length,
      verified_project_reference:isLepe&&!user.length,
      kartaview:{photo_count:street.meta.length,photos:street.meta},
      openstreetmap:{building_count:osm.elements||0}
    }
  };
}

module.exports={analyzeRealCityProfile,extractPaletteFromBuffer};
