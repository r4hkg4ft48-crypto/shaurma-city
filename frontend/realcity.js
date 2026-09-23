(function(){
'use strict';
const API='https://shaurma-city-api.onrender.com';
const STYLE='https://tiles.openfreemap.org/styles/liberty';
const BUILD='68';
let map=null,markers=[],markerEls=new Map(),selected=null,sceneToken=0,builtin3d=[];
const $=(s,r=document)=>r.querySelector(s),$$=(s,r=document)=>Array.from(r.querySelectorAll(s));

function ensureDeps(){
  if(!document.querySelector('link[data-realcity-maplibre]')){const l=document.createElement('link');l.rel='stylesheet';l.href='https://unpkg.com/maplibre-gl@5/dist/maplibre-gl.css';l.dataset.realcityMaplibre='1';document.head.appendChild(l)}
  if(window.maplibregl)return Promise.resolve();
  return new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='https://unpkg.com/maplibre-gl@5/dist/maplibre-gl.js';s.async=true;s.onload=resolve;s.onerror=reject;document.head.appendChild(s)});
}
function inject(){
  if($('#realCityScreen'))return;
  document.body.insertAdjacentHTML('beforeend',`<button id="realCityOpen" type="button" aria-label="Открыть карту">Карта</button><section class="realCityScreen" id="realCityScreen" aria-hidden="true"><div class="realCityMap" id="realCityMap"></div><div class="realCityTop"><button class="rcClose" id="rcClose" type="button" aria-label="Закрыть карту">×</button><div class="rcSearchCard"><div class="rcBrand"><b>шаурмег</b><small>REAL CITY · ${BUILD}</small></div><div class="rcSearchRow"><input id="rcSearch" inputmode="search" placeholder="Метро, улица или заведение" autocomplete="off"><button id="rcFind" type="button">Найти</button></div><div class="rcNearby"><button id="rcNearby" type="button">◎ Вы рядом</button></div><div class="rcResults" id="rcResults"></div></div></div><div class="rcStatus" id="rcStatus">Готовим фасады…</div><div class="rcVenueCard" id="rcVenueCard"><div class="rcVenueHead"><div class="rcPinIcon">🥙</div><div><b id="rcVenueName"></b><small id="rcVenueAddress"></small></div><span class="rcLive">REAL CITY</span></div><div class="rcVenueActions"><button class="rcMenu" id="rcMenu" type="button">Открыть меню</button><button class="rcRepaint" id="rcRepaint" type="button">↻ Ещё раз</button></div></div></section>`);
  $('#realCityOpen').addEventListener('click',open);
  $('#rcClose').addEventListener('click',close);
  $('#rcFind').addEventListener('click',()=>search(true));
  $('#rcSearch').addEventListener('input',()=>search(false));
  $('#rcSearch').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();search(true)}});
  $('#rcNearby').addEventListener('click',locate);
  $('#rcRepaint').addEventListener('click',()=>selected&&focusVenue(selected,true));
  $('#rcMenu').addEventListener('click',()=>{if(!selected)return;const u=new URL(location.href);u.searchParams.set('venue',selected.venue_id||'lepyoshka');u.searchParams.set('view','menu');u.searchParams.set('b',BUILD);location.href=u.toString()});
}
function status(msg,on=true){const el=$('#rcStatus');if(!el)return;el.textContent=msg;el.classList.toggle('show',!!on)}
function open(){
  const screen=$('#realCityScreen');screen.classList.add('open');screen.setAttribute('aria-hidden','false');document.body.style.overflow='hidden';
  ensureMap().then(()=>{map.resize();if(markers.length)fitMarkers()}).catch(()=>status('Карта временно недоступна'));
}
function close(){const screen=$('#realCityScreen');screen.classList.remove('open');screen.setAttribute('aria-hidden','true');document.body.style.overflow='';$('#rcResults').classList.remove('show')}
async function ensureMap(){
  if(map)return map;
  await ensureDeps();
  map=new maplibregl.Map({container:'realCityMap',style:STYLE,center:[37.62,55.75],zoom:10.2,pitch:48,bearing:-14,attributionControl:true,maxPitch:80});
  map.addControl(new maplibregl.NavigationControl({showCompass:true,showZoom:true}),'top-right');
  await new Promise(resolve=>map.once('load',resolve));
  builtin3d=(map.getStyle().layers||[]).filter(l=>l.type==='fill-extrusion'&&(l['source-layer']==='building'||String(l.id).includes('building'))).map(l=>l.id);
  for(const id of builtin3d){try{map.setPaintProperty(id,'fill-extrusion-color','#d8b76c');map.setPaintProperty(id,'fill-extrusion-opacity',.82)}catch{}}
  installLayers();
  await loadMarkers();
  const url=new URL(location.href),wanted=url.searchParams.get('venue');
  if(wanted&&url.searchParams.get('view')==='map'){const m=markers.find(x=>x.venue_id===wanted);if(m)setTimeout(()=>focusVenue(m),250)}
  return map;
}
function installLayers(){
  if(map.getSource('rc-buildings'))return;
  const empty={type:'FeatureCollection',features:[]};
  map.addSource('rc-buildings',{type:'geojson',data:empty});
  map.addSource('rc-details',{type:'geojson',data:empty});
  map.addLayer({id:'rc-gold',type:'fill-extrusion',source:'rc-buildings',paint:{'fill-extrusion-color':'#d8b76c','fill-extrusion-height':['get','height'],'fill-extrusion-base':['coalesce',['get','base'],0],'fill-extrusion-opacity':0}});
  map.addLayer({id:'rc-real',type:'fill-extrusion',source:'rc-buildings',paint:{'fill-extrusion-color':['coalesce',['get','facade'],'#d2d2cf'],'fill-extrusion-height':['get','height'],'fill-extrusion-base':['coalesce',['get','base'],0],'fill-extrusion-opacity':0,'fill-extrusion-vertical-gradient':true}});
  map.addLayer({id:'rc-details-layer',type:'fill-extrusion',source:'rc-details',paint:{'fill-extrusion-color':['get','color'],'fill-extrusion-height':['get','height'],'fill-extrusion-base':['get','base'],'fill-extrusion-opacity':0,'fill-extrusion-vertical-gradient':false}});
}
async function loadMarkers(){
  try{const r=await fetch(API+'/api/shaurmeg/markers',{cache:'no-store'});if(!r.ok)throw new Error();markers=await r.json();if(!Array.isArray(markers))markers=[]}catch{markers=[]}
  markerEls.forEach(v=>v.remove());markerEls.clear();
  for(const m of markers){
    if(!Number.isFinite(Number(m.lon))||!Number.isFinite(Number(m.lat)))continue;
    const el=document.createElement('button');el.type='button';el.className='rcMarker';el.textContent='🥙';el.title=m.name||'Шаурма';el.addEventListener('click',e=>{e.stopPropagation();focusVenue(m)});
    const mk=new maplibregl.Marker({element:el,anchor:'bottom'}).setLngLat([Number(m.lon),Number(m.lat)]).addTo(map);markerEls.set(String(m.id),mk);
  }
  fitMarkers();
}
function fitMarkers(){if(!map||!markers.length)return;const valid=markers.filter(m=>Number.isFinite(Number(m.lon))&&Number.isFinite(Number(m.lat)));if(!valid.length)return;if(valid.length===1){map.jumpTo({center:[Number(valid[0].lon),Number(valid[0].lat)],zoom:15.8,pitch:50});return}const b=new maplibregl.LngLatBounds();valid.forEach(m=>b.extend([Number(m.lon),Number(m.lat)]));map.fitBounds(b,{padding:{top:150,bottom:120,left:35,right:35},maxZoom:15.2,duration:0})}
function search(commit){
  const q=$('#rcSearch').value.trim().toLowerCase(),box=$('#rcResults');
  if(!q){box.classList.remove('show');box.innerHTML='';return}
  const found=markers.filter(m=>[m.name,m.address,m.description].join(' ').toLowerCase().includes(q)).slice(0,6);
  box.innerHTML=found.map((m,i)=>`<button class="rcResult" type="button" data-i="${i}"><i>🥙</i><span><b>${esc(m.name||'Шаурма')}</b><small>${esc(m.address||'')}</small></span></button>`).join('') || '<div style="padding:10px;font-size:11px;color:var(--rc-muted)">Ничего не найдено</div>';
  box.classList.add('show');$$('.rcResult',box).forEach((el,i)=>el.addEventListener('click',()=>{box.classList.remove('show');focusVenue(found[i])}));
  if(commit&&found[0]){box.classList.remove('show');focusVenue(found[0])}
}
function esc(s){return String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function locate(){
  if(!navigator.geolocation){status('Геолокация не поддерживается');setTimeout(()=>status('',false),1600);return}
  status('Определяем ваше место…');navigator.geolocation.getCurrentPosition(p=>{status('',false);map.easeTo({center:[p.coords.longitude,p.coords.latitude],zoom:16.5,duration:700})},()=>{status('Не удалось получить геолокацию');setTimeout(()=>status('',false),1800)},{enableHighAccuracy:false,timeout:6500,maximumAge:120000});
}
function setBuiltinOpacity(v){for(const id of builtin3d){try{map.setPaintProperty(id,'fill-extrusion-opacity',v)}catch{}}}
function clearScene(){const empty={type:'FeatureCollection',features:[]};map.getSource('rc-buildings')?.setData(empty);map.getSource('rc-details')?.setData(empty);try{map.setPaintProperty('rc-gold','fill-extrusion-opacity',0);map.setPaintProperty('rc-real','fill-extrusion-opacity',0);map.setPaintProperty('rc-details-layer','fill-extrusion-opacity',0)}catch{};setBuiltinOpacity(.82)}
function animateFacade(){
  const reduce=matchMedia('(prefers-reduced-motion: reduce)').matches,start=performance.now(),dur=reduce?1:1050;
  function frame(now){const t=Math.min(1,(now-start)/dur),e=1-Math.pow(1-t,3);try{map.setPaintProperty('rc-gold','fill-extrusion-opacity',.96*(1-e));map.setPaintProperty('rc-real','fill-extrusion-opacity',.96*e);map.setPaintProperty('rc-details-layer','fill-extrusion-opacity',.98*Math.max(0,(e-.18)/.82));}catch{};setBuiltinOpacity(.08+.12*(1-e));if(t<1)requestAnimationFrame(frame)}requestAnimationFrame(frame)
}
async function focusVenue(m,replay=false){
  if(!m||!map)return;selected=m;sceneToken++;const token=sceneToken;
  markerEls.forEach((mk,id)=>mk.getElement().classList.toggle('selected',id===String(m.id)));
  $('#rcVenueName').textContent=m.name||'Шаурма';$('#rcVenueAddress').textContent=m.address||'Рядом с вами';$('#rcVenueCard').classList.add('show');$('#rcResults').classList.remove('show');
  if(!replay)clearScene();
  const cfg=(m.realcity_config&&typeof m.realcity_config==='object')?m.realcity_config:{};
  map.easeTo({center:[Number(m.lon),Number(m.lat)],zoom:Number(cfg.zoom)||18.1,pitch:Number(cfg.pitch)||63,bearing:Number(cfg.bearing)||-18,duration:replay?520:820,easing:t=>1-Math.pow(1-t,3)});
  status('Золотые дома → реальные фасады');
  try{
    const u=new URL(API+'/api/shaurmeg/realcity');u.searchParams.set('lat',m.lat);u.searchParams.set('lon',m.lon);u.searchParams.set('radius','190');u.searchParams.set('venue_id',m.venue_id||'');
    const r=await fetch(u.toString(),{cache:'no-store'});if(!r.ok)throw new Error('source');const scene=await r.json();if(token!==sceneToken)return;
    map.getSource('rc-buildings').setData(scene.buildings);map.getSource('rc-details').setData(scene.details);
    map.setPaintProperty('rc-gold','fill-extrusion-opacity',.96);map.setPaintProperty('rc-real','fill-extrusion-opacity',0);map.setPaintProperty('rc-details-layer','fill-extrusion-opacity',0);setBuiltinOpacity(.12);
    setTimeout(()=>{if(token===sceneToken){animateFacade();status(scene.stats?.buildings?`Перерисовано домов: ${scene.stats.buildings}`:'Фасады готовы');setTimeout(()=>status('',false),1400)}},220);
  }catch{
    if(token!==sceneToken)return;
    let start=performance.now();function fallback(now){const t=Math.min(1,(now-start)/800);for(const id of builtin3d){try{map.setPaintProperty(id,'fill-extrusion-color',t<.5?'#cdb071':'#cfd0cd');map.setPaintProperty(id,'fill-extrusion-opacity',.84)}catch{}}if(t<1)requestAnimationFrame(fallback)}requestAnimationFrame(fallback);status('Базовая перерисовка готова');setTimeout(()=>status('',false),1600)
  }
}
async function init(){
  inject();
  const url=new URL(location.href),shouldOpen=url.searchParams.get('view')!=='menu'&&!url.searchParams.get('venue');
  if(shouldOpen)setTimeout(open,60);
  else ensureDeps().catch(()=>{});
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
