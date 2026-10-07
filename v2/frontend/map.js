(() => {
  const {api,esc,money}=SHAURMEG,tg=SHAURMEG.telegram;
  const $=s=>document.querySelector(s);
  const qs=new URLSearchParams(location.search);
  let map,points=[],selected=null,markers=new Map(),buildingLayers=[],fallback=false,userMarker=null,focusToken=0,markerRenderFrame=0;
  let astraLayer=null,supportRealCityLayer=null,astraScripts=null,quarterFrame=0,previewSignature='',activeRealCityModel=null,activeRealCityMode='';
  const baseBuildingPaint=new Map();
  const baseLabelPaint=new Map();
  const realCityWorldPaint=new Map();
  let session=sessionStorage.getItem('shaurmeg_client_session')||'',dashboard=null,userOrders=[],favoriteGroups=[],orderFilter='all',userStream=null,currentReferralUrl='',orderDetailId='';
  let pointsWarmPromise=null;
  const reduceMotion=window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches===true;
  const bootStarted=performance.now();
  const STYLE='https://tiles.openfreemap.org/styles/liberty';
  const FALLBACK={version:8,sources:{osm:{type:'raster',tiles:['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],tileSize:256,maxzoom:19,attribution:'© OpenStreetMap contributors'}},layers:[{id:'osm',type:'raster',source:'osm',paint:{'raster-saturation':-.22,'raster-contrast':.08,'raster-brightness-min':.08,'raster-brightness-max':.78}}]};
  const STATUS={new:'Принят',cooking:'Готовится',ready:'Готово',done:'Выполнен',cancelled:'Отменён'};
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
  function setHeaderTgId(value){
    const el=$('#headerTgId');if(!el)return;
    const id=String(value||'').trim();
    el.textContent=id?'TG ID · '+id:'TG ID · —';
  }
  setHeaderTgId(tg?.initDataUnsafe?.user?.id||'');
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
  async function fetchPointsPayload(ms=28000){
    const r=await fetchWithTimeout(api+'/map/points?profile=summary&boot='+Date.now(),ms);
    if(!r.ok)throw new Error('points_'+r.status);
    const data=await r.json();
    if(!Array.isArray(data))throw new Error('points_invalid');
    if(!data.length)throw new Error('points_empty');
    return data;
  }
  function warmPoints(){
    if(!pointsWarmPromise)pointsWarmPromise=fetchPointsPayload().catch(e=>{pointsWarmPromise=null;throw e});
    return pointsWarmPromise;
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
  const ACTIVE_ORDER_STATUSES=new Set(['new','cooking','ready']);
  function renderActiveOrderBadge(){
    const badge=$('#activeOrderBadge');if(!badge)return;
    const active=(userOrders||[]).filter(o=>ACTIVE_ORDER_STATUSES.has(String(o.status)));
    if(!session||!active.length){badge.classList.add('hidden');return}
    const order=active[0],img=$('#activeOrderImage'),fallback=$('#activeOrderFallback'),count=$('#activeOrderCount');
    badge.dataset.status=ACTIVE_ORDER_STATUSES.has(String(order.status))?String(order.status):'new';
    badge.classList.remove('hidden');
    badge.setAttribute('aria-label','Активные заказы: '+active.length+'. '+(STATUS[order.status]||order.status||''));
    fallback.textContent=String(order.venue_name||'Ш').trim().slice(0,1).toUpperCase()||'Ш';
    if(order.marker_id){
      img.onerror=()=>{img.classList.add('hidden');fallback.classList.remove('hidden')};
      img.onload=()=>{img.classList.remove('hidden');fallback.classList.add('hidden')};
      img.src=api+'/map/markers/'+encodeURIComponent(order.marker_id)+'/avatar?order='+encodeURIComponent(order.order_number||'');
    }else{
      img.removeAttribute('src');img.classList.add('hidden');fallback.classList.remove('hidden');
    }
    count.textContent=String(active.length);count.classList.toggle('hidden',active.length<2);
  }
  async function loadOrders(){
    if(!session){userOrders=[];renderOrdersPanel();renderActiveOrderBadge();return}
    try{
      const r=await fetch(api+'/me/orders',{headers:authHeaders(),cache:'no-store'});if(!r.ok)throw 0;
      userOrders=await r.json();renderOrdersPanel();renderActiveOrderBadge();
    }catch{$('#ordersPanelList').innerHTML='<div class="panelEmpty">Не удалось загрузить заказы</div>';renderActiveOrderBadge()}
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
  function orderDateParts(value){
    const d=value?new Date(value):null;
    if(!d||Number.isNaN(d.getTime()))return {date:'—',time:'—',full:'—'};
    return {
      date:d.toLocaleDateString('ru-RU',{day:'2-digit',month:'long',year:'numeric'}),
      time:d.toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'}),
      full:d.toLocaleString('ru-RU',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})
    };
  }
  function orderProgress(status){
    return ({new:24,cooking:56,ready:84,done:100,cancelled:0})[String(status)]??18;
  }
  function orderStatusHint(status){
    return ({new:'Заказ передан заведению',cooking:'Сейчас готовят',ready:'Можно получать',done:'Заказ получен',cancelled:'Заказ отменён'})[String(status)]||'Статус обновляется';
  }
  function orderReceiveInfo(o){
    const updated=orderDateParts(o?.updated_at||o?.created_at);
    if(o?.status==='done')return {label:'Время получения',value:updated.full};
    if(o?.status==='ready')return {label:'Готов к получению',value:'с '+updated.time};
    if(o?.status==='cancelled')return {label:'Получение',value:'Заказ отменён'};
    return {label:'Время получения',value:o?.fulfillment_type==='delivery'?'После готовности':'По готовности'};
  }
  function orderAvatar(o,large=false){
    const initial=esc(String(o?.venue_name||'Ш').trim().slice(0,1).toUpperCase()||'Ш');
    if(!o?.marker_id)return '<span>'+initial+'</span>';
    const src=api+'/map/markers/'+encodeURIComponent(o.marker_id)+'/avatar?order='+encodeURIComponent(o.order_number||'');
    return '<img src="'+esc(src)+'" alt="" loading="lazy" onerror="this.remove();this.parentElement.classList.add(\'fallback\')"><span>'+initial+'</span>';
  }
  function paymentLabel(o){
    const method=({on_receipt:'При получении',card:'Картой',cash:'Наличными'})[String(o?.payment_method)]||'При получении';
    const status=({paid:'оплачено',pending:'ожидает оплаты',refunded:'возврат'})[String(o?.payment_status)]||'';
    return status?method+' · '+status:method;
  }
  function ensureOrderDetail(){
    let layer=$('#orderDetailOverlay');
    if(layer)return layer;
    layer=document.createElement('div');
    layer.id='orderDetailOverlay';
    layer.className='orderDetailOverlay';
    layer.setAttribute('aria-hidden','true');
    layer.innerHTML='<button class="orderDetailBackdrop" type="button" data-order-detail-close aria-label="Закрыть"></button><article class="orderDetailCard" role="dialog" aria-modal="true" aria-labelledby="orderDetailTitle"><div id="orderDetailContent"></div></article>';
    document.body.appendChild(layer);
    layer.addEventListener('click',e=>{
      if(e.target.closest('[data-order-detail-close]'))closeOrderDetail();
      const menu=e.target.closest('[data-order-detail-menu]');
      if(menu){
        const u=new URL('menu.html',location.href);
        u.searchParams.set('marker',menu.dataset.orderDetailMenu);
        u.searchParams.set('establishment',menu.dataset.orderDetailEst);
        u.searchParams.set('from','map');u.hash=location.hash;location.assign(u.toString());
      }
    });
    document.addEventListener('keydown',e=>{if(e.key==='Escape'&&orderDetailId)closeOrderDetail()});
    return layer;
  }
  function renderOrderDetail(o){
    if(!o)return;
    const layer=ensureOrderDetail(),box=layer.querySelector('#orderDetailContent');
    const created=orderDateParts(o.created_at),receive=orderReceiveInfo(o),items=Array.isArray(o.items)?o.items:[];
    const status=String(o.status||'new'),active=['new','cooking','ready'].includes(status),cancelled=status==='cancelled';
    const steps=['new','cooking','ready','done'],labels={new:'Принят',cooking:'Готовится',ready:'Готово',done:'Получен'},current=steps.indexOf(status);
    const timeline=cancelled?'<div class="orderTimeline cancelled"><b>Заказ отменён</b><span>При необходимости оформите новый заказ в заведении.</span></div>':
      '<div class="orderTimeline"><div class="orderTimelineRail"><i style="width:'+orderProgress(status)+'%"></i></div><div class="orderTimelineSteps">'+steps.map((s,i)=>'<span class="'+(i<=current?'on ':'')+(s===status?'current':'')+'"><i></i><b>'+labels[s]+'</b></span>').join('')+'</div></div>';
    box.innerHTML=
      '<header class="orderDetailHead"><div class="orderDetailVenueAvatar">'+orderAvatar(o,true)+'</div><div class="orderDetailHeadCopy"><small>ЗАКАЗ · '+esc(o.order_number||'')+'</small><h2 id="orderDetailTitle">'+esc(o.venue_name||'Shaurmeg')+'</h2><span>'+esc(orderStatusHint(status))+'</span></div><button type="button" class="orderDetailClose" data-order-detail-close aria-label="Закрыть">×</button></header>'+
      '<div class="orderDetailStatusRow"><span class="status status-'+esc(status)+'">'+esc(STATUS[status]||status)+'</span><b>'+money(o.total||0)+'</b></div>'+
      timeline+
      '<section class="orderDetailFacts">'+
        '<article><small>Дата заказа</small><b>'+esc(created.date)+'</b><span>'+esc(created.time)+'</span></article>'+
        '<article><small>'+esc(receive.label)+'</small><b>'+esc(receive.value)+'</b><span>'+(o.fulfillment_type==='cafe'?'В заведении':'Доставка')+'</span></article>'+
      '</section>'+
      '<section class="orderDetailSection"><div class="orderDetailSectionHead"><div><small>СОСТАВ</small><h3>Что в заказе</h3></div><b>'+items.reduce((s,x)=>s+(Number(x.q)||1),0)+' поз.</b></div>'+
        '<div class="orderDetailItems">'+(items.length?items.map(x=>{const q=Math.max(1,Number(x.q)||1),price=Number(x.p)||0;return '<article><div><b>'+esc(x.n||x.name||'Позиция')+'</b>'+(x.detail?'<small>'+esc(x.detail)+'</small>':'')+'</div><span>× '+q+'</span><strong>'+money(price*q)+'</strong></article>'}).join(''):'<div class="orderDetailEmpty">Состав заказа не найден</div>')+'</div>'+
      '</section>'+
      '<section class="orderDetailSection orderDetailInfo"><div class="orderDetailSectionHead"><div><small>ПОЛУЧЕНИЕ</small><h3>Детали</h3></div></div>'+
        '<div class="orderDetailInfoGrid">'+
          '<div><small>Способ</small><b>'+(o.fulfillment_type==='cafe'?'В заведении':'Доставка')+'</b></div>'+
          '<div><small>Оплата</small><b>'+esc(paymentLabel(o))+'</b></div>'+
          (o.address?'<div class="wide"><small>Адрес</small><b>'+esc(o.address)+'</b></div>':'')+
          (o.phone?'<div><small>Телефон</small><b>'+esc(o.phone)+'</b></div>':'')+
          (o.comment?'<div class="wide"><small>Комментарий</small><b>'+esc(o.comment)+'</b></div>':'')+
        '</div>'+
      '</section>'+
      '<footer class="orderDetailActions">'+
        (o.marker_id&&o.establishment_id?'<button type="button" class="orderDetailPrimary" data-order-detail-menu="'+esc(o.marker_id)+'" data-order-detail-est="'+esc(o.establishment_id)+'">Открыть заведение <span>→</span></button>':'')+
        '<button type="button" class="orderDetailSecondary" data-order-detail-close>Закрыть</button>'+
      '</footer>';
    layer.classList.toggle('isActive',active);
  }
  function openOrderDetail(id){
    const o=(userOrders||[]).find(x=>String(x.id??x.order_number)===String(id));
    if(!o)return;
    orderDetailId=String(id);
    const layer=ensureOrderDetail();renderOrderDetail(o);
    requestAnimationFrame(()=>{layer.classList.add('show');layer.setAttribute('aria-hidden','false')});
    tg?.HapticFeedback?.selectionChanged?.();
  }
  function closeOrderDetail(){
    orderDetailId='';
    const layer=$('#orderDetailOverlay');if(!layer)return;
    layer.classList.remove('show');layer.setAttribute('aria-hidden','true');
  }
  function refreshOrderDetail(){
    if(!orderDetailId)return;
    const o=(userOrders||[]).find(x=>String(x.id??x.order_number)===String(orderDetailId));
    if(o)renderOrderDetail(o);else closeOrderDetail();
  }
  function renderOrdersPanel(){
    const box=$('#ordersPanelList');
    if(!session){box.innerHTML='<div class="panelEmpty"><b>Заказы привязаны к Telegram</b><span>Откройте Shaurmeg через @Shaurmeggbot, чтобы видеть историю и активные заказы.</span></div>';return}
    let rows=[...(userOrders||[])];
    if(orderFilter==='active')rows=rows.filter(o=>['new','cooking','ready'].includes(o.status));
    if(orderFilter==='done')rows=rows.filter(o=>['done','cancelled'].includes(o.status));
    rows.sort((a,b)=>{
      const aa=['new','cooking','ready'].includes(a.status)?1:0,bb=['new','cooking','ready'].includes(b.status)?1:0;
      if(aa!==bb)return bb-aa;
      return new Date(b.created_at||0)-new Date(a.created_at||0);
    });
    const active=(userOrders||[]).filter(o=>['new','cooking','ready'].includes(o.status));
    const lead=active[0];
    const summary='<div class="ordersPanelSummary '+(active.length?'hasActive':'')+'"><div><small>СЕЙЧАС</small><b>'+(active.length?(active.length+' активн'+(active.length===1?'ый заказ':'ых заказа')):'Активных заказов нет')+'</b><span>'+(lead?esc(lead.venue_name||'Shaurmeg')+' · '+esc(orderStatusHint(lead.status)):'Новые заказы появятся здесь сразу после оформления')+'</span></div><i>'+ (active.length?String(active.length):'✓') +'</i></div>';
    box.innerHTML=summary+(rows.length?rows.map(o=>{
      const count=(o.items||[]).reduce((s,x)=>s+(Number(x.q)||1),0),activeNow=['new','cooking','ready'].includes(o.status);
      const created=orderDateParts(o.created_at),receive=orderReceiveInfo(o),id=String(o.id??o.order_number);
      const first=(o.items||[])[0],more=Math.max(0,(o.items||[]).length-1);
      return '<article class="mapOrderCard orderPreviewCard '+(activeNow?'isActive':'')+'" data-order-detail="'+esc(id)+'" role="button" tabindex="0" aria-label="Открыть заказ '+esc(o.order_number||'')+'">'+
        '<div class="orderPreviewTop"><div class="orderPreviewVenue"><div class="orderPreviewAvatar">'+orderAvatar(o)+'</div><div><small>'+esc(o.venue_name||'SHAURMEG')+'</small><b>'+esc(o.order_number||'Заказ')+'</b><span>'+esc(created.full)+'</span></div></div><span class="status status-'+esc(o.status)+'">'+esc(STATUS[o.status]||o.status)+'</span></div>'+
        '<div class="orderPreviewProgress"><i style="width:'+orderProgress(o.status)+'%"></i></div>'+
        '<div class="orderPreviewMain"><div><small>Получение</small><b>'+esc(receive.value)+'</b></div><div><small>Способ</small><b>'+(o.fulfillment_type==='cafe'?'В заведении':'Доставка')+'</b></div></div>'+
        '<div class="orderPreviewDish">'+(first?'<span>'+esc(first.n||first.name||'Позиция')+' × '+esc(first.q||1)+'</span>':'<span>Состав заказа</span>')+(more?'<small>+ ещё '+more+'</small>':'')+'</div>'+
        '<footer><span>'+count+' поз.</span><b>'+money(o.total)+'</b>'+(o.marker_id&&o.establishment_id?'<button type="button" data-order-menu="'+esc(o.marker_id)+'" data-order-est="'+esc(o.establishment_id)+'">Заведение</button>':'')+'<em>Подробнее →</em></footer>'+
      '</article>';
    }).join(''):'<div class="panelEmpty"><b>Здесь пока пусто</b><span>Выберите точку на карте и сделайте первый заказ.</span></div>');
    refreshOrderDetail();
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

  function openPanel(kind){
    closeCard();
    const id=kind==='orders'?'ordersPanel':kind==='favorites'?'favoritesPanel':kind==='profile'?'profilePanel':'';
    document.querySelectorAll('.appPanel').forEach(x=>x.classList.toggle('show',x.id===id));
    $('#panelBackdrop').classList.toggle('show',!!id);document.body.classList.toggle('panelOpen',!!id);
    document.querySelectorAll('.dockBtn').forEach(x=>x.classList.toggle('active',x.dataset.dock===(kind||'map')));
    $('#profileBtn')?.classList.toggle('active',kind==='profile');
    if(kind==='orders')loadOrders();if(kind==='favorites')loadFavorites();if(kind==='profile')loadDashboard();
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
        if(l.type==='fill-extrusion'&&/building/i.test(id)){map.setPaintProperty(l.id,'fill-extrusion-color',cityPalette.building);map.setPaintProperty(l.id,'fill-extrusion-opacity',daypart()==='night'?.78:.9)}
        if(l.type==='line'&&/road|street|highway|path|motorway|trunk/i.test(id)){map.setPaintProperty(l.id,'line-color',cityPalette.road);map.setPaintProperty(l.id,'line-opacity',daypart()==='night'?.6:.82)}
        if(l.type==='symbol'&&/road|place|poi|label/i.test(id)){map.setPaintProperty(l.id,'text-color',cityPalette.label);map.setPaintProperty(l.id,'text-halo-color',cityPalette.background);map.setPaintProperty(l.id,'text-halo-width',1.2)}
      }catch{}
    }
    for(const id of buildingLayers){
      const type=map.getLayer(id)?.type,props=type==='fill-extrusion'?['fill-extrusion-height','fill-extrusion-base']:['fill-opacity'];
      baseBuildingPaint.set(id,Object.fromEntries(props.map(p=>[p,map.getPaintProperty(id,p)])));
    }
    for(const l of layers)if(l.type==='symbol'&&/poi|housenumber|transit|place/i.test(l.id))baseLabelPaint.set(l.id,{'text-opacity':map.getPaintProperty(l.id,'text-opacity'),'icon-opacity':map.getPaintProperty(l.id,'icon-opacity')});
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
  function setRealCityWorldPalette(active){
    const layers=map.getStyle()?.layers||[];
    if(!active){
      for(const [id,props] of realCityWorldPaint){
        if(!map.getLayer(id))continue;
        for(const [prop,value] of Object.entries(props))try{map.setPaintProperty(id,prop,value)}catch{}
      }
      realCityWorldPaint.clear();
      return;
    }
    if(realCityWorldPaint.size)return;
    const remember=(id,prop)=>{
      if(!realCityWorldPaint.has(id))realCityWorldPaint.set(id,{});
      realCityWorldPaint.get(id)[prop]=map.getPaintProperty(id,prop);
    };
    for(const l of layers){
      const id=String(l.id||''),type=l.type;
      try{
        if(type==='background'){
          remember(id,'background-color');map.setPaintProperty(id,'background-color','#9da5a7');
        }else if(type==='fill'&&/water|river|lake|ocean/i.test(id)){
          remember(id,'fill-color');remember(id,'fill-opacity');
          map.setPaintProperty(id,'fill-color','#7898a5');map.setPaintProperty(id,'fill-opacity',.88);
        }else if(type==='fill'&&/park|grass|wood|vegetation|forest|landcover/i.test(id)){
          remember(id,'fill-color');remember(id,'fill-opacity');
          map.setPaintProperty(id,'fill-color','#5f7357');map.setPaintProperty(id,'fill-opacity',.84);
        }else if(type==='fill-extrusion'&&/building/i.test(id)){
          remember(id,'fill-extrusion-color');remember(id,'fill-extrusion-opacity');
          map.setPaintProperty(id,'fill-extrusion-color','#8b8983');map.setPaintProperty(id,'fill-extrusion-opacity',.46);
        }else if(type==='fill'&&/building/i.test(id)){
          remember(id,'fill-color');remember(id,'fill-opacity');
          map.setPaintProperty(id,'fill-color','#8b8983');map.setPaintProperty(id,'fill-opacity',.42);
        }else if(type==='fill'&&/residential|landuse|land/i.test(id)&&!/water/i.test(id)){
          remember(id,'fill-color');remember(id,'fill-opacity');
          map.setPaintProperty(id,'fill-color','#969289');map.setPaintProperty(id,'fill-opacity',.82);
        }else if(type==='line'&&/road|street|highway|path|motorway|trunk/i.test(id)){
          remember(id,'line-color');remember(id,'line-opacity');
          map.setPaintProperty(id,'line-color','#55585a');map.setPaintProperty(id,'line-opacity',.54);
        }
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
      'line-color':['case',['==',['get','kind'],'sidewalk'],'#c8c2b7','#777b7e'],
      'line-width':['case',['==',['get','kind'],'sidewalk'],['interpolate',['linear'],['zoom'],14,2.2,18,5.5],['interpolate',['linear'],['zoom'],14,7,18,13]],
      'line-opacity':0,'line-blur':['case',['==',['get','kind'],'sidewalk'],.4,1.6],'line-opacity-transition':{duration:650,delay:120}
    }});
    map.addLayer({id:'realcity-roads-core',type:'line',source:'realcity-roads',paint:{
      'line-color':['case',['==',['get','kind'],'sidewalk'],'#bdb7ab','#4f5356'],
      'line-width':['case',['==',['get','kind'],'sidewalk'],['interpolate',['linear'],['zoom'],14,1.1,18,3.1],['interpolate',['linear'],['zoom'],14,2.8,18,6.5]],
      'line-opacity':0,'line-opacity-transition':{duration:650,delay:140}
    }});

    map.addSource('realcity-barriers',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
    map.addLayer({id:'realcity-barriers-line',type:'line',source:'realcity-barriers',paint:{
      'line-color':'#4d4d49','line-width':['interpolate',['linear'],['zoom'],15,.7,19,1.7],
      'line-opacity':0,'line-opacity-transition':{duration:520,delay:150}
    }});

    map.addSource('realcity-context',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
    map.addLayer({id:'realcity-context-extrude',type:'fill-extrusion',source:'realcity-context',paint:{
      'fill-extrusion-color':['case',['==',['get','support'],1],'#77736b',['coalesce',['get','wall'],'#b9b7ad']],
      'fill-extrusion-height':['coalesce',['get','height'],1],
      'fill-extrusion-base':['coalesce',['get','base'],0],
      'fill-extrusion-opacity':['case',['==',['get','support'],1],.08,.78]
    }});
    map.addLayer({id:'realcity-context-edge',type:'line',source:'realcity-context',paint:{
      'line-color':['case',['==',['get','support'],1],'#9a958a',['coalesce',['get','accent'],'#D7E0EA']],
      'line-width':['case',['==',['get','role'],'nearby'],1,.65],
      'line-opacity':['case',['==',['get','support'],1],.025,['case',['==',['get','role'],'nearby'],.45,.22]]
    }});

    map.addSource('focus-building',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
    map.addLayer({id:'focus-building-extrude',type:'fill-extrusion',source:'focus-building',paint:{
      'fill-extrusion-color':['case',['==',['get','support'],1],'#706d66',['coalesce',['get','wall'],'#a59c88']],
      'fill-extrusion-height':['coalesce',['get','height'],18],
      'fill-extrusion-base':['coalesce',['get','base'],0],
      'fill-extrusion-opacity':['case',['==',['get','support'],1],.11,.97]
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
    if(window.RealCityLayer&&window.RealCitySplatLayer)return Promise.resolve();
    if(astraScripts)return astraScripts;
    // Renderer modules used to carry a permanent query revision, so Telegram
    // WebView could keep an obsolete splat renderer even
    // after map.js itself was refreshed. Bind every lazy renderer asset to the
    // same per-open cache revision as the Mini App entrypoint.
    const revision=window.__SHAURMEG_ASSET_VERSION__||Date.now().toString(36);
    const load=src=>new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=src+'?v='+encodeURIComponent(revision);s.onload=resolve;s.onerror=()=>{s.remove();reject(new Error('realcity_renderer_unavailable'))};document.head.appendChild(s)});
    astraScripts=(window.RealCitySpatial?Promise.resolve():load('realcity-spatial.js')).then(()=>load('vendor/earcut.min.js')).then(()=>load('realcity-layer.js')).then(()=>load('realcity-splat-layer.js')).catch(e=>{astraScripts=null;throw e});
    return astraScripts;
  }
  function setRealCityAttribution(model){
    const box=$('#realCityAttribution');if(!box)return;box.replaceChildren();
    const refs=[...(Array.isArray(model?.references)?model.references:[]),...(Array.isArray(model?.sources)?model.sources:[])],providers=new Map();
    for(const r of refs){
      const source=r.source||r.provider||r.kind;
      const name=({panoramax:'Panoramax',kartaview:'KartaView',mapillary:'Mapillary',wikimedia:'Wikimedia Commons',owner:'Фото заведения'})[source]||String(source||'');
      if(name&&!providers.has(source))providers.set(source,{name,url:r.page_url||({panoramax:'https://panoramax.fr',kartaview:'https://kartaview.org',mapillary:'https://www.mapillary.com',wikimedia:'https://commons.wikimedia.org'})[source]});
    }
    if(providers.size){
      box.append(document.createTextNode(' · RealCity: '));let i=0;
      for(const p of providers.values()){if(i++)box.append(document.createTextNode(' · '));const a=document.createElement('a');a.textContent=p.name;a.href=p.url||'#';a.target='_blank';a.rel='noopener';box.append(a)}
    }
    box.title=[...new Set(refs.map(r=>[r.attribution,r.license].filter(Boolean).join(' · ')).filter(Boolean))].join('\n');
  }
  function isPhotorealDisplaySafe(model){
    if(model?.quality?.surface_projection===true&&
       (model?.quality?.reference_master===true||String(model?.target?.marker_id)==='3139')&&
       !(Number(model.quality.calibrated_facades)>=1))return false;
    return model?.quality?.display_safe===true&&model?.quality?.map_registered_surface===true;
  }
  const isLepeshkaRealCity=p=>String(p?.id??p?.marker_id)==='3139';
  function isCompletePhotogrammetry(model){
    return isPhotorealDisplaySafe(model)&&model?.quality?.photogrammetric===true&&model?.quality?.metric_reconstruction===true;
  }
  function photorealVolume(model){
    const chunks=Array.isArray(model?.chunks)?model.chunks:[];
    if(!chunks.length)return null;
    const mn=[Infinity,Infinity,Infinity],mx=[-Infinity,-Infinity,-Infinity];
    for(const ch of chunks){
      if(!Array.isArray(ch?.bounds_min)||!Array.isArray(ch?.bounds_max))continue;
      for(let i=0;i<3;i++){mn[i]=Math.min(mn[i],Number(ch.bounds_min[i]));mx[i]=Math.max(mx[i],Number(ch.bounds_max[i]));}
    }
    if([...mn,...mx].some(v=>!Number.isFinite(v)))return null;
    return {span:[mx[0]-mn[0],mx[1]-mn[1],mx[2]-mn[2]],min:mn,max:mx};
  }
  function isMeasuredVolumetric(model){
    if(!isPhotorealDisplaySafe(model)||model?.quality?.volumetric_reconstruction!==true)return false;
    const v=photorealVolume(model),points=Number(model?.stats?.points)||0;
    return !!(v&&points>=5000&&v.span[2]>=3&&Math.max(v.span[0],v.span[1])>=8);
  }
  function removeAstraLayer(){
    for(const id of ['realcity-photoreal-splats','realcity-photoreal-shell','realcity-authored-facades','realcity-astra-facades','realcity-pro-facades'])if(map.getLayer(id))map.removeLayer(id);
    astraLayer=null;supportRealCityLayer=null;activeRealCityModel=null;activeRealCityMode='';setRealCityAttribution(null);
  }
  async function selectRealCityProfile(p,token){
    try{
      let j,preview;
      if(location.pathname.startsWith('/realcity-preview/')&&new URLSearchParams(location.search).get('realcity_preview')==='1'){
        try{preview=window.parent!==window&&window.parent.RealCityStudio?.previewData;}catch{}
      }
      if(preview&&String(preview.marker.id)===String(p.id))j={...preview.marker,marker_id:preview.marker.id,profile:preview.profile};
      else{
        const r=await fetchWithTimeout(api+'/map/markers/'+encodeURIComponent(p.id)+'/realcity?establishment_id='+encodeURIComponent(p.establishment_id),10000);
        if(!r.ok)return;j=await r.json();
      }
      if(token!==focusToken||String(j.marker_id)!==String(p.id)||j.establishment_id!==p.establishment_id||j.venue_id!==p.venue_id)return;
      p.realcity_profile=j.profile||p.realcity_profile;
      const authoredCandidates=[
        {mode:'pro',model:j.profile?.pro},
        {mode:'photoreal',model:j.profile?.photoreal},
        {mode:'astra',model:j.profile?.astra},
        {mode:'open-world',model:j.profile?.real_world}
      ].filter(x=>x.model?.status==='ready'&&
        (x.mode==='photoreal'?isPhotorealDisplaySafe(x.model):x.mode==='pro'?x.model?.mode==='realcity-pro'&&x.model?.quality?.ready===true:!isLepeshkaRealCity(p)));
      if(authoredCandidates.length){
        await loadAstraRenderer();if(token!==focusToken)return;
        const authored=authoredCandidates.find(x=>x.mode==='photoreal'?window.RealCitySpatial.boundPhotoreal(x.model,p,j.profile.scene):window.RealCitySpatial.bound(x.model,p,j.profile.scene));
        if(authored){
          removeAstraLayer();
          if(authored.mode==='photoreal'){
            const isTruePhotogrammetry=isCompletePhotogrammetry(authored.model);
            const isVolumetricDepth=isMeasuredVolumetric(authored.model);
            const referenceMaster=authored.model?.quality?.reference_master===true;
            let shell=null,shellSource=null;
            if(!isTruePhotogrammetry&&!isVolumetricDepth&&!referenceMaster){
              const shellCandidates=[
                {mode:'astra',model:j.profile?.astra},
                {mode:'open-world',model:j.profile?.real_world}
              ].filter(x=>x.model?.status==='ready');
              shellSource=shellCandidates.find(x=>window.RealCitySpatial.bound(x.model,p,j.profile.scene));
              if(shellSource){
                shell=window.RealCityLayer.create({
                  marker:p,profile:j.profile,model:shellSource.model,layerId:'realcity-photoreal-shell',
                  reducedMotion:reduceMotion,onError:e=>console.warn('RealCity support shell fallback',e.message)
                });
                if(shell){map.addLayer(shell);if(!shell.ready){try{map.removeLayer('realcity-photoreal-shell')}catch{}shell=null}}
              }
            }
            const splat=window.RealCitySplatLayer.create({
              marker:p,profile:j.profile,model:authored.model,layerId:'realcity-photoreal-splats',
              reducedMotion:reduceMotion,overlaySupport:authored.model?.quality?.surface_projection===true||(!isTruePhotogrammetry&&isVolumetricDepth),
              onError:e=>console.warn('RealCity photoreal fallback',e.message)
            });
            if(splat){
              map.addLayer(splat);
              if(splat.ready){
                supportRealCityLayer=shell;
                astraLayer=shell?{
                  ready:true,
                  setProgress(v){shell.setProgress?.(v);splat.setProgress?.(v)},
                  stats:{composite:true,shell:shell.stats||null,splats:splat.stats||null}
                }:splat;
                activeRealCityModel=authored.model;activeRealCityMode=authored.mode;setRealCityAttribution(authored.model);
              }else removeAstraLayer();
            }else if(shell){
              astraLayer=shell;supportRealCityLayer=shell;activeRealCityModel=shellSource?.model||null;activeRealCityMode=shellSource?.mode||'open-world';setRealCityAttribution(activeRealCityModel);
            }
          }else{
            const layer=window.RealCityLayer.create({marker:p,profile:j.profile,model:authored.model,layerId:authored.mode==='pro'?'realcity-pro-facades':'realcity-authored-facades',reducedMotion:reduceMotion,onError:e=>console.warn('RealCity renderer fallback',e.message)});
            if(layer){map.addLayer(layer);if(layer.ready){astraLayer=layer;activeRealCityModel=authored.model;activeRealCityMode=authored.mode;setRealCityAttribution(authored.model)}else removeAstraLayer();}
          }
        }
      }
      if(token!==focusToken)return;
      if(astraLayer&&activeRealCityModel){
        const cam=activeRealCityModel.camera||j.profile?.camera||(activeRealCityMode==='photoreal'?{zoom:19.05,pitch:67,bearing:-20,views:[]}:{zoom:18.35,pitch:61,bearing:-20,views:[]}),offset=Math.max(24,Math.min(120,innerHeight/2-$('#venueCard').offsetHeight-124));
        map.easeTo({center:[+p.lon,+p.lat],zoom:cam.zoom,pitch:cam.pitch,bearing:cam.bearing,offset:[0,offset],duration:reduceMotion?0:850});
        $('#realBadge').textContent=activeRealCityMode==='photoreal'?(activeRealCityModel?.quality?.reference_master?'REAL CITY · PHOTO MASTER':activeRealCityModel?.quality?.photogrammetric?'REAL CITY · PHOTOGRAMMETRY':activeRealCityModel?.quality?.surface_projection?'REAL CITY · PHOTO FACADE':'REAL CITY · PHOTO 3D'):activeRealCityMode==='pro'?'REAL CITY · PHOTO VERIFIED':activeRealCityMode==='astra'?'REAL CITY · ASTRA':'REAL CITY · OPEN WORLD';
        if(preview&&activeRealCityMode==='astra'&&String(preview.marker.id)===String(p.id))previewSignature=preview.draft.input_revision+':'+new Date(preview.draft.updated_at).toISOString();
        const views=cam.views||[],box=$('#realCityViews');
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
    const lineFeatures=(lines,kind,limit)=>((lines||[]).slice(0,limit).map(line=>{
      const coords=(Array.isArray(line)?line:[]).map(x=>[Number(x?.[0]),Number(x?.[1])]).filter(x=>Number.isFinite(x[0])&&Number.isFinite(x[1]));
      return coords.length>1?{type:'Feature',properties:{kind},geometry:{type:'LineString',coordinates:coords}}:null;
    }).filter(Boolean));
    const roads=[...lineFeatures(scene.roads,'road',42),...lineFeatures(scene.sidewalks,'sidewalk',56)];
    const barriers=(scene.barriers||[]).slice(0,48).map(item=>{
      const line=Array.isArray(item)?item:item?.coordinates,coords=(Array.isArray(line)?line:[]).map(x=>[Number(x?.[0]),Number(x?.[1])]).filter(x=>Number.isFinite(x[0])&&Number.isFinite(x[1]));
      return coords.length>1?{type:'Feature',properties:{kind:String(item?.kind||'barrier')},geometry:{type:'LineString',coordinates:coords}}:null;
    }).filter(Boolean);
    const greens=[...(activeRealCityModel?.environment?.greens||[]),...(scene.greens||[])].slice(0,48).map(ring=>{
      const coords=closeRing(ring);return coords.length>3?{type:'Feature',properties:{},geometry:{type:'Polygon',coordinates:[coords]}}:null;
    }).filter(Boolean);
    const trees=(scene.trees||[]).slice(0,reduceMotion?22:64).map((t,i)=>({
      type:'Feature',properties:{source:String(t.source||''),color:i%3===0?'#6f956b':i%3===1?'#547c58':'#618765'},
      geometry:{type:'Point',coordinates:[Number(t.lon),Number(t.lat)]}
    })).filter(x=>Number.isFinite(x.geometry.coordinates[0])&&Number.isFinite(x.geometry.coordinates[1]));
    return {heroFeature,contextFeatures,roads,barriers,greens,trees,radius:Math.max(80,Math.min(Number(scene.radius_m)||170,220))};
  }
  function clearQuarter(){
    cancelAnimationFrame(quarterFrame);removeAstraLayer();
    $('#realCityViews').classList.add('hidden');$('#realCityViews').replaceChildren();document.body.classList.remove('realCityExploring','realCityPhotographic');
    for(const id of ['realcity-ground','realcity-greens','realcity-roads','realcity-barriers','realcity-context','realcity-trees','focus-building'])map.getSource(id)?.setData(emptyGeo());
    try{map.setPaintProperty('realcity-ground-fill','fill-opacity',0)}catch{}
    try{map.setPaintProperty('realcity-greens-fill','fill-opacity',0)}catch{}
    try{map.setPaintProperty('realcity-roads-glow','line-opacity',0)}catch{}
    try{map.setPaintProperty('realcity-roads-core','line-opacity',0)}catch{}
    try{map.setPaintProperty('realcity-barriers-line','line-opacity',0)}catch{}
    try{map.setPaintProperty('realcity-tree-glow','circle-opacity',.28);map.setPaintProperty('realcity-tree-crown','circle-opacity',.86)}catch{}
    setBaseBuildingsDim(false);setPhotoLabels(null);setRealCityWorldPalette(false);document.body.classList.remove('realCityActive','realCitySettled');
  }
  function revealQuarter(p,profile){
    cancelAnimationFrame(quarterFrame);
    const token=focusToken,data=buildQuarterData(p,profile);
    // Do not conceal a broken photo model with invented coloured buildings,
    // ground disks or trees. Keep native MapLibre geometry fully usable until
    // the photographed surfaces have been explicitly calibrated.
    if(isLepeshkaRealCity(p)&&!astraLayer){
      clearQuarter();
      $('#focusHudState').textContent='Фасад ожидает точной фотопривязки';
      $('#realBadge').textContent='REAL CITY · ФОТОПРИВЯЗКА';
      return;
    }
    if(!data.heroFeature&&!data.contextFeatures.length){
      setTimeout(()=>{if(token===focusToken)nearestBuilding(p,profile)},reduceMotion?0:360);
      return;
    }
    const authored=astraLayer?activeRealCityModel:null,photoreal=!!(authored&&activeRealCityMode==='photoreal');
    const completePhotogrammetry=photoreal&&isCompletePhotogrammetry(authored);
    const measuredVolumetric=photoreal&&isMeasuredVolumetric(authored);
    const proMode=!!(authored&&activeRealCityMode==='pro');
    const referenceMaster=photoreal&&(isLepeshkaRealCity(p)||authored?.quality?.reference_master===true);
    const reconstructedRadius=completePhotogrammetry
      ?Math.max(80,Math.min(350,Number(authored.quality?.coverage_radius_m)||Number(profile.scene?.radius_m)||190))
      :measuredVolumetric?Math.max(45,Math.min(120,Number(authored.quality?.coverage_radius_m)||90)):0;
    // Measured ONNX depth already contains true 3D parallax, but its source
    // coverage is incomplete. Replace the visible native city blocks with
    // neutral map-accurate support volumes, then let source-colour splats carry
    // appearance. This avoids the "unchanged map with a translucent overlay"
    // failure without pretending fallback depth is complete photogrammetry.
    const replaced=new Set((completePhotogrammetry||measuredVolumetric)
      ?(profile.scene?.buildings||[]).filter(b=>Number(b.distance||0)<=reconstructedRadius).map(b=>String(b.id))
      :photoreal||proMode?[]
      :(authored?.buildings||[]).map(b=>String(b.building_id)));
    if(authored&&!photoreal)for(const b of profile.scene.buildings){
      if(replaced.has(String(b.id)))continue;
      // Some vector tiles contain both the building envelope and its inner
      // parts. Do not draw a second roof through an authored envelope.
      if(authored.buildings.some(a=>a.height_m>=b.height&&window.RealCitySpatial.containsRing(profile.scene.buildings.find(x=>String(x.id)===a.building_id).ring,b.ring)))replaced.add(String(b.id));
    }
    const covered=(profile.scene?.buildings||[]).filter(b=>replaced.has(String(b.id))).map(b=>({type:'Feature',properties:{},geometry:{type:'Polygon',coordinates:[b.ring]}}));
    document.body.classList.add('realCityActive');
    // OpenFreeMap can group distant buildings into one MultiPolygon feature.
    // A distance expression hides the whole feature, not just its local part.
    // Authored neighbors cover the native surfaces directly; only the clinic's
    // distinct footprint needs hiding for its different roof/wing heights.
    const dimmed=proMode?[]:(completePhotogrammetry||measuredVolumetric)?covered:
      (astraLayer&&!photoreal?(activeRealCityMode==='open-world'?[data.heroFeature,...covered]:[data.heroFeature]):[]);
    setBaseBuildingsDim(dimmed.length>0,dimmed.filter(Boolean));
    map.getSource('realcity-ground')?.setData(circlePolygon(p,data.radius));
    map.getSource('realcity-greens')?.setData({type:'FeatureCollection',features:data.greens});
    map.getSource('realcity-roads')?.setData({type:'FeatureCollection',features:data.roads});
    map.getSource('realcity-barriers')?.setData({type:'FeatureCollection',features:data.barriers});
    const visibleTrees=(referenceMaster||proMode)?[]:(photoreal?data.trees.filter(f=>f.properties?.source==='osm'):data.trees);
    map.getSource('realcity-trees')?.setData({type:'FeatureCollection',features:visibleTrees});
    const photoGround=!!(photoreal||(astraLayer&&authored?.environment?.roads?.length));
    setRealCityWorldPalette(!!astraLayer&&!referenceMaster&&!proMode);
    setPhotoLabels(photoGround?p:null);
    document.body.classList.toggle('realCityPhotographic',photoGround);
    // Keep the real base map visible. A flat 90%-opaque disk was one of the
    // main reasons the quarter looked synthetic even when facade pixels were real.
    try{map.setPaintProperty('realcity-ground-fill','fill-color',photoreal?'#87847d':photoGround?'#aaa69c':['coalesce',['get','ground'],'#d8d3c8']);map.setPaintProperty('realcity-ground-fill','fill-opacity',referenceMaster||proMode?0:photoreal?.045:photoGround?.24:daypart()==='night'?.12:.16)}catch{}
    try{map.setPaintProperty('realcity-greens-fill','fill-opacity',referenceMaster||proMode?0:photoreal?.24:photoGround?.62:.34)}catch{}
    try{map.setPaintProperty('realcity-roads-glow','line-opacity',referenceMaster||proMode?0:photoreal?.05:photoGround?.14:.12)}catch{}
    try{map.setPaintProperty('realcity-roads-core','line-opacity',referenceMaster||proMode?0:photoreal?.28:photoGround?.64:daypart()==='night'?.42:.56)}catch{}
    try{map.setPaintProperty('realcity-barriers-line','line-opacity',referenceMaster||proMode?0:photoreal?.22:photoGround?.5:.3)}catch{}
    try{map.setPaintProperty('realcity-tree-glow','circle-opacity',referenceMaster||proMode?0:photoreal?.04:.28);map.setPaintProperty('realcity-tree-crown','circle-opacity',referenceMaster||proMode?0:photoreal?.14:.86)}catch{}
    $('#focusHudState').textContent='собираем цифровой квартал';

    const contextSource=map.getSource('realcity-context'),heroSource=map.getSource('focus-building');
    const duration=reduceMotion?1:980,started=performance.now();
    const supportify=f=>f?{...f,properties:{...f.properties,support:1,wall:'#77736b',accent:'#8f8a80'}}:null;
    const supportMode=!proMode&&measuredVolumetric&&!completePhotogrammetry;
    const context=supportMode
      ?data.contextFeatures.filter(f=>replaced.has(f.properties.id)).map(supportify)
      :(astraLayer?[]:data.contextFeatures.filter(f=>!replaced.has(f.properties.id)));
    const hero=supportMode&&data.heroFeature&&replaced.has(data.heroFeature.properties.id)
      ?supportify(data.heroFeature)
      :(astraLayer?null:(data.heroFeature&&!replaced.has(data.heroFeature.properties.id)?data.heroFeature:null));
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
        if(astraLayer&&previewSignature)window.__SHAURMEG_REALCITY_PREVIEW_READY__=previewSignature;
        $('#focusHudState').textContent=astraLayer?(activeRealCityMode==='pro'?'проверенные фотоповерхности':activeRealCityMode==='photoreal'?'фотографическая 3D-реконструкция':activeRealCityMode==='astra'?'фасады Astra':'открытые данные · реальный квартал'):'геометрия квартала';
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
  function validMapPoint(p){
    const lat=Number(p?.lat),lon=Number(p?.lon);
    return Number.isFinite(lat)&&Number.isFinite(lon)&&lat>=-85&&lat<=85&&lon>=-180&&lon<=180&&p?.id!=null;
  }
  function venueGeoJSON(list=points){
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
      const p=points.find(x=>String(x.id)===id);if(p)selectPoint(p);
    });
    const interactiveLayers=['venue-clusters','venue-single-dot'];if(!fallback)interactiveLayers.push('venue-cluster-count');
    for(const layer of interactiveLayers){
      map.on('mouseenter',layer,()=>{map.getCanvas().style.cursor='pointer'});
      map.on('mouseleave',layer,()=>{map.getCanvas().style.cursor=''});
    }
  }
  function clearDomMarkers(){
    for(const m of markers.values())m.remove();
    markers.clear();
  }
  function renderVisibleMarkers(){
    if(!map||!points.length)return;
    cancelAnimationFrame(markerRenderFrame);
    markerRenderFrame=requestAnimationFrame(()=>{
      const zoom=map.getZoom();
      if(zoom<12.8){clearDomMarkers();return}
      const bounds=map.getBounds(),center=map.getCenter();
      const latPad=Math.max(.002,(bounds.getNorth()-bounds.getSouth())*.18);
      const lonPad=Math.max(.002,(bounds.getEast()-bounds.getWest())*.18);
      let visible=points.filter(p=>{
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
  function createMap(style){return new maplibregl.Map({container:'map',style,center:[37.6176,55.7558],zoom:10.3,pitch:42,bearing:-12,maxPitch:72,canvasContextAttributes:{antialias:true},attributionControl:false,renderWorldCopies:false,fadeDuration:140})}
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
    styleBuildings();addFocusLayers();ensureVenueClusterLayers();
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
    const s=p.marker_style||{},el=document.createElement('button');el.className='mapMarker'+(animate?' markerReveal':'')+(animate&&s.pulse!==false?' pulseMarker':'');el.style.setProperty('--reveal-delay',Math.min(index,12)*38+'ms');el.type='button';el.style.background=s.background||'#D94343';el.style.borderColor=s.border||'#f6f3e9';el.style.opacity=s.opacity??1;el.style.width=(s.size||44)+'px';el.style.height=(s.size||44)+'px';el.style.borderRadius=s.shape==='circle'?'50%':s.shape==='square'?'10px':s.shape==='pin'?'50% 50% 50% 14px':'16px';
    if(p.has_avatar){const img=new Image();img.alt='';img.src=api+'/map/markers/'+p.id+'/avatar';img.onerror=()=>{img.remove();el.insertAdjacentText('afterbegin',s.icon||'🥙')};el.appendChild(img)}else el.textContent=s.icon||'🥙';
    if(s.label_visible){const l=document.createElement('span');l.className='markerLabel';l.textContent=p.name;el.appendChild(l)}
    el.onclick=e=>{e.stopPropagation();selectPoint(p)};return el;
  }
  async function loadPoints(){
    // The points request starts before MapLibre is ready. On a cold backend this
    // removes the first-open race that previously required a manual reload.
    const data=await warmPoints();
    pointsWarmPromise=null;
    const seen=new Set();
    points=data.filter(validMapPoint).filter(p=>{const id=String(p.id);if(seen.has(id))return false;seen.add(id);return true});
    $('#pointsCount').textContent=points.length;
    clearDomMarkers();
    map.getSource('venue-points')?.setData(venueGeoJSON(points));
    if(points.length)fitAll();
    renderVisibleMarkers();
    const direct=qs.get('marker');if(direct){const p=points.find(x=>String(x.id)===direct);if(p)setTimeout(()=>selectPoint(p),350)}
  }
  async function loadPointsWithRetry(){
    for(let attempt=0;attempt<5;attempt++){
      try{await loadPoints();return}
      catch(e){console.warn('points load failed',attempt+1,e);pointsWarmPromise=null;if(attempt<4)await sleep(700+attempt*850)}
    }
    toast('Карта открыта, точки догружаются…');setTimeout(()=>{pointsWarmPromise=null;loadPointsWithRetry()},3500);
  }
  function fitAll(){
    const valid=points.filter(validMapPoint);if(!valid.length)return;
    const b=new maplibregl.LngLatBounds();valid.forEach(x=>b.extend([Number(x.lon),Number(x.lat)]));
    map.fitBounds(b,{padding:{top:130,bottom:210,left:40,right:40},maxZoom:12.4,duration:700});
  }
  function selectPoint(p){
    previewSignature='';
    closePanels();selected=p;markers.forEach((m,k)=>m.getElement().classList.toggle('selected',k===String(p.id)));
    $('#venueName').textContent=p.name||'Заведение';$('#venueName').title=p.name||'';$('#venueAddress').textContent=p.address||'';$('#venueAddress').title=p.address||'';$('#venueDescription').textContent=p.description||'';$('#venueDescription').classList.toggle('hidden',!p.description);
    $('#venueHoursQuick').textContent=p.hours||'';$('#venueHoursQuick').classList.toggle('hidden',!p.hours);$('#venuePriceQuick').textContent=p.price_label||'';$('#venuePriceQuick').classList.toggle('hidden',!p.price_label);
    $('#realBadge').textContent=p.realcity_quality&&p.realcity_quality!=='heuristic'?'REAL CITY · '+String(p.realcity_quality).toUpperCase():'REAL CITY';
    const a=$('#venueAvatar');a.innerHTML=p.has_avatar?'<img alt="" src="'+api+'/map/markers/'+encodeURIComponent(p.id)+'/avatar">':esc(p.marker_style?.icon||'🥙');
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
  $('#profileBtn').onclick=()=>openPanel('profile');
  $('#panelBackdrop').onclick=closePanels;document.querySelectorAll('[data-panel-close]').forEach(x=>x.onclick=closePanels);
  $('#orderFilter').onclick=e=>{const b=e.target.closest('[data-order-filter]');if(!b)return;orderFilter=b.dataset.orderFilter;document.querySelectorAll('[data-order-filter]').forEach(x=>x.classList.toggle('active',x===b));renderOrdersPanel()};
  $('#ordersPanelList').onclick=e=>{
    const b=e.target.closest('[data-order-menu]');
    if(b){const u=new URL('menu.html',location.href);u.searchParams.set('marker',b.dataset.orderMenu);u.searchParams.set('establishment',b.dataset.orderEst);u.searchParams.set('from','map');u.hash=location.hash;location.assign(u.toString());return}
    const card=e.target.closest('[data-order-detail]');if(card)openOrderDetail(card.dataset.orderDetail);
  };
  $('#ordersPanelList').onkeydown=e=>{
    if(e.key!=='Enter'&&e.key!==' ')return;
    const card=e.target.closest('[data-order-detail]');if(!card)return;e.preventDefault();openOrderDetail(card.dataset.orderDetail);
  };
  $('#activeOrderBadge').onclick=()=>{
    orderFilter='active';
    document.querySelectorAll('[data-order-filter]').forEach(x=>x.classList.toggle('active',x.dataset.orderFilter==='active'));
    openPanel('orders');renderOrdersPanel();tg?.HapticFeedback?.selectionChanged?.();
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
  warmPoints().catch(e=>console.warn('points warmup failed',e));
  authClient().then(ok=>{if(ok){loadDashboard();loadOrders();loadFavorites();connectUserStream()}else{renderGuestProfile();renderOrdersPanel();renderActiveOrderBadge();loadFavorites()}});
  bootMap().catch(e=>{console.error(e);dismissBoot();toast('Не удалось загрузить подложку карты. Откройте приложение ещё раз.')});
})();
