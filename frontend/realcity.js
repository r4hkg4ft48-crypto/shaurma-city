(function(){
'use strict';

const API='https://shaurma-city-api.onrender.com';
const STYLE='https://tiles.openfreemap.org/styles/liberty';
const BUILD='73';
const GOLD='#d7b46a';
const DEFAULT_PROFILE={
  version:2,quality:'heuristic',confidence:.36,
  palette:{wall:'#d3d1cc',accent:'#8a7463',windows:'#29343d',storefront:'#24282b',roof:'#b7b4ae'},
  neighborhood_palette:['#d3d1cc','#c7c4bd','#bbb8b1','#a99e92','#8a7463'],
  building_style:'panel_simple',
  camera:{zoom:18.15,pitch:63,bearing:-18}
};

let map=null,markers=[],markerEls=new Map(),selected=null,sceneToken=0;
let builtin3d=[],buildingLayers=[],buildingSourceId='openmaptiles',buildingSourceLayer='building';
let directVenueId='',profileCache=new Map();

const $=(s,r=document)=>r.querySelector(s),$$=(s,r=document)=>Array.from(r.querySelectorAll(s));

function normalizeVenue(v){return String(v||'').trim().toLowerCase().replace(/^venue_/,'')}
function esc(s){return String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'}[c]))}
function clamp(n,a,b){return Math.max(a,Math.min(b,n))}
function hexRgb(hex){const m=String(hex||'').match(/^#([0-9a-f]{6})$/i);return m?[parseInt(m[1].slice(0,2),16),parseInt(m[1].slice(2,4),16),parseInt(m[1].slice(4,6),16)]:null}
function rgbHex(r,g,b){const x=n=>clamp(Math.round(n),0,255).toString(16).padStart(2,'0');return '#'+x(r)+x(g)+x(b)}
function shade(hex,delta){const c=hexRgb(hex);if(!c)return hex;return rgbHex(c[0]+delta,c[1]+delta,c[2]+delta)}
function safeProfile(p){
  const x=p&&typeof p==='object'?p:{},pal=x.palette&&typeof x.palette==='object'?x.palette:{};
  return {
    ...DEFAULT_PROFILE,...x,
    palette:{...DEFAULT_PROFILE.palette,...pal},
    neighborhood_palette:Array.isArray(x.neighborhood_palette)&&x.neighborhood_palette.length?x.neighborhood_palette:DEFAULT_PROFILE.neighborhood_palette,
    camera:{...DEFAULT_PROFILE.camera,...(x.camera||{})}
  };
}
function qualityLabel(q){return ({photo:'PHOTO',street:'STREET',osm:'OSM',heuristic:'AUTO'})[q]||'AUTO'}

function ensureDeps(){
  if(!document.querySelector('link[data-realcity-maplibre]')){const l=document.createElement('link');l.rel='stylesheet';l.href='https://unpkg.com/maplibre-gl@5/dist/maplibre-gl.css';l.dataset.realcityMaplibre='1';document.head.appendChild(l)}
  if(window.maplibregl)return Promise.resolve();
  return new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='https://unpkg.com/maplibre-gl@5/dist/maplibre-gl.js';s.async=true;s.onload=resolve;s.onerror=reject;document.head.appendChild(s)});
}

function inject(){
  if($('#realCityScreen'))return;
  document.body.insertAdjacentHTML('beforeend',`
  <button id="realCityOpen" type="button" aria-label="Открыть карту">Карта</button>
  <section class="realCityScreen" id="realCityScreen" aria-hidden="true">
    <div class="realCityMap" id="realCityMap"></div>
    <div class="realCityTop">
      <button class="rcClose" id="rcClose" type="button" aria-label="Закрыть карту">×</button>
      <div class="rcSearchCard">
        <div class="rcBrand"><b>шаурмег</b><small>REAL CITY · ${BUILD}</small></div>
        <div class="rcSearchRow"><input id="rcSearch" inputmode="search" placeholder="Метро, улица или заведение" autocomplete="off"><button id="rcFind" type="button">Найти</button></div>
        <div class="rcNearby"><button id="rcNearby" type="button">◎ Вы рядом</button></div>
        <div class="rcResults" id="rcResults"></div>
      </div>
    </div>
    <div class="rcStatus" id="rcStatus">Анализируем район…</div>
    <div class="rcVenueCard" id="rcVenueCard">
      <div class="rcVenueHead"><div class="rcPinIcon">🥙</div><div><b id="rcVenueName"></b><small id="rcVenueAddress"></small></div><span class="rcLive" id="rcLive">REAL CITY</span></div>
      <div class="rcVenueActions"><button class="rcMenu" id="rcMenu" type="button">Открыть меню</button><button class="rcRepaint" id="rcRepaint" type="button">↻ Ещё раз</button></div>
    </div>
  </section>`);
  $('#realCityOpen').onclick=open;
  $('#rcClose').onclick=close;
  $('#rcFind').onclick=()=>search(true);
  $('#rcSearch').addEventListener('input',()=>search(false));
  $('#rcSearch').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();search(true)}});
  $('#rcNearby').onclick=locate;
  $('#rcRepaint').onclick=()=>selected&&focusVenue(selected,true);
  $('#rcMenu').onclick=()=>{if(!selected)return;const u=new URL(location.href);u.searchParams.set('venue',selected.venue_id||'lepyoshka');u.searchParams.set('view','menu');u.searchParams.set('b',BUILD);location.href=u.toString()};
}

function status(msg,on=true){const el=$('#rcStatus');if(!el)return;el.textContent=msg;el.classList.toggle('show',!!on)}
function open(){const s=$('#realCityScreen');s.classList.add('open');s.setAttribute('aria-hidden','false');document.body.style.overflow='hidden';ensureMap().then(()=>map.resize()).catch(()=>status('Карта временно недоступна'))}
function close(){const s=$('#realCityScreen');s.classList.remove('open');s.setAttribute('aria-hidden','true');document.body.style.overflow='';$('#rcResults').classList.remove('show')}

async function ensureMap(){
  if(map)return map;
  await ensureDeps();
  map=new maplibregl.Map({container:'realCityMap',style:STYLE,center:[37.62,55.75],zoom:10.2,pitch:48,bearing:-14,attributionControl:true,maxPitch:80});
  map.addControl(new maplibregl.NavigationControl({showCompass:true,showZoom:true}),'top-right');
  await new Promise(resolve=>map.once('load',resolve));

  const layers=map.getStyle().layers||[];
  const buildingTemplate=layers.find(l=>l['source-layer']==='building'&&l.source);
  if(buildingTemplate){buildingSourceId=buildingTemplate.source;buildingSourceLayer=buildingTemplate['source-layer']||'building'}
  builtin3d=layers.filter(l=>l.type==='fill-extrusion'&&l['source-layer']==='building').map(l=>l.id);
  buildingLayers=layers.filter(l=>['fill','fill-extrusion'].includes(l.type)&&l['source-layer']==='building').map(l=>l.id);
  for(const id of builtin3d){try{map.setPaintProperty(id,'fill-extrusion-color',GOLD);map.setPaintProperty(id,'fill-extrusion-opacity',.88)}catch{}}
  try{map.setLight({anchor:'viewport',color:'#fff0c9',intensity:.42,position:[1.15,165,38]})}catch{}

  installLayers(layers);
  await loadMarkers();

  if(directVenueId){
    const m=markers.find(x=>normalizeVenue(x.venue_id)===directVenueId);
    if(m)setTimeout(()=>focusVenue(m),180);else fitMarkers();
  }else fitMarkers();
  return map;
}

function addLayerSafe(layer,before){
  try{map.addLayer(layer,before)}catch{try{map.addLayer(layer)}catch{}}
}
function installLayers(styleLayers){
  if(map.getLayer('rc-world-real'))return;
  const before=styleLayers.find(l=>l.type==='symbol')?.id;
  addLayerSafe({
    id:'rc-world-real',type:'fill-extrusion',source:buildingSourceId,'source-layer':buildingSourceLayer,minzoom:14,
    filter:['!=',['get','hide_3d'],true],
    paint:{
      'fill-extrusion-color':'#d3d1cc',
      'fill-extrusion-height':['coalesce',['get','render_height'],['*',['coalesce',['get','levels'],3],3.05],9],
      'fill-extrusion-base':['coalesce',['get','render_min_height'],0],
      'fill-extrusion-opacity':0,
      'fill-extrusion-vertical-gradient':true
    }
  },before);
  addLayerSafe({
    id:'rc-world-roof',type:'fill-extrusion',source:buildingSourceId,'source-layer':buildingSourceLayer,minzoom:14,
    filter:['!=',['get','hide_3d'],true],
    paint:{
      'fill-extrusion-color':'#b7b4ae',
      'fill-extrusion-height':['coalesce',['get','render_height'],['*',['coalesce',['get','levels'],3],3.05],9],
      'fill-extrusion-base':['-', ['coalesce',['get','render_height'],['*',['coalesce',['get','levels'],3],3.05],9], .18],
      'fill-extrusion-opacity':0,
      'fill-extrusion-vertical-gradient':false
    }
  },before);

  const empty={type:'FeatureCollection',features:[]};
  map.addSource('rc-hero',{type:'geojson',data:empty});
  map.addSource('rc-details',{type:'geojson',data:empty});
  addLayerSafe({id:'rc-hero-layer',type:'fill-extrusion',source:'rc-hero',paint:{'fill-extrusion-color':['get','color'],'fill-extrusion-height':['get','height'],'fill-extrusion-base':0,'fill-extrusion-opacity':0,'fill-extrusion-vertical-gradient':true}},before);
  addLayerSafe({id:'rc-details-layer',type:'fill-extrusion',source:'rc-details',paint:{'fill-extrusion-color':['get','color'],'fill-extrusion-height':['get','height'],'fill-extrusion-base':['get','base'],'fill-extrusion-opacity':0,'fill-extrusion-vertical-gradient':false}},before);
}

async function loadMarkers(){
  try{const r=await fetch(API+'/api/shaurmeg/markers?lite=1',{cache:'no-store'});if(!r.ok)throw new Error();markers=await r.json();if(!Array.isArray(markers))markers=[]}catch{markers=[]}
  markerEls.forEach(v=>v.remove());markerEls.clear();
  for(const m of markers){
    if(!Number.isFinite(Number(m.lon))||!Number.isFinite(Number(m.lat)))continue;
    const el=document.createElement('button');el.type='button';el.className='rcMarker';el.textContent='🥙';el.title=m.name||'Шаурма';
    el.onclick=e=>{e.stopPropagation();focusVenue(m)};
    const mk=new maplibregl.Marker({element:el,anchor:'bottom'}).setLngLat([Number(m.lon),Number(m.lat)]).addTo(map);markerEls.set(String(m.id),mk);
  }
}

function fitMarkers(){
  if(!map||!markers.length)return;
  const valid=markers.filter(m=>Number.isFinite(Number(m.lon))&&Number.isFinite(Number(m.lat)));if(!valid.length)return;
  if(valid.length===1){map.jumpTo({center:[Number(valid[0].lon),Number(valid[0].lat)],zoom:15.8,pitch:50});return}
  const b=new maplibregl.LngLatBounds();valid.forEach(m=>b.extend([Number(m.lon),Number(m.lat)]));
  map.fitBounds(b,{padding:{top:150,bottom:120,left:35,right:35},maxZoom:15.3,duration:0});
}
function search(commit){
  const q=$('#rcSearch').value.trim().toLowerCase(),box=$('#rcResults');
  if(!q){box.classList.remove('show');box.innerHTML='';return}
  const found=markers.filter(m=>[m.name,m.address,m.description].join(' ').toLowerCase().includes(q)).slice(0,7);
  box.innerHTML=found.map((m,i)=>`<button class="rcResult" type="button" data-i="${i}"><i>🥙</i><span><b>${esc(m.name||'Шаурма')}</b><small>${esc(m.address||'')}</small></span></button>`).join('')||'<div style="padding:10px;font-size:11px;color:var(--rc-muted)">Ничего не найдено</div>';
  box.classList.add('show');$$('.rcResult',box).forEach((el,i)=>el.onclick=()=>{box.classList.remove('show');focusVenue(found[i])});
  if(commit&&found[0]){box.classList.remove('show');focusVenue(found[0])}
}
function locate(){
  if(!navigator.geolocation){status('Геолокация не поддерживается');setTimeout(()=>status('',false),1600);return}
  status('Определяем ваше место…');navigator.geolocation.getCurrentPosition(p=>{status('',false);map.easeTo({center:[p.coords.longitude,p.coords.latitude],zoom:16.5,duration:700})},()=>{status('Не удалось получить геолокацию');setTimeout(()=>status('',false),1800)},{enableHighAccuracy:false,timeout:6500,maximumAge:120000});
}

async function fetchProfile(m){
  if(profileCache.has(String(m.id)))return profileCache.get(String(m.id));
  try{
    const r=await fetch(API+'/api/shaurmeg/realcity-profile/'+encodeURIComponent(m.id),{cache:'no-store'});
    if(!r.ok)throw new Error();
    const j=await r.json(),p=safeProfile(j.profile);
    p.quality=j.quality||p.quality;p.status=j.status||'ready';profileCache.set(String(m.id),p);return p;
  }catch{return safeProfile(DEFAULT_PROFILE)}
}

function worldColorExpression(profile){
  const p=safeProfile(profile),sw=p.neighborhood_palette||[],wall=p.palette.wall,accent=p.palette.accent;
  const c0=sw[0]||shade(wall,10),c1=sw[1]||wall,c2=sw[2]||shade(wall,-9),c3=sw[3]||shade(accent,8);
  return ['interpolate',['linear'],['coalesce',['get','render_height'],['*',['coalesce',['get','levels'],3],3.05],10],0,c0,12,c1,28,c2,55,c3,95,shade(wall,-18)];
}
function applyWorldProfile(profile){
  const p=safeProfile(profile);
  try{
    map.setPaintProperty('rc-world-real','fill-extrusion-color',worldColorExpression(p));
    map.setPaintProperty('rc-world-roof','fill-extrusion-color',p.palette.roof);
    map.setLight({anchor:'viewport',color:shade(p.palette.wall,45),intensity:.50,position:[1.2,155,40]});
  }catch{}
}
function setBuiltinOpacity(v){for(const id of builtin3d){try{map.setPaintProperty(id,'fill-extrusion-opacity',v)}catch{}}}
function setRealOpacity(v){
  try{map.setPaintProperty('rc-world-real','fill-extrusion-opacity',v);map.setPaintProperty('rc-world-roof','fill-extrusion-opacity',Math.min(.98,v+.02));map.setPaintProperty('rc-hero-layer','fill-extrusion-opacity',v);map.setPaintProperty('rc-details-layer','fill-extrusion-opacity',Math.max(0,(v-.16)/.84))}catch{}
}
function clearScene(){
  const empty={type:'FeatureCollection',features:[]};map.getSource('rc-hero')?.setData(empty);map.getSource('rc-details')?.setData(empty);
  setRealOpacity(0);setBuiltinOpacity(.88);
  for(const id of builtin3d){try{map.setPaintProperty(id,'fill-extrusion-color',GOLD)}catch{}}
  try{map.setLight({anchor:'viewport',color:'#fff0c9',intensity:.42,position:[1.15,165,38]})}catch{}
}
function animateMorph(){
  const reduce=matchMedia('(prefers-reduced-motion: reduce)').matches,start=performance.now(),dur=reduce?1:1120;
  function frame(now){const t=Math.min(1,(now-start)/dur),e=1-Math.pow(1-t,3);setBuiltinOpacity(.88*(1-e)+.035);setRealOpacity(.97*e);if(t<1)requestAnimationFrame(frame)}
  requestAnimationFrame(frame);
}
function waitForIdle(timeout=1050){return new Promise(resolve=>{let done=false;const finish=()=>{if(done)return;done=true;clearTimeout(timer);try{map.off('idle',finish)}catch{};resolve()};const timer=setTimeout(finish,timeout);map.once('idle',finish)})}

function local(lon,lat,oLon,oLat){const k=Math.cos(oLat*Math.PI/180);return[(lon-oLon)*111320*k,(lat-oLat)*110540]}
function fromLocal(x,y,oLon,oLat){const k=Math.cos(oLat*Math.PI/180);return[oLon+x/(111320*k),oLat+y/110540]}
function centroid(r){let x=0,y=0,n=0;for(const p of r){if(Array.isArray(p)&&p.length>=2){x+=p[0];y+=p[1];n++}}return n?[x/n,y/n]:[0,0]}
function pointInRing(p,r){let inside=false;for(let i=0,j=r.length-1;i<r.length;j=i++){const a=r[i],b=r[j],hit=((a[1]>p[1])!==(b[1]>p[1]))&&(p[0]<(b[0]-a[0])*(p[1]-a[1])/((b[1]-a[1])||1e-12)+a[0]);if(hit)inside=!inside}return inside}
function ringDistance(p,r,oLon,oLat){if(pointInRing(p,r))return 0;const P=local(p[0],p[1],oLon,oLat);let best=1e9;for(let i=0;i<r.length-1;i++){const A=local(r[i][0],r[i][1],oLon,oLat),B=local(r[i+1][0],r[i+1][1],oLon,oLat),vx=B[0]-A[0],vy=B[1]-A[1],wx=P[0]-A[0],wy=P[1]-A[1],d=vx*vx+vy*vy,t=d?clamp((wx*vx+wy*vy)/d,0,1):0,dx=P[0]-(A[0]+vx*t),dy=P[1]-(A[1]+vy*t);best=Math.min(best,Math.hypot(dx,dy))}return best}
function edgeRect(a,b,depth,oLon,oLat,start,end){const A=local(a[0],a[1],oLon,oLat),B=local(b[0],b[1],oLon,oLat),dx=B[0]-A[0],dy=B[1]-A[1],len=Math.hypot(dx,dy);if(len<.8)return null;const nx=-dy/len,ny=dx/len,p0=[A[0]+dx*start,A[1]+dy*start],p1=[A[0]+dx*end,A[1]+dy*end],d=depth/2,pts=[[p0[0]+nx*d,p0[1]+ny*d],[p1[0]+nx*d,p1[1]+ny*d],[p1[0]-nx*d,p1[1]-ny*d],[p0[0]-nx*d,p0[1]-ny*d],[p0[0]+nx*d,p0[1]+ny*d]];return pts.map(p=>fromLocal(p[0],p[1],oLon,oLat))}
function featureRings(f){const g=f?.geometry;if(!g)return[];if(g.type==='Polygon')return g.coordinates?.[0]?[g.coordinates[0]]:[];if(g.type==='MultiPolygon')return(g.coordinates||[]).map(p=>p?.[0]).filter(Boolean);return[]}
function featureHeight(props,id){const h=Number(props.render_height??props.height),lv=Number(props.levels);if(Number.isFinite(h)&&h>2)return clamp(h,3,140);if(Number.isFinite(lv)&&lv>0)return clamp(lv*3.05,3,140);let n=0;for(const ch of String(id))n=(n*31+ch.charCodeAt(0))>>>0;return 9+(n%8)*3.05}

function buildDetails(m,profile){
  if(!buildingLayers.length)return null;
  let raw=[];try{raw=map.queryRenderedFeatures(undefined,{layers:buildingLayers})||[]}catch{return null}
  const p=safeProfile(profile),center=[Number(m.lon),Number(m.lat)],oLon=center[0],oLat=center[1],items=[],seen=new Set();
  for(const f of raw){
    const props=f.properties||{};
    for(const ring0 of featureRings(f)){
      const ring=ring0.map(x=>[Number(x[0]),Number(x[1])]).filter(x=>Number.isFinite(x[0])&&Number.isFinite(x[1]));if(ring.length<4)continue;
      const first=ring[0],last=ring[ring.length-1];if(first[0]!==last[0]||first[1]!==last[1])ring.push([...first]);
      const c0=centroid(ring),sig=(f.id!=null?String(f.id):c0[0].toFixed(5)+','+c0[1].toFixed(5));if(seen.has(sig))continue;seen.add(sig);
      const d=ringDistance(center,ring,oLon,oLat);if(d>150)continue;
      const height=featureHeight(props,sig),floors=clamp(Math.round(Number(props.levels)||height/3.05),1,35);items.push({sig,ring,d,height,floors});
    }
  }
  if(!items.length)return null;items.sort((a,b)=>a.d-b.d);const chosen=items.slice(0,10),hero=chosen[0],details=[];
  const heroFeature={type:'Feature',properties:{color:p.palette.wall,height:hero.height},geometry:{type:'Polygon',coordinates:[hero.ring]}};
  for(const b of chosen.slice(0,7)){
    const heroish=b===hero,pal=heroish?p.palette:{
      wall:p.neighborhood_palette[(chosen.indexOf(b)+1)%p.neighborhood_palette.length]||p.palette.wall,
      accent:shade(p.palette.accent,(chosen.indexOf(b)%3-1)*10),windows:p.palette.windows,storefront:p.palette.storefront,roof:p.palette.roof
    };
    if(heroish)details.push({type:'Feature',properties:{base:.12,height:Math.min(3.3,b.height),color:pal.storefront},geometry:{type:'Polygon',coordinates:[b.ring]}});
    const floors=Math.min(b.floors,14);
    for(let fl=1;fl<floors;fl++){
      const base=fl*3.05+1,height=Math.min(base+1.18,b.height-.2);if(height<=base)continue;
      for(let e=0;e<b.ring.length-1;e++){
        const A=local(b.ring[e][0],b.ring[e][1],oLon,oLat),B=local(b.ring[e+1][0],b.ring[e+1][1],oLon,oLat),len=Math.hypot(B[0]-A[0],B[1]-A[1]);if(len<3)continue;
        const count=Math.min(15,Math.max(1,Math.floor(len/5.3)));
        for(let w=0;w<count;w++){const seg=1/count,rect=edgeRect(b.ring[e],b.ring[e+1],heroish?.54:.42,oLon,oLat,w*seg+seg*.2,(w+1)*seg-seg*.2);if(rect)details.push({type:'Feature',properties:{base,height,color:pal.windows},geometry:{type:'Polygon',coordinates:[rect]}})}
      }
    }
    if(heroish){
      for(let e=0;e<b.ring.length-1;e+=2){const rect=edgeRect(b.ring[e],b.ring[e+1],.72,oLon,oLat,.055,.15);if(rect)details.push({type:'Feature',properties:{base:.25,height:Math.max(3,b.height-.22),color:pal.accent},geometry:{type:'Polygon',coordinates:[rect]}})}
      if(String(p.building_style).includes('balcon'))for(let fl=2;fl<Math.min(b.floors,14);fl+=2){for(let e=0;e<b.ring.length-1;e++){const ledge=edgeRect(b.ring[e],b.ring[e+1],.95,oLon,oLat,.18,.82);if(ledge){const z=fl*3.05+.35;details.push({type:'Feature',properties:{base:z,height:z+.16,color:shade(p.palette.wall,-18)},geometry:{type:'Polygon',coordinates:[ledge]}})}}}
    }
  }
  return {hero:{type:'FeatureCollection',features:[heroFeature]},details:{type:'FeatureCollection',features:details},count:chosen.length};
}

async function focusVenue(m,replay=false){
  if(!m||!map)return;selected=m;sceneToken++;const token=sceneToken;
  markerEls.forEach((mk,id)=>mk.getElement().classList.toggle('selected',id===String(m.id)));
  $('#rcVenueName').textContent=m.name||'Шаурма';$('#rcVenueAddress').textContent=m.address||'Рядом с вами';$('#rcVenueCard').classList.add('show');$('#rcResults').classList.remove('show');$('#rcLive').textContent='REAL CITY';
  clearScene();

  const profilePromise=fetchProfile(m);
  const initial=profileCache.get(String(m.id))||safeProfile(DEFAULT_PROFILE),cam=initial.camera;
  map.easeTo({center:[Number(m.lon),Number(m.lat)],zoom:Number(cam.zoom)||18.15,pitch:Number(cam.pitch)||63,bearing:Number(cam.bearing)||-18,duration:replay?560:920,easing:t=>1-Math.pow(1-t,3)});
  status('Считываем фасады и цвета района…');

  const [,profile]=await Promise.all([waitForIdle(replay?720:1120),profilePromise]);if(token!==sceneToken)return;
  const p=safeProfile(profile);applyWorldProfile(p);
  const detail=buildDetails(m,p);
  if(detail){map.getSource('rc-hero')?.setData(detail.hero);map.getSource('rc-details')?.setData(detail.details)}
  $('#rcLive').textContent='REAL CITY · '+qualityLabel(p.quality);
  animateMorph();
  const sourceText=p.quality==='photo'?'по фото фасада':p.quality==='street'?'по уличным снимкам':p.quality==='osm'?'по данным зданий':'автоматически';
  status('Фасады окрашены '+sourceText);
  setTimeout(()=>{if(token===sceneToken)status('',false)},1700);
}

async function init(){
  inject();
  const url=new URL(location.href),tgStart=window.Telegram?.WebApp?.initDataUnsafe?.start_param||url.searchParams.get('tgWebAppStartParam')||'';
  directVenueId=normalizeVenue(url.searchParams.get('venue')||tgStart);
  const shouldOpen=url.searchParams.get('view')!=='menu';
  if(shouldOpen)setTimeout(open,40);else ensureDeps().catch(()=>{});
}

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();