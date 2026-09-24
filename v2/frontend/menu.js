(() => {
  const {api,money,esc}=SHAURMEG,tg=SHAURMEG.telegram,$=s=>document.querySelector(s);
  const qs=new URLSearchParams(location.search),marker=qs.get('marker'),est=qs.get('establishment');
  let ctx=null,session=sessionStorage.getItem('shaurmeg_client_session')||'',cart=[],category='all',fulfillment='cafe';
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
  async function load(){
    if(!marker||!est)throw new Error('Не выбрана точка');
    const r=await fetch(api+'/menu-context?marker_id='+encodeURIComponent(marker)+'&establishment_id='+encodeURIComponent(est),{cache:'no-store'});if(!r.ok)throw new Error('Меню этой точки недоступно');ctx=await r.json();
    $('#topName').textContent=ctx.venue.name;$('#topAddress').textContent=ctx.marker.address||'МЕНЮ';$('#venueName').textContent=ctx.venue.name;$('#venueMeta').textContent=[ctx.marker.address,ctx.marker.hours].filter(Boolean).join(' · ');
    if(ctx.marker.hero_image){$('#heroImg').src=ctx.marker.hero_image;$('#heroImg').classList.remove('hidden')}
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
      const body={items:cart.map(x=>({id:x.id,q:x.q})),marker_id:marker,establishment_id:est,venue_id:ctx.venue.venue_id,fulfillment_type:fulfillment,customer_name:$('#customer').value.trim(),phone:$('#phone').value.trim(),address:$('#address').value.trim(),comment:$('#comment').value.trim(),payment_method:'on_receipt'};
      if(!session&&tg?.initData)body.telegram_init_data=tg.initData;
      const headers={'Content-Type':'application/json'};if(session)headers.Authorization='Bearer '+session;
      const r=await fetch(api+'/orders',{method:'POST',headers,body:JSON.stringify(body)}),j=await r.json().catch(()=>({}));
      if(!r.ok)throw new Error(j.error==='phone_required'?'Укажите телефон':j.error==='address_required'?'Укажите адрес':j.error||'Не удалось оформить заказ');
      cart=[];save();closeSheets();toast('Заказ '+j.order_number+' принят ✓');tg?.HapticFeedback?.notificationOccurred?.('success');
    }catch(e){toast(e.message||'Ошибка заказа')}finally{btn.disabled=false}
  }
  $('#chips').onclick=e=>{const b=e.target.closest('[data-cat]');if(!b)return;category=b.dataset.cat;document.querySelectorAll('[data-cat]').forEach(x=>x.classList.toggle('active',x===b));renderMenu()};
  $('#menuGrid').onclick=e=>{const b=e.target.closest('[data-add]');if(b)add(b.dataset.add)};
  $('#cartItems').onclick=e=>{let b=e.target.closest('[data-plus]');if(b){add(b.dataset.plus);return}b=e.target.closest('[data-minus]');if(b){const x=cart.find(x=>x.id===b.dataset.minus);if(x&&--x.q<=0)cart=cart.filter(v=>v!==x);save()}};
  $('#cartBtn').onclick=()=>openSheet('cartSheet');$('#checkoutBtn').onclick=()=>openSheet('checkoutSheet');$('#profileBtn').onclick=()=>{openSheet('profileSheet');myOrders()};$('#backdrop').onclick=closeSheets;document.querySelectorAll('[data-close]').forEach(x=>x.onclick=closeSheets);
  $('#fulfillment').onclick=e=>{const b=e.target.closest('[data-value]');if(!b)return;fulfillment=b.dataset.value;document.querySelectorAll('#fulfillment button').forEach(x=>x.classList.toggle('active',x===b));document.querySelectorAll('.delivery').forEach(x=>x.classList.toggle('hidden',fulfillment!=='delivery'))};
  $('#placeOrder').onclick=place;$('#back').onclick=()=>history.length>1?history.back():location.assign('index.html');
  try{tg?.ready();tg?.expand();tg?.BackButton?.show();tg?.BackButton?.onClick(()=>history.back())}catch{}
  Promise.allSettled([authTelegram(),load()]).then(()=>{}).catch(()=>{});
  load().catch(e=>{toast(e.message);$('#venueName').textContent='Меню недоступно'});authTelegram();
})();