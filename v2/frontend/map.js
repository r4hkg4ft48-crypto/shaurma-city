(() => {
  const {api,esc,money}=SHAURMEG,tg=SHAURMEG.telegram;
  const $=s=>document.querySelector(s);
  const qs=new URLSearchParams(location.search);
  let map,points=[],selected=null,markers=new Map(),buildingLayers=[],fallback=false,userMarker=null,focusToken=0;
  let session=sessionStorage.getItem('shaurmeg_client_session')||'',dashboard=null,userOrders=[],orderFilter='all',userStream=null,currentReferralUrl='';
  const reduceMotion=window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches===true;
  const bootStarted=performance.now();
  const STYLE='https://tiles.openfreemap.org/styles/liberty';
  const FALLBACK={version:8,sources:{osm:{type:'raster',tiles:['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],tileSize:256,maxzoom:19,attribution:'© OpenStreetMap contributors'}},layers:[{id:'osm',type:'raster',source:'osm',paint:{'raster-saturation':-.22,'raster-contrast':.08,'raster-brightness-min':.08,'raster-brightness-max':.78}}]};
  const STATUS={new:'Принят',cooking:'Готовится',ready:'Готов',done:'Завершён',cancelled:'Отменён'};
  const CITY_PALETTES={
    morning:{background:'#15263E',water:'#173A63',land:'#1D3048',residential:'#24384F',building:'#F2F5F8',road:'#FFFFFF',label:'#F7F9FC'},
    day:{background:'#0F2035',water:'#14375F',land:'#192D44',residential:'#21364E',building:'#F7F9FC',road:'#FFFFFF',label:'#F7F9FC'},
    evening:{background:'#0D192A',water:'#112F52',land:'#16273B',residential:'#1D3047',building:'#EDF1F5',road:'#F4F6F8',label:'#F8FAFC'},
    night:{background:'#09111D',water:'#0B2340',land:'#111E2D',residential:'#17263A',building:'#DDE4EC',road:'#B7C1CC',label:'#F2F5F8'}
  };
  window.__SHAURMEG_MAP_STARTED__=true;

  function daypart(){
    const h=new Date().getHours();
    return h>=5&&h<11?'morning':h>=11&&h<17?'day':h>=17&&h<22?'evening':'night';
  }
  function applyDaypart(){
    const part=daypart(),labels={morning:'УТРО',day:'ДЕНЬ',evening:'ВЕЧЕР',night:'НОЧЬ'};
    document.body.dataset.daypart=part;
    const mode=$('#cityMode');if(mode)mode.querySelector('span').textContent='ГОРОД · '+labels[part];
    return CITY_PALETTES[part]||CITY_PALETTES.day;
  }
  const cityPalette=applyDaypart();
  function toast(v){const el=$('#toast');if(!el)return;el.textContent=v;el.classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(()=>el.classList.remove('show'),1900)}
  function dismissBoot(){
    clearTimeout(window.__SHAURMEG_BOOT_WATCHDOG__);
    const b=$('#boot');if(!b)return;
    const wait=Math.max(0,1750-(performance.now()-bootStarted));
    setTimeout(()=>{b.classList.add('out');setTimeout(()=>b.remove(),900)},wait);
  }
  const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  async function fetchWithTimeout(url,ms=7000){
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),ms);
    try{return await fetch(url,{cache:'no-store',signal:controller.signal})}
    finally{clearTimeout(timer)}
  }

  function authHeaders(){return session?{Authorization:'Bearer '+session}:{}}
  async function authClient(){
    if(session){
      try{const r=await fetch(api+'/me/dashboard',{headers:authHeaders(),cache:'no-store'});if(r.ok){dashboard=await r.json();return true}}catch{}
      session='';sessionStorage.removeItem('shaurmeg_client_session');
    }
    if(!tg?.initData)return false;
    try{
      const body={initData:tg.initData};if(qs.get('ref'))body.referral_code=qs.get('ref');
      const r=await fetch(api+'/auth/telegram',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      if(!r.ok)return false;
      const j=await r.json();session=j.session;sessionStorage.setItem('shaurmeg_client_session',session);
      return true;
    }catch{return false}
  }
  async function loadDashboard(){
    if(!session)return renderGuestProfile();
    try{
      const r=await fetch(api+'/me/dashboard',{headers:authHeaders(),cache:'no-store'});if(!r.ok)throw 0;
      dashboard=await r.json();renderDashboard();
    }catch{renderGuestProfile()}
  }
  async function loadOrders(){
    if(!session){userOrders=[];renderOrdersPanel();return}
    try{
      const r=await fetch(api+'/me/orders',{headers:authHeaders(),cache:'no-store'});if(!r.ok)throw 0;
      userOrders=await r.json();renderOrdersPanel();
    }catch{$('#ordersPanelList').innerHTML='<div class="panelEmpty">Не удалось загрузить заказы</div>'}
  }
  function renderGuestProfile(){
    $('#profileName').textContent='Откройте в Telegram';$('#profileUsername').textContent='Профиль привязывается к Telegram ID';
    $('#profileAvatar').textContent='Ш';$('#avgCheck').textContent='0 ₽';$('#ordersCount').textContent='0';$('#totalSpent').textContent='0 ₽';$('#activeOrders').textContent='0';
    $('#favoriteVenue').textContent='Пока определяем';$('#favoriteMeta').textContent='История появится после авторизации';
    $('#refCode').textContent='—';$('#refInvited').textContent='0';$('#refOrdered').textContent='0';$('#refQualified').textContent='0';$('#bonusBalance').textContent='0';
  }
  function renderDashboard(){
    const d=dashboard||{},u=d.user||{},s=d.stats||{},r=d.referral||{},b=d.bonuses||{},fav=d.favorite_venue;
    const name=[u.first_name,u.last_name].filter(Boolean).join(' ')||u.username||'Пользователь';
    $('#profileName').textContent=name;$('#profileTitle').textContent=u.first_name?u.first_name+', это твой Shaurmeg':'Твой Shaurmeg';
    $('#profileUsername').textContent=u.username?'@'+u.username:'Telegram ID · '+(u.id||'');
    $('#profileAvatar').textContent=(u.first_name||u.username||'Ш').slice(0,1).toUpperCase();
    $('#avgCheck').textContent=money(s.avg_check||0);$('#ordersCount').textContent=String(s.order_count||0);$('#totalSpent').textContent=money(s.total_spent||0);$('#activeOrders').textContent=String(s.active_orders||0);
    $('#activeOrderDot').classList.toggle('hidden',!(Number(s.active_orders)>0));
    $('#favoriteVenue').textContent=fav?.venue_name||'Пока определяем';
    $('#favoriteMeta').textContent=fav?fav.orders+' заказ'+(fav.orders===1?'':'а')+' · '+money(fav.spent):'Сделайте первый заказ';
    $('#bonusBalance').textContent=String(b.balance||0);
    $('#refCode').textContent=r.code||'—';$('#refInvited').textContent=String(r.invited||0);$('#refOrdered').textContent=String(r.ordered||0);$('#refQualified').textContent=String(r.qualified||0);
    currentReferralUrl=r.url||'';
  }
  function renderOrdersPanel(){
    const box=$('#ordersPanelList');
    if(!session){box.innerHTML='<div class="panelEmpty"><b>Заказы привязаны к Telegram</b><span>Откройте Shaurmeg через @Shaurmeggbot, чтобы видеть историю и активные заказы.</span></div>';return}
    let rows=userOrders;
    if(orderFilter==='active')rows=rows.filter(o=>['new','cooking','ready'].includes(o.status));
    if(orderFilter==='done')rows=rows.filter(o=>['done','cancelled'].includes(o.status));
    box.innerHTML=rows.length?rows.map(o=>{
      const count=(o.items||[]).reduce((s,x)=>s+(Number(x.q)||1),0);
      const active=['new','cooking','ready'].includes(o.status);
      return '<article class="mapOrderCard '+(active?'isActive':'')+'">'+
        '<header><div><small>'+esc(o.venue_name||'SHAURMEG')+'</small><b>'+esc(o.order_number)+'</b></div><span class="status status-'+esc(o.status)+'">'+esc(STATUS[o.status]||o.status)+'</span></header>'+
        '<div class="mapOrderMeta"><span>'+new Date(o.created_at).toLocaleString('ru-RU',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})+'</span><span>'+(o.fulfillment_type==='cafe'?'В заведении':'Доставка')+'</span></div>'+
        '<div class="mapOrderItems">'+(o.items||[]).slice(0,3).map(x=>'<span>'+esc(x.n||x.name)+' × '+esc(x.q||1)+'</span>').join('')+((o.items||[]).length>3?'<small>ещё '+((o.items||[]).length-3)+'</small>':'')+'</div>'+
        '<footer><span>'+count+' поз.</span><b>'+money(o.total)+'</b>'+(o.marker_id&&o.establishment_id?'<button data-order-menu="'+esc(o.marker_id)+'" data-order-est="'+esc(o.establishment_id)+'">Открыть</button>':'')+'</footer>'+
      '</article>';
    }).join(''):'<div class="panelEmpty"><b>Здесь пока пусто</b><span>Выберите точку на карте и сделайте первый заказ.</span></div>';
  }
  function connectUserStream(){
    try{userStream?.close()}catch{};if(!session)return;
    userStream=new EventSource(api+'/me/stream?session='+encodeURIComponent(session));
    const refresh=()=>{loadOrders();loadDashboard()};
    userStream.addEventListener('order',refresh);userStream.addEventListener('update',refresh);
  }

  function openPanel(kind){
    closeCard();
    const id=kind==='orders'?'ordersPanel':kind==='profile'?'profilePanel':'';
    document.querySelectorAll('.appPanel').forEach(x=>x.classList.toggle('show',x.id===id));
    $('#panelBackdrop').classList.toggle('show',!!id);document.body.classList.toggle('panelOpen',!!id);
    document.querySelectorAll('.dockBtn').forEach(x=>x.classList.toggle('active',x.dataset.dock===(kind||'map')));
    if(kind==='orders')loadOrders();if(kind==='profile')loadDashboard();
    tg?.HapticFeedback?.selectionChanged?.();
  }
  function closePanels(){openPanel('map')}

  function styleBuildings(){
    const layers=map.getStyle()?.layers||[];
    buildingLayers=layers.filter(x=>x.type==='fill-extrusion'||(/building/i.test(x.id)&&x.type==='fill')).map(x=>x.id);
    for(const l of layers){
      const id=String(l.id||'');
      try{
        if(l.type==='background')map.setPaintProperty(l.id,'background-color',cityPalette.background);
        if(l.type==='fill'&&/water|river|lake|ocean/i.test(id)){map.setPaintProperty(l.id,'fill-color',cityPalette.water);map.setPaintProperty(l.id,'fill-opacity',.96)}
        else if(l.type==='fill'&&/park|grass|wood|vegetation|forest|landcover/i.test(id)){map.setPaintProperty(l.id,'fill-color',cityPalette.land);map.setPaintProperty(l.id,'fill-opacity',.9)}
        else if(l.type==='fill'&&/residential|landuse|land/i.test(id)){map.setPaintProperty(l.id,'fill-color',cityPalette.residential);map.setPaintProperty(l.id,'fill-opacity',.88)}
        if(l.type==='fill'&&/building/i.test(id)){map.setPaintProperty(l.id,'fill-color',cityPalette.building);map.setPaintProperty(l.id,'fill-opacity',daypart()==='night'?.76:.86)}
        if(l.type==='line'&&/road|street|highway|path|motorway|trunk/i.test(id)){map.setPaintProperty(l.id,'line-color',cityPalette.road);map.setPaintProperty(l.id,'line-opacity',daypart()==='night'?.6:.82)}
        if(l.type==='symbol'&&/road|place|poi|label/i.test(id)){map.setPaintProperty(l.id,'text-color',cityPalette.label);map.setPaintProperty(l.id,'text-halo-color',cityPalette.background);map.setPaintProperty(l.id,'text-halo-width',1.2)}
      }catch{}
    }
  }
  function addFocusLayers(){
    if(map.getSource('focus-building'))return;

    map.addSource('focus-flight',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
    map.addLayer({id:'focus-flight-glow',type:'line',source:'focus-flight',paint:{'line-color':'#D94343','line-width':7,'line-opacity':.09,'line-blur':4}});
    map.addLayer({id:'focus-flight-core',type:'line',source:'focus-flight',paint:{'line-color':'#FFFFFF','line-width':1.2,'line-opacity':.48,'line-dasharray':[1.4,1.1]}});

    map.addSource('focus-zone',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
    map.addLayer({id:'focus-zone-glow',type:'circle',source:'focus-zone',paint:{'circle-radius':['interpolate',['linear'],['zoom'],12,22,18,62],'circle-color':'#D94343','circle-opacity':.08,'circle-blur':.7,'circle-stroke-width':1,'circle-stroke-color':'#FFFFFF','circle-stroke-opacity':.26}});
    map.addLayer({id:'focus-zone-core',type:'circle',source:'focus-zone',paint:{'circle-radius':['interpolate',['linear'],['zoom'],12,7,18,16],'circle-color':'#315D93','circle-opacity':.08,'circle-stroke-width':1.2,'circle-stroke-color':'#FFFFFF','circle-stroke-opacity':.38}});

    map.addSource('realcity-ground',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
    map.addLayer({id:'realcity-ground-fill',type:'fill',source:'realcity-ground',paint:{
      'fill-color':['coalesce',['get','ground'],'#d8d3c8'],
      'fill-opacity':0,
      'fill-opacity-transition':{duration:650,delay:0}
    }});

    map.addSource('realcity-greens',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
    map.addLayer({id:'realcity-greens-fill',type:'fill',source:'realcity-greens',paint:{
      'fill-color':'#45694d','fill-opacity':0,
      'fill-opacity-transition':{duration:620,delay:100}
    }});

    map.addSource('realcity-roads',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
    map.addLayer({id:'realcity-roads-glow',type:'line',source:'realcity-roads',paint:{
      'line-color':'#FFFFFF','line-width':['interpolate',['linear'],['zoom'],14,7,18,13],
      'line-opacity':0,'line-blur':5,'line-opacity-transition':{duration:650,delay:120}
    }});
    map.addLayer({id:'realcity-roads-core',type:'line',source:'realcity-roads',paint:{
      'line-color':'#E8EDF3','line-width':['interpolate',['linear'],['zoom'],14,2,18,5],
      'line-opacity':0,'line-opacity-transition':{duration:650,delay:140}
    }});

    map.addSource('realcity-context',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
    map.addLayer({id:'realcity-context-extrude',type:'fill-extrusion',source:'realcity-context',paint:{
      'fill-extrusion-color':['coalesce',['get','wall'],'#b9b7ad'],
      'fill-extrusion-height':['coalesce',['get','height'],1],
      'fill-extrusion-base':0,
      'fill-extrusion-opacity':.78
    }});
    map.addLayer({id:'realcity-context-edge',type:'line',source:'realcity-context',paint:{
      'line-color':['coalesce',['get','accent'],'#D7E0EA'],
      'line-width':['case',['==',['get','role'],'nearby'],1,.65],
      'line-opacity':['case',['==',['get','role'],'nearby'],.45,.22]
    }});

    map.addSource('focus-building',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
    map.addLayer({id:'focus-building-extrude',type:'fill-extrusion',source:'focus-building',paint:{
      'fill-extrusion-color':['coalesce',['get','wall'],'#a59c88'],
      'fill-extrusion-height':['coalesce',['get','height'],18],
      'fill-extrusion-base':0,'fill-extrusion-opacity':.97
    }});
    map.addLayer({id:'focus-building-edge',type:'line',source:'focus-building',paint:{
      'line-color':['coalesce',['get','accent'],'#F4F7FA'],'line-width':1.55,'line-opacity':.78
    }});

    map.addSource('realcity-trees',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
    map.addLayer({id:'realcity-tree-glow',type:'circle',source:'realcity-trees',paint:{
      'circle-radius':['interpolate',['linear'],['zoom'],14,4,18,10],
      'circle-color':'#1b3424','circle-opacity':.28,'circle-blur':.35
    }});
    map.addLayer({id:'realcity-tree-crown',type:'circle',source:'realcity-trees',paint:{
      'circle-radius':['interpolate',['linear'],['zoom'],14,2.2,18,6.4],
      'circle-color':['coalesce',['get','color'],'#5f8a62'],
      'circle-opacity':.86,'circle-stroke-width':.7,'circle-stroke-color':'#bed0b8','circle-stroke-opacity':.22
    }});
  }
  function emptyGeo(){return {type:'FeatureCollection',features:[]}}
  function pointFeature(p){return {type:'FeatureCollection',features:[{type:'Feature',properties:{},geometry:{type:'Point',coordinates:[+p.lon,+p.lat]}}]}}
  function closeRing(ring){
    const out=(Array.isArray(ring)?ring:[]).map(x=>[Number(x?.[0]),Number(x?.[1])]).filter(x=>Number.isFinite(x[0])&&Number.isFinite(x[1]));
    if(out.length<3)return [];
    const a=out[0],b=out[out.length-1];if(a[0]!==b[0]||a[1]!==b[1])out.push([...a]);
    return out;
  }
  function circlePolygon(p,radius=150,steps=56){
    const lat=+p.lat,lon=+p.lon,c=Math.cos(lat*Math.PI/180),ring=[];
    for(let i=0;i<=steps;i++){
      const a=i/steps*Math.PI*2;
      ring.push([lon+Math.cos(a)*radius/(111320*c),lat+Math.sin(a)*radius/110540]);
    }
    return {type:'FeatureCollection',features:[{type:'Feature',properties:{ground:p.realcity_profile?.palette?.ground||'#d8d3c8'},geometry:{type:'Polygon',coordinates:[ring]}}]};
  }
  function setBaseBuildingsDim(active){
    for(const id of buildingLayers){
      try{
        const type=map.getLayer(id)?.type;
        if(type==='fill-extrusion')map.setPaintProperty(id,'fill-extrusion-opacity',active?.14:.84);
        else if(type==='fill')map.setPaintProperty(id,'fill-opacity',active?.16:(daypart()==='night'?.76:.86));
      }catch{}
    }
  }
  function buildQuarterData(p,profile){
    const scene=profile?.scene||{},rawBuildings=Array.isArray(scene.buildings)?scene.buildings:[],heroId=scene.hero_building_id||profile?.scene?.hero_building_id;
    const maxContext=reduceMotion?10:(innerWidth<430?22:30);
    const sorted=[...rawBuildings].sort((a,b)=>(a.distance||0)-(b.distance||0));
    let hero=sorted.find(x=>x.role==='hero'||String(x.id)===String(heroId))||sorted[0]||null;
    const context=sorted.filter(x=>x!==hero).slice(0,maxContext);
    const feature=b=>{
      const ring=closeRing(b.ring);if(ring.length<4)return null;
      return {type:'Feature',properties:{
        id:String(b.id||''),role:b.role||'background',wall:b.palette?.wall||'#b9b7ad',
        accent:b.palette?.accent||b.palette?.roof||'#d7d5cf',windows:b.palette?.windows||'#39444a',
        targetHeight:Math.max(3,Math.min(Number(b.height)||9,140)),height:1,
        levels:Number(b.levels)||1,style:String(b.style||'')
      },geometry:{type:'Polygon',coordinates:[ring]}};
    };
    const heroFeature=hero?feature(hero):null,contextFeatures=context.map(feature).filter(Boolean);
    const roads=(scene.roads||[]).slice(0,28).map(line=>{
      const coords=(Array.isArray(line)?line:[]).map(x=>[Number(x?.[0]),Number(x?.[1])]).filter(x=>Number.isFinite(x[0])&&Number.isFinite(x[1]));
      return coords.length>1?{type:'Feature',properties:{},geometry:{type:'LineString',coordinates:coords}}:null;
    }).filter(Boolean);
    const greens=(scene.greens||[]).slice(0,14).map(ring=>{
      const coords=closeRing(ring);return coords.length>3?{type:'Feature',properties:{},geometry:{type:'Polygon',coordinates:[coords]}}:null;
    }).filter(Boolean);
    const trees=(scene.trees||[]).slice(0,reduceMotion?22:48).map((t,i)=>({
      type:'Feature',properties:{color:i%3===0?'#6f956b':i%3===1?'#547c58':'#618765'},
      geometry:{type:'Point',coordinates:[Number(t.lon),Number(t.lat)]}
    })).filter(x=>Number.isFinite(x.geometry.coordinates[0])&&Number.isFinite(x.geometry.coordinates[1]));
    return {heroFeature,contextFeatures,roads,greens,trees,radius:Math.max(80,Math.min(Number(scene.radius_m)||170,220))};
  }
  function clearQuarter(){
    for(const id of ['realcity-ground','realcity-greens','realcity-roads','realcity-context','realcity-trees','focus-building'])map.getSource(id)?.setData(emptyGeo());
    try{map.setPaintProperty('realcity-ground-fill','fill-opacity',0)}catch{}
    try{map.setPaintProperty('realcity-greens-fill','fill-opacity',0)}catch{}
    try{map.setPaintProperty('realcity-roads-glow','line-opacity',0)}catch{}
    try{map.setPaintProperty('realcity-roads-core','line-opacity',0)}catch{}
    setBaseBuildingsDim(false);document.body.classList.remove('realCityActive','realCitySettled');
  }
  function revealQuarter(p,profile){
    const token=focusToken,data=buildQuarterData(p,profile);
    if(!data.heroFeature&&!data.contextFeatures.length){
      setTimeout(()=>{if(token===focusToken)nearestBuilding(p,profile)},reduceMotion?0:360);
      return;
    }
    document.body.classList.add('realCityActive');setBaseBuildingsDim(true);
    map.getSource('realcity-ground')?.setData(circlePolygon(p,data.radius));
    map.getSource('realcity-greens')?.setData({type:'FeatureCollection',features:data.greens});
    map.getSource('realcity-roads')?.setData({type:'FeatureCollection',features:data.roads});
    map.getSource('realcity-trees')?.setData({type:'FeatureCollection',features:data.trees});
    try{map.setPaintProperty('realcity-ground-fill','fill-opacity',daypart()==='night'?.16:.22)}catch{}
    try{map.setPaintProperty('realcity-greens-fill','fill-opacity',.34)}catch{}
    try{map.setPaintProperty('realcity-roads-glow','line-opacity',.16)}catch{}
    try{map.setPaintProperty('realcity-roads-core','line-opacity',daypart()==='night'?.42:.56)}catch{}
    $('#focusHudState').textContent='собираем цифровой квартал';

    const contextSource=map.getSource('realcity-context'),heroSource=map.getSource('focus-building');
    const duration=reduceMotion?1:820,started=performance.now();
    const context=data.contextFeatures,hero=data.heroFeature;
    const render=(now)=>{
      if(token!==focusToken)return;
      const elapsed=now-started;
      const grown=context.map((f,index)=>{
        const delay=reduceMotion?0:Math.min(index,16)*22;
        const t=reduceMotion?1:Math.max(0,Math.min(1,(elapsed-delay)/610)),e=1-Math.pow(1-t,3);
        return {...f,properties:{...f.properties,height:Math.max(.8,f.properties.targetHeight*e)}};
      });
      contextSource?.setData({type:'FeatureCollection',features:grown});
      if(hero){
        const delay=reduceMotion?0:150,t=reduceMotion?1:Math.max(0,Math.min(1,(elapsed-delay)/650)),e=1-Math.pow(1-t,3);
        heroSource?.setData({type:'FeatureCollection',features:[{...hero,properties:{...hero.properties,height:Math.max(.8,hero.properties.targetHeight*e)}}]});
      }
      if(elapsed<duration)requestAnimationFrame(render);
      else{
        document.body.classList.add('realCitySettled');
        $('#focusHudState').textContent='цифровая копия готова';
        tg?.HapticFeedback?.impactOccurred?.('light');
      }
    };
    requestAnimationFrame(render);
  }
  function setFocusZone(p){map.getSource('focus-zone')?.setData(p?pointFeature(p):emptyGeo())}
  function setFlight(from,p){
    map.getSource('focus-flight')?.setData(from&&p?{type:'FeatureCollection',features:[{type:'Feature',properties:{},geometry:{type:'LineString',coordinates:[[+from.lng,+from.lat],[+p.lon,+p.lat]]}}]}:emptyGeo());
  }
  function showFocusHud(p){
    const hud=$('#focusHud');if(!hud)return;
    $('#focusHudName').textContent=p.name||'Заведение';$('#focusHudState').textContent='входим в квартал';
    hud.classList.add('show');clearTimeout(showFocusHud.t);clearTimeout(showFocusHud.t2);
    showFocusHud.t=setTimeout(()=>{if($('#focusHudState'))$('#focusHudState').textContent='собираем окружение'},720);
    showFocusHud.t2=setTimeout(()=>hud.classList.remove('show'),3300);
  }
  function cinematicFocus(p){
    const token=++focusToken,from=map.getCenter();
    setFlight(from,p);setFocusZone(p);showFocusHud(p);
    document.body.classList.add('cityFocus');$('#mapFocusFlash')?.classList.add('active');
    map.stop();
    if(reduceMotion){
      map.easeTo({center:[+p.lon,+p.lat],zoom:17.35,pitch:fallback?0:60,bearing:fallback?0:-16,offset:[0,58],duration:320});
    }else{
      const seed=Number(p.id)||1,cam=p.realcity_profile?.camera||{},bearing=Number.isFinite(Number(cam.bearing))?Number(cam.bearing):(-16+((seed%5)-2)*3);
      map.flyTo({center:[+p.lon,+p.lat],zoom:Number(cam.zoom)||17.8,pitch:fallback?0:(Number(cam.pitch)||61),bearing:fallback?0:bearing,offset:[0,54],duration:1280,curve:1.48,speed:.9,essential:true});
    }
    setTimeout(()=>{if(token!==focusToken)return;setFlight(null,null);$('#mapFocusFlash')?.classList.remove('active')},reduceMotion?380:1250);
  }
  function nearestBuilding(p,profile){
    if(fallback||!buildingLayers.length)return;
    let fs=[];try{const px=map.project([+p.lon,+p.lat]),pad=34;fs=map.queryRenderedFeatures([[px.x-pad,px.y-pad],[px.x+pad,px.y+pad]],{layers:buildingLayers})||[]}catch{}
    const polys=fs.filter(f=>['Polygon','MultiPolygon'].includes(f.geometry?.type));if(!polys.length){map.getSource('focus-building')?.setData(emptyGeo());return}
    const center=[+p.lon,+p.lat],centroid=g=>{const ring=g.type==='Polygon'?g.coordinates?.[0]:g.coordinates?.[0]?.[0];if(!ring?.length)return center;return ring.reduce((a,x)=>[a[0]+x[0]/ring.length,a[1]+x[1]/ring.length],[0,0])};
    polys.sort((a,b)=>{const A=centroid(a.geometry),B=centroid(b.geometry);return Math.hypot(A[0]-center[0],A[1]-center[1])-Math.hypot(B[0]-center[0],B[1]-center[1])});
    const f=polys[0],pal=profile?.palette||{},props=f.properties||{},raw=Number(props.render_height??props.height)||(Number(props.levels||props['building:levels'])||6)*3.05,target=Math.max(4,Math.min(raw,130)),wall=pal.wall||pal.facade||'#a59c88';
    const source=map.getSource('focus-building');if(!source)return;
    if(reduceMotion){source.setData({type:'FeatureCollection',features:[{type:'Feature',properties:{wall,height:target},geometry:f.geometry}]});return}
    const started=performance.now(),duration=520,token=focusToken;
    const tick=now=>{
      if(token!==focusToken)return;
      const t=Math.min(1,(now-started)/duration),e=1-Math.pow(1-t,3),height=Math.max(1,target*e);
      source.setData({type:'FeatureCollection',features:[{type:'Feature',properties:{wall,height},geometry:f.geometry}]});
      if(t<1)requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
  function createMap(style){return new maplibregl.Map({container:'map',style,center:[37.6176,55.7558],zoom:10.3,pitch:42,bearing:-12,maxPitch:72,attributionControl:false,renderWorldCopies:false,fadeDuration:140})}
  function waitLoad(m,ms=6000){return new Promise((resolve,reject)=>{let done=false;const t=setTimeout(()=>end(new Error('map_timeout')),ms);function end(e){if(done)return;done=true;clearTimeout(t);e?reject(e):resolve()}m.once('load',()=>end());m.once('error',e=>{if(!m.loaded())console.warn('map',e?.error||e)})})}
  async function bootMap(){
    try{map=createMap(STYLE);await waitLoad(map,5200)}
    catch(primaryError){
      console.warn('primary map style failed',primaryError);try{map?.remove()}catch{};$('#map').innerHTML='';fallback=true;
      try{map=createMap(FALLBACK);await waitLoad(map,5200)}catch(fallbackError){dismissBoot();throw fallbackError}
    }
    map.addControl(new maplibregl.NavigationControl({showCompass:false}),'bottom-right');
    styleBuildings();addFocusLayers();
    map.on('click',e=>{if(e.originalEvent.target.closest?.('.mapMarker'))return;closeCard()});
    map.on('movestart',()=>document.body.classList.add('mapMoving'));
    map.on('moveend',()=>document.body.classList.remove('mapMoving'));
    dismissBoot();loadPointsWithRetry();
  }
  function markerNode(p,index=0){
    const s=p.marker_style||{},el=document.createElement('button');el.className='mapMarker markerReveal'+(s.pulse!==false?' pulseMarker':'');el.style.setProperty('--reveal-delay',Math.min(index,18)*55+'ms');el.type='button';el.style.background=s.background||'#10221b';el.style.borderColor=s.border||'#f6f3e9';el.style.opacity=s.opacity??1;el.style.width=(s.size||44)+'px';el.style.height=(s.size||44)+'px';el.style.borderRadius=s.shape==='circle'?'50%':s.shape==='square'?'10px':s.shape==='pin'?'50% 50% 50% 14px':'16px';el.style.transform='translate(-50%,-50%) scale('+(s.scale||1)+')';
    if(p.has_avatar){const img=new Image();img.alt='';img.src=api+'/map/markers/'+p.id+'/avatar';img.onerror=()=>{img.remove();el.insertAdjacentText('afterbegin',s.icon||'🥙')};el.appendChild(img)}else el.textContent=s.icon||'🥙';
    if(s.label_visible){const l=document.createElement('span');l.className='markerLabel';l.textContent=p.name;el.appendChild(l)}
    el.onclick=e=>{e.stopPropagation();selectPoint(p)};return el;
  }
  async function loadPoints(){
    const r=await fetchWithTimeout(api+'/map/points',7000);if(!r.ok)throw new Error('points_'+r.status);
    const data=await r.json();if(!Array.isArray(data))throw new Error('points_invalid');
    points=data;$('#pointsCount').textContent=points.length;
    for(const m of markers.values())m.remove();markers.clear();
    points.forEach((p,index)=>{const el=markerNode(p,index),m=new maplibregl.Marker({element:el,anchor:'center'}).setLngLat([+p.lon,+p.lat]).addTo(map);markers.set(String(p.id),m)});
    if(points.length)fitAll();
    const direct=qs.get('marker');if(direct){const p=points.find(x=>String(x.id)===direct);if(p)setTimeout(()=>selectPoint(p),350)}
  }
  async function loadPointsWithRetry(){
    for(let attempt=0;attempt<3;attempt++){try{await loadPoints();return}catch(e){console.warn('points load failed',attempt+1,e);if(attempt<2)await sleep(1200*(attempt+1))}}
    toast('Карта открыта, точки догружаются…');setTimeout(()=>loadPointsWithRetry(),5000);
  }
  function fitAll(){if(!points.length)return;const b=new maplibregl.LngLatBounds();points.forEach(x=>b.extend([+x.lon,+x.lat]));map.fitBounds(b,{padding:{top:130,bottom:210,left:40,right:40},maxZoom:13,duration:700})}
  function selectPoint(p){
    closePanels();selected=p;markers.forEach((m,k)=>m.getElement().classList.toggle('selected',k===String(p.id)));
    $('#venueName').textContent=p.name||'Заведение';$('#venueAddress').textContent=p.address||'';$('#venueDescription').textContent=p.description||'';$('#venueDescription').classList.toggle('hidden',!p.description);
    $('#venueHoursQuick').textContent=p.hours||'';$('#venueHoursQuick').classList.toggle('hidden',!p.hours);$('#venuePriceQuick').textContent=p.price_label||'';$('#venuePriceQuick').classList.toggle('hidden',!p.price_label);
    $('#realBadge').textContent=p.realcity_quality&&p.realcity_quality!=='heuristic'?'REAL CITY · '+String(p.realcity_quality).toUpperCase():'REAL CITY';
    const a=$('#venueAvatar');a.innerHTML=p.has_avatar?'<img alt="" src="'+api+'/map/markers/'+encodeURIComponent(p.id)+'/avatar">':esc(p.marker_style?.icon||'🥙');
    $('#venueCard').classList.add('show');
    cinematicFocus(p);
    setTimeout(()=>{if(selected&&String(selected.id)===String(p.id))revealQuarter(p,p.realcity_profile||{})},reduceMotion?220:560);
    tg?.HapticFeedback?.selectionChanged?.();
  }
  function closeCard(){
    focusToken++;selected=null;$('#venueCard').classList.remove('show');markers.forEach(m=>m.getElement().classList.remove('selected'));
    clearQuarter();setFocusZone(null);setFlight(null,null);
    $('#focusHud')?.classList.remove('show');$('#mapFocusFlash')?.classList.remove('active');document.body.classList.remove('cityFocus');
  }
  function search(){
    const q=$('#search').value.trim().toLowerCase(),box=$('#results');if(!q){box.classList.add('hidden');return}
    const list=points.filter(x=>(x.name+' '+x.address).toLowerCase().includes(q)).slice(0,8);box.innerHTML=list.length?list.map(x=>'<button class="searchResult" data-id="'+x.id+'"><b>'+esc(x.name)+'</b><small>'+esc(x.address||'')+'</small></button>').join(''):'<div class="empty">Ничего не найдено</div>';box.classList.remove('hidden');
  }

  $('#searchToggle').onclick=()=>{$('#searchBox').classList.toggle('hidden');if(!$('#searchBox').classList.contains('hidden'))setTimeout(()=>$('#search').focus(),60);else $('#results').classList.add('hidden')};
  $('#search').oninput=search;$('#results').onclick=e=>{const b=e.target.closest('[data-id]');if(!b)return;const p=points.find(x=>String(x.id)===b.dataset.id);if(p){selectPoint(p);$('#results').classList.add('hidden')}};
  $('#locate').onclick=()=>{if(!navigator.geolocation)return toast('Геопозиция недоступна');navigator.geolocation.getCurrentPosition(p=>{
    const ll=[p.coords.longitude,p.coords.latitude];
    if(!userMarker){const el=document.createElement('div');el.className='userLocation';el.innerHTML='<i></i>';userMarker=new maplibregl.Marker({element:el,anchor:'center'}).setLngLat(ll).addTo(map)}else userMarker.setLngLat(ll);
    map.flyTo({center:ll,zoom:15.7,pitch:fallback?0:48,bearing:map.getBearing(),duration:reduceMotion?320:850,essential:true});toast('Вы здесь');
  },()=>toast('Не удалось получить геопозицию'),{enableHighAccuracy:true,timeout:8000,maximumAge:20000})};
  $('#home').onclick=()=>{closePanels();closeCard();fitAll()};$('#closeCard').onclick=closeCard;
  $('#openMenu').onclick=()=>{if(!selected)return;const u=new URL('menu.html',location.href);u.searchParams.set('marker',selected.id);u.searchParams.set('establishment',selected.establishment_id);u.searchParams.set('from','map');u.hash=location.hash;location.assign(u.toString())};

  $('#bottomDock').onclick=e=>{const b=e.target.closest('[data-dock]');if(b)openPanel(b.dataset.dock)};
  $('#panelBackdrop').onclick=closePanels;document.querySelectorAll('[data-panel-close]').forEach(x=>x.onclick=closePanels);
  $('#orderFilter').onclick=e=>{const b=e.target.closest('[data-order-filter]');if(!b)return;orderFilter=b.dataset.orderFilter;document.querySelectorAll('[data-order-filter]').forEach(x=>x.classList.toggle('active',x===b));renderOrdersPanel()};
  $('#ordersPanelList').onclick=e=>{const b=e.target.closest('[data-order-menu]');if(!b)return;const u=new URL('menu.html',location.href);u.searchParams.set('marker',b.dataset.orderMenu);u.searchParams.set('establishment',b.dataset.orderEst);u.searchParams.set('from','map');u.hash=location.hash;location.assign(u.toString())};
  $('#copyReferral').onclick=async()=>{if(!currentReferralUrl)return toast('Откройте профиль через Telegram');try{await navigator.clipboard.writeText(currentReferralUrl);toast('Ссылка скопирована ✓');tg?.HapticFeedback?.notificationOccurred?.('success')}catch{toast(currentReferralUrl)}};
  $('#shareReferral').onclick=async()=>{
    if(!currentReferralUrl)return toast('Откройте профиль через Telegram');
    const text='Попробуй Shaurmeg — городскую карту шаурмы 🥙';
    try{if(navigator.share){await navigator.share({title:'Shaurmeg',text,url:currentReferralUrl});return}}catch(e){if(e?.name==='AbortError')return}
    try{tg?.openTelegramLink?.('https://t.me/share/url?url='+encodeURIComponent(currentReferralUrl)+'&text='+encodeURIComponent(text))}catch{try{await navigator.clipboard.writeText(currentReferralUrl);toast('Ссылка скопирована ✓')}catch{}}
  };

  try{tg?.ready();tg?.expand();tg?.BackButton?.hide?.();const chrome=daypart()==='night'?'#09111D':'#0F2035';tg?.setHeaderColor?.(chrome);tg?.setBackgroundColor?.(chrome)}catch{}
  authClient().then(ok=>{if(ok){loadDashboard();loadOrders();connectUserStream()}else{renderGuestProfile();renderOrdersPanel()}});
  bootMap().catch(e=>{console.error(e);dismissBoot();toast('Не удалось загрузить подложку карты. Откройте приложение ещё раз.')});
})();