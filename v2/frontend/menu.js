(() => {
  const {api,money,esc}=SHAURMEG,tg=SHAURMEG.telegram,$=s=>document.querySelector(s);
  const qs=new URLSearchParams(location.search),marker=qs.get('marker'),est=qs.get('establishment');
  let ctx=null,session=sessionStorage.getItem('shaurmeg_client_session')||'',cart=[],category='all',fulfillment='cafe',builder=null,builderState={type:'',sauces:[],extras:[]};
  const cartKey='shaurmeg_cart_'+String(est||marker||'');
  try{cart=JSON.parse(localStorage.getItem(cartKey)||'[]')}catch{cart=[]}
  function toast(v){$('#toast').textContent=v;$('#toast').classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(()=>$('#toast').classList.remove('show'),1800)}
  function save(){localStorage.setItem(cartKey,JSON.stringify(cart));renderCart()}
  function openSheet(id){$('#backdrop').classList.add('show');document.querySelectorAll('.sheet').forEach(x=>x.classList.toggle('show',x.id===id))}
  function closeSheets(){$('#backdrop').classList.remove('show');document.querySelectorAll('.sheet').forEach(x=>x.classList.remove('show'))}
  async function authTelegram(){
    if(!tg?.initData)return;
    try{const r=await fetch(api+'/auth/telegram',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({initData:tg.initData})});if(!r.ok)return;const j=await r.json();session=j.session;sessionStorage.setItem('shaurmeg_client_session',session);if(j.user?.first_name&&!$('#customer').value)$('#customer').value=j.user.first_name}catch{}
  }
  function builderConfig(config={}){
    if(config.builder_enabled!==true&&!config.builder)return null;
    if(config.builder&&Array.isArray(config.builder.types)&&Array.isArray(config.builder.sauces))return config.builder;
    return {types:[{id:'shawarma',name:'Шаурма',price:330},{id:'flatbread',name:'Лепёшка',price:320}],sauces:[{id:'standard',name:'Стандартные соусы'},{id:'big_tasty',name:'Биг Тейсти'},{id:'bbq',name:'Барбекю'},{id:'pomegranate',name:'Гранатовый'},{id:'cheese',name:'Сырный'},{id:'garlic',name:'Чесночный'}],extras:[{id:'fries',name:'Картошка фри'},{id:'jalapeno',name:'Халапеньо'},{id:'onion',name:'Лук'},{id:'cheese',name:'Сыр'}],min_sauces:1,max_sauces:6,max_extras:4};
  }
  function optionName(list,id){return (list.find(x=>String(x.id)===String(id))||{}).name||id}
  function renderBuilder(){
    if(!builder)return;
    const type=builder.types.find(x=>String(x.id)===String(builderState.type))||builder.types[0];
    if(!builderState.type)builderState.type=String(type.id);
    $('#builderTypes').innerHTML=builder.types.map(x=>'<button class="builderChoice '+(String(x.id)===builderState.type?'active':'')+'" data-btype="'+esc(x.id)+'"><b>'+esc(x.name)+'</b><small>'+money(x.price||0)+'</small></button>').join('');
    $('#builderSauces').innerHTML=builder.sauces.map(x=>'<button class="builderChoice '+(builderState.sauces.includes(String(x.id))?'active':'')+'" data-bsauce="'+esc(x.id)+'"><b>'+esc(x.name)+'</b><small>'+(x.id==='standard'?'Фирменная пара':'Добавить')+'</small></button>').join('');
    $('#builderExtras').innerHTML=(builder.extras||[]).map(x=>'<button class="builderChoice '+(builderState.extras.includes(String(x.id))?'active':'')+'" data-bextra="'+esc(x.id)+'"><b>'+esc(x.name)+'</b><small>'+(x.id==='onion'?'Бесплатно':'Добавить')+'</small></button>').join('');
    $('#builderPrice').textContent=money(type.price||0);$('#builderSummary').textContent=(type.name||'Сборка')+' · '+builderState.sauces.length+' соус'+(builderState.sauces.length===1?'':'а');
    $('#sauceHint').textContent=builderState.sauces.length?'Соусы: '+builderState.sauces.map(id=>optionName(builder.sauces,id)).join(', '):'Выбери минимум один соус';
  }
  function openBuilder(){if(!builder)return;builderState={type:String(builder.types[0]?.id||''),sauces:[],extras:[]};renderBuilder();openSheet('builderSheet')}
  function toggleBuilder(list,id,max){id=String(id);const i=list.indexOf(id);if(i>=0)list.splice(i,1);else if(list.length<max)list.push(id);else toast('Достигнут максимум');renderBuilder()}
  function addBuilt(){
    if(!builder)return;const min=Math.max(1,Number(builder.min_sauces)||1);if(builderState.sauces.length<min)return toast('Добавь хотя бы один соус');
    const type=builder.types.find(x=>String(x.id)===builderState.type);if(!type)return;
    const detail='Соусы: '+builderState.sauces.map(id=>optionName(builder.sauces,id)).join(', ')+' · Добавки: '+(builderState.extras.length?builderState.extras.map(id=>optionName(builder.extras||[],id)).join(', '):'без добавок');
    cart.push({id:'custom_'+Date.now(),n:type.name+' · своя сборка',p:Number(type.price)||0,q:1,detail,builderData:{type:builderState.type,sauces:[...builderState.sauces],extras:[...builderState.extras]}});save();closeSheets();toast('Сборка добавлена ✓');tg?.HapticFeedback?.notificationOccurred?.('success');
  }
  async function load(){
    if(!marker||!est)throw new Error('Не выбрана точка');
    const r=await fetch(api+'/menu-context?marker_id='+encodeURIComponent(marker)+'&establishment_id='+encodeURIComponent(est),{cache:'no-store'});if(!r.ok)throw new Error('Меню этой точки недоступно');ctx=await r.json();
    $('#topName').textContent=ctx.venue.name;$('#topAddress').textContent=ctx.marker.address||'МЕНЮ';$('#venueName').textContent=ctx.venue.name;$('#venueMeta').textContent=[ctx.marker.address,ctx.marker.hours].filter(Boolean).join(' · ');
    if(ctx.marker.hero_image){$('#heroImg').src=ctx.marker.hero_image;$('#heroImg').classList.remove('hidden')}
    builder=builderConfig(ctx.venue.config||{});$('#builderEntry').classList.toggle('hidden',!builder);
    const menu=(ctx.venue.menu||[]).filter(x=>x.active!==false),sections=ctx.venue.sections||[];
    $('#menuCount').textContent=menu.length+' позиций';$('#chips').innerHTML='<button class="chip active" data-cat="all">Все</button>'+sections.map(x=>'<button class="chip" data-cat="'+esc(x.id)+'">'+esc((x.emoji?x.emoji+' ':'')+x.name)+'</button>').join('');
    renderMenu();renderCart();
  }
  function renderMenu(){
    const menu=(ctx?.venue?.menu||[]).filter(x=>x.active!==false&&(category==='all'||String(x.c||x.category)===category));
    $('#menuGrid').innerHTML=menu.length?menu.map(x=>'<article class="foodCard">'+
      '<div class="foodPic">'+(x.image?'<img src="'+esc(x.image)+'" alt="">':'🥙')+'</div><div class="foodBody"><h3>'+esc(x.n||x.name)+'</h3><p>'+esc(x.d||x.description||'')+'</p><div class="foodRow"><b>'+money(x.p??x.price)+'</b><button class="addBtn" data-add="'+esc(x.id)+'">+</button></div></div></article>').join(''):'<div class="empty" style="grid-column:1/-1">В разделе пока нет позиций</div>';
  }
  function renderCart(){
    const count=cart.reduce((s,x)=>s+x.q,0),total=cart.reduce((s,x)=>s+x.p*x.q,0);$('#cartCount').textContent=count;$('#cartTotal').textContent=money(total);$('#sheetTotal').textContent=money(total);$('#cartBtn').classList.toggle('hidden',!count);
    $('#cartItems').innerHTML=count?cart.map(x=>'<div class="cartItem"><div><b>'+esc(x.n)+'</b><small>'+money(x.p)+' за шт.</small></div><div class="qty"><button data-minus="'+esc(x.id)+'">−</button><b>'+x.q+'</b><button data-plus="'+esc(x.id)+'">+</button></div></div>').join(''):'<div class="empty">Корзина пуста</div>';
  }
  function add(id){
    const src=(ctx?.venue?.menu||[]).find(x=>String(x.id)===String(id));if(!src)return;const x=cart.find(x=>String(x.id)===String(id));if(x)x.q++;else cart.push({id:String(src.id),n:String(src.n||src.name),p:Number(src.p??src.price)||0,q:1});save();tg?.HapticFeedback?.impactOccurred?.('light');
  }
  async function myOrders(){
    if(!session){$('#myOrders').innerHTML='<div class="empty">Откройте Mini App внутри Telegram, чтобы видеть историю заказов.</div>';return}
    try{const r=await fetch(api+'/me/orders',{headers:{Authorization:'Bearer '+session}});if(!r.ok)throw 0;const rows=await r.json();$('#myOrders').innerHTML=rows.length?rows.map(o=>'<article class="orderCard"><header><b>'+esc(o.order_number)+'</b><span class="status">'+esc(o.status)+'</span></header><small>'+new Date(o.created_at).toLocaleString('ru-RU')+' · '+esc(o.venue_name||'')+'</small><div style="margin-top:7px;font-weight:900">'+money(o.total)+'</div></article>').join(''):'<div class="empty">Заказов пока нет</div>'}catch{$('#myOrders').innerHTML='<div class="empty">Не удалось загрузить историю</div>'}
  }
  async function place(){
    const btn=$('#placeOrder');btn.disabled=true;
    try{
      const body={items:cart.map(x=>({id:x.id,q:x.q,...(x.builderData?{builder:x.builderData}:{})})),marker_id:marker,establishment_id:est,venue_id:ctx.venue.venue_id,fulfillment_type:fulfillment,customer_name:$('#customer').value.trim(),phone:$('#phone').value.trim(),address:$('#address').value.trim(),comment:$('#comment').value.trim(),payment_method:'on_receipt'};
      if(!session&&tg?.initData)body.telegram_init_data=tg.initData;
      const headers={'Content-Type':'application/json'};if(session)headers.Authorization='Bearer '+session;
      const r=await fetch(api+'/orders',{method:'POST',headers,body:JSON.stringify(body)}),j=await r.json().catch(()=>({}));
      if(!r.ok)throw new Error(j.error==='phone_required'?'Укажите телефон':j.error==='address_required'?'Укажите адрес':j.error||'Не удалось оформить заказ');
      cart=[];save();closeSheets();toast('Заказ '+j.order_number+' принят ✓');tg?.HapticFeedback?.notificationOccurred?.('success');
    }catch(e){toast(e.message||'Ошибка заказа')}finally{btn.disabled=false}
  }
  $('#chips').onclick=e=>{const b=e.target.closest('[data-cat]');if(!b)return;category=b.dataset.cat;document.querySelectorAll('[data-cat]').forEach(x=>x.classList.toggle('active',x===b));renderMenu()};
  $('#menuGrid').onclick=e=>{const b=e.target.closest('[data-add]');if(b)add(b.dataset.add)};
  $('#cartItems').onclick=e=>{let b=e.target.closest('[data-plus]');if(b){const x=cart.find(x=>x.id===b.dataset.plus);if(x){x.q++;save()}return}b=e.target.closest('[data-minus]');if(b){const x=cart.find(x=>x.id===b.dataset.minus);if(x&&--x.q<=0)cart=cart.filter(v=>v!==x);save()}};
  $('#openBuilder').onclick=openBuilder;$('#builderTypes').onclick=e=>{const b=e.target.closest('[data-btype]');if(b){builderState.type=b.dataset.btype;renderBuilder()}};$('#builderSauces').onclick=e=>{const b=e.target.closest('[data-bsauce]');if(b)toggleBuilder(builderState.sauces,b.dataset.bsauce,Math.max(1,Number(builder.max_sauces)||builder.sauces.length))};$('#builderExtras').onclick=e=>{const b=e.target.closest('[data-bextra]');if(b)toggleBuilder(builderState.extras,b.dataset.bextra,Math.max(0,Number(builder.max_extras)||builder.extras.length))};$('#addBuilder').onclick=addBuilt;
  $('#cartBtn').onclick=()=>openSheet('cartSheet');$('#checkoutBtn').onclick=()=>openSheet('checkoutSheet');$('#profileBtn').onclick=()=>{openSheet('profileSheet');myOrders()};$('#backdrop').onclick=closeSheets;document.querySelectorAll('[data-close]').forEach(x=>x.onclick=closeSheets);
  $('#fulfillment').onclick=e=>{const b=e.target.closest('[data-value]');if(!b)return;fulfillment=b.dataset.value;document.querySelectorAll('#fulfillment button').forEach(x=>x.classList.toggle('active',x===b));document.querySelectorAll('.delivery').forEach(x=>x.classList.toggle('hidden',fulfillment!=='delivery'))};
  function goMap(){
    try{tg?.BackButton?.hide?.()}catch{}
    const fallback=new URL('index.html',location.href);
    if(marker)fallback.searchParams.set('marker',marker);
    fallback.hash=location.hash;
    if(qs.get('from')==='map'&&history.length>1)history.back();
    else location.assign(fallback.toString());
  }
  $('#placeOrder').onclick=place;$('#back').onclick=goMap;
  try{tg?.ready();tg?.expand();tg?.BackButton?.show();tg?.BackButton?.onClick(goMap)}catch{}
  authTelegram();
  load().catch(e=>{toast(e.message);$('#venueName').textContent='Меню недоступно'});
})();