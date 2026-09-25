(() => {
  const {api,money,esc}=SHAURMEG,tg=SHAURMEG.telegram,$=s=>document.querySelector(s);
  const qs=new URLSearchParams(location.search),marker=qs.get('marker'),est=qs.get('establishment');
  let ctx=null,session=sessionStorage.getItem('shaurmeg_client_session')||'',cart=[],category='all',fulfillment='cafe',builder=null,builderState={type:'',bread:'',meat:'',sauces:[],extras:[]};

  const THEME_KEYS=['emerald','amber','cobalt','cherry','violet','graphite','ocean','citrus'];
  const THEMES={
    emerald:{accent:'#98e5af',accent2:'#e2f8e8',bg:'#08110d',panel:'#101b15',panel2:'#15231b',hero:'#1b3825',glow:'rgba(110,220,147,.28)',ink:'#0c1b11'},
    amber:{accent:'#ffc66d',accent2:'#fff0cf',bg:'#150e07',panel:'#20160c',panel2:'#2b1d0f',hero:'#4a2c10',glow:'rgba(255,178,71,.28)',ink:'#241404'},
    cobalt:{accent:'#82afff',accent2:'#e5edff',bg:'#08101c',panel:'#101927',panel2:'#17243a',hero:'#17345f',glow:'rgba(79,137,255,.28)',ink:'#07142b'},
    cherry:{accent:'#ff96a8',accent2:'#ffe4e9',bg:'#15090d',panel:'#211117',panel2:'#301720',hero:'#572033',glow:'rgba(255,93,126,.26)',ink:'#2b0710'},
    violet:{accent:'#b9a2ff',accent2:'#eee9ff',bg:'#0f0a19',panel:'#191225',panel2:'#241936',hero:'#402b65',glow:'rgba(143,108,255,.28)',ink:'#160a2b'},
    graphite:{accent:'#d5d9df',accent2:'#f5f7f8',bg:'#0d0f11',panel:'#15191c',panel2:'#1e2428',hero:'#333b41',glow:'rgba(210,218,225,.18)',ink:'#111417'},
    ocean:{accent:'#7ed9e2',accent2:'#dff8fb',bg:'#061316',panel:'#0c1d21',panel2:'#102a2f',hero:'#16424a',glow:'rgba(70,202,217,.25)',ink:'#061d21'},
    citrus:{accent:'#d7ef72',accent2:'#f4fad8',bg:'#111407',panel:'#1a200d',panel2:'#252d12',hero:'#3c4918',glow:'rgba(200,232,83,.24)',ink:'#182004'}
  };

  const cartKey='shaurmeg_cart_'+String(est||marker||'');
  try{cart=JSON.parse(localStorage.getItem(cartKey)||'[]')}catch{cart=[]}

  function toast(v){const el=$('#toast');if(!el)return;el.textContent=v;el.classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(()=>el.classList.remove('show'),1800)}
  function themeKey(seed){let h=2166136261;for(const ch of String(seed||'shaurmeg')){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)}return THEME_KEYS[Math.abs(h)%THEME_KEYS.length]}
  function applyTheme(config={}){
    const key=THEMES[config.theme_key]?config.theme_key:themeKey(est);
    const t=THEMES[key],root=document.documentElement;
    document.body.dataset.theme=key;
    for(const [k,v] of Object.entries(t))root.style.setProperty('--venue-'+k,v);
    root.style.setProperty('--accent',t.accent);root.style.setProperty('--accent2',t.accent2);
    const meta=document.querySelector('meta[name="theme-color"]');if(meta)meta.content=t.bg;
    try{tg?.setHeaderColor?.(t.bg);tg?.setBackgroundColor?.(t.bg)}catch{}
  }
  function cartStats(){return {count:cart.reduce((s,x)=>s+(Number(x.q)||0),0),total:cart.reduce((s,x)=>s+(Number(x.p)||0)*(Number(x.q)||0),0)}}
  function save(){localStorage.setItem(cartKey,JSON.stringify(cart));renderCart()}
  function openSheet(id){$('#backdrop').classList.add('show');document.querySelectorAll('.sheet').forEach(x=>x.classList.toggle('show',x.id===id))}
  function closeSheets(){$('#backdrop').classList.remove('show');document.querySelectorAll('.sheet').forEach(x=>x.classList.remove('show'))}

  async function authTelegram(){
    if(!tg?.initData)return;
    try{
      const r=await fetch(api+'/auth/telegram',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({initData:tg.initData})});
      if(!r.ok)return;
      const j=await r.json();session=j.session;sessionStorage.setItem('shaurmeg_client_session',session);
      if(j.user?.first_name&&!$('#customer').value)$('#customer').value=j.user.first_name;
    }catch{}
  }

  function builderConfig(config={}){
    if(config.builder_enabled===false)return null;
    if(config.builder_enabled!==true&&!config.builder)return null;
    const fallback={
      title:'Собери свою шаурму',subtitle:'Выбери основу, лаваш, мясо, соусы и добавки',
      types:[{id:'shawarma',name:'Шаурма',price:330},{id:'flatbread',name:'Лепёшка',price:320}],
      breads:[{id:'classic_lavash',name:'Классический лаваш',price:0}],
      meats:[{id:'chicken',name:'Курица',price:0}],
      sauces:[{id:'standard',name:'Стандартные соусы',price:0},{id:'big_tasty',name:'Биг Тейсти',price:0},{id:'bbq',name:'Барбекю',price:0},{id:'pomegranate',name:'Гранатовый',price:0},{id:'cheese',name:'Сырный',price:0},{id:'garlic',name:'Чесночный',price:0}],
      extras:[{id:'fries',name:'Картошка фри',price:0},{id:'jalapeno',name:'Халапеньо',price:0},{id:'onion',name:'Лук',price:0},{id:'cheese',name:'Сыр',price:0}],
      min_sauces:1,max_sauces:6,max_extras:4
    };
    const raw=config.builder&&typeof config.builder==='object'?config.builder:{};
    const normalize=(key,base)=>Array.isArray(raw[key])&&raw[key].length?raw[key].map((x,i)=>({id:String(x.id||key+'_'+i),name:String(x.name||x.n||'Опция'),price:Number(x.price??x.price_delta??x.p)||0})):base.map(x=>({...x}));
    const sauces=normalize('sauces',fallback.sauces),extras=normalize('extras',fallback.extras);
    return {
      title:String(raw.title||fallback.title),subtitle:String(raw.subtitle||fallback.subtitle),
      types:normalize('types',fallback.types),breads:normalize('breads',fallback.breads),meats:normalize('meats',fallback.meats),
      sauces,extras,
      min_sauces:Number.isFinite(Number(raw.min_sauces))?Math.max(0,Number(raw.min_sauces)):fallback.min_sauces,
      max_sauces:Number.isFinite(Number(raw.max_sauces))?Math.max(1,Number(raw.max_sauces)):sauces.length,
      max_extras:Number.isFinite(Number(raw.max_extras))?Math.max(0,Number(raw.max_extras)):extras.length
    };
  }
  function option(list,id){return (list||[]).find(x=>String(x.id)===String(id))||null}
  function optionName(list,id){return option(list,id)?.name||id}
  function optionPrice(list,id){return Number(option(list,id)?.price)||0}
  function optionPriceText(x,base=false){
    const p=Number(x?.price)||0;
    return base?money(p):(p>0?'+ '+money(p):'Без доплаты');
  }
  function builderTotal(){
    if(!builder)return 0;
    const type=option(builder.types,builderState.type);
    return (Number(type?.price)||0)+optionPrice(builder.breads,builderState.bread)+optionPrice(builder.meats,builderState.meat)+
      builderState.sauces.reduce((s,id)=>s+optionPrice(builder.sauces,id),0)+builderState.extras.reduce((s,id)=>s+optionPrice(builder.extras,id),0);
  }
  function renderBuilder(){
    if(!builder)return;
    const type=option(builder.types,builderState.type)||builder.types[0];
    if(!builderState.type)builderState.type=String(type?.id||'');
    if(!builderState.bread)builderState.bread=String(builder.breads?.[0]?.id||'');
    if(!builderState.meat)builderState.meat=String(builder.meats?.[0]?.id||'');
    $('#builderTypes').innerHTML=(builder.types||[]).map(x=>'<button class="builderChoice '+(String(x.id)===builderState.type?'active':'')+'" data-btype="'+esc(x.id)+'"><b>'+esc(x.name)+'</b><small>'+optionPriceText(x,true)+'</small></button>').join('');
    $('#builderBreads').innerHTML=(builder.breads||[]).map(x=>'<button class="builderChoice '+(String(x.id)===builderState.bread?'active':'')+'" data-bbread="'+esc(x.id)+'"><b>'+esc(x.name)+'</b><small>'+optionPriceText(x)+'</small></button>').join('');
    $('#builderMeats').innerHTML=(builder.meats||[]).map(x=>'<button class="builderChoice '+(String(x.id)===builderState.meat?'active':'')+'" data-bmeat="'+esc(x.id)+'"><b>'+esc(x.name)+'</b><small>'+optionPriceText(x)+'</small></button>').join('');
    $('#builderSauces').innerHTML=(builder.sauces||[]).map(x=>'<button class="builderChoice '+(builderState.sauces.includes(String(x.id))?'active':'')+'" data-bsauce="'+esc(x.id)+'"><b>'+esc(x.name)+'</b><small>'+optionPriceText(x)+'</small></button>').join('');
    $('#builderExtras').innerHTML=(builder.extras||[]).map(x=>'<button class="builderChoice '+(builderState.extras.includes(String(x.id))?'active':'')+'" data-bextra="'+esc(x.id)+'"><b>'+esc(x.name)+'</b><small>'+optionPriceText(x)+'</small></button>').join('');
    $('#builderBreadBlock').classList.toggle('hidden',!(builder.breads||[]).length);
    $('#builderMeatBlock').classList.toggle('hidden',!(builder.meats||[]).length);
    $('#builderPrice').textContent=money(builderTotal());
    const bread=optionName(builder.breads,builderState.bread),meat=optionName(builder.meats,builderState.meat);
    $('#builderSummary').textContent=[type?.name,bread,meat].filter(Boolean).join(' · ');
    const min=Math.max(0,Number(builder.min_sauces)||0);
    $('#sauceHint').textContent=builderState.sauces.length?'Соусы: '+builderState.sauces.map(id=>optionName(builder.sauces,id)).join(', '):(min?'Выбери минимум '+min+' соус'+(min===1?'':'а'):'Соус можно не добавлять');
  }
  function openBuilder(){
    if(!builder)return;
    builderState={type:String(builder.types?.[0]?.id||''),bread:String(builder.breads?.[0]?.id||''),meat:String(builder.meats?.[0]?.id||''),sauces:[],extras:[]};
    renderBuilder();openSheet('builderSheet');
  }
  function toggleBuilder(list,id,max){id=String(id);const i=list.indexOf(id);if(i>=0)list.splice(i,1);else if(list.length<max)list.push(id);else toast('Достигнут максимум');renderBuilder()}
  function addBuilt(){
    if(!builder)return;
    const min=Math.max(0,Number(builder.min_sauces)||0);if(builderState.sauces.length<min)return toast('Нужно выбрать соусов: минимум '+min);
    const type=option(builder.types,builderState.type);if(!type)return;
    const bread=option(builder.breads,builderState.bread),meat=option(builder.meats,builderState.meat);
    const parts=[];
    if(bread)parts.push('Лаваш: '+bread.name);
    if(meat)parts.push('Мясо: '+meat.name);
    parts.push('Соусы: '+(builderState.sauces.length?builderState.sauces.map(id=>optionName(builder.sauces,id)).join(', '):'без соусов'));
    parts.push('Добавки: '+(builderState.extras.length?builderState.extras.map(id=>optionName(builder.extras,id)).join(', '):'без добавок'));
    cart.push({
      id:'custom_'+Date.now(),n:type.name+' · своя сборка',p:builderTotal(),q:1,detail:parts.join(' · '),
      builderData:{type:builderState.type,bread:builderState.bread,meat:builderState.meat,sauces:[...builderState.sauces],extras:[...builderState.extras]}
    });
    save();closeSheets();toast('Сборка добавлена ✓');tg?.HapticFeedback?.notificationOccurred?.('success');
  }

  async function load(){
    if(!marker||!est)throw new Error('Не выбрана точка');
    const r=await fetch(api+'/menu-context?marker_id='+encodeURIComponent(marker)+'&establishment_id='+encodeURIComponent(est),{cache:'no-store'});
    if(!r.ok)throw new Error('Меню этой точки недоступно');
    ctx=await r.json();applyTheme(ctx.venue.config||{});
    $('#topName').textContent=ctx.venue.name;
    $('#topAddress').textContent=ctx.marker.address||'МЕНЮ';
    $('#venueName').textContent=ctx.venue.name;
    $('#venueMeta').textContent=ctx.marker.description||ctx.marker.address||'';
    $('#checkoutVenue').textContent=ctx.venue.name;
    $('#checkoutAddress').textContent=ctx.marker.address||'';
    if(ctx.marker.hours){$('#venueHours').textContent=ctx.marker.hours;$('#venueHours').classList.remove('hidden')}
    if(ctx.marker.price_label){$('#venuePrice').textContent=ctx.marker.price_label;$('#venuePrice').classList.remove('hidden')}
    if(ctx.marker.hero_image){$('#heroImg').src=ctx.marker.hero_image;$('#heroImg').classList.remove('hidden')}
    else $('#hero').classList.add('heroNoImage');
    builder=builderConfig(ctx.venue.config||{});$('#builderEntry').classList.toggle('hidden',!builder);
    if(builder){$('#builderEntryTitle').textContent=builder.title||'Собери свою шаурму';$('#builderEntrySubtitle').textContent=builder.subtitle||'Основа → лаваш → мясо → соусы → добавки'}
    const menu=(ctx.venue.menu||[]).filter(x=>x.active!==false),sections=ctx.venue.sections||[];
    $('#menuCount').textContent=menu.length+' позиций';
    $('#chips').innerHTML='<button class="chip active" data-cat="all">Все</button>'+sections.map(x=>'<button class="chip" data-cat="'+esc(x.id)+'">'+esc((x.emoji?x.emoji+' ':'')+x.name)+'</button>').join('');
    renderMenu();renderCart();
  }

  function renderMenu(){
    const menu=(ctx?.venue?.menu||[]).filter(x=>x.active!==false&&(category==='all'||String(x.c||x.category)===category));
    $('#menuGrid').innerHTML=menu.length?menu.map(x=>'<article class="foodCard">'+
      '<div class="foodPic">'+(x.image?'<img src="'+esc(x.image)+'" alt="" loading="lazy" onerror="this.remove()">':'<span>🥙</span>')+'<i></i></div>'+
      '<div class="foodBody"><div class="foodTitle"><h3>'+esc(x.n||x.name)+'</h3></div><p>'+esc(x.d||x.description||'')+'</p>'+
      '<div class="foodRow"><b>'+money(x.p??x.price)+'</b><button class="addBtn" data-add="'+esc(x.id)+'" aria-label="Добавить">+</button></div></div></article>').join('')
      :'<div class="empty" style="grid-column:1/-1">В разделе пока нет позиций</div>';
  }

  function renderCart(){
    const {count,total}=cartStats();
    $('#cartCount').textContent=count;$('#cartTotal').textContent=money(total);$('#sheetTotal').textContent=money(total);
    $('#cartItemsCount').textContent=count;$('#checkoutTotal').textContent=money(total);$('#placeOrderTotal').textContent=money(total);
    $('#cartBtn').classList.toggle('hidden',!count);
    $('#checkoutBtn').disabled=!count;$('#placeOrder').disabled=!count;
    $('#cartItems').innerHTML=count?cart.map(x=>'<div class="cartItem"><div class="cartItemCopy"><b>'+esc(x.n)+'</b>'+
      (x.detail?'<small>'+esc(x.detail)+'</small>':'<small>'+money(x.p)+' за шт.</small>')+
      '</div><div class="qty"><button data-minus="'+esc(x.id)+'">−</button><b>'+x.q+'</b><button data-plus="'+esc(x.id)+'">+</button></div></div>').join('')
      :'<div class="empty">Корзина пуста</div>';
  }

  function add(id){
    const src=(ctx?.venue?.menu||[]).find(x=>String(x.id)===String(id));if(!src)return;
    const x=cart.find(x=>String(x.id)===String(id));if(x)x.q++;else cart.push({id:String(src.id),n:String(src.n||src.name),p:Number(src.p??src.price)||0,q:1});
    save();tg?.HapticFeedback?.impactOccurred?.('light');
  }

  const STATUS_LABELS={new:'Принят',cooking:'Готовится',ready:'Готов',done:'Завершён',cancelled:'Отменён'};
  async function myOrders(){
    if(!session){$('#myOrders').innerHTML='<div class="empty">Откройте Mini App внутри Telegram, чтобы видеть историю заказов.</div>';return}
    try{
      const r=await fetch(api+'/me/orders',{headers:{Authorization:'Bearer '+session}});if(!r.ok)throw 0;
      const rows=await r.json();
      $('#myOrders').innerHTML=rows.length?rows.map(o=>'<article class="orderCard historyCard"><header><div><small>'+esc(o.venue_name||'Shaurmeg')+'</small><b>'+esc(o.order_number)+'</b></div><span class="status status-'+esc(o.status)+'">'+esc(STATUS_LABELS[o.status]||o.status)+'</span></header>'+
        '<div class="historyMeta">'+new Date(o.created_at).toLocaleString('ru-RU')+' · '+(o.fulfillment_type==='cafe'?'в заведении':'доставка')+'</div>'+
        '<div class="historyBottom"><span>'+((o.items||[]).reduce((s,x)=>s+(x.q||1),0))+' поз.</span><b>'+money(o.total)+'</b></div></article>').join('')
        :'<div class="empty">Заказов пока нет</div>';
    }catch{$('#myOrders').innerHTML='<div class="empty">Не удалось загрузить историю</div>'}
  }
  async function submitOrder(){
    const btn=$('#placeOrder');btn.disabled=true;
    const {total}=cartStats();
    try{
      const body={items:cart.map(x=>({id:x.id,q:x.q,...(x.builderData?{builder:x.builderData}:{})})),marker_id:marker,establishment_id:est,venue_id:ctx.venue.venue_id,fulfillment_type:fulfillment,customer_name:$('#customer').value.trim(),phone:$('#phone').value.trim(),address:$('#address').value.trim(),comment:$('#comment').value.trim(),payment_method:'on_receipt'};
      if(!session&&tg?.initData)body.telegram_init_data=tg.initData;
      const headers={'Content-Type':'application/json'};if(session)headers.Authorization='Bearer '+session;
      const r=await fetch(api+'/orders',{method:'POST',headers,body:JSON.stringify(body)}),j=await r.json().catch(()=>({}));
      if(!r.ok)throw new Error(j.error==='phone_required'?'Укажите телефон':j.error==='address_required'?'Укажите адрес':j.error||'Не удалось оформить заказ');
      $('#successNumber').textContent=j.order_number||'Заказ принят';
      $('#successVenue').textContent=(ctx?.venue?.name||'Заведение')+(ctx?.marker?.address?' · '+ctx.marker.address:'');
      $('#successTotal').textContent=money(j.total??total);
      cart=[];save();openSheet('successSheet');tg?.HapticFeedback?.notificationOccurred?.('success');
    }catch(e){toast(e.message||'Ошибка заказа')}finally{btn.disabled=false}
  }

  $('#chips').onclick=e=>{const b=e.target.closest('[data-cat]');if(!b)return;category=b.dataset.cat;document.querySelectorAll('[data-cat]').forEach(x=>x.classList.toggle('active',x===b));renderMenu()};
  $('#menuGrid').onclick=e=>{const b=e.target.closest('[data-add]');if(b)add(b.dataset.add)};
  $('#cartItems').onclick=e=>{
    let b=e.target.closest('[data-plus]');if(b){const x=cart.find(x=>x.id===b.dataset.plus);if(x){x.q++;save()}return}
    b=e.target.closest('[data-minus]');if(b){const x=cart.find(x=>x.id===b.dataset.minus);if(x&&--x.q<=0)cart=cart.filter(v=>v!==x);save()}
  };
  $('#openBuilder').onclick=openBuilder;
  $('#builderTypes').onclick=e=>{const b=e.target.closest('[data-btype]');if(b){builderState.type=b.dataset.btype;renderBuilder()}};
  $('#builderBreads').onclick=e=>{const b=e.target.closest('[data-bbread]');if(b){builderState.bread=b.dataset.bbread;renderBuilder()}};
  $('#builderMeats').onclick=e=>{const b=e.target.closest('[data-bmeat]');if(b){builderState.meat=b.dataset.bmeat;renderBuilder()}};
  $('#builderSauces').onclick=e=>{const b=e.target.closest('[data-bsauce]');if(b)toggleBuilder(builderState.sauces,b.dataset.bsauce,Math.max(1,Number(builder.max_sauces)||builder.sauces.length))};
  $('#builderExtras').onclick=e=>{const b=e.target.closest('[data-bextra]');if(!b)return;const max=Number.isFinite(Number(builder.max_extras))?Math.max(0,Number(builder.max_extras)):builder.extras.length;toggleBuilder(builderState.extras,b.dataset.bextra,max)};
  $('#addBuilder').onclick=addBuilt;
  $('#cartBtn').onclick=()=>openSheet('cartSheet');
  $('#checkoutBtn').onclick=()=>openSheet('checkoutSheet');
  $('#profileBtn').onclick=()=>{openSheet('profileSheet');myOrders()};
  $('#backdrop').onclick=closeSheets;
  document.querySelectorAll('[data-close]').forEach(x=>x.onclick=closeSheets);
  $('#fulfillment').onclick=e=>{const b=e.target.closest('[data-value]');if(!b)return;fulfillment=b.dataset.value;document.querySelectorAll('#fulfillment button').forEach(x=>x.classList.toggle('active',x===b));document.querySelectorAll('.delivery').forEach(x=>x.classList.toggle('hidden',fulfillment!=='delivery'))};
  $('#placeOrder').onclick=submitOrder;
  $('#successMenu').onclick=closeSheets;
  $('#successOrders').onclick=()=>{openSheet('profileSheet');myOrders()};

  function goMap(){
    try{tg?.BackButton?.hide?.()}catch{}
    const fallback=new URL('index.html',location.href);if(marker)fallback.searchParams.set('marker',marker);fallback.hash=location.hash;
    if(qs.get('from')==='map'&&history.length>1)history.back();else location.assign(fallback.toString());
  }
  $('#back').onclick=goMap;
  try{tg?.ready();tg?.expand();tg?.BackButton?.show();tg?.BackButton?.onClick(goMap)}catch{}
  authTelegram();
  load().catch(e=>{toast(e.message);$('#venueName').textContent='Меню недоступно'});
})();