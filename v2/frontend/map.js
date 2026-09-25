(() => {
  const {api,esc}=SHAURMEG,tg=SHAURMEG.telegram;
  const $=s=>document.querySelector(s);
  let map,points=[],selected=null,markers=new Map(),buildingLayers=[],fallback=false;
  const STYLE='https://tiles.openfreemap.org/styles/liberty';
  const FALLBACK={version:8,sources:{osm:{type:'raster',tiles:['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],tileSize:256,maxzoom:19,attribution:'© OpenStreetMap contributors'}},layers:[{id:'osm',type:'raster',source:'osm',paint:{'raster-saturation':-.22,'raster-contrast':.08,'raster-brightness-min':.08,'raster-brightness-max':.78}}]};
  function toast(v){$('#toast').textContent=v;$('#toast').classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(()=>$('#toast').classList.remove('show'),1500)}
  function styleBuildings(){
    const layers=map.getStyle()?.layers||[];
    buildingLayers=layers.filter(x=>x.type==='fill-extrusion'||(/building/i.test(x.id)&&x.type==='fill')).map(x=>x.id);
    for(const l of layers){
      try{
        if(l.type==='background')map.setPaintProperty(l.id,'background-color','#1b231d');
        if(l.type==='fill'&&/land|park|grass|wood|vegetation|residential/i.test(l.id))map.setPaintProperty(l.id,'fill-saturation',-.15);
      }catch{}
    }
  }
  function addFocusLayers(){
    if(map.getSource('focus-building'))return;
    map.addSource('focus-building',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
    map.addLayer({id:'focus-building-extrude',type:'fill-extrusion',source:'focus-building',paint:{
      'fill-extrusion-color':['coalesce',['get','wall'],'#a59c88'],
      'fill-extrusion-height':['coalesce',['get','height'],18],
      'fill-extrusion-base':0,'fill-extrusion-opacity':.94
    }});
    map.addLayer({id:'focus-building-edge',type:'line',source:'focus-building',paint:{'line-color':'#e7f5e9','line-width':1.2,'line-opacity':.65}});
  }
  function nearestBuilding(p,profile){
    if(fallback||!buildingLayers.length)return;
    let fs=[];try{const px=map.project([+p.lon,+p.lat]),pad=28;fs=map.queryRenderedFeatures([[px.x-pad,px.y-pad],[px.x+pad,px.y+pad]],{layers:buildingLayers})||[]}catch{}
    const polys=fs.filter(f=>['Polygon','MultiPolygon'].includes(f.geometry?.type));if(!polys.length){map.getSource('focus-building')?.setData({type:'FeatureCollection',features:[]});return}
    const center=[+p.lon,+p.lat],centroid=g=>{
      const ring=g.type==='Polygon'?g.coordinates?.[0]:g.coordinates?.[0]?.[0];if(!ring?.length)return center;
      return ring.reduce((a,x)=>[a[0]+x[0]/ring.length,a[1]+x[1]/ring.length],[0,0]);
    };
    polys.sort((a,b)=>{const A=centroid(a.geometry),B=centroid(b.geometry);return Math.hypot(A[0]-center[0],A[1]-center[1])-Math.hypot(B[0]-center[0],B[1]-center[1])});
    const f=polys[0],pal=profile?.palette||{},props=f.properties||{},h=Number(props.render_height??props.height)||(Number(props.levels||props['building:levels'])||6)*3.05;
    map.getSource('focus-building')?.setData({type:'FeatureCollection',features:[{type:'Feature',properties:{wall:pal.wall||pal.facade||'#a59c88',height:Math.max(4,Math.min(h,130))},geometry:f.geometry}]});
  }
  function createMap(style){
    return new maplibregl.Map({container:'map',style,center:[37.6176,55.7558],zoom:10.3,pitch:42,bearing:-12,maxPitch:72,attributionControl:false,renderWorldCopies:false,fadeDuration:140});
  }
  function waitLoad(m,ms=6000){return new Promise((resolve,reject)=>{let done=false;const t=setTimeout(()=>end(new Error('map_timeout')),ms);function end(e){if(done)return;done=true;clearTimeout(t);e?reject(e):resolve()}m.once('load',()=>end());m.once('error',e=>{if(!m.loaded())console.warn('map',e?.error||e)})})}
  async function bootMap(){
    try{map=createMap(STYLE);await waitLoad(map,6200)}
    catch(e){try{map?.remove()}catch{};$('#map').innerHTML='';fallback=true;map=createMap(FALLBACK);await waitLoad(map,7000)}
    map.addControl(new maplibregl.NavigationControl({showCompass:false}),'bottom-right');
    styleBuildings();addFocusLayers();map.on('click',e=>{if(e.originalEvent.target.closest?.('.mapMarker'))return;closeCard()});
    await loadPoints();
  }
  function markerNode(p){
    const s=p.marker_style||{},el=document.createElement('button');el.className='mapMarker';el.type='button';el.style.background=s.background||'#10221b';el.style.borderColor=s.border||'#f6f3e9';el.style.opacity=s.opacity??1;el.style.transform='translate(-50%,-50%) scale('+(s.scale||1)+')';
    if(p.has_avatar){const img=new Image();img.alt='';img.src=api+'/map/markers/'+p.id+'/avatar';img.onerror=()=>{img.remove();el.insertAdjacentText('afterbegin',s.icon||'🥙')};el.appendChild(img)}else el.textContent=s.icon||'🥙';
    if(s.label_visible){const l=document.createElement('span');l.className='markerLabel';l.textContent=p.name;el.appendChild(l)}
    el.onclick=e=>{e.stopPropagation();selectPoint(p)};
    return el;
  }
  async function loadPoints(){
    const r=await fetch(api+'/map/points',{cache:'no-store'});if(!r.ok)throw new Error('points_'+r.status);points=await r.json();
    for(const m of markers.values())m.remove();markers.clear();
    points.forEach(p=>{const el=markerNode(p),m=new maplibregl.Marker({element:el,anchor:'center'}).setLngLat([+p.lon,+p.lat]).addTo(map);markers.set(String(p.id),m)});
    if(points.length)fitAll();
    const url=new URL(location.href),direct=url.searchParams.get('marker');if(direct){const p=points.find(x=>String(x.id)===direct);if(p)setTimeout(()=>selectPoint(p),350)}
    $('#boot').classList.add('out');setTimeout(()=>$('#boot').remove(),650);
  }
  function fitAll(){if(!points.length)return;const b=new maplibregl.LngLatBounds();points.forEach(x=>b.extend([+x.lon,+x.lat]));map.fitBounds(b,{padding:{top:130,bottom:160,left:40,right:40},maxZoom:13,duration:700})}
  function selectPoint(p){
    selected=p;markers.forEach((m,k)=>m.getElement().classList.toggle('selected',k===String(p.id)));
    $('#venueName').textContent=p.name||'Заведение';$('#venueAddress').textContent=p.address||'';
    $('#realBadge').textContent=p.realcity_quality&&p.realcity_quality!=='heuristic'?'REAL CITY · '+String(p.realcity_quality).toUpperCase():'REAL CITY';
    const a=$('#venueAvatar');a.innerHTML=p.has_avatar?'<img alt="" src="'+api+'/map/markers/'+encodeURIComponent(p.id)+'/avatar">':esc(p.marker_style?.icon||'🥙');
    $('#venueCard').classList.add('show');
    map.easeTo({center:[+p.lon,+p.lat],zoom:17.7,pitch:fallback?0:58,bearing:fallback?0:-18,offset:[0,80],duration:850,easing:t=>1-Math.pow(1-t,3)});
    setTimeout(()=>nearestBuilding(p,p.realcity_profile||{}),950);
    tg?.HapticFeedback?.selectionChanged?.();
  }
  function closeCard(){selected=null;$('#venueCard').classList.remove('show');markers.forEach(m=>m.getElement().classList.remove('selected'));map.getSource('focus-building')?.setData({type:'FeatureCollection',features:[]})}
  function search(){
    const q=$('#search').value.trim().toLowerCase(),box=$('#results');if(!q){box.classList.add('hidden');return}
    const list=points.filter(x=>(x.name+' '+x.address).toLowerCase().includes(q)).slice(0,8);box.innerHTML=list.length?list.map(x=>'<button class="searchResult" data-id="'+x.id+'"><b>'+esc(x.name)+'</b><small>'+esc(x.address||'')+'</small></button>').join(''):'<div class="empty">Ничего не найдено</div>';box.classList.remove('hidden');
  }
  $('#searchToggle').onclick=()=>{$('#searchBox').classList.toggle('hidden');if(!$('#searchBox').classList.contains('hidden'))setTimeout(()=>$('#search').focus(),60);else $('#results').classList.add('hidden')};
  $('#search').oninput=search;$('#results').onclick=e=>{const b=e.target.closest('[data-id]');if(!b)return;const p=points.find(x=>String(x.id)===b.dataset.id);if(p){selectPoint(p);$('#results').classList.add('hidden')}};
  $('#locate').onclick=()=>{if(!navigator.geolocation)return toast('Геопозиция недоступна');navigator.geolocation.getCurrentPosition(p=>map.easeTo({center:[p.coords.longitude,p.coords.latitude],zoom:15.5,duration:800}),()=>toast('Не удалось получить геопозицию'),{enableHighAccuracy:true,timeout:8000})};
  $('#home').onclick=()=>{closeCard();fitAll()};$('#closeCard').onclick=closeCard;
  $('#openMenu').onclick=()=>{if(!selected)return;const u=new URL('menu.html',location.href);u.searchParams.set('marker',selected.id);u.searchParams.set('establishment',selected.establishment_id);u.searchParams.set('from','map');u.hash=location.hash;location.assign(u.toString())};
  try{tg?.ready();tg?.expand();tg?.BackButton?.hide?.();tg?.setHeaderColor?.('#0b0f12');tg?.setBackgroundColor?.('#0b0f12')}catch{}
  bootMap().catch(e=>{console.error(e);toast('Карта не загрузилась');$('#boot').classList.add('out')});
})();