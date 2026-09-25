(() => {
  const {api,esc,money}=SHAURMEG,tg=SHAURMEG.telegram;
  const $=s=>document.querySelector(s);
  const qs=new URLSearchParams(location.search);
  let map,points=[],selected=null,markers=new Map(),buildingLayers=[],fallback=false;
  let session=sessionStorage.getItem('shaurmeg_client_session')||'',dashboard=null,userOrders=[],orderFilter='all',userStream=null,currentReferralUrl='';
  const bootStarted=performance.now();
  const STYLE='https://tiles.openfreemap.org/styles/liberty';
  const FALLBACK={version:8,sources:{osm:{type:'raster',tiles:['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],tileSize:256,maxzoom:19,attribution:'© OpenStreetMap contributors'}},layers:[{id:'osm',type:'raster',source:'osm',paint:{'raster-saturation':-.22,'raster-contrast':.08,'raster-brightness-min':.08,'raster-brightness-max':.78}}]};
  const STATUS={new:'Принят',cooking:'Готовится',ready:'Готов',done:'Завершён',cancelled:'Отменён'};
  window.__SHAURMEG_MAP_STARTED__=true;

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
        if(l.type==='background')map.setPaintProperty(l.id,'background-color','#152019');
        if(l.type==='fill'&&/water|river|lake|ocean/i.test(id)){map.setPaintProperty(l.id,'fill-color','#0d2b32');map.setPaintProperty(l.id,'fill-opacity',.96)}
        else if(l.type==='fill'&&/park|grass|wood|vegetation|forest|landcover/i.test(id)){map.setPaintProperty(l.id,'fill-color','#36553e');map.setPaintProperty(l.id,'fill-opacity',.9)}
        else if(l.type==='fill'&&/residential|landuse|land/i.test(id)){map.setPaintProperty(l.id,'fill-color','#29372d');map.setPaintProperty(l.id,'fill-opacity',.88)}
        if(l.type==='fill'&&/building/i.test(id)){map.setPaintProperty(l.id,'fill-color','#b9b7ac');map.setPaintProperty(l.id,'fill-opacity',.86)}
        if(l.type==='line'&&/road|street|highway|path|motorway|trunk/i.test(id)){map.setPaintProperty(l.id,'line-color','#f0f0e8');map.setPaintProperty(l.id,'line-opacity',.82)}
        if(l.type==='symbol'&&/road|place|poi|label/i.test(id)){map.setPaintProperty(l.id,'text-color','#eef0e8');map.setPaintProperty(l.id,'text-halo-color','#18221b');map.setPaintProperty(l.id,'text-halo-width',1.2)}
      }catch{}
    }
  }
  function addFocusLayers(){
    if(map.getSource('focus-building'))return;
    map.addSource('focus-building',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
    map.addLayer({id:'focus-building-extrude',type:'fill-extrusion',source:'focus-building',paint:{
      'fill-extrusion-color':['coalesce',['get','wall'],'#a59c88'],'fill-extrusion-height':['coalesce',['get','height'],18],
      'fill-extrusion-base':0,'fill-extrusion-opacity':.94
    }});
    map.addLayer({id:'focus-building-edge',type:'line',source:'focus-building',paint:{'line-color':'#e7f5e9','line-width':1.2,'line-opacity':.65}});
  }
  function nearestBuilding(p,profile){
    if(fallback||!buildingLayers.length)return;
    let fs=[];try{const px=map.project([+p.lon,+p.lat]),pad=28;fs=map.queryRenderedFeatures([[px.x-pad,px.y-pad],[px.x+pad,px.y+pad]],{layers:buildingLayers})||[]}catch{}
    const polys=fs.filter(f=>['Polygon','MultiPolygon'].includes(f.geometry?.type));if(!polys.length){map.getSource('focus-building')?.setData({type:'FeatureCollection',features:[]});return}
    const center=[+p.lon,+p.lat],centroid=g=>{const ring=g.type==='Polygon'?g.coordinates?.[0]:g.coordinates?.[0]?.[0];if(!ring?.length)return center;return ring.reduce((a,x)=>[a[0]+x[0]/ring.length,a[1]+x[1]/ring.length],[0,0])};
    polys.sort((a,b)=>{const A=centroid(a.geometry),B=centroid(b.geometry);return Math.hypot(A[0]-center[0],A[1]-center[1])-Math.hypot(B[0]-center[0],B[1]-center[1])});
    const f=polys[0],pal=profile?.palette||{},props=f.properties||{},h=Number(props.render_height??props.height)||(Number(props.levels||props['building:levels'])||6)*3.05;
    map.getSource('focus-building')?.setData({type:'FeatureCollection',features:[{type:'Feature',properties:{wall:pal.wall||pal.facade||'#a59c88',height:Math.max(4,Math.min(h,130))},geometry:f.geometry}]});
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
    styleBuildings();addFocusLayers();map.on('click',e=>{if(e.originalEvent.target.closest?.('.mapMarker'))return;closeCard()});
    dismissBoot();loadPointsWithRetry();
  }
  function markerNode(p){
    const s=p.marker_style||{},el=document.createElement('button');el.className='mapMarker'+(s.pulse!==false?' pulseMarker':'');el.type='button';el.style.background=s.background||'#10221b';el.style.borderColor=s.border||'#f6f3e9';el.style.opacity=s.opacity??1;el.style.width=(s.size||44)+'px';el.style.height=(s.size||44)+'px';el.style.borderRadius=s.shape==='circle'?'50%':s.shape==='square'?'10px':s.shape==='pin'?'50% 50% 50% 14px':'16px';el.style.transform='translate(-50%,-50%) scale('+(s.scale||1)+')';
    if(p.has_avatar){const img=new Image();img.alt='';img.src=api+'/map/markers/'+p.id+'/avatar';img.onerror=()=>{img.remove();el.insertAdjacentText('afterbegin',s.icon||'🥙')};el.appendChild(img)}else el.textContent=s.icon||'🥙';
    if(s.label_visible){const l=document.createElement('span');l.className='markerLabel';l.textContent=p.name;el.appendChild(l)}
    el.onclick=e=>{e.stopPropagation();selectPoint(p)};return el;
  }
  async function loadPoints(){
    const r=await fetchWithTimeout(api+'/map/points',7000);if(!r.ok)throw new Error('points_'+r.status);
    const data=await r.json();if(!Array.isArray(data))throw new Error('points_invalid');
    points=data;$('#pointsCount').textContent=points.length;
    for(const m of markers.values())m.remove();markers.clear();
    points.forEach(p=>{const el=markerNode(p),m=new maplibregl.Marker({element:el,anchor:'center'}).setLngLat([+p.lon,+p.lat]).addTo(map);markers.set(String(p.id),m)});
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
    map.easeTo({center:[+p.lon,+p.lat],zoom:17.35,pitch:fallback?0:60,bearing:fallback?0:-16,offset:[0,58],duration:900,easing:t=>1-Math.pow(1-t,3)});
    setTimeout(()=>nearestBuilding(p,p.realcity_profile||{}),950);tg?.HapticFeedback?.selectionChanged?.();
  }
  function closeCard(){selected=null;$('#venueCard').classList.remove('show');markers.forEach(m=>m.getElement().classList.remove('selected'));map?.getSource('focus-building')?.setData({type:'FeatureCollection',features:[]})}
  function search(){
    const q=$('#search').value.trim().toLowerCase(),box=$('#results');if(!q){box.classList.add('hidden');return}
    const list=points.filter(x=>(x.name+' '+x.address).toLowerCase().includes(q)).slice(0,8);box.innerHTML=list.length?list.map(x=>'<button class="searchResult" data-id="'+x.id+'"><b>'+esc(x.name)+'</b><small>'+esc(x.address||'')+'</small></button>').join(''):'<div class="empty">Ничего не найдено</div>';box.classList.remove('hidden');
  }

  $('#searchToggle').onclick=()=>{$('#searchBox').classList.toggle('hidden');if(!$('#searchBox').classList.contains('hidden'))setTimeout(()=>$('#search').focus(),60);else $('#results').classList.add('hidden')};
  $('#search').oninput=search;$('#results').onclick=e=>{const b=e.target.closest('[data-id]');if(!b)return;const p=points.find(x=>String(x.id)===b.dataset.id);if(p){selectPoint(p);$('#results').classList.add('hidden')}};
  $('#locate').onclick=()=>{if(!navigator.geolocation)return toast('Геопозиция недоступна');navigator.geolocation.getCurrentPosition(p=>map.easeTo({center:[p.coords.longitude,p.coords.latitude],zoom:15.5,duration:800}),()=>toast('Не удалось получить геопозицию'),{enableHighAccuracy:true,timeout:8000})};
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

  try{tg?.ready();tg?.expand();tg?.BackButton?.hide?.();tg?.setHeaderColor?.('#07100c');tg?.setBackgroundColor?.('#07100c')}catch{}
  authClient().then(ok=>{if(ok){loadDashboard();loadOrders();connectUserStream()}else{renderGuestProfile();renderOrdersPanel()}});
  bootMap().catch(e=>{console.error(e);dismissBoot();toast('Не удалось загрузить подложку карты. Откройте приложение ещё раз.')});
})();