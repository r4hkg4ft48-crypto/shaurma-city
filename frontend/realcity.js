(function(){
'use strict';

const API='https://shaurma-city-api.onrender.com';
const STYLE='https://tiles.openfreemap.org/styles/liberty';
const BUILD='86';
const GOLD='#777970';
const EARTH={bg:'#1a211c',land:'#4d5649',land2:'#5b6056',residential:'#62665b',commercial:'#6d695c',industrial:'#5a5d58',grass:'#536d4c',forest:'#2f4d37',scrub:'#59634c',water:'#13242a',building:'#89877d',buildingTop:'#a09d91',road:'#f6f4ed',roadSoft:'#e5e7e1',path:'#cfd4cb',border:'#717a70',label:'#f7f6ef',labelMuted:'#d4d6cf',halo:'#2b332d'};
const EMPTY={type:'FeatureCollection',features:[]};

let map=null,markers=[],markerEls=new Map(),selected=null,sceneToken=0,directVenueId='';
let builtin3d=[],buildingLayers=[],roadLayers=[],dimmedLayers=[],profileCache=new Map(),venueSourceReady=false;

const $=(s,r=document)=>r.querySelector(s),$$=(s,r=document)=>Array.from(r.querySelectorAll(s));
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));

function normalizeVenue(v){return String(v||'').trim().toLowerCase().replace(/^venue_/,'')}
function esc(s){return String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function hexRgb(hex){const m=String(hex||'').match(/^#([0-9a-f]{6})$/i);return m?[parseInt(m[1].slice(0,2),16),parseInt(m[1].slice(2,4),16),parseInt(m[1].slice(4,6),16)]:null}
function rgbHex(r,g,b){const x=n=>clamp(Math.round(n),0,255).toString(16).padStart(2,'0');return '#'+x(r)+x(g)+x(b)}
function shade(hex,d){const c=hexRgb(hex);return c?rgbHex(c[0]+d,c[1]+d,c[2]+d):hex}
function alpha(hex,a){const c=hexRgb(hex);return c?`rgba(${c[0]},${c[1]},${c[2]},${a})`:hex}
function qualityLabel(q){return ({photo:'PHOTO',street:'STREET',osm:'OSM',heuristic:'AUTO'})[q]||'AUTO'}

const DEFAULT_PROFILE={
 version:4,quality:'heuristic',confidence:.35,building_style:'panel_simple',
 palette:{wall:'#d3d1cc',accent:'#8a7463',windows:'#29343d',storefront:'#24282b',roof:'#b7b4ae',ground:'#d9d5cc'},
 neighborhood_palette:['#d3d1cc','#c8c5be','#bcb9b1','#aaa39a','#8a7463'],
 facade:{levels:9,window_rows:8,window_columns:5,window_width_ratio:.54,window_height_ratio:.48,panel_grid:true,balconies:false,balcony_every:2,balcony_depth_m:.65,vertical_bands:true,vertical_band_every:3,storefront:true,storefront_height_m:3.35,roof_equipment:true,material:'panel'},
 environment:{tree_density:.3,vegetation_ratio:.12,ground_color:'#d9d5cc'},
 camera:{zoom:18.35,pitch:61,bearing:-20},
 scene:{buildings:[],trees:[]},
 texture:{hero_data_url:null,source:'procedural'}
};
function safeProfile(p){
 const x=p&&typeof p==='object'?p:{};
 return {
   ...DEFAULT_PROFILE,...x,
   palette:{...DEFAULT_PROFILE.palette,...(x.palette||{})},
   facade:{...DEFAULT_PROFILE.facade,...(x.facade||{})},
   environment:{...DEFAULT_PROFILE.environment,...(x.environment||{})},
   camera:{...DEFAULT_PROFILE.camera,...(x.camera||{})},
   scene:{...DEFAULT_PROFILE.scene,...(x.scene||{})},
   texture:{...DEFAULT_PROFILE.texture,...(x.texture||{})},
   neighborhood_palette:Array.isArray(x.neighborhood_palette)&&x.neighborhood_palette.length?x.neighborhood_palette:DEFAULT_PROFILE.neighborhood_palette
 };
}

function ensureDeps(){
 if(!document.querySelector('link[data-realcity-maplibre]')){
   const l=document.createElement('link');l.rel='stylesheet';l.href='https://unpkg.com/maplibre-gl@5/dist/maplibre-gl.css';l.dataset.realcityMaplibre='1';document.head.appendChild(l);
 }
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
   <div class="rcStatus" id="rcStatus">Собираем реальный квартал…</div>
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
 $('#rcMenu').onclick=()=>{if(!selected)return;const u=new URL(location.href);u.searchParams.set('venue',selected.venue_id);u.searchParams.set('establishment',selected.establishment_id||'');u.searchParams.set('marker',selected.marker_id||selected.id);u.searchParams.set('context','marker');u.searchParams.set('view','menu');u.searchParams.set('b',BUILD);location.href=u.toString()};
}

function status(msg,on=true){const el=$('#rcStatus');if(!el)return;el.textContent=msg;el.classList.toggle('show',!!on)}
function open(){
 const s=$('#realCityScreen');s.classList.add('open');s.setAttribute('aria-hidden','false');document.body.style.overflow='hidden';
 const ready=ensureMap().then(()=>{map.resize();return map}).catch(e=>{status('Карта временно недоступна');throw e});
 const intro=window.RealCitySpaceIntro;
 if(intro){intro.play({ready,mode:intro.preferredMode()}).catch(()=>{});}
 return ready;
}
function close(){
 window.RealCitySpaceIntro?.stop?.();
 const s=$('#realCityScreen');s.classList.remove('open','rc-map-arrived','rc-intro-running');s.setAttribute('aria-hidden','true');document.body.style.overflow='';$('#rcResults')?.classList.remove('show');
}

async function ensureMap(){
 if(map)return map;
 await ensureDeps();
 map=new maplibregl.Map({container:'realCityMap',style:STYLE,center:[37.6176,55.7558],zoom:10.4,pitch:48,bearing:-14,attributionControl:false,maxPitch:78});
 map.addControl(new maplibregl.NavigationControl({showCompass:true,showZoom:true}),'top-right');
 map.addControl(new maplibregl.AttributionControl({compact:true,customAttribution:'Каталог заведений: © OpenStreetMap contributors · ODbL'}),'bottom-right');
 await new Promise(resolve=>map.once('load',resolve));

 const layers=map.getStyle().layers||[];
 applyEarthBaseMap(layers);
 builtin3d=layers.filter(l=>l.type==='fill-extrusion'&&(l['source-layer']==='building'||/building/i.test(l.id))).map(l=>l.id);
 buildingLayers=layers.filter(l=>['fill','fill-extrusion'].includes(l.type)&&(l['source-layer']==='building'||/building/i.test(l.id))).map(l=>l.id);
 roadLayers=layers.filter(l=>l.type==='line'&&(/road|street|transport|highway/i.test(String(l.id||''))||/transportation|road|highway/i.test(String(l['source-layer']||'')))).map(l=>l.id);
 for(const id of builtin3d){try{map.setPaintProperty(id,'fill-extrusion-color',GOLD);map.setPaintProperty(id,'fill-extrusion-opacity',.84)}catch{}}
 installSceneLayers(layers);
 installTreeImage();
 dimPoiLayers(layers);
 installVenueLayers(layers);
 map.on('moveend',renderVisibleVenueMarkers);
 map.on('zoomend',renderVisibleVenueMarkers);
 await loadMarkers();

 if(directVenueId){
   const m=markers.find(x=>normalizeVenue(x.venue_id)===directVenueId);
   if(m)setTimeout(()=>focusVenue(m),180);else fitMarkers();
 }else fitMarkers();
 return map;
}

function addLayerSafe(layer,before){try{map.addLayer(layer,before)}catch{try{map.addLayer(layer)}catch{}}}
function applyEarthBaseMap(layers){
 for(const l of layers){
   const id=String(l.id||'').toLowerCase(),sl=String(l['source-layer']||'').toLowerCase(),key=id+' '+sl;
   try{
     if(l.type==='background'){
       map.setPaintProperty(l.id,'background-color',EARTH.bg);
       map.setPaintProperty(l.id,'background-opacity',1);
     }else if(l.type==='fill'){
       let color=EARTH.land,opacity=.96;
       if(/water|ocean|lake|river/.test(key)){color=EARTH.water;opacity=.98}
       else if(/wood|forest|tree|orchard/.test(key)){color=EARTH.forest;opacity=.98}
       else if(/park|grass|meadow|garden|cemetery|pitch/.test(key)){color=EARTH.grass;opacity=.97}
       else if(/scrub|heath|wetland|farmland|farmyard/.test(key)){color=EARTH.scrub;opacity=.94}
       else if(/residential/.test(key)){color=EARTH.residential;opacity=.91}
       else if(/commercial|retail/.test(key)){color=EARTH.commercial;opacity=.90}
       else if(/industrial|railway/.test(key)){color=EARTH.industrial;opacity=.90}
       else if(/building/.test(key)){color=EARTH.building;opacity=.94}
       else if(/landuse|landcover/.test(key)){color=EARTH.land2;opacity=.91}
       map.setPaintProperty(l.id,'fill-color',color);
       map.setPaintProperty(l.id,'fill-opacity',opacity);
       try{map.setPaintProperty(l.id,'fill-outline-color',/building/.test(key)?EARTH.buildingTop:shade(color,-6))}catch{}
     }else if(l.type==='fill-extrusion'){
       if(/building/.test(key)){
         map.setPaintProperty(l.id,'fill-extrusion-color',EARTH.building);
         map.setPaintProperty(l.id,'fill-extrusion-opacity',.90);
         try{map.setPaintProperty(l.id,'fill-extrusion-vertical-gradient',true)}catch{}
       }
     }else if(l.type==='line'){
       let color=EARTH.border,opacity=.52;
       if(/motorway|trunk|primary/.test(key)){color=EARTH.road;opacity=.97}
       else if(/secondary|tertiary|street|road|transport/.test(key)){color=EARTH.roadSoft;opacity=.91}
       else if(/path|foot|cycle|track/.test(key)){color=EARTH.path;opacity=.66}
       else if(/rail/.test(key)){color='#b8bbb4';opacity=.52}
       else if(/waterway|river|stream/.test(key)){color='#35545d';opacity=.74}
       else if(/boundary|admin/.test(key)){color=EARTH.border;opacity=.42}
       map.setPaintProperty(l.id,'line-color',color);
       map.setPaintProperty(l.id,'line-opacity',opacity);
     }else if(l.type==='symbol'){
       const primary=/road|street|place|city|town|village|district/.test(key);
       try{map.setPaintProperty(l.id,'text-color',primary?EARTH.label:EARTH.labelMuted)}catch{}
       try{map.setPaintProperty(l.id,'text-halo-color',EARTH.halo)}catch{}
       try{map.setPaintProperty(l.id,'text-halo-width',primary?1.6:1.15)}catch{}
       try{map.setPaintProperty(l.id,'text-halo-blur',.42)}catch{}
       try{map.setPaintProperty(l.id,'icon-opacity',primary?.76:.48)}catch{}
     }else if(l.type==='raster'){
       try{map.setPaintProperty(l.id,'raster-saturation',-.08)}catch{}
       try{map.setPaintProperty(l.id,'raster-brightness-min',.08)}catch{}
       try{map.setPaintProperty(l.id,'raster-brightness-max',.82)}catch{}
       try{map.setPaintProperty(l.id,'raster-contrast',.08)}catch{}
     }
   }catch{}
 }
 try{map.setLight({anchor:'viewport',color:'#f2ead7',intensity:.36,position:[1.15,165,38]})}catch{}
}
function installSceneLayers(styleLayers){
 if(map.getSource('rc-buildings'))return;
 const before=styleLayers.find(l=>l.type==='symbol')?.id;
 map.addSource('rc-buildings',{type:'geojson',data:EMPTY});
 map.addSource('rc-storefront',{type:'geojson',data:EMPTY});
 map.addSource('rc-windows',{type:'geojson',data:EMPTY});
 map.addSource('rc-accents',{type:'geojson',data:EMPTY});
 map.addSource('rc-balconies',{type:'geojson',data:EMPTY});
 map.addSource('rc-roofeq',{type:'geojson',data:EMPTY});
 map.addSource('rc-trees',{type:'geojson',data:EMPTY});
 map.addSource('rc-focus',{type:'geojson',data:EMPTY});
 map.addSource('rc-focus-roads',{type:'geojson',data:EMPTY});
 map.addSource('rc-hero-highlight',{type:'geojson',data:EMPTY});

 addLayerSafe({id:'rc-focus-aura',type:'circle',source:'rc-focus',paint:{
   'circle-radius':['interpolate',['linear'],['zoom'],15,44,17,82,18.5,126,20,165],
   'circle-color':'#d6e3d2','circle-opacity':0,'circle-blur':.88,'circle-pitch-alignment':'map'
 }},before);

 addLayerSafe({id:'rc-focus-core',type:'circle',source:'rc-focus',paint:{
   'circle-radius':['interpolate',['linear'],['zoom'],15,11,17,19,18.5,28,20,36],
   'circle-color':'#f4f1e8','circle-opacity':0,'circle-blur':.58,'circle-pitch-alignment':'map'
 }},before);

 addLayerSafe({id:'rc-focus-roads-glow',type:'line',source:'rc-focus-roads',paint:{
   'line-color':'#d8e7dc','line-width':['interpolate',['linear'],['zoom'],15,3,17,7,18.5,11,20,15],
   'line-opacity':0,'line-blur':['interpolate',['linear'],['zoom'],15,2,18,5,20,7]
 }},before);

 addLayerSafe({id:'rc-focus-roads-line',type:'line',source:'rc-focus-roads',paint:{
   'line-color':'#f5fbff','line-width':['interpolate',['linear'],['zoom'],15,.7,17,1.4,18.5,2.15,20,2.7],
   'line-opacity':0
 }},before);

 addLayerSafe({id:'rc-gold',type:'fill-extrusion',source:'rc-buildings',paint:{
   'fill-extrusion-color':GOLD,'fill-extrusion-height':['get','height'],'fill-extrusion-base':0,'fill-extrusion-opacity':0,'fill-extrusion-vertical-gradient':true
 }},before);

 addLayerSafe({id:'rc-real-color',type:'fill-extrusion',source:'rc-buildings',filter:['==',['get','patterned'],0],paint:{
   'fill-extrusion-color':['get','wall'],'fill-extrusion-height':['get','height'],'fill-extrusion-base':0,'fill-extrusion-opacity':0,'fill-extrusion-vertical-gradient':true
 }},before);

 addLayerSafe({id:'rc-real-pattern',type:'fill-extrusion',source:'rc-buildings',filter:['==',['get','patterned'],1],paint:{
   'fill-extrusion-pattern':['get','pattern_name'],'fill-extrusion-height':['get','height'],'fill-extrusion-base':0,'fill-extrusion-opacity':0,'fill-extrusion-vertical-gradient':false
 }},before);

 addLayerSafe({id:'rc-roofs',type:'fill-extrusion',source:'rc-buildings',paint:{
   'fill-extrusion-color':['get','roof'],'fill-extrusion-height':['get','height'],'fill-extrusion-base':['-', ['get','height'], .22],'fill-extrusion-opacity':0,'fill-extrusion-vertical-gradient':false
 }},before);

 addLayerSafe({id:'rc-storefront-layer',type:'fill-extrusion',source:'rc-storefront',paint:{
   'fill-extrusion-color':['get','color'],'fill-extrusion-height':['get','height'],'fill-extrusion-base':0,'fill-extrusion-opacity':0,'fill-extrusion-vertical-gradient':false
 }},before);

 addLayerSafe({id:'rc-window-layer',type:'fill-extrusion',source:'rc-windows',paint:{
   'fill-extrusion-color':['get','color'],'fill-extrusion-height':['get','height'],'fill-extrusion-base':['get','base'],'fill-extrusion-opacity':0,'fill-extrusion-vertical-gradient':false
 }},before);

 addLayerSafe({id:'rc-accent-layer',type:'fill-extrusion',source:'rc-accents',paint:{
   'fill-extrusion-color':['get','color'],'fill-extrusion-height':['get','height'],'fill-extrusion-base':['get','base'],'fill-extrusion-opacity':0,'fill-extrusion-vertical-gradient':false
 }},before);

 addLayerSafe({id:'rc-balcony-layer',type:'fill-extrusion',source:'rc-balconies',paint:{
   'fill-extrusion-color':['get','color'],'fill-extrusion-height':['get','height'],'fill-extrusion-base':['get','base'],'fill-extrusion-opacity':0,'fill-extrusion-vertical-gradient':false
 }},before);

 addLayerSafe({id:'rc-roofeq-layer',type:'fill-extrusion',source:'rc-roofeq',paint:{
   'fill-extrusion-color':['get','color'],'fill-extrusion-height':['get','height'],'fill-extrusion-base':['get','base'],'fill-extrusion-opacity':0,'fill-extrusion-vertical-gradient':true
 }},before);

 addLayerSafe({id:'rc-tree-shadow',type:'circle',source:'rc-trees',paint:{
   'circle-radius':['interpolate',['linear'],['zoom'],16,3,18,7,19,10],
   'circle-color':'rgba(42,48,34,.22)','circle-blur':.35,'circle-opacity':0
 }},before);

 addLayerSafe({id:'rc-tree-symbol',type:'symbol',source:'rc-trees',layout:{
   'icon-image':'rc-tree','icon-size':['interpolate',['linear'],['zoom'],16,.28,18,.52,19,.68],
   'icon-allow-overlap':true,'icon-ignore-placement':true,'icon-anchor':'bottom','icon-pitch-alignment':'viewport'
 },paint:{'icon-opacity':0}},undefined);

 addLayerSafe({id:'rc-hero-roof-glow',type:'fill-extrusion',source:'rc-hero-highlight',paint:{
   'fill-extrusion-color':'#f4f1e8',
   'fill-extrusion-height':['+', ['get','height'], .16],
   'fill-extrusion-base':['-', ['get','height'], .12],
   'fill-extrusion-opacity':0,
   'fill-extrusion-vertical-gradient':false
 }},before);

 addLayerSafe({id:'rc-hero-ground-glow',type:'line',source:'rc-hero-highlight',paint:{
   'line-color':'#e7eee4','line-width':['interpolate',['linear'],['zoom'],16,2,18,5,20,7],
   'line-blur':['interpolate',['linear'],['zoom'],16,2,18,5,20,7],
   'line-opacity':0
 }},before);

 addLayerSafe({id:'rc-hero-edge',type:'line',source:'rc-hero-highlight',paint:{
   'line-color':'#fffdf8','line-width':['interpolate',['linear'],['zoom'],16,.5,18,1.25,20,1.8],
   'line-opacity':0
 }},before);
}

function installTreeImage(){
 if(map.hasImage('rc-tree'))return;
 const c=document.createElement('canvas');c.width=64;c.height=64;const x=c.getContext('2d');
 x.clearRect(0,0,64,64);
 x.fillStyle='rgba(45,36,25,.78)';x.fillRect(29,39,6,20);
 x.fillStyle='#405c36';x.beginPath();x.arc(32,28,18,0,Math.PI*2);x.fill();
 x.fillStyle='#557449';x.beginPath();x.arc(23,28,11,0,Math.PI*2);x.fill();x.beginPath();x.arc(39,24,12,0,Math.PI*2);x.fill();
 x.fillStyle='rgba(181,203,143,.38)';x.beginPath();x.arc(26,20,7,0,Math.PI*2);x.fill();
 map.addImage('rc-tree',x.getImageData(0,0,64,64),{pixelRatio:2});
}

function dimPoiLayers(layers){
 dimmedLayers=[];
 for(const l of layers){
   if(l.type!=='symbol')continue;
   const id=String(l.id||'').toLowerCase();
   if(/road|street|place|city|town|village|district/.test(id))continue;
   if(!/poi|shop|amenity|transit|station|housenumber|building|restaurant|school|hospital|parking|bus|rail/.test(id))continue;
   try{
     const text=map.getPaintProperty(l.id,'text-opacity'),icon=map.getPaintProperty(l.id,'icon-opacity');
     dimmedLayers.push({id:l.id,text,icon});
     map.setPaintProperty(l.id,'text-opacity',.18);map.setPaintProperty(l.id,'icon-opacity',.12);
   }catch{}
 }
}

function defaultVenueStyle(category='shawarma'){
 const base={shape:'pin',size:42,scale:1,opacity:1,pulse:false,label_visible:false};
 if(category==='shawarma')return {...base,icon:'🥙',background:'#f1c96f',border:'#fff7df',text:'#24190d',glow:'#e8bd59',pulse:true};
 if(category==='doner_kebab')return {...base,icon:'🥙',background:'#d99b58',border:'#fff2df',text:'#25180d',glow:'#d79245'};
 if(category==='bakery')return {...base,icon:'🥐',background:'#c9a676',border:'#f7ead8',text:'#2b2117',glow:'#b88e5e'};
 if(category==='middle_eastern')return {...base,icon:'🍽️',background:'#a88d67',border:'#eee5d6',text:'#241f18',glow:'#9b815f'};
 return {...base,icon:'•',background:'#8f9585',border:'#eef0e8',text:'#182018',glow:'#78846f'};
}
function venueStyle(m){return m?.marker_style&&typeof m.marker_style==='object'?{...defaultVenueStyle(m.category),...m.marker_style}:defaultVenueStyle(m?.category)}
function venueFeature(m){
 const s=venueStyle(m),isSelected=selected&&String(selected.id)===String(m.id);
 return {type:'Feature',id:Number(m.id),properties:{
  id:String(m.id),venue_id:String(m.venue_id||''),name:String(m.name||''),category:String(m.category||'shawarma'),
  icon:String(s.icon||'•'),background:String(s.background||'#8f9585'),border:String(s.border||'#fff'),
  text:String(s.text||'#182018'),glow:String(s.glow||'#78846f'),shape:String(s.shape||'pin'),
  size:Number(s.size)||42,opacity:Number(s.opacity)||1,pulse:s.pulse?1:0,has_avatar:m.has_avatar?1:0,
  selected:isSelected?1:0,verified:(m.verification_status==='manual_verified'||Number(m.verification_score)>=.78)?1:0
 },geometry:{type:'Point',coordinates:[Number(m.lon),Number(m.lat)]}};
}
function venueGeoJSON(){return {type:'FeatureCollection',features:markers.filter(m=>Number.isFinite(Number(m.lon))&&Number.isFinite(Number(m.lat))).map(venueFeature)}}
function syncVenueSource(){if(!venueSourceReady)return;try{map.getSource('rc-venues')?.setData(venueGeoJSON())}catch{}}
function installVenueLayers(styleLayers){
 if(map.getSource('rc-venues')){venueSourceReady=true;return}
 const before=styleLayers.find(l=>l.type==='symbol')?.id;
 map.addSource('rc-venues',{type:'geojson',data:EMPTY,cluster:true,clusterMaxZoom:14,clusterRadius:52});

 addLayerSafe({id:'rc-venue-cluster-halo',type:'circle',source:'rc-venues',filter:['has','point_count'],maxzoom:15,paint:{
  'circle-radius':['step',['get','point_count'],24,25,30,100,38,400,46,1200,56],
  'circle-color':'rgba(247,244,237,.18)','circle-blur':.68,'circle-opacity':.82
 }},before);
 addLayerSafe({id:'rc-venue-cluster',type:'circle',source:'rc-venues',filter:['has','point_count'],maxzoom:15,paint:{
  'circle-radius':['step',['get','point_count'],16,25,20,100,25,400,30,1200,36],
  'circle-color':'#242a24','circle-opacity':.92,'circle-stroke-width':2.5,'circle-stroke-color':'#f8f5ec'
 }},before);
 addLayerSafe({id:'rc-venue-cluster-count',type:'symbol',source:'rc-venues',filter:['has','point_count'],maxzoom:15,layout:{
  'text-field':['get','point_count_abbreviated'],'text-size':['step',['get','point_count'],11,100,12,1000,13],
  'text-font':['Noto Sans Regular']
 },paint:{'text-color':'#fffdf7','text-halo-color':'rgba(0,0,0,.22)','text-halo-width':.5}},before);

 addLayerSafe({id:'rc-venue-point-glow',type:'circle',source:'rc-venues',filter:['!',['has','point_count']],maxzoom:15.25,paint:{
  'circle-radius':['interpolate',['linear'],['zoom'],10,5,13,8,15,13],
  'circle-color':['case',['==',['get','selected'],1],'#fffdf8',['get','glow']],
  'circle-opacity':['case',['==',['get','selected'],1],.34,.14],
  'circle-blur':.68
 }},before);
 addLayerSafe({id:'rc-venue-point',type:'circle',source:'rc-venues',filter:['!',['has','point_count']],maxzoom:15.25,paint:{
  'circle-radius':['interpolate',['linear'],['zoom'],10,3.8,13,6.5,15,10],
  'circle-color':['get','background'],
  'circle-opacity':['get','opacity'],
  'circle-stroke-width':['case',['==',['get','selected'],1],3,1.6],
  'circle-stroke-color':['get','border']
 }},before);
 addLayerSafe({id:'rc-venue-point-icon',type:'symbol',source:'rc-venues',filter:['!',['has','point_count']],minzoom:12.2,maxzoom:15.25,layout:{
  'text-field':['get','icon'],'text-size':['interpolate',['linear'],['zoom'],12.2,8,14,11,15.2,15],
  'text-allow-overlap':true,'text-ignore-placement':true
 },paint:{'text-color':['get','text'],'text-halo-color':'rgba(255,255,255,.10)','text-halo-width':.3}},before);

 map.on('click','rc-venue-cluster',async e=>{
  const f=e.features?.[0];if(!f)return;
  try{const zoom=await map.getSource('rc-venues').getClusterExpansionZoom(f.properties.cluster_id);map.easeTo({center:f.geometry.coordinates,zoom:Math.min(16,zoom),duration:520})}catch{}
 });
 const openFromFeature=e=>{const id=String(e.features?.[0]?.properties?.id||'');const m=markers.find(x=>String(x.id)===id);if(m)focusVenue(m)};
 map.on('click','rc-venue-point',openFromFeature);
 map.on('click','rc-venue-point-icon',openFromFeature);
 ['rc-venue-cluster','rc-venue-point','rc-venue-point-icon'].forEach(id=>{
  map.on('mouseenter',id,()=>map.getCanvas().style.cursor='pointer');
  map.on('mouseleave',id,()=>map.getCanvas().style.cursor='');
 });
 venueSourceReady=true;
}
function markerAvatarUrl(m){return API+'/api/shaurmeg/markers/'+encodeURIComponent(m.id)+'/avatar?v='+encodeURIComponent(String(m.updated_at||m.verification_score||BUILD))}
function makeVenueMarkerElement(m){
 const s=venueStyle(m),el=document.createElement('button');el.type='button';el.className='rcMarker rcMarkerDynamic';el.title=m.name||'Точка';
 const size=Math.max(30,Math.min(68,Number(s.size)||42));
 el.style.width=size+'px';el.style.height=size+'px';el.style.background=s.background;el.style.borderColor=s.border;el.style.color=s.text;el.style.opacity=String(s.opacity??1);
 el.style.borderRadius=s.shape==='circle'?'50%':s.shape==='square'?'8px':s.shape==='rounded'?'15px':'16px 16px 16px 5px';
 el.style.boxShadow='0 9px 24px rgba(0,0,0,.36),0 0 18px '+s.glow+'44';
 if(s.pulse)el.classList.add('pulse');
 if(selected&&String(selected.id)===String(m.id))el.classList.add('selected');
 if(m.has_avatar){
  const img=document.createElement('img');img.src=markerAvatarUrl(m);img.alt='';img.loading='lazy';img.decoding='async';
  img.onerror=()=>{img.remove();el.textContent=s.icon||'•'};el.appendChild(img);
 }else el.textContent=s.icon||'•';
 el.onclick=e=>{e.stopPropagation();focusVenue(m)};
 return el;
}
function renderVisibleVenueMarkers(){
 markerEls.forEach(v=>v.remove());markerEls.clear();
 if(!map||map.getZoom()<15.15)return;
 const b=map.getBounds(),visible=markers.filter(m=>Number(m.lon)>=b.getWest()&&Number(m.lon)<=b.getEast()&&Number(m.lat)>=b.getSouth()&&Number(m.lat)<=b.getNorth());
 if(visible.length>220)return;
 for(const m of visible){
  const el=makeVenueMarkerElement(m);
  const mk=new maplibregl.Marker({element:el,anchor:'bottom'}).setLngLat([Number(m.lon),Number(m.lat)]).addTo(map);
  markerEls.set(String(m.id),mk);
 }
}
function setSelectedMarkerVisual(id){
 syncVenueSource();
 markerEls.forEach((mk,key)=>mk.getElement().classList.toggle('selected',String(key)===String(id)));
}
async function loadMarkers(){
 try{
  const r=await fetch(API+'/api/shaurmeg/map-points?t='+Date.now(),{cache:'no-store'});
  if(!r.ok)throw new Error();
  markers=await r.json();if(!Array.isArray(markers))markers=[];
 }catch{markers=[]}
 syncVenueSource();renderVisibleVenueMarkers();
}
function fitMarkers(){
 if(!map||!markers.length)return;
 const valid=markers.filter(m=>Number.isFinite(Number(m.lon))&&Number.isFinite(Number(m.lat)));if(!valid.length)return;
 if(valid.length===1){map.jumpTo({center:[Number(valid[0].lon),Number(valid[0].lat)],zoom:15.8,pitch:48});return}
 const b=new maplibregl.LngLatBounds();valid.forEach(m=>b.extend([Number(m.lon),Number(m.lat)]));
 map.fitBounds(b,{padding:{top:150,bottom:120,left:35,right:35},maxZoom:11.2,duration:0});
}
function resultIcon(m){
 const s=venueStyle(m);
 if(m.has_avatar)return '<img src="'+markerAvatarUrl(m)+'" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:10px">';
 return esc(s.icon||'•');
}
function search(commit){
 const q=$('#rcSearch').value.trim().toLowerCase(),box=$('#rcResults');
 if(!q){box.classList.remove('show');box.innerHTML='';return}
 const found=markers.filter(m=>[m.name,m.address,m.category].join(' ').toLowerCase().includes(q)).slice(0,12);
 box.innerHTML=found.map((m,i)=>`<button class="rcResult" type="button" data-i="${i}"><i style="overflow:hidden;background:${esc(venueStyle(m).background)}">${resultIcon(m)}</i><span><b>${esc(m.name||'Точка')}</b><small>${esc(m.address||'')}</small></span></button>`).join('')||'<div style="padding:10px;font-size:11px;color:var(--rc-muted)">Ничего не найдено</div>';
 box.classList.add('show');$$('.rcResult',box).forEach((el,i)=>el.onclick=()=>{box.classList.remove('show');focusVenue(found[i])});
 if(commit&&found[0]){box.classList.remove('show');focusVenue(found[0])}
}
function updateVenueCardMarker(m){
 const el=$('#rcPinIcon');if(!el)return;const s=venueStyle(m);
 el.style.background=s.background;el.style.color=s.text;el.style.border='2px solid '+s.border;el.style.overflow='hidden';el.innerHTML='';
 if(m.has_avatar){const img=document.createElement('img');img.src=markerAvatarUrl(m);img.alt='';img.onerror=()=>{img.remove();el.textContent=s.icon||'•'};el.appendChild(img)}else el.textContent=s.icon||'•';
}


function locate(){
 if(!navigator.geolocation){status('Геолокация не поддерживается');setTimeout(()=>status('',false),1600);return}
 status('Определяем ваше место…');
 navigator.geolocation.getCurrentPosition(p=>{status('',false);map.easeTo({center:[p.coords.longitude,p.coords.latitude],zoom:16.5,duration:700})},()=>{status('Не удалось получить геолокацию');setTimeout(()=>status('',false),1800)},{enableHighAccuracy:false,timeout:6500,maximumAge:120000});
}

async function fetchProfile(m){
 const key=String(m.id);
 if(profileCache.has(key)&&Number(profileCache.get(key)?.version)>=7)return profileCache.get(key);
 let last=null;
 for(let attempt=0;attempt<4;attempt++){
   try{
     const r=await fetch(API+'/api/shaurmeg/realcity-profile/'+encodeURIComponent(m.id)+'?v=7&t='+Date.now(),{cache:'no-store'});
     if(r.ok){
       const j=await r.json();last=safeProfile(j.profile);last.quality=j.quality||last.quality;last.status=j.status||'ready';
       if(Number(last.version)>=7&&Array.isArray(last.scene?.buildings)&&last.scene.buildings.length){profileCache.set(key,last);return last}
       if((j.status==='pending'||j.status==='processing')&&Number(j.profile?.version||0)<7)return last
     }
   }catch{}
   if(attempt<3)await new Promise(r=>setTimeout(r,700+attempt*400));
 }
 return last||safeProfile(DEFAULT_PROFILE);
}

function canvasImageData(c){return c.getContext('2d').getImageData(0,0,c.width,c.height)}
function addOrReplaceImage(name,data,pixelRatio=1){
 try{if(map.hasImage(name))map.removeImage(name)}catch{}
 try{map.addImage(name,data,{pixelRatio})}catch{}
}
function makeFacadePattern(name,palette,facade,variant=0,style='panel_simple'){
 const c=document.createElement('canvas');c.width=64;c.height=128;const x=c.getContext('2d');
 const wall=palette.wall||'#d3d1cc',accent=palette.accent||'#8a7463',win=palette.windows||'#29343d';
 x.fillStyle=wall;x.fillRect(0,0,64,128);

 if(String(style).includes('brick')||facade.material==='brick'){
   x.strokeStyle=alpha(shade(wall,-30),.33);x.lineWidth=1;
   for(let y=8;y<128;y+=8){x.beginPath();x.moveTo(0,y+.5);x.lineTo(64,y+.5);x.stroke();const shift=((y/8)%2)*8;for(let xx=-shift;xx<64;xx+=16){x.beginPath();x.moveTo(xx+.5,y-8);x.lineTo(xx+.5,y);x.stroke()}}
 }else{
   x.strokeStyle=alpha(shade(wall,-28),facade.panel_grid?.24:.12);x.lineWidth=.75;
   for(let y=0;y<128;y+=32){x.beginPath();x.moveTo(0,y+.5);x.lineTo(64,y+.5);x.stroke()}
   for(let xx=0;xx<64;xx+=16){x.beginPath();x.moveTo(xx+.5,0);x.lineTo(xx+.5,128);x.stroke()}
 }

 if(facade.vertical_bands){
   const bandX=(variant*13)%48;
   x.fillStyle=alpha(accent,.82);x.fillRect(bandX,0,7,128);
   x.fillStyle=alpha(shade(accent,18),.26);x.fillRect(bandX+1,0,1,128);
 }

 const cols=2,rows=4;
 for(let r=0;r<rows;r++){
   for(let col=0;col<cols;col++){
     const ox=8+col*30+((variant%2)*2),oy=10+r*29;
     x.fillStyle=alpha(shade(wall,-28),.38);x.fillRect(ox-2,oy-2,18,16);
     x.fillStyle=win;x.fillRect(ox,oy,14,12);
     x.fillStyle='rgba(170,198,214,.18)';x.fillRect(ox+1,oy+1,5,2);
     x.fillStyle='rgba(255,255,255,.14)';x.fillRect(ox+1,oy+1,1,10);
   }
   if(facade.balconies&&((r+1)%Math.max(1,facade.balcony_every||2)===0)){
     const y=24+r*29;x.fillStyle=alpha(shade(wall,-24),.90);x.fillRect(4,y,56,3);
     x.strokeStyle='rgba(56,61,62,.42)';x.lineWidth=1;x.strokeRect(6,y-5,52,5);
   }
 }
 addOrReplaceImage(name,canvasImageData(c),1);
 return name;
}
async function addPhotoPattern(name,dataUrl){
 if(!dataUrl)return false;
 return new Promise(resolve=>{
   const img=new Image();
   img.onload=()=>{
     try{
       const c=document.createElement('canvas');c.width=128;c.height=256;const x=c.getContext('2d');x.drawImage(img,0,0,128,256);
       const glaze=x.createLinearGradient(0,0,128,0);glaze.addColorStop(0,'rgba(255,255,255,.03)');glaze.addColorStop(.55,'rgba(255,255,255,0)');glaze.addColorStop(1,'rgba(0,0,0,.05)');x.fillStyle=glaze;x.fillRect(0,0,128,256);
       addOrReplaceImage(name,canvasImageData(c),1);resolve(true);
     }catch{resolve(false)}
   };
   img.onerror=()=>resolve(false);img.src=dataUrl;
 });
}
async function installPatterns(profile){
 const p=safeProfile(profile),names=['rcp-hero','rcp-near-1','rcp-near-2','rcp-near-3','rcp-near-4'];
 let hero='rcp-hero';
 if(p.texture?.hero_data_url){
   const ok=await addPhotoPattern('rcp-hero-photo',p.texture.hero_data_url);
   if(ok)hero='rcp-hero-photo';
 }
 makeFacadePattern('rcp-hero',p.palette,p.facade,0,p.building_style);
 const sw=p.neighborhood_palette||[];
 for(let i=1;i<=4;i++){
   const wall=sw[(i-1)%Math.max(1,sw.length)]||shade(p.palette.wall,(i-2)*7);
   const pal={...p.palette,wall,accent:sw[(i+2)%Math.max(1,sw.length)]||p.palette.accent,roof:shade(p.palette.roof,(i-2)*5)};
   makeFacadePattern('rcp-near-'+i,pal,{...p.facade,balconies:i%2===0?p.facade.balconies:false,vertical_bands:i%3!==0},i,p.building_style);
 }
 return {hero,names};
}

function local(lon,lat,oLon,oLat){const k=Math.cos(oLat*Math.PI/180);return[(lon-oLon)*111320*k,(lat-oLat)*110540]}
function fromLocal(x,y,oLon,oLat){const k=Math.cos(oLat*Math.PI/180);return[oLon+x/(111320*k),oLat+y/110540]}
function centroid(r){let x=0,y=0,n=0;for(const p of r){x+=p[0];y+=p[1];n++}return n?[x/n,y/n]:[0,0]}
function edgeRect(a,b,depth,oLon,oLat,start,end){
 const A=local(a[0],a[1],oLon,oLat),B=local(b[0],b[1],oLon,oLat),dx=B[0]-A[0],dy=B[1]-A[1],len=Math.hypot(dx,dy);if(len<.8)return null;
 const nx=-dy/len,ny=dx/len,p0=[A[0]+dx*start,A[1]+dy*start],p1=[A[0]+dx*end,A[1]+dy*end],d=depth/2;
 return [[p0[0]+nx*d,p0[1]+ny*d],[p1[0]+nx*d,p1[1]+ny*d],[p1[0]-nx*d,p1[1]-ny*d],[p0[0]-nx*d,p0[1]-ny*d],[p0[0]+nx*d,p0[1]+ny*d]].map(v=>fromLocal(v[0],v[1],oLon,oLat));
}
function rectAround(center,w,h,oLon,oLat,shiftX=0,shiftY=0){
 const C=local(center[0],center[1],oLon,oLat),x=C[0]+shiftX,y=C[1]+shiftY;
 return [[x-w/2,y-h/2],[x+w/2,y-h/2],[x+w/2,y+h/2],[x-w/2,y+h/2],[x-w/2,y-h/2]].map(v=>fromLocal(v[0],v[1],oLon,oLat));
}

function ringsFromFeature(f){
 const g=f?.geometry;if(!g)return[];
 if(g.type==='Polygon')return g.coordinates?.[0]?[g.coordinates[0]]:[];
 if(g.type==='MultiPolygon')return (g.coordinates||[]).map(p=>p?.[0]).filter(Boolean);
 return[];
}
function featureHeight(props,id){
 const h=Number(props?.render_height??props?.height),lv=Number(props?.levels??props?.['building:levels']);
 if(Number.isFinite(h)&&h>2)return clamp(h,3,150);
 if(Number.isFinite(lv)&&lv>0)return clamp(lv*3.05,3,150);
 let n=0;for(const ch of String(id))n=(n*31+ch.charCodeAt(0))>>>0;return 9+(n%7)*3.05;
}
function approxDistance(a,b,lat){const k=Math.cos(lat*Math.PI/180);return Math.hypot((a[0]-b[0])*111320*k,(a[1]-b[1])*110540)}
function sceneFromVisibleMap(profile,m){
 if(!buildingLayers.length)return null;
 let raw=[];try{raw=map.queryRenderedFeatures(undefined,{layers:buildingLayers})||[]}catch{return null}
 const center=[Number(m.lon),Number(m.lat)],seen=new Set(),items=[];
 for(const f of raw){
   const props=f.properties||{};
   for(const ring0 of ringsFromFeature(f)){
     const ring=ring0.map(v=>[Number(v[0]),Number(v[1])]).filter(v=>Number.isFinite(v[0])&&Number.isFinite(v[1]));if(ring.length<4)continue;
     const first=ring[0],last=ring[ring.length-1];if(first[0]!==last[0]||first[1]!==last[1])ring.push([...first]);
     const cc=centroid(ring),sig=(f.id!=null?String(f.id):cc[0].toFixed(5)+','+cc[1].toFixed(5));if(seen.has(sig))continue;seen.add(sig);
     const d=approxDistance(cc,center,center[1]);if(d>220)continue;
     const h=featureHeight(props,sig),lv=clamp(Math.round(Number(props.levels)||h/3.05),1,35);
     items.push({sig,ring,d,h,lv});
   }
 }
 if(!items.length)return null;
 items.sort((a,b)=>a.d-b.d);
 const p=safeProfile(profile),sw=p.neighborhood_palette||[],buildings=items.slice(0,70).map((b,i)=>({
   id:'tile-'+b.sig,ring:b.ring,height:b.h,levels:b.lv,distance:b.d,
   role:i===0?'hero':i<10?'nearby':'background',style:i===0?p.building_style:'mixed_residential',pattern:i===0?0:1+(i%4),
   palette:{wall:i===0?p.palette.wall:(sw[i%Math.max(1,sw.length)]||p.palette.wall),accent:p.palette.accent,windows:p.palette.windows,storefront:p.palette.storefront,roof:p.palette.roof}
 }));
 return {...p,scene:{...(p.scene||{}),buildings,hero_building_id:buildings[0]?.id||null}};
}

function buildSceneGeo(profile,m,patternSet){
 const p=safeProfile(profile),scene=p.scene||{},blds=Array.isArray(scene.buildings)?scene.buildings:[],oLon=Number(m.lon),oLat=Number(m.lat);
 const bFeatures=[],store=[],windows=[],accents=[],balconies=[],roofeq=[];
 const markerPoint=[oLon,oLat];

 function edgeLength(a,b){const A=local(a[0],a[1],oLon,oLat),B=local(b[0],b[1],oLon,oLat);return Math.hypot(B[0]-A[0],B[1]-A[1])}
 function edgeDistance(a,b){
   const A=local(a[0],a[1],oLon,oLat),B=local(b[0],b[1],oLon,oLat),P=[0,0],vx=B[0]-A[0],vy=B[1]-A[1],wx=P[0]-A[0],wy=P[1]-A[1],d=vx*vx+vy*vy,t=d?clamp((wx*vx+wy*vy)/d,0,1):0;
   return Math.hypot(P[0]-(A[0]+vx*t),P[1]-(A[1]+vy*t));
 }

 for(let i=0;i<blds.length;i++){
   const b=blds[i],ring=Array.isArray(b.ring)?b.ring:[];if(ring.length<4)continue;
   const role=b.role||'background',patterned=role==='hero'||role==='nearby'?1:0;
   const patternName=role==='hero'?patternSet.hero:'rcp-near-'+(1+(Number(b.pattern||i)%4));
   const wall=b.palette?.wall||p.palette.wall,win=b.palette?.windows||p.palette.windows,accent=b.palette?.accent||p.palette.accent,storeColor=b.palette?.storefront||p.palette.storefront;
   bFeatures.push({type:'Feature',properties:{
     id:b.id,height:Number(b.height)||9,role,patterned,pattern_name:patternName,wall,roof:b.palette?.roof||p.palette.roof
   },geometry:{type:'Polygon',coordinates:[ring]}});

   if(role==='hero'){
     const edges=Array.from({length:ring.length-1},(_,e)=>({e,d:edgeDistance(ring[e],ring[e+1]),len:edgeLength(ring[e],ring[e+1])})).filter(x=>x.len>4).sort((a,b)=>a.d-b.d);
     const frontEdges=edges.slice(0,Math.min(2,edges.length));

     if(p.facade.storefront){
       const storeH=Math.min(Number(p.facade.storefront_height_m)||3.35,Number(b.height)||3.35);
       for(const ed of frontEdges){
         const rr=edgeRect(ring[ed.e],ring[ed.e+1],.78,oLon,oLat,.025,.975);if(!rr)continue;
         store.push({type:'Feature',properties:{color:storeColor,height:storeH},geometry:{type:'Polygon',coordinates:[rr]}});
       }
     }

     const floors=Math.min(Number(b.levels)||p.facade.levels||10,20);
     const baseFloor=p.facade.storefront?1:0;
     for(let fl=baseFloor;fl<floors;fl++){
       const z=fl*3.05+1.02,top=Math.min(z+1.34,(Number(b.height)||z+1.34)-.12);if(top<=z)continue;
       for(const ed of edges){
         const count=clamp(Math.floor(ed.len/4.6),1,9),seg=1/count;
         for(let w=0;w<count;w++){
           const s=w*seg+seg*.24,t=(w+1)*seg-seg*.24,rr=edgeRect(ring[ed.e],ring[ed.e+1],.30,oLon,oLat,s,t);if(!rr)continue;
           windows.push({type:'Feature',properties:{base:z,height:top,color:win},geometry:{type:'Polygon',coordinates:[rr]}});
         }
       }
     }

     if(p.facade.vertical_bands){
       const bandEdges=edges.filter((_,idx)=>idx%Math.max(1,Number(p.facade.vertical_band_every)||3)===0).slice(0,6);
       for(const ed of bandEdges){
         const rr=edgeRect(ring[ed.e],ring[ed.e+1],.34,oLon,oLat,.04,.105);if(!rr)continue;
         accents.push({type:'Feature',properties:{base:.2,height:Math.max(3,(Number(b.height)||9)-.28),color:accent},geometry:{type:'Polygon',coordinates:[rr]}});
       }
     }

     if(p.facade.balconies){
       const every=Math.max(1,Number(p.facade.balcony_every)||2);
       const balconyEdges=edges.filter(x=>x.len>7).slice(0,Math.min(6,edges.length));
       for(let fl=2;fl<floors;fl+=every){
         const z=fl*3.05+.32;
         for(const ed of balconyEdges){
           const rr=edgeRect(ring[ed.e],ring[ed.e+1],Number(p.facade.balcony_depth_m)||.8,oLon,oLat,.12,.88);if(!rr)continue;
           balconies.push({type:'Feature',properties:{base:z,height:z+.18,color:shade(wall,-18)},geometry:{type:'Polygon',coordinates:[rr]}});
         }
       }
     }
   }else if(role==='nearby'&&i<6){
     const storeH=2.8;
     const edges=Array.from({length:ring.length-1},(_,e)=>({e,d:edgeDistance(ring[e],ring[e+1]),len:edgeLength(ring[e],ring[e+1])})).filter(x=>x.len>5).sort((a,b)=>a.d-b.d);
     if(edges[0]){
       const rr=edgeRect(ring[edges[0].e],ring[edges[0].e+1],.52,oLon,oLat,.04,.96);
       if(rr)store.push({type:'Feature',properties:{color:storeColor,height:Math.min(storeH,Number(b.height)||storeH)},geometry:{type:'Polygon',coordinates:[rr]}});
     }
   }

   if((role==='hero'||(role==='nearby'&&i<5))&&p.facade.roof_equipment){
     const cc=centroid(ring),base=Number(b.height)||9,count=role==='hero'?3:1;
     for(let q=0;q<count;q++){
       const rr=rectAround(cc,role==='hero'?4.6:3.2,role==='hero'?3.0:2.4,oLon,oLat,(q-1)*4.8,(q%2)*2.2);
       roofeq.push({type:'Feature',properties:{base,height:base+(role==='hero'?1.5:1.0),color:shade(b.palette?.roof||p.palette.roof,-8)},geometry:{type:'Polygon',coordinates:[rr]}});
     }
   }
 }

 const treeFeatures=(Array.isArray(scene.trees)?scene.trees:[]).slice(0,75).map((t,i)=>({type:'Feature',properties:{source:t.source||'auto',size:.85+(i%5)*.06},geometry:{type:'Point',coordinates:[Number(t.lon),Number(t.lat)]}}));
 return {
   buildings:{type:'FeatureCollection',features:bFeatures},
   storefront:{type:'FeatureCollection',features:store},
   windows:{type:'FeatureCollection',features:windows},
   accents:{type:'FeatureCollection',features:accents},
   balconies:{type:'FeatureCollection',features:balconies},
   roofeq:{type:'FeatureCollection',features:roofeq},
   trees:{type:'FeatureCollection',features:treeFeatures}
 };
}
function setFocusPoint(m){
 const lon=Number(m?.lon),lat=Number(m?.lat);
 map.getSource('rc-focus')?.setData(Number.isFinite(lon)&&Number.isFinite(lat)?{type:'FeatureCollection',features:[{type:'Feature',properties:{},geometry:{type:'Point',coordinates:[lon,lat]}}]}:EMPTY);
}
function buildFocusRoads(m){
 if(!roadLayers.length)return EMPTY;
 try{
   const point=map.project([Number(m.lon),Number(m.lat)]),pad=190;
   const features=map.queryRenderedFeatures([[point.x-pad,point.y-pad],[point.x+pad,point.y+pad]],{layers:roadLayers})||[];
   const out=[],seen=new Set();
   for(const f of features){
     if(!f?.geometry||!['LineString','MultiLineString'].includes(f.geometry.type))continue;
     const coords=f.geometry.coordinates,first=f.geometry.type==='LineString'?coords?.[0]:coords?.[0]?.[0];
     if(!first)continue;
     const key=(f.id??'')+':'+Number(first[0]).toFixed(5)+':'+Number(first[1]).toFixed(5);
     if(seen.has(key))continue;seen.add(key);
     out.push({type:'Feature',properties:{},geometry:f.geometry});
     if(out.length>=34)break;
   }
   return {type:'FeatureCollection',features:out};
 }catch{return EMPTY}
}
function setHeroHighlight(buildings){
 const hero=buildings?.features?.find(f=>f?.properties?.role==='hero');
 map.getSource('rc-hero-highlight')?.setData(hero?{type:'FeatureCollection',features:[{type:'Feature',properties:{height:Number(hero.properties.height)||9},geometry:hero.geometry}]}:EMPTY);
}
function setFocusGlowOpacity(v){
 const d=clamp(v,0,1);
 try{
   map.setPaintProperty('rc-focus-aura','circle-opacity',.19*d);
   map.setPaintProperty('rc-focus-core','circle-opacity',.34*d);
   map.setPaintProperty('rc-focus-roads-glow','line-opacity',.22*d);
   map.setPaintProperty('rc-focus-roads-line','line-opacity',.78*d);
   map.setPaintProperty('rc-hero-roof-glow','fill-extrusion-opacity',.16*d);
   map.setPaintProperty('rc-hero-ground-glow','line-opacity',.42*d);
   map.setPaintProperty('rc-hero-edge','line-opacity',.68*d);
 }catch{}
}
function animateFocusGlow(token){
 const reduce=matchMedia('(prefers-reduced-motion: reduce)').matches,start=performance.now(),dur=reduce?1:2100;
 function frame(now){
   if(token!==sceneToken)return;
   const t=Math.min(1,(now-start)/dur),settle=.82,breath=.84+.16*Math.sin(t*Math.PI*3.2);
   setFocusGlowOpacity(t<.55?(1-Math.pow(1-t/.55,3)):settle*breath);
   if(t<1)requestAnimationFrame(frame);else setFocusGlowOpacity(.78);
 }
 requestAnimationFrame(frame);
}

function setBuiltinOpacity(v){for(const id of builtin3d){try{map.setPaintProperty(id,'fill-extrusion-opacity',v)}catch{}}}
function setSceneOpacity(v){
 const d=Math.max(0,Math.min(1,v));
 try{
   map.setPaintProperty('rc-real-color','fill-extrusion-opacity',.96*d);
   map.setPaintProperty('rc-real-pattern','fill-extrusion-opacity',.99*d);
   map.setPaintProperty('rc-roofs','fill-extrusion-opacity',.98*d);
   map.setPaintProperty('rc-storefront-layer','fill-extrusion-opacity',.98*Math.max(0,(d-.08)/.92));
   map.setPaintProperty('rc-window-layer','fill-extrusion-opacity',.99*Math.max(0,(d-.10)/.90));
   map.setPaintProperty('rc-accent-layer','fill-extrusion-opacity',.96*Math.max(0,(d-.14)/.86));
   map.setPaintProperty('rc-balcony-layer','fill-extrusion-opacity',.98*Math.max(0,(d-.18)/.82));
   map.setPaintProperty('rc-roofeq-layer','fill-extrusion-opacity',.96*Math.max(0,(d-.12)/.88));
   map.setPaintProperty('rc-tree-shadow','circle-opacity',.42*Math.max(0,(d-.28)/.72));
   map.setPaintProperty('rc-tree-symbol','icon-opacity',.98*Math.max(0,(d-.30)/.70));
 }catch{}
}
function clearScene(){
 for(const id of ['rc-buildings','rc-storefront','rc-windows','rc-accents','rc-balconies','rc-roofeq','rc-trees','rc-focus','rc-focus-roads','rc-hero-highlight'])map.getSource(id)?.setData(EMPTY);
 setFocusGlowOpacity(0);
 try{map.setPaintProperty('rc-gold','fill-extrusion-opacity',0)}catch{}
 setSceneOpacity(0);setBuiltinOpacity(.84);
 for(const id of builtin3d){try{map.setPaintProperty(id,'fill-extrusion-color',GOLD)}catch{}}
 try{map.setLight({anchor:'viewport',color:'#f1ead9',intensity:.34,position:[1.15,165,38]})}catch{}
}
function animateMorph(){
 const reduce=matchMedia('(prefers-reduced-motion: reduce)').matches,start=performance.now(),dur=reduce?1:1280;
 function frame(now){
   const t=Math.min(1,(now-start)/dur),e=1-Math.pow(1-t,3);
   try{map.setPaintProperty('rc-gold','fill-extrusion-opacity',.98*(1-e))}catch{}
   setBuiltinOpacity(.84*(1-e)+.02);
   setSceneOpacity(e);
   if(t<1)requestAnimationFrame(frame);
 }
 requestAnimationFrame(frame);
}
function waitForIdle(timeout=1200){return new Promise(resolve=>{let done=false;const f=()=>{if(done)return;done=true;clearTimeout(timer);try{map.off('idle',f)}catch{};resolve()};const timer=setTimeout(f,timeout);map.once('idle',f)})}

async function focusVenue(m,replay=false){
 if(!m||!map)return;selected=m;sceneToken++;const token=sceneToken;
 setSelectedMarkerVisual(m.id);updateVenueCardMarker(m);
 $('#rcVenueName').textContent=m.name||'Точка';$('#rcVenueAddress').textContent=m.address||'Москва';$('#rcVenueCard').classList.add('show');$('#rcResults').classList.remove('show');$('#rcLive').textContent='REAL CITY';
 $('#rcMenu').textContent=m.has_menu===false?'Подробнее':'Открыть меню';
 clearScene();
 setFocusPoint(m);
 status('Анализируем фото и собираем фасады…');

 const profilePromise=fetchProfile(m);
 const initial=profileCache.get(String(m.id))||safeProfile(DEFAULT_PROFILE),cam=initial.camera;
 map.easeTo({center:[Number(m.lon),Number(m.lat)],zoom:Number(cam.zoom)||18.35,pitch:Number(cam.pitch)||61,bearing:Number(cam.bearing)||-20,offset:[0,60],duration:replay?620:980,easing:t=>1-Math.pow(1-t,3)});

 const [,profile]=await Promise.all([waitForIdle(replay?760:1220),profilePromise]);if(token!==sceneToken)return;
 const p=safeProfile(profile);
 const patterns=await installPatterns(p);if(token!==sceneToken)return;
 const geo=buildSceneGeo(p,m,patterns);

 let readyGeo=geo;
 if(!readyGeo.buildings.features.length){
   const fallback=sceneFromVisibleMap(p,m);
   if(fallback)readyGeo=buildSceneGeo(fallback,m,patterns);
 }
 if(!readyGeo.buildings.features.length){
   status('Не удалось получить геометрию домов — оставили базовую карту');
   setBuiltinOpacity(.84);setTimeout(()=>{if(token===sceneToken)status('',false)},1800);return;
 }
 map.getSource('rc-buildings').setData(readyGeo.buildings);
 map.getSource('rc-storefront').setData(readyGeo.storefront);
 map.getSource('rc-windows').setData(readyGeo.windows);
 map.getSource('rc-accents').setData(readyGeo.accents);
 map.getSource('rc-balconies').setData(readyGeo.balconies);
 map.getSource('rc-roofeq').setData(readyGeo.roofeq);
 map.getSource('rc-trees').setData(readyGeo.trees);
 map.getSource('rc-focus-roads').setData(buildFocusRoads(m));
 setHeroHighlight(readyGeo.buildings);

 try{
   map.setPaintProperty('rc-gold','fill-extrusion-opacity',.98);
   map.setLight({anchor:'viewport',color:shade(p.palette.wall,52),intensity:.55,position:[1.1,150,42]});
 }catch{}
 setSceneOpacity(0);setBuiltinOpacity(.10);

 requestAnimationFrame(()=>requestAnimationFrame(()=>{animateMorph();animateFocusGlow(token)}));
 $('#rcLive').textContent='REAL CITY · '+qualityLabel(p.quality);
 const src=p.texture?.source==='hero_reference'?'по фото фасада':p.quality==='street'?'по уличным снимкам':p.quality==='osm'?'по геометрии зданий':'по фотопрофилю';
 status('Квартал восстановлен '+src);
 setTimeout(()=>{if(token===sceneToken)status('',false)},1900);
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