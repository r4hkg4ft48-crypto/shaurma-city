(function(){
'use strict';
const API='https://shaurma-city-api.onrender.com';
const STYLE='https://tiles.openfreemap.org/styles/liberty';
const BUILD='70';
let map=null,markers=[],markerEls=new Map(),selected=null,sceneToken=0,builtin3d=[],buildingLayers=[];
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
  const styleLayers=map.getStyle().layers||[];
  builtin3d=styleLayers.filter(l=>l.type==='fill-extrusion'&&(l['source-layer']==='building'||String(l.id).toLowerCase().includes('building'))).map(l=>l.id);
  buildingLayers=styleLayers.filter(l=>['fill-extrusion','fill'].includes(l.type)&&(l['source-layer']==='building'||String(l.id).toLowerCase().includes('building'))).map(l=>l.id);
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
  map.addLayer({id:'rc-roofs',type:'fill-extrusion',source:'rc-buildings',paint:{'fill-extrusion-color':['coalesce',['get','roof'],'#b9b8b3'],'fill-extrusion-height':['get','height'],'fill-extrusion-base':['-',['get','height'],0.22],'fill-extrusion-opacity':0,'fill-extrusion-vertical-gradient':false}});
  map.addLayer({id:'rc-details-layer',type:'fill-extrusion',source:'rc-details',paint:{'fill-extrusion-color':['get','color'],'fill-extrusion-height':['get','height'],'fill-extrusion-base':['get','base'],'fill-extrusion-opacity':0,'fill-extrusion-vertical-gradient':false}});
}
async function loadMarkers(){
  try{const r=await fetch(API+'/api/shaurmeg/markers?lite=1',{cache:'no-store'});if(!r.ok)throw new Error();markers=await r.json();if(!Array.isArray(markers))markers=[]}catch{markers=[]}
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

const RC_PALETTES=[
 {wall:'#d8d4cc',accent:'#8a6a56',windows:'#2c3742',storefront:'#24272a',roof:'#bab5ab'},
 {wall:'#d5d7d6',accent:'#6e7475',windows:'#27313a',storefront:'#20252a',roof:'#b8bbb9'},
 {wall:'#d7d0c5',accent:'#7a6354',windows:'#26313a',storefront:'#2d2925',roof:'#b9b0a5'},
 {wall:'#cfd3d6',accent:'#78828c',windows:'#29343d',storefront:'#20262d',roof:'#aeb5ba'}
];
function rcHash(s){let h=2166136261;for(const ch of String(s)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)}return h>>>0}
function rcClamp(n,a,b){return Math.max(a,Math.min(b,n))}
function rcNum(v){const n=Number.parseFloat(String(v??'').replace(',','.'));return Number.isFinite(n)?n:null}
function rcLocal(lon,lat,oLon,oLat){const k=Math.cos(oLat*Math.PI/180);return[(lon-oLon)*111320*k,(lat-oLat)*110540]}
function rcFromLocal(x,y,oLon,oLat){const k=Math.cos(oLat*Math.PI/180);return[oLon+x/(111320*k),oLat+y/110540]}
function rcCentroid(r){let x=0,y=0,n=0;for(const p of r){if(Array.isArray(p)&&p.length>=2){x+=p[0];y+=p[1];n++}}return n?[x/n,y/n]:[0,0]}
function rcPointInRing(p,r){let inside=false;for(let i=0,j=r.length-1;i<r.length;j=i++){const a=r[i],b=r[j],hit=((a[1]>p[1])!==(b[1]>p[1]))&&(p[0]<(b[0]-a[0])*(p[1]-a[1])/((b[1]-a[1])||1e-12)+a[0]);if(hit)inside=!inside}return inside}
function rcRingDistance(p,r,oLon,oLat){if(rcPointInRing(p,r))return 0;const P=rcLocal(p[0],p[1],oLon,oLat);let best=1e9;for(let i=0;i<r.length-1;i++){const A=rcLocal(r[i][0],r[i][1],oLon,oLat),B=rcLocal(r[i+1][0],r[i+1][1],oLon,oLat),vx=B[0]-A[0],vy=B[1]-A[1],wx=P[0]-A[0],wy=P[1]-A[1],d=vx*vx+vy*vy,t=d?rcClamp((wx*vx+wy*vy)/d,0,1):0,dx=P[0]-(A[0]+vx*t),dy=P[1]-(A[1]+vy*t);best=Math.min(best,Math.hypot(dx,dy))}return best}
function rcEdgeRect(a,b,depth,oLon,oLat,start,end){const A=rcLocal(a[0],a[1],oLon,oLat),B=rcLocal(b[0],b[1],oLon,oLat),dx=B[0]-A[0],dy=B[1]-A[1],len=Math.hypot(dx,dy);if(len<.8)return null;const ux=dx/len,uy=dy/len,nx=-uy,ny=ux,p0=[A[0]+dx*start,A[1]+dy*start],p1=[A[0]+dx*end,A[1]+dy*end],d=depth/2,pts=[[p0[0]+nx*d,p0[1]+ny*d],[p1[0]+nx*d,p1[1]+ny*d],[p1[0]-nx*d,p1[1]-ny*d],[p0[0]-nx*d,p0[1]-ny*d],[p0[0]+nx*d,p0[1]+ny*d]];return pts.map(p=>rcFromLocal(p[0],p[1],oLon,oLat))}
function rcPalette(venueId,p,id){if(String(venueId||'').toLowerCase()==='lepyoshka')return{wall:'#d5d5d1',accent:'#735845',windows:'#28343e',storefront:'#202429',roof:'#b9b9b4'};const q={...RC_PALETTES[rcHash(id)%RC_PALETTES.length]},tag=String(p.colour||p.color||p['building:colour']||'');if(/^#[0-9a-f]{6}$/i.test(tag))q.wall=tag;const mat=String(p.material||p['building:material']||'').toLowerCase();if(mat.includes('brick'))q.accent='#805c49';return q}
function rcHeight(p,id){const direct=rcNum(p.render_height??p.height),levels=rcNum(p.levels??p['building:levels']);if(direct)return rcClamp(direct,3,120);if(levels)return rcClamp(levels*3.05,3,120);return 9+(rcHash(id)%8)*3.05}
function rcRings(feature){
 const g=feature?.geometry;if(!g)return[];
 if(g.type==='Polygon')return(g.coordinates||[]).length?[g.coordinates[0]]:[];
 if(g.type==='MultiPolygon')return(g.coordinates||[]).map(p=>p?.[0]).filter(r=>Array.isArray(r)&&r.length>=4);
 return[];
}
function rcVisibleScene(m){
 if(!buildingLayers.length)return null;
 let raw=[];try{raw=map.queryRenderedFeatures(undefined,{layers:buildingLayers})||[]}catch{return null}
 const center=[Number(m.lon),Number(m.lat)],oLon=center[0],oLat=center[1],seen=new Set(),items=[];
 for(const f of raw){
   const props=f.properties||{},rings=rcRings(f);
   rings.forEach((ring,idx)=>{
     if(!Array.isArray(ring)||ring.length<4)return;
     const r=ring.map(p=>[Number(p[0]),Number(p[1])]).filter(p=>Number.isFinite(p[0])&&Number.isFinite(p[1]));if(r.length<4)return;
     const first=r[0],last=r[r.length-1];if(first[0]!==last[0]||first[1]!==last[1])r.push([...first]);
     const c0=rcCentroid(r),sig=(f.id!=null?String(f.id):c0[0].toFixed(5)+','+c0[1].toFixed(5))+':'+idx;if(seen.has(sig))return;seen.add(sig);
     const d=rcRingDistance(center,r,oLon,oLat);if(d>230)return;
     const id='tile-'+sig,height=rcHeight(props,id),floors=rcClamp(Math.round(rcNum(props.levels)||height/3.05),1,35),palette=rcPalette(m.venue_id,props,id);
     items.push({id,ring:r,distance:d,height,floors,palette});
   });
 }
 if(!items.length)return null;items.sort((a,b)=>a.distance-b.distance);const chosen=items.slice(0,80),hero=chosen[0];
 const buildings={type:'FeatureCollection',features:chosen.map((b,i)=>({type:'Feature',id:i+1,properties:{id:b.id,height:b.height,base:0,facade:b.palette.wall,roof:b.palette.roof,distance:Math.round(b.distance),hero:b===hero?1:0},geometry:{type:'Polygon',coordinates:[b.ring]}}))};
 const detailFeatures=[];
 for(const b of chosen.filter((x,i)=>i<7&&x.distance<115)){
   const heroish=b===hero;
   if(heroish)detailFeatures.push({type:'Feature',properties:{base:.1,height:Math.min(3.2,b.height),color:b.palette.storefront,kind:'storefront'},geometry:{type:'Polygon',coordinates:[b.ring]}});
   const floors=Math.min(b.floors,13);
   for(let fl=1;fl<floors;fl++){
     const base=fl*3.05+1.0,height=Math.min(base+1.2,b.height-.22);if(height<=base)continue;
     for(let e=0;e<b.ring.length-1;e++){
       const A=rcLocal(b.ring[e][0],b.ring[e][1],oLon,oLat),B=rcLocal(b.ring[e+1][0],b.ring[e+1][1],oLon,oLat),edge=Math.hypot(B[0]-A[0],B[1]-A[1]);if(edge<3)continue;
       const count=Math.min(14,Math.max(1,Math.floor(edge/5.4)));
       for(let w=0;w<count;w++){const seg=1/count,s=w*seg+seg*.19,t=(w+1)*seg-seg*.19,rect=rcEdgeRect(b.ring[e],b.ring[e+1],heroish?.52:.4,oLon,oLat,s,t);if(rect)detailFeatures.push({type:'Feature',properties:{base,height,color:b.palette.windows,kind:'window'},geometry:{type:'Polygon',coordinates:[rect]}})}
     }
   }
   if(heroish){for(let e=0;e<b.ring.length-1;e+=2){const rect=rcEdgeRect(b.ring[e],b.ring[e+1],.68,oLon,oLat,.055,.14);if(rect)detailFeatures.push({type:'Feature',properties:{base:.25,height:Math.max(3,b.height-.22),color:b.palette.accent,kind:'accent'},geometry:{type:'Polygon',coordinates:[rect]}})}}
 }
 return{buildings,details:{type:'FeatureCollection',features:detailFeatures},stats:{buildings:buildings.features.length,details:detailFeatures.length},source:'map-vector'};
}
function rcWaitForMap(timeout=1050){return new Promise(resolve=>{let done=false;const finish=()=>{if(done)return;done=true;clearTimeout(timer);try{map.off('idle',finish)}catch{};resolve()};const timer=setTimeout(finish,timeout);map.once('idle',finish)})}
function rcApplyScene(scene,token){if(!scene||token!==sceneToken)return false;map.getSource('rc-buildings').setData(scene.buildings);map.getSource('rc-details').setData(scene.details);map.setPaintProperty('rc-gold','fill-extrusion-opacity',.96);map.setPaintProperty('rc-real','fill-extrusion-opacity',0);map.setPaintProperty('rc-roofs','fill-extrusion-opacity',0);map.setPaintProperty('rc-details-layer','fill-extrusion-opacity',0);setBuiltinOpacity(.12);setTimeout(()=>{if(token===sceneToken){animateFacade();status(scene.stats?.buildings?`Перерисовано домов: ${scene.stats.buildings}`:'Фасады готовы');setTimeout(()=>status('',false),1400)}},180);return true}
async function rcServerScene(m,signal){const u=new URL(API+'/api/shaurmeg/realcity');u.searchParams.set('lat',m.lat);u.searchParams.set('lon',m.lon);u.searchParams.set('radius','150');u.searchParams.set('venue_id',m.venue_id||'');const r=await fetch(u.toString(),{cache:'no-store',signal});if(!r.ok)throw new Error('source');return r.json()}

function setBuiltinOpacity(v){for(const id of builtin3d){try{map.setPaintProperty(id,'fill-extrusion-opacity',v)}catch{}}}
function clearScene(){const empty={type:'FeatureCollection',features:[]};map.getSource('rc-buildings')?.setData(empty);map.getSource('rc-details')?.setData(empty);try{map.setPaintProperty('rc-gold','fill-extrusion-opacity',0);map.setPaintProperty('rc-real','fill-extrusion-opacity',0);map.setPaintProperty('rc-roofs','fill-extrusion-opacity',0);map.setPaintProperty('rc-details-layer','fill-extrusion-opacity',0)}catch{};setBuiltinOpacity(.82)}
function animateFacade(){
  const reduce=matchMedia('(prefers-reduced-motion: reduce)').matches,start=performance.now(),dur=reduce?1:1050;
  function frame(now){const t=Math.min(1,(now-start)/dur),e=1-Math.pow(1-t,3);try{map.setPaintProperty('rc-gold','fill-extrusion-opacity',.96*(1-e));map.setPaintProperty('rc-real','fill-extrusion-opacity',.96*e);map.setPaintProperty('rc-roofs','fill-extrusion-opacity',.98*e);map.setPaintProperty('rc-details-layer','fill-extrusion-opacity',.98*Math.max(0,(e-.18)/.82));}catch{};setBuiltinOpacity(.08+.12*(1-e));if(t<1)requestAnimationFrame(frame)}requestAnimationFrame(frame)
}
async function focusVenue(m,replay=false){
  if(!m||!map)return;selected=m;sceneToken++;const token=sceneToken;
  markerEls.forEach((mk,id)=>mk.getElement().classList.toggle('selected',id===String(m.id)));
  $('#rcVenueName').textContent=m.name||'Шаурма';$('#rcVenueAddress').textContent=m.address||'Рядом с вами';$('#rcVenueCard').classList.add('show');$('#rcResults').classList.remove('show');
  if(!replay)clearScene();
  const cfg=(m.realcity_config&&typeof m.realcity_config==='object')?m.realcity_config:{};
  map.easeTo({center:[Number(m.lon),Number(m.lat)],zoom:Number(cfg.zoom)||18.1,pitch:Number(cfg.pitch)||63,bearing:Number(cfg.bearing)||-18,duration:replay?520:820,easing:t=>1-Math.pow(1-t,3)});
  status('Золотые дома → реальные фасады');
  await rcWaitForMap(replay?650:1100);if(token!==sceneToken)return;
  const local=rcVisibleScene(m);
  if(local&&local.stats.buildings){rcApplyScene(local,token);return}
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),5200);
  try{const scene=await rcServerScene(m,controller.signal);clearTimeout(timer);if(token!==sceneToken)return;rcApplyScene(scene,token)}
  catch{clearTimeout(timer);if(token!==sceneToken)return;let start=performance.now();function fallback(now){const t=Math.min(1,(now-start)/800),e=1-Math.pow(1-t,3);for(const id of builtin3d){try{map.setPaintProperty(id,'fill-extrusion-color',t<.18?'#d8b76c':'#cfd0cd');map.setPaintProperty(id,'fill-extrusion-opacity',.84)}catch{}}if(t<1)requestAnimationFrame(fallback)}requestAnimationFrame(fallback);status('Фасады карты обновлены');setTimeout(()=>status('',false),1500)}
}
async function init(){
  inject();
  const url=new URL(location.href),tgStart=window.Telegram?.WebApp?.initDataUnsafe?.start_param||url.searchParams.get('tgWebAppStartParam')||'',directVenue=url.searchParams.get('venue')||tgStart,shouldOpen=url.searchParams.get('view')!=='menu'&&!directVenue;
  if(shouldOpen)setTimeout(open,60);
  else ensureDeps().catch(()=>{});
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
