(() => {
 const {api,money,esc}=SHAURMEG,tg=SHAURMEG.telegram,$=s=>document.querySelector(s);
 let session=sessionStorage.getItem('shaurmeg_venue_owner_session')||'',accesses=[],est='',data=null,menu=[],builder=null,stream=null;
 const THEME_KEYS=['emerald','amber','cobalt','cherry','violet','graphite','ocean','citrus'];
 const BUILDER_DEFAULT={
   title:'Собери свою шаурму',subtitle:'Выбери основу, лаваш, мясо, соусы и добавки',
   types:[{id:'shawarma',name:'Шаурма',price:330},{id:'flatbread',name:'Лепёшка',price:320}],
   breads:[{id:'classic_lavash',name:'Классический лаваш',price:0}],
   meats:[{id:'chicken',name:'Курица',price:0}],
   sauces:[{id:'standard',name:'Стандартные соусы',price:0},{id:'big_tasty',name:'Биг Тейсти',price:0},{id:'bbq',name:'Барбекю',price:0},{id:'pomegranate',name:'Гранатовый',price:0},{id:'cheese',name:'Сырный',price:0},{id:'garlic',name:'Чесночный',price:0}],
   extras:[{id:'fries',name:'Картошка фри',price:0},{id:'jalapeno',name:'Халапеньо',price:0},{id:'onion',name:'Лук',price:0},{id:'cheese',name:'Сыр',price:0}],
   min_sauces:1,max_sauces:6,max_extras:4
 };
 const GROUPS={types:'builderTypesAdmin',breads:'builderBreadsAdmin',meats:'builderMeatsAdmin',sauces:'builderSaucesAdmin',extras:'builderExtrasAdmin'};
 const clone=x=>JSON.parse(JSON.stringify(x));
 function themeKey(seed){let h=2166136261;for(const ch of String(seed||'shaurmeg')){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)}return THEME_KEYS[Math.abs(h)%THEME_KEYS.length]}
 function toast(v){$('#toast').textContent=v;$('#toast').classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(()=>$('#toast').classList.remove('show'),1800)}
 async function call(path,opt={}){opt.headers={...(opt.headers||{}),Authorization:'Bearer '+session};if(opt.body){opt.headers['Content-Type']='application/json';if(typeof opt.body!=='string')opt.body=JSON.stringify(opt.body)}const r=await fetch(api+path,opt);if(!r.ok){const j=await r.json().catch(()=>({}));throw new Error(j.error||'HTTP '+r.status)}return r.json()}
 async function auth(){
   if(session){try{const me=await call('/venue-owner/me');accesses=me.establishments||[];$('#ownerName').textContent=me.user?.first_name||me.user?.username||'OWNER';return true}catch{session='';sessionStorage.removeItem('shaurmeg_venue_owner_session')}}
   if(!tg?.initData)return false;
   try{
     const r=await fetch(api+'/venue-owner/auth/telegram',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({initData:tg.initData})});
     if(!r.ok)throw 0;const j=await r.json();session=j.session;accesses=j.establishments||[];sessionStorage.setItem('shaurmeg_venue_owner_session',session);$('#ownerName').textContent=j.user?.first_name||j.user?.username||'OWNER';return true
   }catch{return false}
 }
 async function bootstrap(){
   if(!(await auth())){$('#gateText').textContent='Нет действующей Telegram-сессии. Откройте Mini App из бота владельца.';return}
   if(!accesses.length){$('#gateText').textContent='К этому Telegram-аккаунту пока не привязано ни одного заведения. Введите код, который выдал администратор карты.';return}
   $('#gate').classList.add('hidden');$('#venueSelect').innerHTML=accesses.map(x=>'<option value="'+esc(x.establishment_id)+'">'+esc(x.name)+'</option>').join('');
   est=new URL(location.href).searchParams.get('establishment')||accesses[0].establishment_id;if(!accesses.some(x=>x.establishment_id===est))est=accesses[0].establishment_id;$('#venueSelect').value=est;await load();
 }
 async function claimAccess(){
   if(!session)return toast('Откройте Mini App через Telegram-бота владельца');const code=$('#claimCode').value.trim();if(!code)return toast('Введите код');
   try{const j=await call('/venue-owner/claim',{method:'POST',body:{code}});accesses=j.establishments||[];if(!accesses.length)throw new Error('Доступ не появился');$('#gate').classList.add('hidden');$('#venueSelect').innerHTML=accesses.map(x=>'<option value="'+esc(x.establishment_id)+'">'+esc(x.name)+'</option>').join('');est=accesses[0].establishment_id;$('#venueSelect').value=est;await load();toast('Заведение подключено ✓')}catch(e){toast(e.message)}
 }

 function builderForEdit(config={}){
   const raw=config.builder&&typeof config.builder==='object'?config.builder:{};
   const out=clone(BUILDER_DEFAULT);
   out.title=String(raw.title||out.title);out.subtitle=String(raw.subtitle||out.subtitle);
   for(const key of ['types','breads','meats','sauces','extras']){
     if(Array.isArray(raw[key])&&raw[key].length)out[key]=raw[key].map((x,i)=>({id:String(x.id||key+'_'+i),name:String(x.name||x.n||'Опция'),price:Number(x.price??x.price_delta??x.p)||0}));
   }
   out.min_sauces=Number.isFinite(Number(raw.min_sauces))?Number(raw.min_sauces):out.min_sauces;
   out.max_sauces=Number.isFinite(Number(raw.max_sauces))?Number(raw.max_sauces):out.max_sauces;
   out.max_extras=Number.isFinite(Number(raw.max_extras))?Number(raw.max_extras):out.max_extras;
   return out;
 }
 function builderId(group){return group+'_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,6)}
 function priceLabel(group){return group==='types'?'Базовая цена':'Доплата'}
 function renderBuilderGroup(group){
   const root=$('#'+GROUPS[group]),rows=builder?.[group]||[];
   root.innerHTML=rows.length?rows.map((x,i)=>'<div class="builderAdminRow" data-builder-group="'+group+'" data-builder-index="'+i+'">'+
     '<div class="builderAdminRowMain"><input data-builder-key="name" value="'+esc(x.name||'')+'" placeholder="Название"><small>'+priceLabel(group)+'</small></div>'+
     '<div class="builderAdminPrice"><span>₽</span><input data-builder-key="price" inputmode="decimal" type="number" min="0" value="'+esc(Number(x.price)||0)+'"></div>'+
     '<button class="dangerBtn" type="button" data-builder-del="'+group+'" data-builder-index="'+i+'">×</button>'+
   '</div>').join(''):'<div class="builderAdminEmpty">Добавьте хотя бы один вариант</div>';
 }
 function renderBuilderEditor(){
   if(!builder)return;
   $('#builderTitle').value=builder.title||'';$('#builderSubtitle').value=builder.subtitle||'';
   $('#builderMinSauces').value=builder.min_sauces??1;$('#builderMaxSauces').value=builder.max_sauces??builder.sauces.length;$('#builderMaxExtras').value=builder.max_extras??builder.extras.length;
   Object.keys(GROUPS).forEach(renderBuilderGroup);
 }
 function readBuilder(){
   if(!builder)builder=clone(BUILDER_DEFAULT);
   builder.title=$('#builderTitle').value.trim()||BUILDER_DEFAULT.title;
   builder.subtitle=$('#builderSubtitle').value.trim();
   builder.min_sauces=Math.max(0,Number($('#builderMinSauces').value)||0);
   builder.max_sauces=Math.max(1,Number($('#builderMaxSauces').value)||1);
   builder.max_extras=Math.max(0,Number($('#builderMaxExtras').value)||0);
   document.querySelectorAll('.builderAdminRow').forEach(row=>{
     const group=row.dataset.builderGroup,i=+row.dataset.builderIndex,x=builder[group]?.[i];if(!x)return;
     const name=row.querySelector('[data-builder-key="name"]'),price=row.querySelector('[data-builder-key="price"]');
     x.name=name?.value.trim()||'Опция';x.price=Math.max(0,Number(price?.value)||0);
   });
 }
 function addBuilderOption(group){
   if(!GROUPS[group])return;readBuilder();
   const labels={types:'Новый формат',breads:'Новый лаваш',meats:'Новое мясо',sauces:'Новый соус',extras:'Новый ингредиент'};
   builder[group].push({id:builderId(group),name:labels[group],price:0});renderBuilderGroup(group);
   setTimeout(()=>$('#'+GROUPS[group])?.lastElementChild?.querySelector('input')?.focus(),30);
 }
 function deleteBuilderOption(group,index){
   if(!GROUPS[group])return;readBuilder();
   const required=['types','breads','meats','sauces'];if(required.includes(group)&&builder[group].length<=1)return toast('Оставьте хотя бы один вариант');
   builder[group].splice(index,1);renderBuilderGroup(group);
 }

 async function load(){
   data=await call('/venue-owner/establishments/'+encodeURIComponent(est));menu=(data.menu||[]).map(x=>({...x}));builder=builderForEdit(data.config||{});
   $('#vName').value=data.name||'';$('#vAddress').value=data.address||'';$('#vDescription').value=data.description||'';$('#vHours').value=data.hours||'';$('#vPrice').value=data.price_label||'';
   $('#vMarkerIcon').value=data.marker_style?.icon||'🥙';$('#vMarkerBg').value=data.marker_style?.background||'#10221b';$('#vTheme').value=data.config?.theme_key||themeKey(est);$('#vBuilderEnabled').checked=data.config?.builder_enabled===true;
   renderMenu();renderBuilderEditor();await loadOrders();connect();
 }
 function renderMenu(){$('#menuEditor').innerHTML=menu.length?menu.map((x,i)=>'<div class="menuEditRow" data-i="'+i+'"><input data-k="n" value="'+esc(x.n||x.name||'')+'" placeholder="Название"><input class="desc" data-k="d" value="'+esc(x.d||x.description||'')+'" placeholder="Описание"><input data-k="p" inputmode="decimal" value="'+esc(x.p??x.price??0)+'" placeholder="₽"><button class="dangerBtn" data-del="'+i+'" type="button">×</button></div>').join(''):'<div class="empty">Добавьте первую позицию</div>'}
 function readMenu(){document.querySelectorAll('.menuEditRow').forEach(row=>{const i=+row.dataset.i,x=menu[i];row.querySelectorAll('[data-k]').forEach(inp=>x[inp.dataset.k]=inp.dataset.k==='p'?+inp.value:inp.value);x.id=x.id||'item_'+Date.now()+'_'+i;x.c=x.c||'shawarma';x.active=true})}
 async function saveProfile(){try{await call('/venue-owner/establishments/'+encodeURIComponent(est)+'/profile',{method:'PATCH',body:{name:$('#vName').value,address:$('#vAddress').value,description:$('#vDescription').value,hours:$('#vHours').value,price_label:$('#vPrice').value,config:{theme_key:$('#vTheme').value}}});toast('Профиль сохранён ✓');await load()}catch(e){toast(e.message)}}
 async function saveAppearance(){try{await call('/venue-owner/establishments/'+encodeURIComponent(est)+'/appearance',{method:'PATCH',body:{marker_style:{...(data.marker_style||{}),icon:$('#vMarkerIcon').value||'🥙',background:$('#vMarkerBg').value||'#10221b'}}});toast('Метка обновлена ✓');await load()}catch(e){toast(e.message)}}
 async function saveMenu(){readMenu();try{await call('/venue-owner/establishments/'+encodeURIComponent(est)+'/menu',{method:'PUT',body:{menu,sections:data.sections||[]}});toast('Меню обновлено ✓');await load()}catch(e){toast(e.message)}}
 async function saveBuilder(){
   readBuilder();
   if(!builder.types.length||!builder.breads.length||!builder.meats.length||!builder.sauces.length)return toast('Заполните обязательные группы');
   const btn=$('#saveBuilder');btn.disabled=true;
   try{
     const j=await call('/venue-owner/establishments/'+encodeURIComponent(est)+'/builder',{method:'PUT',body:{enabled:$('#vBuilderEnabled').checked,builder}});
     builder=builderForEdit({builder:j.builder});toast('Конструктор обновлён ✓');await load();
   }catch(e){toast(e.message)}finally{btn.disabled=false}
 }
 async function loadOrders(){try{const rows=await call('/venue-owner/establishments/'+encodeURIComponent(est)+'/orders');renderOrders(rows)}catch(e){$('#ordersList').innerHTML='<div class="empty">Не удалось загрузить заказы</div>'}}
 function renderOrders(rows){
   const labels={new:'Новый',cooking:'Готовится',ready:'Готов',done:'Выдан',cancelled:'Отменён'};
   $('#ordersList').innerHTML=rows.length?rows.map(o=>'<article class="orderCard">'+
     '<header><b>'+esc(o.order_number)+'</b><span class="status status-'+esc(o.status)+'">'+esc(labels[o.status]||o.status)+'</span></header>'+
     '<div class="adminOrderMeta"><span>'+new Date(o.created_at).toLocaleString('ru-RU')+'</span><span>'+(o.fulfillment_type==='cafe'?'В заведении':'Доставка')+'</span><span>Метка #'+esc(o.marker_id||'—')+'</span></div>'+
     '<div class="adminOrderMeta">'+(o.customer_name?'<span>👤 '+esc(o.customer_name)+'</span>':'')+(o.phone?'<span>☎ '+esc(o.phone)+'</span>':'')+(o.address?'<span>⌂ '+esc(o.address)+'</span>':'')+'</div>'+
     '<div class="adminOrderItems">'+(o.items||[]).map(x=>'<div>'+esc(x.n||x.name)+' × '+esc(x.q||1)+(x.detail?'<small> · '+esc(x.detail)+'</small>':'')+'</div>').join('')+'</div>'+
     (o.comment?'<div class="notice" style="margin-top:10px">Комментарий: '+esc(o.comment)+'</div>':'')+
     '<div class="adminOrderTotal"><small>Итого</small><b>'+money(o.total)+'</b></div>'+
     '<div class="rowBtns" style="margin-top:10px">'+(o.status==='new'?'<button class="plainBtn" data-order="'+o.id+'" data-status="cooking">Принять</button>':'')+(o.status==='cooking'?'<button class="plainBtn" data-order="'+o.id+'" data-status="ready">Готов</button>':'')+(o.status==='ready'?'<button class="primaryBtn" data-order="'+o.id+'" data-status="done">Выдан</button>':'')+(!['done','cancelled'].includes(o.status)?'<button class="dangerBtn" data-order="'+o.id+'" data-status="cancelled">Отменить</button>':'')+'</div></article>').join(''):'<div class="empty">Заказов пока нет</div>';
 }
 function connect(){stream?.close();stream=new EventSource(api+'/venue-owner/establishments/'+encodeURIComponent(est)+'/stream?owner_session='+encodeURIComponent(session));stream.addEventListener('order',()=>loadOrders());stream.addEventListener('update',()=>loadOrders());stream.onerror=()=>$('#ordersLive').textContent='RECONNECT'}

 document.querySelector('.tabs').onclick=e=>{const b=e.target.closest('[data-tab]');if(!b)return;document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active',x===b));['profile','menu','orders'].forEach(id=>$('#'+id).classList.toggle('hidden',id!==b.dataset.tab))};
 $('#claimBtn').onclick=claimAccess;
 $('#ordersList').onclick=async e=>{const b=e.target.closest('[data-order]');if(!b)return;b.disabled=true;try{await call('/venue-owner/establishments/'+encodeURIComponent(est)+'/orders/'+b.dataset.order,{method:'PATCH',body:{status:b.dataset.status}});await loadOrders();toast('Статус обновлён')}catch(err){toast(err.message)}finally{b.disabled=false}};
 $('#venueSelect').onchange=async()=>{est=$('#venueSelect').value;await load()};
 $('#saveProfile').onclick=saveProfile;$('#saveAppearance').onclick=saveAppearance;$('#saveMenu').onclick=saveMenu;$('#saveBuilder').onclick=saveBuilder;
 $('#addItem').onclick=()=>{readMenu();menu.push({id:'item_'+Date.now(),n:'Новая позиция',d:'',p:0,c:'shawarma',active:true});renderMenu()};
 $('#menuEditor').onclick=e=>{const b=e.target.closest('[data-del]');if(!b)return;readMenu();menu.splice(+b.dataset.del,1);renderMenu()};
 $('#builderAdmin').onclick=e=>{
   const add=e.target.closest('[data-builder-add]');if(add)return addBuilderOption(add.dataset.builderAdd);
   const del=e.target.closest('[data-builder-del]');if(del)return deleteBuilderOption(del.dataset.builderDel,+del.dataset.builderIndex);
 };
 try{tg?.ready();tg?.expand()}catch{};bootstrap().catch(e=>{$('#gateText').textContent=e.message});
})();