(() => {
  const {api,esc,money}=SHAURMEG,tg=SHAURMEG.telegram;
  const $=s=>document.querySelector(s);
  const qs=new URLSearchParams(location.search);
  let map,points=[],selected=null,markers=new Map(),buildingLayers=[],fallback=false,userMarker=null,userLocation=null,locationRadius=0,focusToken=0,markerRenderFrame=0,orderFocusTimer=0;
  let astraLayer=null,astraScripts=null,quarterFrame=0;
  const baseBuildingPaint=new Map();
  const baseLabelPaint=new Map();
  let session=sessionStorage.getItem('shaurmeg_client_session')||'',dashboard=null,userOrders=[],favoriteGroups=[],orderFilter='all',userStream=null,currentReferralUrl='';
  const reduceMotion=window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches===true;
  const bootStarted=performance.now();
  const STYLE='https://tiles.openfreemap.org/styles/liberty';
  const FALLBACK={version:8,sources:{osm:{type:'raster',tiles:['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],tileSize:256,maxzoom:19,attribution:'© OpenStreetMap contributors'}},layers:[{id:'osm',type:'raster',source:'osm',paint:{'raster-saturation':-.22,'raster-contrast':.08,'raster-brightness-min':.08,'raster-brightness-max':.78}}]};
  const STATUS={new:'Принят',cooking:'Готовится',ready:'Готово',done:'Выполнен',cancelled:'Отменён'};
  const CITY_PALETTES={
    morning:{background:'#B9B7AC',water:'#809EAD',land:'#97A184',residential:'#C8C2B6',building:'#D8D0C3',road:'#E8E4DD',label:'#27343C'},
    day:{background:'#AFAEA5',water:'#7896A6',land:'#8F9B7A',residential:'#C2BDB3',building:'#D4CDC1',road:'#E9E6E0',label:'#24323A'},
    evening:{background:'#504D49',water:'#516D7D',land:'#626B58',residential:'#746F68',building:'#BDB5A9',road:'#CFC9C0',label:'#F0EEE9'},
    night:{background:'#111820',water:'#193242',land:'#232D27',residential:'#2B3134',building:'#8F918E',road:'#8F918D',label:'#E8EBED'}
  };
  const COFFEE_PALETTES={
    morning:{background:'#F8F1E8',water:'#E3EBE5',land:'#F1E5D6',residential:'#E9D8C4',building:'#FFFDF8',road:'#FFFFFF',label:'#513629'},
    day:{background:'#F5EBDD',water:'#DDE8E1',land:'#EFE2D1',residential:'#E5D2BC',building:'#FFFCF6',road:'#FFFDF9',label:'#4B3023'},
    evening:{background:'#F0E2D1',water:'#D9E4DE',land:'#E9DAC8',residential:'#DDC5AA',building:'#FFF8EE',road:'#FFF9F1',label:'#4A3023'},
    night:{background:'#E8D7C3',water:'#D0DDD7',land:'#E1D0BD',residential:'#D4B99D',building:'#F8EEE2',road:'#F9F3EA',label:'#422A1E'}
  };
  const DISCOVERY={
    shawarma:{label:'ШАУРМА',city:'ГОРОД',theme:'#0F2035',cluster:['#D94343','#C83747','#A8263B'],dot:'#D94343',stroke:'#F7F9FC',count:'#FFFFFF',icon:'🥙'},
    coffee:{label:'КОФЕ',city:'КОФЕ',theme:'#F2E6D6',cluster:['#9B6848','#815238','#68402D'],dot:'#7A4D34',stroke:'#FFF9F0',count:'#FFF9F1',icon:'☕'}
  };
  const initialSection=String(qs.get('section')||sessionStorage.getItem('shaurmeg_discovery_mode')||'shawarma').toLowerCase();
  let discoveryMode=initialSection==='coffee'?'coffee':'shawarma';
  document.body.dataset.discoveryMode=discoveryMode;
  window.__SHAURMEG_MAP_STARTED__=true;

  function categoryOf(p){
    const raw=String(p?.category||'shawarma').trim().toLowerCase();
    if(['coffee','cafe','coffee_shop','coffeeshop','кофе','кофейня'].includes(raw))return 'coffee';
    if(!raw||['shawarma','shaurma','шаурма','food'].includes(raw))return 'shawarma';
    return raw;
  }
  function activePoints(){return points.filter(p=>categoryOf(p)===discoveryMode)}
  function daypart(){
    const h=new Date().getHours();
    return h>=5&&h<11?'morning':h>=11&&h<17?'day':h>=17&&h<22?'evening':'night';
  }
  function paletteForMode(part=daypart()){
    const palettes=discoveryMode==='coffee'?COFFEE_PALETTES:CITY_PALETTES;
    return palettes[part]||palettes.day;
  }
  function applyDaypart(){
    const part=daypart(),labels={morning:'УТРО',day:'ДЕНЬ',evening:'ВЕЧЕР',night:'НОЧЬ'};
    document.body.dataset.daypart=part;
    const mode=$('#cityMode');if(mode)mode.querySelector('span').textContent=(DISCOVERY[discoveryMode]?.city||'ГОРОД')+' · '+labels[part];
    return paletteForMode(part);
  }
  let cityPalette=applyDaypart();
  function setHeaderTgId(value){
    const el=$('#headerTgId');if(!el)return;
    const id=String(value||'').trim();
    el.textContent=id?'TG ID · '+id:'TG ID · —';
  }
  setHeaderTgId(tg?.initDataUnsafe?.user?.id||'');
  setDiscoveryMode(discoveryMode,{fit:false,persist:false,announce:false});
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
    if(!session){userOrders=[];renderOrdersPanel();syncActiveOrderSpotlight();return}
    try{
      const r=await fetch(api+'/me/orders',{headers:authHeaders(),cache:'no-store'});if(!r.ok)throw 0;
      userOrders=await r.json();renderOrdersPanel();syncActiveOrderSpotlight();
    }catch{$('#ordersPanelList').innerHTML='<div class="panelEmpty">Не удалось загрузить заказы</div>';syncActiveOrderSpotlight()}
  }
  function renderGuestProfile(){
    setHeaderTgId(tg?.initDataUnsafe?.user?.id||'');
    $('#profileName').textContent='Откройте в Telegram';$('#profileUsername').textContent='Профиль привязывается к Telegram ID';
    $('#profileAvatar').textContent='Ш';$('#avgCheck').textContent='0 ₽';$('#ordersCount').textContent='0';$('#totalSpent').textContent='0 ₽';$('#activeOrders').textContent='0';
    $('#favoriteVenue').textContent='Пока определяем';$('#favoriteMeta').textContent='История появится после авторизации';
    $('#refCode').textContent='—';$('#refInvited').textContent='0';$('#refOrdered').textContent='0';$('#refQualified').textContent='0';$('#bonusBalance').textContent='0';
  }
  function renderDashboard(){
    const d=dashboard||{},u=d.user||{},s=d.stats||{},r=d.referral||{},b=d.bonuses||{},fav=d.favorite_venue;
    const name=[u.first_name,u.last_name].filter(Boolean).join(' ')||u.username||'Пользователь';
    setHeaderTgId(u.id||'');
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
        '<footer><span>'+count+' поз.</span><b>'+money(o.total)+'</b>'+
          (active&&o.marker_id?'<button data-order-focus="'+esc(o.marker_id)+'">На карте</button>':'')+
          (o.marker_id&&o.establishment_id?'<button data-order-menu="'+esc(o.marker_id)+'" data-order-est="'+esc(o.establishment_id)+'">Меню</button>':'')+
        '</footer>'+
      '</article>';
    }).join(''):'<div class="panelEmpty"><b>Здесь пока пусто</b><span>Выберите точку на карте и сделайте первый заказ.</span></div>';
  }

  function currentActiveOrder(){
    return userOrders.find(o=>['new','cooking','ready'].includes(String(o.status||'')))||null;
  }
  function syncActiveOrderSpotlight(){
    const order=currentActiveOrder(),card=$('#activeOrderSpotlight');
    if(!card)return;
    card.classList.toggle('hidden',!order);
    $('#activeOrderDot')?.classList.toggle('hidden',!order);
    if(!order)return;
    const item=(order.items||[])[0]||{};
    $('#activeOrderVenue').textContent=order.venue_name||'Активный заказ';
    $('#activeOrderState').textContent=(STATUS[order.status]||'В работе')+' · '+(order.order_number||'');
    const point=points.find(p=>String(p.id)===String(order.marker_id||''));
    $('#activeOrderDish').textContent=categoryOf(point)==='coffee'?'☕':'🥙';
  }
  function hidePanelsForMap(){
    document.querySelectorAll('.appPanel').forEach(x=>x.classList.remove('show'));
    $('#panelBackdrop')?.classList.remove('show');document.body.classList.remove('panelOpen');
    document.querySelectorAll('.dockBtn').forEach(x=>x.classList.toggle('active',x.dataset.dock==='map'));
    $('#profileBtn')?.classList.remove('active');
  }
  function focusOrderByMarker(markerId){
    const p=points.find(x=>String(x.id)===String(markerId||''));if(!p){toast('Точка заказа пока не найдена на карте');return false}
    if(categoryOf(p)!==discoveryMode)setDiscoveryMode(categoryOf(p),{fit:false,persist:true,announce:false});
    hidePanelsForMap();closeCard();
    selected=p;markers.forEach((m,k)=>m.getElement().classList.toggle('selected',k===String(p.id)));
    document.body.classList.add('orderFocus');clearTimeout(focusOrderByMarker.t);
    focusOrderByMarker.t=setTimeout(()=>document.body.classList.remove('orderFocus'),1800);
    cinematicFocus(p);
    const token=focusToken;
    setTimeout(()=>{if(token===focusToken&&!astraLayer)revealQuarter(p,p.realcity_profile||{})},reduceMotion?160:520);
    selectRealCityProfile(p,token);
    $('#focusHudName').textContent=p.name||'Заказ';
    $('#focusHudState').textContent='ваш заказ здесь';
    tg?.HapticFeedback?.notificationOccurred?.('success');
    return true;
  }
  function focusActiveOrder(){
    const order=currentActiveOrder();return order?focusOrderByMarker(order.marker_id):false;
  }
  async function loadFavorites(){
    const box=$('#favoritesPanelList');
    if(!session){
      favoriteGroups=[];$('#favoritesCount').textContent='0';
      box.innerHTML='<div class="favoritesEmpty"><div>♥</div><b>Избранное живёт в Telegram</b><span>Откройте Shaurmeg через @Shaurmeggbot — здесь появятся любимые блюда из заказов и сохранённые позиции.</span></div>';
      return;
    }
    try{
      const r=await fetch(api+'/me/favorites',{headers:authHeaders(),cache:'no-store'});if(!r.ok)throw 0;
      const j=await r.json();favoriteGroups=Array.isArray(j.groups)?j.groups:[];renderFavorites();
    }catch{
      favoriteGroups=[];$('#favoritesCount').textContent='0';
      box.innerHTML='<div class="favoritesEmpty"><div>!</div><b>Не удалось загрузить избранное</b><span>Попробуйте открыть раздел ещё раз.</span></div>';
    }
  }
  function renderFavorites(){
    const box=$('#favoritesPanelList'),total=favoriteGroups.reduce((s,g)=>s+(g.items?.length||0),0);
    $('#favoritesCount').textContent=String(total);
    if(!favoriteGroups.length){
      box.innerHTML='<div class="favoritesEmpty"><div>♡</div><b>Здесь появится твой вкус</b><span>Закажи блюдо или нажми сердечко в меню заведения — Shaurmeg соберёт любимое здесь.</span></div>';
      return;
    }
    box.innerHTML=favoriteGroups.map(group=>{
      const initial=String(group.venue_name||'Ш').trim().slice(0,1).toUpperCase()||'Ш';
      return '<section class="favoriteVenueGroup">'+
        '<header class="favoriteVenueHead"><div class="favoriteVenueMonogram">'+esc(initial)+'</div><div><small>ЗАВЕДЕНИЕ</small><h3>'+esc(group.venue_name||'Заведение')+'</h3><span>'+esc(group.address||'')+'</span></div><strong>'+String(group.items?.length||0)+'</strong></header>'+
        '<div class="favoriteDishGrid">'+(group.items||[]).map(item=>{
          const meta=item.explicit?(item.order_count?'♥ В избранном · заказывали '+item.order_count+'×':'♥ В избранном'):(item.order_count>1?'Заказывали '+item.order_count+' раза':'Из истории заказов');
          return '<article class="favoriteDishCard">'+
            '<div class="favoriteDishPhoto">'+(item.image?'<img src="'+esc(item.image)+'" alt="" loading="lazy" onerror="this.remove()">':'<span>🥙</span>')+
              (item.explicit?'<i>♥</i>':'')+'</div>'+
            '<div class="favoriteDishBody"><small>'+esc(meta)+'</small><h4>'+esc(item.name||'Позиция')+'</h4>'+
              (item.description?'<p>'+esc(item.description)+'</p>':'')+
              '<div class="favoriteDishFooter"><b>'+money(item.price||0)+'</b><div class="favoriteDishActions">'+
                (item.explicit?'<button class="favoriteRemoveBtn" data-fav-remove="'+esc(item.item_id)+'" data-fav-est="'+esc(group.establishment_id)+'" aria-label="Убрать из избранного">♥</button>':'')+
                '<button class="favoriteOrderBtn" data-fav-order="'+esc(item.item_id)+'" data-fav-marker="'+esc(group.marker_id)+'" data-fav-est="'+esc(group.establishment_id)+'">Заказать <span>→</span></button>'+
              '</div></div></div>'+
          '</article>';
        }).join('')+'</div>'+
      '</section>';
    }).join('');
  }

  function connectUserStream(){
    try{userStream?.close()}catch{};if(!session)return;
    userStream=new EventSource(api+'/me/stream?session='+encodeURIComponent(session));
    const refresh=()=>{loadOrders();loadDashboard();loadFavorites()};
    userStream.addEventListener('order',refresh);userStream.addEventListener('update',refresh);
  }

  function showPanel(kind){
    closeCard();
    const id=kind==='orders'?'ordersPanel':kind==='favorites'?'favoritesPanel':kind==='profile'?'profilePanel':'';
    document.querySelectorAll('.appPanel').forEach(x=>x.classList.toggle('show',x.id===id));
    $('#panelBackdrop').classList.toggle('show',!!id);document.body.classList.toggle('panelOpen',!!id);
    document.querySelectorAll('.dockBtn').forEach(x=>x.classList.toggle('active',x.dataset.dock===(kind||'map')));
    $('#profileBtn')?.classList.toggle('active',kind==='profile');
    if(kind==='orders')loadOrders();if(kind==='favorites')loadFavorites();if(kind==='profile')loadDashboard();
    tg?.HapticFeedback?.selectionChanged?.();
  }
  function openPanel(kind){
    clearTimeout(orderFocusTimer);
    if(kind==='orders'&&currentActiveOrder()&&focusActiveOrder()){
      orderFocusTimer=setTimeout(()=>showPanel('orders'),reduceMotion?120:820);
      return;
    }
    showPanel(kind);
  }
  function closePanels(){showPanel('map')}

  function roadTone(id){
    const night=daypart()==='night';
    if(/motorway|trunk|primary/i.test(id))return night?'#B9A990':'#EEE7DA';
    if(/secondary|tertiary/i.test(id))return night?'#9C9890':'#DEDAD2';
    if(/service|path|track|foot|cycle/i.test(id))return night?'#666C6D':'#C6C4BC';
    return cityPalette.road;
  }
  function applyCityLight(){
    if(!map||fallback||typeof map.setLight!=='function')return;
    const part=daypart();
    const lights={
      morning:{color:'#FFE1B8',intensity:.42,position:[1.15,118,42]},
      day:{color:'#FFF6E7',intensity:.48,position:[1.18,180,38]},
      evening:{color:'#FFB977',intensity:.34,position:[1.2,238,26]},
      night:{color:'#9CC8F3',intensity:.22,position:[1.18,212,20]}
    };
    try{map.setLight({anchor:'map',...lights[part]})}catch{}
  }
  function styleBuildings(){
    const layers=map.getStyle()?.layers||[];
    buildingLayers=layers.filter(x=>x.type==='fill-extrusion'||(/building/i.test(x.id)&&x.type==='fill')).map(x=>x.id);
    const part=daypart(),night=part==='night',evening=part==='evening';
    for(const l of layers){
      const id=String(l.id||'');
      try{
        if(l.type==='background')map.setPaintProperty(l.id,'background-color',cityPalette.background);
        if(l.type==='fill'&&/water|river|lake|ocean/i.test(id)){
          map.setPaintProperty(l.id,'fill-color',cityPalette.water);
          map.setPaintProperty(l.id,'fill-opacity',night?.94:.9);
        }else if(l.type==='fill'&&/park|grass|wood|vegetation|forest|landcover|meadow|garden/i.test(id)){
          map.setPaintProperty(l.id,'fill-color',cityPalette.land);
          map.setPaintProperty(l.id,'fill-opacity',night?.84:.94);
        }else if(l.type==='fill'&&/industrial|commercial/i.test(id)){
          map.setPaintProperty(l.id,'fill-color',night?'#303337':'#B6B1A8');
          map.setPaintProperty(l.id,'fill-opacity',.76);
        }else if(l.type==='fill'&&/residential|landuse|land/i.test(id)){
          map.setPaintProperty(l.id,'fill-color',cityPalette.residential);
          map.setPaintProperty(l.id,'fill-opacity',night?.84:.91);
        }
        if(l.type==='fill'&&/building/i.test(id)){
          map.setPaintProperty(l.id,'fill-color',cityPalette.building);
          map.setPaintProperty(l.id,'fill-opacity',night?.66:.76);
        }
        if(l.type==='fill-extrusion'&&/building/i.test(id)){
          map.setPaintProperty(l.id,'fill-extrusion-color',cityPalette.building);
          map.setPaintProperty(l.id,'fill-extrusion-opacity',night?.84:.94);
          try{map.setPaintProperty(l.id,'fill-extrusion-vertical-gradient',true)}catch{}
        }
        if(l.type==='line'&&/rail|railway/i.test(id)){
          map.setPaintProperty(l.id,'line-color',night?'#555C61':'#747877');
          map.setPaintProperty(l.id,'line-opacity',night?.62:.7);
        }else if(l.type==='line'&&/road|street|highway|path|motorway|trunk|primary|secondary|tertiary|service/i.test(id)){
          map.setPaintProperty(l.id,'line-color',roadTone(id));
          map.setPaintProperty(l.id,'line-opacity',/path|track|foot|cycle/i.test(id)?(night?.42:.55):(evening?.76:night?.66:.84));
        }
        if(l.type==='symbol'&&/road|place|poi|label/i.test(id)){
          map.setPaintProperty(l.id,'text-color',cityPalette.label);
          map.setPaintProperty(l.id,'text-halo-color',night?'rgba(12,18,24,.84)':'rgba(238,235,227,.82)');
          map.setPaintProperty(l.id,'text-halo-width',night?1.15:1.35);
          try{map.setPaintProperty(l.id,'text-halo-blur',.35)}catch{}
        }
      }catch{}
    }
    for(const id of buildingLayers){
      const type=map.getLayer(id)?.type,props=type==='fill-extrusion'?['fill-extrusion-height','fill-extrusion-base']:['fill-opacity'];
      baseBuildingPaint.set(id,Object.fromEntries(props.map(p=>[p,map.getPaintProperty(id,p)])));
    }
    for(const l of layers)if(l.type==='symbol'&&/poi|housenumber|transit|place/i.test(l.id))baseLabelPaint.set(l.id,{'text-opacity':map.getPaintProperty(l.id,'text-opacity'),'icon-opacity':map.getPaintProperty(l.id,'icon-opacity')});
    applyCityLight();
  }
  function buildingHeightExpression(){
    return ['max',3,['coalesce',
      ['to-number',['get','render_height'],0],
      ['to-number',['get','height'],0],
      ['*',['coalesce',['to-number',['get','building:levels'],0],['to-number',['get','levels'],0]],3.05],
      9
    ]];
  }
  function buildingBaseExpression(){
    return ['coalesce',['to-number',['get','render_min_height'],0],['to-number',['get','min_height'],0],0];
  }
  function enhanceCityDepth(){
    if(fallback||map.getLayer('city-building-depth'))return;
    const baseId=buildingLayers.find(id=>map.getLayer(id)?.source&&map.getLayer(id)?.['source-layer']);
    const base=baseId?map.getLayer(baseId):null;if(!base?.source||!base['source-layer'])return;
    const source=base.source,sourceLayer=base['source-layer'],height=buildingHeightExpression(),baseHeight=buildingBaseExpression();
    try{
      map.addLayer({
        id:'city-building-shadow',type:'fill-extrusion',source,'source-layer':sourceLayer,minzoom:13.4,
        paint:{
          'fill-extrusion-color':'#11171A',
          'fill-extrusion-height':height,'fill-extrusion-base':baseHeight,
          'fill-extrusion-opacity':['interpolate',['linear'],['zoom'],13.4,0,14.3,.11,16,.2],
          'fill-extrusion-translate':[2.2,3.2],'fill-extrusion-translate-anchor':'viewport',
          'fill-extrusion-vertical-gradient':true
        }
      });
      map.addLayer({
        id:'city-building-depth',type:'fill-extrusion',source,'source-layer':sourceLayer,minzoom:13.5,
        paint:{
          'fill-extrusion-color':['match',['downcase',['coalesce',['get','building:material'],'']],
            'brick',discoveryMode==='coffee'?'#C8A27E':'#B49A86',
            'glass',discoveryMode==='coffee'?'#C7C5BD':'#AEBEC3',
            'concrete',discoveryMode==='coffee'?'#D5C3AE':'#C2BCB2',
            'stone',discoveryMode==='coffee'?'#D4BFA3':'#C8BBA7',
            'metal',discoveryMode==='coffee'?'#BEB9AF':'#AEB5B6',
            'wood',discoveryMode==='coffee'?'#A98566':'#9A826D',
            cityPalette.building],
          'fill-extrusion-height':height,'fill-extrusion-base':baseHeight,
          'fill-extrusion-opacity':['interpolate',['linear'],['zoom'],13.5,.18,14.4,.62,15.4,.9,17,.96],
          'fill-extrusion-vertical-gradient':true
        }
      });
      map.addLayer({
        id:'city-building-outline',type:'line',source,'source-layer':sourceLayer,minzoom:14.1,
        paint:{
          'line-color':daypart()==='night'?'#B7C1C5':'#7C766D',
          'line-width':['interpolate',['linear'],['zoom'],14.1,.25,16,.7,18,1],
          'line-opacity':['interpolate',['linear'],['zoom'],14.1,.08,16,.25,18,.36]
        }
      });
      map.addLayer({
        id:'city-landmark-extrusions',type:'fill-extrusion',source,'source-layer':sourceLayer,minzoom:14.2,
        filter:['any',['has','name'],['has','name:ru'],['has','name:en']],
        paint:{
          'fill-extrusion-color':['interpolate',['linear'],['zoom'],14.2,cityPalette.building,16,discoveryMode==='coffee'?'#D8B38D':'#D2B58E',18,discoveryMode==='coffee'?'#C79B73':'#C89C67'],
          'fill-extrusion-height':height,'fill-extrusion-base':baseHeight,
          'fill-extrusion-opacity':['interpolate',['linear'],['zoom'],14.2,.18,15.2,.55,17,.84],
          'fill-extrusion-vertical-gradient':true
        }
      });
      map.addLayer({
        id:'city-landmark-outline',type:'line',source,'source-layer':sourceLayer,minzoom:15,
        filter:['any',['has','name'],['has','name:ru'],['has','name:en']],
        paint:{
          'line-color':discoveryMode==='coffee'?'#EAC69F':'#E5C27E',
          'line-width':['interpolate',['linear'],['zoom'],15,.5,18,1.4],
          'line-opacity':['interpolate',['linear'],['zoom'],15,.14,18,.52]
        }
      });
    }catch(e){console.warn('city depth skipped',e)}
  }
  function refreshCityDepth(){
    if(!map?.getLayer('city-building-depth'))return enhanceCityDepth();
    try{
      map.setPaintProperty('city-building-depth','fill-extrusion-color',
        ['match',['downcase',['coalesce',['get','building:material'],'']],
          'brick',discoveryMode==='coffee'?'#C8A27E':'#B49A86',
          'glass',discoveryMode==='coffee'?'#C7C5BD':'#AEBEC3',
          'concrete',discoveryMode==='coffee'?'#D5C3AE':'#C2BCB2',
          'stone',discoveryMode==='coffee'?'#D4BFA3':'#C8BBA7',
          'metal',discoveryMode==='coffee'?'#BEB9AF':'#AEB5B6',
          'wood',discoveryMode==='coffee'?'#A98566':'#9A826D',
          cityPalette.building]);
      map.setPaintProperty('city-landmark-extrusions','fill-extrusion-color',
        ['interpolate',['linear'],['zoom'],14.2,cityPalette.building,16,discoveryMode==='coffee'?'#D8B38D':'#D2B58E',18,discoveryMode==='coffee'?'#C79B73':'#C89C67']);
      map.setPaintProperty('city-building-outline','line-color',daypart()==='night'?'#B7C1C5':'#7C766D');
      map.setPaintProperty('city-landmark-outline','line-color',discoveryMode==='coffee'?'#EAC69F':'#E5C27E');
      applyCityLight();
    }catch{}
  }

  function styleVenueClusters(){
    if(!map)return;
    const theme=DISCOVERY[discoveryMode]||DISCOVERY.shawarma;
    try{
      if(map.getLayer('venue-clusters')){
        map.setPaintProperty('venue-clusters','circle-color',['step',['get','point_count'],theme.cluster[0],20,theme.cluster[1],80,theme.cluster[2]]);
        map.setPaintProperty('venue-clusters','circle-stroke-color',theme.stroke);
      }
      if(map.getLayer('venue-cluster-count'))map.setPaintProperty('venue-cluster-count','text-color',theme.count);
      if(map.getLayer('venue-single-dot')){
        map.setPaintProperty('venue-single-dot','circle-color',theme.dot);
        map.setPaintProperty('venue-single-dot','circle-stroke-color',theme.stroke);
      }
    }catch{}
  }
  function setDiscoveryMode(mode,{fit=true,persist=true,announce=true}={}){
    const next=mode==='coffee'?'coffee':'shawarma';
    if(selected&&categoryOf(selected)!==next)closeCard();
    discoveryMode=next;
    document.body.dataset.discoveryMode=next;
    cityPalette=applyDaypart();
    const meta=document.querySelector('meta[name="theme-color"]');if(meta)meta.setAttribute('content',DISCOVERY[next].theme);
    const caption=$('#sectionToggleCaption');if(caption)caption.textContent=DISCOVERY[next].label;
    const toggle=$('#sectionToggle');if(toggle){
      toggle.dataset.mode=next;
      toggle.setAttribute('aria-label',next==='coffee'?'Сейчас раздел кофе. Переключить на шаурму':'Сейчас раздел шаурмы. Переключить на кофе');
    }
    const input=$('#search');if(input)input.placeholder=next==='coffee'?'Найти кофейню или адрес…':'Найти заведение или адрес…';
    document.title=next==='coffee'?'Шаурмег · кофе':'Шаурмег · карта';
    if(persist){
      sessionStorage.setItem('shaurmeg_discovery_mode',next);
      try{const u=new URL(location.href);u.searchParams.set('section',next);history.replaceState(null,'',u.pathname+u.search+u.hash)}catch{}
    }
    if(map){
      styleBuildings();refreshCityDepth();styleVenueClusters();
      map.getSource('venue-points')?.setData(venueGeoJSON(activePoints()));
    }
    const current=activePoints();
    const counter=$('#pointsCount');if(counter)counter.textContent=current.length;
    clearDomMarkers();renderVisibleMarkers();
    if(fit&&current.length)fitAll();
    if(announce)toast((next==='coffee'?'Кофе':'Шаурма')+' · '+current.length+' точек');
    tg?.HapticFeedback?.selectionChanged?.();
  }

  function setPhotoLabels(marker){
    const covered=marker?['<',['distance',{type:'Point',coordinates:[Number(marker.lon),Number(marker.lat)]}],244]:null;
    const mask=value=>{
      if(Array.isArray(value)&&['interpolate','interpolate-hcl','interpolate-lab'].includes(value[0])&&value[2]?.[0]==='zoom')return value.map((v,i)=>i>=4&&i%2===0?mask(v):v);
      if(Array.isArray(value)&&value[0]==='step'&&value[1]?.[0]==='zoom')return value.map((v,i)=>i>=2&&i%2===0?mask(v):v);
      return ['case',covered,0,value??1];
    };
    for(const [id,props] of baseLabelPaint)for(const [prop,value] of Object.entries(props))try{map.setPaintProperty(id,prop,marker?mask(value):value??1)}catch{}
  }
  function addFocusLayers(){
    if(map.getSource('focus-building'))return;

    map.addSource('focus-flight',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
    map.addLayer({id:'focus-flight-glow',type:'line',source:'focus-flight',paint:{'line-color':'#D94343','line-width':7,'line-opacity':.09,'line-blur':4}});
    map.addLayer({id:'focus-flight-core',type:'line',source:'focus-flight',paint:{'line-color':'#FFFFFF','line-width':1.2,'line-opacity':.48,'line-dasharray':[1.4,1.1]}});

    map.addSource('focus-zone',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
    map.addLayer({id:'focus-zone-glow',type:'circle',source:'focus-zone',paint:{'circle-radius':['interpolate',['linear'],['zoom'],12,22,18,62],'circle-color':'#D94343','circle-opacity':.08,'circle-blur':.7,'circle-stroke-width':1,'circle-stroke-color':'#FFFFFF','circle-stroke-opacity':.26}});
    map.addLayer({id:'focus-zone-core',type:'circle',source:'focus-zone',paint:{'circle-radius':['interpolate',['linear'],['zoom'],12,7,18,16],'circle-color':'#315D93','circle-opacity':.08,'circle-stroke-width':1.2,'circle-stroke-color':'#FFFFFF','circle-stroke-opacity':.38}});

    map.addSource('user-radius',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
    map.addLayer({id:'user-radius-fill',type:'fill',source:'user-radius',paint:{'fill-color':'#5AB2FF','fill-opacity':.075}});
    map.addLayer({id:'user-radius-line',type:'line',source:'user-radius',paint:{'line-color':'#8ACBFF','line-width':1.4,'line-opacity':.7,'line-dasharray':[2,1.5]}});

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
      'fill-extrusion-base':['coalesce',['get','base'],0],
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
      'fill-extrusion-base':['coalesce',['get','base'],0],'fill-extrusion-opacity':.97
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
  function setBaseBuildingsDim(active,features=[]){
    // `within` does not evaluate polygon features in MapLibre. Distance to an
    // inset footprint detects overlapping native polygons, without hiding a
    // neighboring building merely because its wall touches the reconstructed one.
    const polygons=features.map(f=>{
      const r=f.geometry?.coordinates?.[0];if(!r?.length)return null;
      const ring=window.RealCitySpatial.bufferRing(r,-.3);
      return {type:'Feature',properties:{},geometry:{type:'Polygon',coordinates:[ring]}};
    }).filter(Boolean);
    const covered=['<',['distance',{type:'FeatureCollection',features:polygons}],.05];
    const mask=value=>{
      // MapLibre requires zoom to remain at the top-level ramp.
      if(Array.isArray(value)&&['interpolate','interpolate-hcl','interpolate-lab'].includes(value[0])&&value[2]?.[0]==='zoom')return value.map((v,i)=>i>=4&&i%2===0?mask(v):v);
      if(Array.isArray(value)&&value[0]==='step'&&value[1]?.[0]==='zoom')return value.map((v,i)=>i>=2&&i%2===0?mask(v):v);
      return ['case',covered,0,value];
    };
    for(const id of buildingLayers){
      try{
        const type=map.getLayer(id)?.type;
        const saved=baseBuildingPaint.get(id)||{};
        for(const [prop,value] of Object.entries(saved)){
          const initial=value??(prop==='fill-opacity'?1:0);
          map.setPaintProperty(id,prop,active&&polygons.length?mask(initial):initial);
        }
      }catch{}
    }
  }
  function loadAstraRenderer(){
    if(window.RealCityLayer)return Promise.resolve();
    if(astraScripts)return astraScripts;
    const load=src=>new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=src+'?v=realcity-photo-materials-3';s.onload=resolve;s.onerror=()=>{s.remove();reject(new Error('astra_renderer_unavailable'))};document.head.appendChild(s)});
    astraScripts=(window.RealCitySpatial?Promise.resolve():load('realcity-spatial.js')).then(()=>load('vendor/earcut.min.js')).then(()=>load('realcity-layer.js')).catch(e=>{astraScripts=null;throw e});
    return astraScripts;
  }
  function removeAstraLayer(){
    if(map.getLayer('realcity-astra-facades'))map.removeLayer('realcity-astra-facades');astraLayer=null;
  }
  async function selectRealCityProfile(p,token){
    try{
      const r=await fetchWithTimeout(api+'/map/markers/'+encodeURIComponent(p.id)+'/realcity?establishment_id='+encodeURIComponent(p.establishment_id),10000);
      if(!r.ok)return;
      const j=await r.json();if(token!==focusToken||String(j.marker_id)!==String(p.id)||j.establishment_id!==p.establishment_id||j.venue_id!==p.venue_id)return;
      p.realcity_profile=j.profile||p.realcity_profile;
      if(j.profile?.astra?.status==='ready'){
        await loadAstraRenderer();if(token!==focusToken)return;
        if(window.RealCitySpatial.bound(j.profile.astra,p,j.profile.scene)){
          removeAstraLayer();
          const layer=window.RealCityLayer.create({marker:p,profile:j.profile,reducedMotion:reduceMotion,onError:e=>console.warn('Astra renderer fallback',e.message)});
          if(layer){map.addLayer(layer);if(layer.ready)astraLayer=layer;else removeAstraLayer();}
        }
      }
      if(token!==focusToken)return;
      if(astraLayer){
        const cam=j.profile.astra.camera,offset=Math.max(24,Math.min(120,innerHeight/2-$('#venueCard').offsetHeight-124));
        map.easeTo({center:[+p.lon,+p.lat],zoom:cam.zoom,pitch:cam.pitch,bearing:cam.bearing,offset:[0,offset],duration:reduceMotion?0:850});
        $('#realBadge').textContent='REAL CITY · ASTRA';
        const views=j.profile.astra.camera.views||[],box=$('#realCityViews');
        box.replaceChildren();box.classList.toggle('hidden',!views.length);
        for(const view of views){const button=document.createElement('button');button.textContent=view.label;button.type='button';button.setAttribute('aria-pressed','false');button.onclick=()=>{
          document.body.classList.add('realCityExploring');$('#focusHud').classList.remove('show');
          box.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));
          map.easeTo({center:view.center||[+p.lon,+p.lat],bearing:view.bearing,pitch:view.pitch,zoom:view.zoom,offset:[0,70],duration:reduceMotion?0:1000});
        };box.appendChild(button);}
      }
      revealQuarter(p,p.realcity_profile);
    }catch(e){if(token===focusToken)console.warn('RealCity profile',e.message)}
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
        base:Math.max(0,Number(b.base_m)||0),
        levels:Number(b.levels)||1,style:String(b.style||'')
      },geometry:{type:'Polygon',coordinates:[ring]}};
    };
    const heroFeature=hero?feature(hero):null,contextFeatures=context.map(feature).filter(Boolean);
    const roads=(scene.roads||[]).slice(0,28).map(line=>{
      const coords=(Array.isArray(line)?line:[]).map(x=>[Number(x?.[0]),Number(x?.[1])]).filter(x=>Number.isFinite(x[0])&&Number.isFinite(x[1]));
      return coords.length>1?{type:'Feature',properties:{},geometry:{type:'LineString',coordinates:coords}}:null;
    }).filter(Boolean);
    const greens=[...(profile.astra?.environment?.greens||[]),...(scene.greens||[])].slice(0,48).map(ring=>{
      const coords=closeRing(ring);return coords.length>3?{type:'Feature',properties:{},geometry:{type:'Polygon',coordinates:[coords]}}:null;
    }).filter(Boolean);
    const trees=(scene.trees||[]).slice(0,reduceMotion?22:48).map((t,i)=>({
      type:'Feature',properties:{color:i%3===0?'#6f956b':i%3===1?'#547c58':'#618765'},
      geometry:{type:'Point',coordinates:[Number(t.lon),Number(t.lat)]}
    })).filter(x=>Number.isFinite(x.geometry.coordinates[0])&&Number.isFinite(x.geometry.coordinates[1]));
    return {heroFeature,contextFeatures,roads,greens,trees,radius:Math.max(80,Math.min(Number(scene.radius_m)||170,220))};
  }
  function clearQuarter(){
    cancelAnimationFrame(quarterFrame);removeAstraLayer();
    $('#realCityViews').classList.add('hidden');$('#realCityViews').replaceChildren();document.body.classList.remove('realCityExploring','realCityPhotographic');
    for(const id of ['realcity-ground','realcity-greens','realcity-roads','realcity-context','realcity-trees','focus-building'])map.getSource(id)?.setData(emptyGeo());
    try{map.setPaintProperty('realcity-ground-fill','fill-opacity',0)}catch{}
    try{map.setPaintProperty('realcity-greens-fill','fill-opacity',0)}catch{}
    try{map.setPaintProperty('realcity-roads-glow','line-opacity',0)}catch{}
    try{map.setPaintProperty('realcity-roads-core','line-opacity',0)}catch{}
    setBaseBuildingsDim(false);setPhotoLabels(null);document.body.classList.remove('realCityActive','realCitySettled');
  }
  function revealQuarter(p,profile){
    cancelAnimationFrame(quarterFrame);
    const token=focusToken,data=buildQuarterData(p,profile);
    if(!data.heroFeature&&!data.contextFeatures.length){
      setTimeout(()=>{if(token===focusToken)nearestBuilding(p,profile)},reduceMotion?0:360);
      return;
    }
    const replaced=new Set(astraLayer?profile.astra.buildings.map(b=>b.building_id):[]);
    if(astraLayer)for(const b of profile.scene.buildings){
      if(replaced.has(String(b.id)))continue;
      // Some vector tiles contain both the building envelope and its inner
      // parts. Do not draw a second roof through an authored envelope.
      if(profile.astra.buildings.some(a=>a.height_m>=b.height&&window.RealCitySpatial.containsRing(profile.scene.buildings.find(x=>String(x.id)===a.building_id).ring,b.ring)))replaced.add(String(b.id));
    }
    const covered=(profile.scene?.buildings||[]).filter(b=>replaced.has(String(b.id))).map(b=>({type:'Feature',properties:{},geometry:{type:'Polygon',coordinates:[b.ring]}}));
    document.body.classList.add('realCityActive');
    // OpenFreeMap can group distant buildings into one MultiPolygon feature.
    // A distance expression hides the whole feature, not just its local part.
    // Authored neighbors cover the native surfaces directly; only the clinic's
    // distinct footprint needs hiding for its different roof/wing heights.
    setBaseBuildingsDim(true,astraLayer?[data.heroFeature].filter(Boolean):[data.heroFeature,...data.contextFeatures,...covered].filter(Boolean));
    map.getSource('realcity-ground')?.setData(circlePolygon(p,data.radius));
    map.getSource('realcity-greens')?.setData({type:'FeatureCollection',features:data.greens});
    map.getSource('realcity-roads')?.setData({type:'FeatureCollection',features:data.roads});
    map.getSource('realcity-trees')?.setData({type:'FeatureCollection',features:data.trees});
    const photoGround=!!(astraLayer&&profile.astra.environment?.roads?.length);
    setPhotoLabels(photoGround?p:null);
    document.body.classList.toggle('realCityPhotographic',photoGround);
    try{map.setPaintProperty('realcity-ground-fill','fill-color',photoGround?'#bbbdb2':['coalesce',['get','ground'],'#d8d3c8']);map.setPaintProperty('realcity-ground-fill','fill-opacity',photoGround?.86:daypart()==='night'?.16:.22)}catch{}
    try{map.setPaintProperty('realcity-greens-fill','fill-opacity',photoGround?.9:.34)}catch{}
    try{map.setPaintProperty('realcity-roads-glow','line-opacity',photoGround?0:.16)}catch{}
    try{map.setPaintProperty('realcity-roads-core','line-opacity',photoGround?0:daypart()==='night'?.42:.56)}catch{}
    $('#focusHudState').textContent='собираем цифровой квартал';

    const contextSource=map.getSource('realcity-context'),heroSource=map.getSource('focus-building');
    const duration=reduceMotion?1:980,started=performance.now();
    const context=astraLayer?[]:data.contextFeatures.filter(f=>!replaced.has(f.properties.id)),hero=data.heroFeature&&!replaced.has(data.heroFeature.properties.id)?data.heroFeature:null;
    if(!hero)heroSource?.setData(emptyGeo());
    const render=(now)=>{
      if(token!==focusToken)return;
      const elapsed=now-started;
      astraLayer?.setProgress(reduceMotion?1:Math.min(1,elapsed/duration));
      const grown=context.map((f,index)=>{
        const delay=reduceMotion?0:Math.min(index,16)*22;
        const t=reduceMotion?1:Math.max(0,Math.min(1,(elapsed-delay)/610)),e=1-Math.pow(1-t,3);
        return {...f,properties:{...f.properties,height:Math.max(.8,f.properties.base+(f.properties.targetHeight-f.properties.base)*e)}};
      });
      contextSource?.setData({type:'FeatureCollection',features:grown});
      if(hero){
        const delay=reduceMotion?0:150,t=reduceMotion?1:Math.max(0,Math.min(1,(elapsed-delay)/650)),e=1-Math.pow(1-t,3);
        heroSource?.setData({type:'FeatureCollection',features:[{...hero,properties:{...hero.properties,height:Math.max(.8,hero.properties.base+(hero.properties.targetHeight-hero.properties.base)*e)}}]});
      }
      if(elapsed<duration)quarterFrame=requestAnimationFrame(render);
      else{
        document.body.classList.add('realCitySettled');
        $('#focusHudState').textContent=astraLayer?'фасады по вашим фото':'геометрия квартала';
        if(astraLayer)setTimeout(()=>{if(token===focusToken)$('#focusHud').classList.remove('show')},1400);
        tg?.HapticFeedback?.impactOccurred?.('light');
      }
    };
    quarterFrame=requestAnimationFrame(render);
  }
  function setFocusZone(p){map.getSource('focus-zone')?.setData(p?pointFeature(p):emptyGeo())}
  function setFlight(from,p){
    map.getSource('focus-flight')?.setData(from&&p?{type:'FeatureCollection',features:[{type:'Feature',properties:{},geometry:{type:'LineString',coordinates:[[+from.lng,+from.lat],[+p.lon,+p.lat]]}}]}:emptyGeo());
  }
  function showFocusHud(p){
    const hud=$('#focusHud');if(!hud)return;
    $('#focusHudName').textContent=p.name||'Заведение';$('#focusHudState').textContent='входим в квартал';
    hud.classList.add('show');clearTimeout(showFocusHud.t);clearTimeout(showFocusHud.t2);
    showFocusHud.t=setTimeout(()=>{if(!document.body.classList.contains('realCitySettled')&&$('#focusHudState'))$('#focusHudState').textContent='собираем окружение'},720);
    showFocusHud.t2=setTimeout(()=>hud.classList.remove('show'),3300);
  }
  function cinematicFocus(p){
    const token=++focusToken,from=map.getCenter();
    setFlight(from,p);setFocusZone(p);showFocusHud(p);
    document.body.classList.add('cityFocus');$('#mapFocusFlash')?.classList.add('active');
    map.stop();
    if(reduceMotion){
      map.easeTo({center:[+p.lon,+p.lat],zoom:17.25,pitch:fallback?0:48,bearing:fallback?0:-10,offset:[0,46],duration:320});
    }else{
      const seed=Number(p.id)||1,cam=p.realcity_profile?.camera||{},bearing=Number.isFinite(Number(cam.bearing))?Number(cam.bearing):(-16+((seed%5)-2)*3);
      map.flyTo({center:[+p.lon,+p.lat],zoom:Number(cam.zoom)||17.65,pitch:fallback?0:Math.min(55,Number(cam.pitch)||52),bearing:fallback?0:bearing,offset:[0,44],duration:1180,curve:1.42,speed:.92,essential:true});
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
  function validMapPoint(p){
    const lat=Number(p?.lat),lon=Number(p?.lon);
    return Number.isFinite(lat)&&Number.isFinite(lon)&&lat>=-85&&lat<=85&&lon>=-180&&lon<=180&&p?.id!=null;
  }
  function venueGeoJSON(list=activePoints()){
    return {type:'FeatureCollection',features:(list||[]).filter(validMapPoint).map(p=>({
      type:'Feature',id:Number.isFinite(Number(p.id))?Number(p.id):undefined,
      properties:{marker_id:String(p.id)},
      geometry:{type:'Point',coordinates:[Number(p.lon),Number(p.lat)]}
    }))};
  }
  function ensureVenueClusterLayers(){
    if(map.getSource('venue-points'))return;
    map.addSource('venue-points',{type:'geojson',data:venueGeoJSON([]),cluster:true,clusterRadius:58,clusterMaxZoom:12});
    map.addLayer({
      id:'venue-clusters',type:'circle',source:'venue-points',
      filter:['has','point_count'],maxzoom:13,
      paint:{
        'circle-color':['step',['get','point_count'],'#D94343',20,'#C83747',80,'#A8263B'],
        'circle-radius':['step',['get','point_count'],18,20,22,80,27],
        'circle-stroke-width':2,'circle-stroke-color':'#F7F9FC','circle-stroke-opacity':.82,
        'circle-opacity':.94
      }
    });
    if(!fallback)map.addLayer({
      id:'venue-cluster-count',type:'symbol',source:'venue-points',
      filter:['has','point_count'],maxzoom:13,
      layout:{'text-field':['get','point_count_abbreviated'],'text-size':11},
      paint:{'text-color':'#FFFFFF'}
    });
    map.addLayer({
      id:'venue-single-dot',type:'circle',source:'venue-points',
      filter:['!',['has','point_count']],maxzoom:13,
      paint:{
        'circle-color':'#D94343','circle-radius':6,
        'circle-stroke-width':2,'circle-stroke-color':'#F7F9FC','circle-stroke-opacity':.9,
        'circle-opacity':.94
      }
    });

    map.on('click','venue-clusters',async e=>{
      const feature=e.features?.[0],clusterId=feature?.properties?.cluster_id;
      if(clusterId==null)return;
      try{
        const source=map.getSource('venue-points');
        const zoom=await source.getClusterExpansionZoom(Number(clusterId));
        map.easeTo({center:feature.geometry.coordinates,zoom:Math.min(14,Number(zoom)||13),duration:520,essential:true});
        tg?.HapticFeedback?.selectionChanged?.();
      }catch{}
    });
    map.on('click','venue-single-dot',e=>{
      const id=String(e.features?.[0]?.properties?.marker_id||'');
      const p=activePoints().find(x=>String(x.id)===id);if(p)selectPoint(p);
    });
    const interactiveLayers=['venue-clusters','venue-single-dot'];if(!fallback)interactiveLayers.push('venue-cluster-count');
    for(const layer of interactiveLayers){
      map.on('mouseenter',layer,()=>{map.getCanvas().style.cursor='pointer'});
      map.on('mouseleave',layer,()=>{map.getCanvas().style.cursor=''});
    }
    styleVenueClusters();
  }
  function clearDomMarkers(){
    for(const m of markers.values())m.remove();
    markers.clear();
  }
  function renderVisibleMarkers(){
    if(!map)return;
    const modePoints=activePoints();
    if(!modePoints.length){clearDomMarkers();return}
    cancelAnimationFrame(markerRenderFrame);
    markerRenderFrame=requestAnimationFrame(()=>{
      const zoom=map.getZoom();
      if(zoom<12.8){clearDomMarkers();return}
      const bounds=map.getBounds(),center=map.getCenter();
      const latPad=Math.max(.002,(bounds.getNorth()-bounds.getSouth())*.18);
      const lonPad=Math.max(.002,(bounds.getEast()-bounds.getWest())*.18);
      let visible=modePoints.filter(p=>{
        const lat=Number(p.lat),lon=Number(p.lon);
        return validMapPoint(p)&&lat>=bounds.getSouth()-latPad&&lat<=bounds.getNorth()+latPad&&lon>=bounds.getWest()-lonPad&&lon<=bounds.getEast()+lonPad;
      });
      if(selected&&validMapPoint(selected)&&!visible.some(p=>String(p.id)===String(selected.id)))visible.push(selected);
      if(visible.length>160){
        visible.sort((a,b)=>{
          const ad=(Number(a.lon)-center.lng)**2+(Number(a.lat)-center.lat)**2;
          const bd=(Number(b.lon)-center.lng)**2+(Number(b.lat)-center.lat)**2;
          return ad-bd;
        });
        visible=visible.slice(0,160);
      }
      const wanted=new Set(visible.map(p=>String(p.id)));
      for(const [id,m] of markers)if(!wanted.has(id)){m.remove();markers.delete(id)}
      visible.forEach((p,index)=>{
        const id=String(p.id);
        if(!markers.has(id)){
          const el=markerNode(p,index,visible.length<=40);
          const m=new maplibregl.Marker({element:el,anchor:'center'}).setLngLat([Number(p.lon),Number(p.lat)]).addTo(map);
          markers.set(id,m);
        }
        markers.get(id)?.getElement()?.classList.toggle('selected',!!selected&&String(selected.id)===id);
      });
    });
  }
  function createMap(style){return new maplibregl.Map({container:'map',style,center:[37.6176,55.7558],zoom:10.55,pitch:32,bearing:-7,maxPitch:68,canvasContextAttributes:{antialias:true,preserveDrawingBuffer:false},attributionControl:false,renderWorldCopies:false,fadeDuration:120})}
  // A ready style can accept venue/RealCity sources while base tiles still stream.
  // Waiting for `load` made slow tiles discard a perfectly usable vector map.
  function waitLoad(m,ms=20000){return new Promise((resolve,reject)=>{
    let done=false;const ready=()=>end(),removed=()=>end(new Error('map_removed'));
    const warning=e=>console.warn('map',e?.error||e);
    const t=setTimeout(()=>end(new Error('map_style_timeout')),ms);
    function end(e){if(done)return;done=true;clearTimeout(t);m.off('style.load',ready);m.off('load',ready);m.off('remove',removed);m.off('error',warning);e?reject(e):resolve()}
    m.on('style.load',ready);m.on('load',ready);m.on('remove',removed);m.on('error',warning);
    if(m.isStyleLoaded())ready();
  })}
  async function bootMap(){
    try{map=createMap(STYLE);await waitLoad(map)}
    catch(primaryError){
      console.warn('primary map style failed',primaryError);try{map?.remove()}catch{};$('#map').innerHTML='';fallback=true;
      try{map=createMap(FALLBACK);await waitLoad(map,12000)}catch(fallbackError){dismissBoot();throw fallbackError}
    }
    map.addControl(new maplibregl.NavigationControl({showCompass:false}),'bottom-right');
    styleBuildings();enhanceCityDepth();addFocusLayers();ensureVenueClusterLayers();
    map.on('click',e=>{
      if(e.originalEvent.target.closest?.('.mapMarker'))return;
      const hit=map.queryRenderedFeatures(e.point,{layers:['venue-clusters','venue-single-dot']});
      if(hit?.length)return;
      const facade=astraLayer?.pick(e.point);
      if(facade){
        $('#focusHudName').textContent=facade.role==='hero'?(selected?.name||'Главное здание'):'Соседнее здание';
        $('#focusHudState').textContent=facade.evidence==='observed'?'Фасад восстановлен по фото':'Сторона без подтверждённого фото';
        $('#focusHud').classList.add('show');clearTimeout(showFocusHud.t2);showFocusHud.t2=setTimeout(()=>$('#focusHud').classList.remove('show'),2800);return;
      }
      closeCard();
    });
    map.on('movestart',()=>document.body.classList.add('mapMoving'));
    map.on('moveend',()=>{document.body.classList.remove('mapMoving');renderVisibleMarkers()});
    dismissBoot();loadPointsWithRetry();
  }
  function markerNode(p,index=0,animate=true){
    const category=categoryOf(p),theme=DISCOVERY[category]||DISCOVERY.shawarma,s=p.marker_style||{},el=document.createElement('button');el.className='mapMarker'+(animate?' markerReveal':'')+(animate&&s.pulse!==false?' pulseMarker':'');el.dataset.category=category;el.style.setProperty('--reveal-delay',Math.min(index,12)*38+'ms');el.type='button';el.style.background=s.background||theme.dot;el.style.borderColor=s.border||theme.stroke;el.style.opacity=s.opacity??1;el.style.width=(s.size||44)+'px';el.style.height=(s.size||44)+'px';el.style.borderRadius=s.shape==='circle'?'50%':s.shape==='square'?'10px':s.shape==='pin'?'50% 50% 50% 14px':'16px';
    if(p.has_avatar){const img=new Image();img.alt='';img.src=api+'/map/markers/'+p.id+'/avatar';img.onerror=()=>{img.remove();el.insertAdjacentText('afterbegin',s.icon||theme.icon)};el.appendChild(img)}else el.textContent=s.icon||theme.icon;
    if(s.label_visible){const l=document.createElement('span');l.className='markerLabel';l.textContent=p.name;el.appendChild(l)}
    el.onclick=e=>{e.stopPropagation();selectPoint(p)};return el;
  }
  async function loadPoints(){
    // Geometry is fetched for the selected, fully bound venue below. Shipping
    // every quarter here delayed the initial map by an 8 MB response.
    const r=await fetchWithTimeout(api+'/map/points?profile=summary',15000);if(!r.ok)throw new Error('points_'+r.status);
    const data=await r.json();if(!Array.isArray(data))throw new Error('points_invalid');
    const seen=new Set();
    points=data.filter(validMapPoint).filter(p=>{const id=String(p.id);if(seen.has(id))return false;seen.add(id);return true});syncActiveOrderSpotlight();
    const direct=qs.get('marker'),directPoint=direct?points.find(x=>String(x.id)===direct):null;
    if(directPoint&&['coffee','shawarma'].includes(categoryOf(directPoint)))discoveryMode=categoryOf(directPoint);
    setDiscoveryMode(discoveryMode,{fit:false,persist:false,announce:false});
    if(activePoints().length)fitAll();
    renderVisibleMarkers();
    if(directPoint)setTimeout(()=>selectPoint(directPoint),350)
  }
  async function loadPointsWithRetry(){
    for(let attempt=0;attempt<3;attempt++){try{await loadPoints();return}catch(e){console.warn('points load failed',attempt+1,e);if(attempt<2)await sleep(1200*(attempt+1))}}
    toast('Карта открыта, точки догружаются…');setTimeout(()=>loadPointsWithRetry(),5000);
  }
  function fitAll(){
    const valid=activePoints().filter(validMapPoint);if(!valid.length)return;
    const b=new maplibregl.LngLatBounds();valid.forEach(x=>b.extend([Number(x.lon),Number(x.lat)]));
    map.fitBounds(b,{padding:{top:122,bottom:176,left:34,right:34},maxZoom:12.55,pitch:fallback?0:26,bearing:fallback?0:-6,duration:720});
  }
  function selectPoint(p){
    closePanels();selected=p;markers.forEach((m,k)=>m.getElement().classList.toggle('selected',k===String(p.id)));
    $('#venueName').textContent=p.name||'Заведение';$('#venueName').title=p.name||'';$('#venueAddress').textContent=p.address||'';$('#venueAddress').title=p.address||'';$('#venueDescription').textContent=p.description||'';$('#venueDescription').classList.toggle('hidden',!p.description);
    $('#venueHoursQuick').textContent=p.hours||'';$('#venueHoursQuick').classList.toggle('hidden',!p.hours);$('#venuePriceQuick').textContent=p.price_label||'';$('#venuePriceQuick').classList.toggle('hidden',!p.price_label);
    $('#realBadge').textContent=p.realcity_quality&&p.realcity_quality!=='heuristic'?'REAL CITY · '+String(p.realcity_quality).toUpperCase():'REAL CITY';
    const a=$('#venueAvatar'),theme=DISCOVERY[categoryOf(p)]||DISCOVERY.shawarma;a.innerHTML=p.has_avatar?'<img alt="" src="'+api+'/map/markers/'+encodeURIComponent(p.id)+'/avatar">':esc(p.marker_style?.icon||theme.icon);
    $('#venueCard').classList.add('show');
    cinematicFocus(p);
    const token=focusToken;
    setTimeout(()=>{if(token===focusToken&&!astraLayer)revealQuarter(p,p.realcity_profile||{})},reduceMotion?220:560);
    selectRealCityProfile(p,token);
    tg?.HapticFeedback?.selectionChanged?.();
  }
  function closeCard(){
    focusToken++;selected=null;$('#venueCard').classList.remove('show');markers.forEach(m=>m.getElement().classList.remove('selected'));
    clearQuarter();setFocusZone(null);setFlight(null,null);
    $('#focusHud')?.classList.remove('show');$('#mapFocusFlash')?.classList.remove('active');document.body.classList.remove('cityFocus');
  }
  function distanceMeters(a,b){
    if(!a||!b)return Infinity;
    const R=6371000,toRad=v=>v*Math.PI/180,dLat=toRad(Number(b.lat)-Number(a.lat)),dLon=toRad(Number(b.lon)-Number(a.lon));
    const la1=toRad(Number(a.lat)),la2=toRad(Number(b.lat));
    const h=Math.sin(dLat/2)**2+Math.cos(la1)*Math.cos(la2)*Math.sin(dLon/2)**2;
    return 2*R*Math.asin(Math.min(1,Math.sqrt(h)));
  }
  function distanceLabel(m){
    if(!Number.isFinite(m))return '';
    return m<1000?Math.max(10,Math.round(m/10)*10)+' м':(m/1000).toFixed(m<10000?1:0).replace('.',',')+' км';
  }
  function search(){
    const input=$('#search'),q=input.value.trim().toLowerCase(),box=$('#results');
    $('#searchClear')?.classList.toggle('hidden',!q);
    if(!q){box.classList.add('hidden');return}
    const origin=userLocation?{lat:userLocation.lat,lon:userLocation.lon}:null;
    const list=activePoints().map(x=>{
      const hay=(x.name+' '+(x.address||'')).toLowerCase(),name=String(x.name||'').toLowerCase();
      return {x,score:name===q?0:name.startsWith(q)?1:hay.includes(q)?2:9,dist:origin?distanceMeters(origin,x):Infinity};
    }).filter(v=>v.score<9).sort((a,b)=>a.score-b.score||a.dist-b.dist).slice(0,8);
    box.innerHTML=list.length?list.map(v=>'<button class="searchResult" data-id="'+v.x.id+'"><b>'+esc(v.x.name)+'</b><small>'+esc(v.x.address||'Открыть точку на карте')+'</small>'+(Number.isFinite(v.dist)?'<span class="searchDistance">'+distanceLabel(v.dist)+'</span>':'')+'</button>').join(''):'<div class="empty">Ничего не найдено</div>';
    box.classList.remove('hidden');
  }
  function showLocationRadius(radius){
    if(!userLocation||!map)return;
    locationRadius=radius;
    map.getSource('user-radius')?.setData(circlePolygon({lat:userLocation.lat,lon:userLocation.lon,realcity_profile:null},radius,72));
    document.querySelectorAll('.radiusBtn').forEach(b=>b.classList.toggle('active',Number(b.dataset.radius)===radius));
    const latDelta=radius/110540,lonDelta=radius/(111320*Math.cos(userLocation.lat*Math.PI/180));
    const bounds=new maplibregl.LngLatBounds([userLocation.lon-lonDelta,userLocation.lat-latDelta],[userLocation.lon+lonDelta,userLocation.lat+latDelta]);
    map.fitBounds(bounds,{padding:{top:118,bottom:112,left:38,right:82},pitch:fallback?0:(radius<=600?38:26),bearing:fallback?0:-6,duration:reduceMotion?280:740,maxZoom:radius<=600?16.1:14.25});
    toast(radius<=600?'Рядом · 500 м':'Район · 2.5 км');
  }
  function requestLocation(radius){
    if(!navigator.geolocation)return toast('Геопозиция недоступна');
    navigator.geolocation.getCurrentPosition(pos=>{
      userLocation={lat:pos.coords.latitude,lon:pos.coords.longitude,accuracy:pos.coords.accuracy||0};
      const ll=[userLocation.lon,userLocation.lat];
      if(!userMarker){const el=document.createElement('div');el.className='userLocation';el.innerHTML='<i></i>';userMarker=new maplibregl.Marker({element:el,anchor:'center'}).setLngLat(ll).addTo(map)}else userMarker.setLngLat(ll);
      showLocationRadius(radius);search();
    },()=>toast('Не удалось получить геопозицию'),{enableHighAccuracy:true,timeout:8000,maximumAge:20000});
  }

  $('#sectionToggle').onclick=()=>setDiscoveryMode(discoveryMode==='coffee'?'shawarma':'coffee');
  $('#search').oninput=search;
  $('#searchClear').onclick=e=>{e.preventDefault();$('#search').value='';$('#searchClear').classList.add('hidden');$('#results').classList.add('hidden');$('#search').focus()};
  $('#results').onclick=e=>{const b=e.target.closest('[data-id]');if(!b)return;const p=activePoints().find(x=>String(x.id)===b.dataset.id);if(p){selectPoint(p);$('#results').classList.add('hidden');$('#search').blur()}};
  $('#locateNear').dataset.radius='500';$('#locateDistrict').dataset.radius='2500';
  $('#locateNear').onclick=()=>requestLocation(500);$('#locateDistrict').onclick=()=>requestLocation(2500);
  $('#home').onclick=()=>{closePanels();closeCard();locationRadius=0;map.getSource('user-radius')?.setData(emptyGeo());document.querySelectorAll('.radiusBtn').forEach(b=>b.classList.remove('active'));fitAll()};
  $('#closeCard').onclick=closeCard;
  $('#openMenu').onclick=()=>{if(!selected)return;const u=new URL('menu.html',location.href);u.searchParams.set('marker',selected.id);u.searchParams.set('establishment',selected.establishment_id);u.searchParams.set('from','map');u.hash=location.hash;location.assign(u.toString())};

  $('#bottomDock').onclick=e=>{const b=e.target.closest('[data-dock]');if(b)openPanel(b.dataset.dock)};
  $('#profileBtn').onclick=()=>openPanel('profile');
  $('#favoritesFloat').onclick=()=>showPanel('favorites');
  $('#activeOrderSpotlight').onclick=()=>showPanel('orders');
  $('#panelBackdrop').onclick=closePanels;document.querySelectorAll('[data-panel-close]').forEach(x=>x.onclick=closePanels);
  $('#orderFilter').onclick=e=>{const b=e.target.closest('[data-order-filter]');if(!b)return;orderFilter=b.dataset.orderFilter;document.querySelectorAll('[data-order-filter]').forEach(x=>x.classList.toggle('active',x===b));renderOrdersPanel()};
  $('#ordersPanelList').onclick=e=>{
    const focus=e.target.closest('[data-order-focus]');if(focus){closePanels();focusOrderByMarker(focus.dataset.orderFocus);return}
    const b=e.target.closest('[data-order-menu]');if(!b)return;
    const u=new URL('menu.html',location.href);u.searchParams.set('marker',b.dataset.orderMenu);u.searchParams.set('establishment',b.dataset.orderEst);u.searchParams.set('from','map');u.hash=location.hash;location.assign(u.toString());
  };
  $('#favoritesPanelList').onclick=async e=>{
    const order=e.target.closest('[data-fav-order]');
    if(order){
      const u=new URL('menu.html',location.href);
      u.searchParams.set('marker',order.dataset.favMarker);u.searchParams.set('establishment',order.dataset.favEst);
      u.searchParams.set('from','map');u.searchParams.set('quick_item',order.dataset.favOrder);u.searchParams.set('quick_checkout','1');u.hash=location.hash;
      tg?.HapticFeedback?.impactOccurred?.('light');location.assign(u.toString());return;
    }
    const remove=e.target.closest('[data-fav-remove]');if(!remove||!session)return;
    remove.disabled=true;
    try{
      const r=await fetch(api+'/me/favorites/'+encodeURIComponent(remove.dataset.favEst)+'/'+encodeURIComponent(remove.dataset.favRemove),{method:'DELETE',headers:authHeaders()});
      if(!r.ok)throw 0;toast('Убрано из избранного');await loadFavorites();tg?.HapticFeedback?.selectionChanged?.();
    }catch{remove.disabled=false;toast('Не удалось изменить избранное')}
  };
  $('#copyReferral').onclick=async()=>{if(!currentReferralUrl)return toast('Откройте профиль через Telegram');try{await navigator.clipboard.writeText(currentReferralUrl);toast('Ссылка скопирована ✓');tg?.HapticFeedback?.notificationOccurred?.('success')}catch{toast(currentReferralUrl)}};
  $('#shareReferral').onclick=async()=>{
    if(!currentReferralUrl)return toast('Откройте профиль через Telegram');
    const text='Попробуй Shaurmeg — городскую карту шаурмы 🥙';
    try{if(navigator.share){await navigator.share({title:'Shaurmeg',text,url:currentReferralUrl});return}}catch(e){if(e?.name==='AbortError')return}
    try{tg?.openTelegramLink?.('https://t.me/share/url?url='+encodeURIComponent(currentReferralUrl)+'&text='+encodeURIComponent(text))}catch{try{await navigator.clipboard.writeText(currentReferralUrl);toast('Ссылка скопирована ✓')}catch{}}
  };

  try{tg?.ready();tg?.expand();tg?.BackButton?.hide?.();const chrome=daypart()==='night'?'#09111D':'#0F2035';tg?.setHeaderColor?.(chrome);tg?.setBackgroundColor?.(chrome)}catch{}
  authClient().then(ok=>{if(ok){loadDashboard();loadOrders();loadFavorites();connectUserStream()}else{renderGuestProfile();renderOrdersPanel();loadFavorites()}});
  bootMap().catch(e=>{console.error(e);dismissBoot();toast('Не удалось загрузить подложку карты. Откройте приложение ещё раз.')});
})();
