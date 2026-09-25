(() => {
 const {api,money,esc}=SHAURMEG,tg=SHAURMEG.telegram,$=s=>document.querySelector(s);
 let session=sessionStorage.getItem('shaurmeg_venue_owner_session')||'',accesses=[],est='',data=null,menu=[],builder=null,stream=null;
 const THEME_KEYS=['emerald','amber','cobalt','cherry','violet','graphite','ocean','citrus'];
 const DEFAULT_THEME={primary:'#D94343',secondary:'#13233B',tone:'balanced'};
 const LEGACY_THEME_PRESETS={
   emerald:{primary:'#54D9A0',secondary:'#25352F',tone:'balanced'},
   amber:{primary:'#FFB468',secondary:'#4B321E',tone:'balanced'},
   cobalt:{primary:'#6D8DFF',secondary:'#263F73',tone:'balanced'},
   cherry:{primary:'#FF709F',secondary:'#5E2941',tone:'balanced'},
   violet:{primary:'#AA6CFF',secondary:'#4A306C',tone:'balanced'},
   graphite:{primary:'#CFD3DA',secondary:'#39404A',tone:'balanced'},
   ocean:{primary:'#58C9DC',secondary:'#1C4B58',tone:'balanced'},
   citrus:{primary:'#C9E768',secondary:'#40511E',tone:'balanced'}
 };

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
 function cleanHex(v,fallback='#D94343'){const s=String(v||'').trim().toUpperCase();return /^#[0-9A-F]{6}$/.test(s)?s:fallback}
 function themeForConfig(config={}){
   if(config.theme&&typeof config.theme==='object')return {
     primary:cleanHex(config.theme.primary,DEFAULT_THEME.primary),
     secondary:cleanHex(config.theme.secondary,DEFAULT_THEME.secondary),
     tone:['dark','light','balanced'].includes(config.theme.tone)?config.theme.tone:DEFAULT_THEME.tone
   };
   return {...(LEGACY_THEME_PRESETS[config.theme_key]||LEGACY_THEME_PRESETS[themeKey(est)]||DEFAULT_THEME)};
 }
 function readThemeInputs(){return {
   primary:cleanHex($('#themePrimaryHex').value,$('#themePrimary').value||DEFAULT_THEME.primary),
   secondary:cleanHex($('#themeSecondaryHex').value,$('#themeSecondary').value||DEFAULT_THEME.secondary),
   tone:['dark','light','balanced'].includes($('#themeTone').value)?$('#themeTone').value:'balanced'
 }}
 function renderThemePreview(theme=readThemeInputs()){
   const p=$('#themePreview');if(!p)return;
   const [r,g,b]=theme.primary.slice(1).match(/../g).map(x=>parseInt(x,16)),brightness=(r*299+g*587+b*114)/1000;
   p.dataset.tone=theme.tone;p.style.setProperty('--preview-primary',theme.primary);p.style.setProperty('--preview-secondary',theme.secondary);p.style.setProperty('--preview-ink',brightness>150?'#142033':'#FFFFFF');
   $('#themePreviewName').textContent=$('#vName').value.trim()||data?.name||'Название';
 }
 function syncThemeInputs(theme){
   const t={primary:cleanHex(theme.primary,DEFAULT_THEME.primary),secondary:cleanHex(theme.secondary,DEFAULT_THEME.secondary),tone:['dark','light','balanced'].includes(theme.tone)?theme.tone:'balanced'};
   $('#themePrimary').value=t.primary;$('#themePrimaryHex').value=t.primary;$('#themeSecondary').value=t.secondary;$('#themeSecondaryHex').value=t.secondary;$('#themeTone').value=t.tone;renderThemePreview(t);
 }
 function syncThemeColor(colorId,hexId,fromHex=false){
   const color=$(colorId),hexInput=$(hexId);if(!color||!hexInput)return;
   if(fromHex){const v=cleanHex(hexInput.value,'');if(v){color.value=v;hexInput.value=v}}
   else hexInput.value=color.value.toUpperCase();
   renderThemePreview();
 }
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

 function ensureMenuId(x,i=0){
   if(!x.id)x.id='item_'+Date.now().toString(36)+'_'+i+'_'+Math.random().toString(36).slice(2,6);
   return String(x.id);
 }
 function menuCategoryOptions(current){
   const known=[...(Array.isArray(data?.sections)?data.sections:[]),{id:'shawarma',name:'Шаурма'},{id:'drinks',name:'Напитки'},{id:'bakery',name:'Выпечка'},{id:'extras',name:'Допы'}];
   const map=new Map();for(const x of known){const id=String(x?.id||'').trim();if(id&&!map.has(id))map.set(id,String(x?.name||id))}
   if(current&&!map.has(String(current)))map.set(String(current),String(current));
   return [...map.entries()].map(([id,name])=>'<option value="'+esc(id)+'" '+(String(current)===id?'selected':'')+'>'+esc(name)+'</option>').join('');
 }
 function photoDataUrl(blob){
   return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result||''));r.onerror=()=>reject(new Error('Не удалось прочитать фото'));r.readAsDataURL(blob)});
 }
 function canvasBlob(canvas,quality){
   return new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',quality));
 }
 function loadPhotoImage(file){
   return new Promise((resolve,reject)=>{
     const url=URL.createObjectURL(file),img=new Image();
     img.onload=()=>resolve({img,url});
     img.onerror=()=>{URL.revokeObjectURL(url);reject(new Error('Формат фото не поддерживается'))};
     img.src=url;
   });
 }
 async function compressMenuPhoto(file){
   if(!file||!String(file.type||'').startsWith('image/'))throw new Error('Выберите изображение');
   if(file.size>25*1024*1024)throw new Error('Фото слишком большое');
   const loaded=await loadPhotoImage(file),img=loaded.img;
   try{
     const nw=Number(img.naturalWidth||img.width),nh=Number(img.naturalHeight||img.height);
     if(!nw||!nh)throw new Error('Не удалось определить размер фото');
     const firstScale=Math.min(1,1000/Math.max(nw,nh));
     let w=Math.max(320,Math.round(nw*firstScale)),h=Math.max(240,Math.round(nh*firstScale));
     const qualities=[.86,.78,.70,.62,.55,.48];
     for(let i=0;i<qualities.length;i++){
       const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;
       const ctx=canvas.getContext('2d',{alpha:false});if(!ctx)throw new Error('Не удалось обработать фото');
       ctx.fillStyle='#F7F9FC';ctx.fillRect(0,0,w,h);ctx.drawImage(img,0,0,w,h);
       const blob=await canvasBlob(canvas,qualities[i]);if(!blob)throw new Error('Не удалось сжать фото');
       const encoded=await photoDataUrl(blob);
       if(encoded.length<=420000)return encoded;
       w=Math.max(360,Math.round(w*.84));h=Math.max(270,Math.round(h*.84));
     }
     throw new Error('Фото не удалось подготовить — выберите другое');
   }finally{URL.revokeObjectURL(loaded.url)}
 }
 function renderMenu(){
   const root=$('#menuEditor');
   $('#menuItemCount').textContent=String(menu.length);
   root.innerHTML=menu.length?menu.map((x,i)=>{
     const id=ensureMenuId(x,i),name=String(x.n||x.name||''),desc=String(x.d||x.description||''),price=Number(x.p??x.price)||0,cat=String(x.c||x.category||'shawarma'),image=String(x.image||'');
     return '<article class="menuEditCard" data-item-id="'+esc(id)+'">'+
       '<div class="menuEditPhoto '+(image?'hasPhoto':'')+'">'+
         '<button class="menuPhotoPreview" type="button" data-photo-pick="'+esc(id)+'" aria-label="Выбрать фото">'+
           (image?'<img src="'+esc(image)+'" alt="">':'<span><i>＋</i><b>Фото блюда</b><small>Выбрать из галереи</small></span>')+
         '</button>'+
         '<input type="file" accept="image/*" data-photo-input="'+esc(id)+'" hidden>'+
         '<div class="menuPhotoActions">'+
           '<button class="plainBtn" type="button" data-photo-pick="'+esc(id)+'">'+(image?'Заменить':'Выбрать фото')+'</button>'+
           (image?'<button class="menuPhotoRemove" type="button" data-photo-remove="'+esc(id)+'">Удалить</button>':'')+
         '</div>'+
       '</div>'+
       '<div class="menuEditContent">'+
         '<div class="menuEditCardHead"><div><small>ПОЗИЦИЯ '+(i+1)+'</small><b>'+esc(name||'Новая позиция')+'</b></div><button class="dangerBtn menuDeleteItem" data-del-id="'+esc(id)+'" type="button">Удалить</button></div>'+
         '<div class="menuEditForm">'+
           '<label class="menuEditField menuEditName"><span>Название</span><input data-k="n" value="'+esc(name)+'" placeholder="Например, Шаурма классическая"></label>'+
           '<label class="menuEditField menuEditPrice"><span>Цена</span><div class="menuPriceInput"><input data-k="p" type="number" min="0" inputmode="decimal" value="'+esc(price)+'"><i>₽</i></div></label>'+
           '<label class="menuEditField menuEditCategory"><span>Раздел</span><select data-k="c">'+menuCategoryOptions(cat)+'</select></label>'+
           '<label class="menuEditField menuEditDescription"><span>Описание</span><textarea data-k="d" rows="3" placeholder="Состав, особенности, вес...">'+esc(desc)+'</textarea></label>'+
         '</div>'+
       '</div>'+
     '</article>';
   }).join(''):'<div class="ownerMenuEmpty"><div>＋</div><b>Меню пока пустое</b><span>Добавьте первую позицию и выберите для неё аппетитное фото.</span><button class="primaryBtn" type="button" data-add-empty>Добавить позицию</button></div>';
 }
 function readMenu(){
   document.querySelectorAll('.menuEditCard').forEach(row=>{
     const id=String(row.dataset.itemId||''),x=menu.find(item=>String(item.id)===id);if(!x)return;
     row.querySelectorAll('[data-k]').forEach(inp=>{const k=inp.dataset.k;x[k]=k==='p'?Math.max(0,Number(inp.value)||0):inp.value});
     x.id=id;x.c=x.c||'shawarma';x.active=true;
   });
 }
 function menuSectionsForSave(){
   const names={shawarma:'Шаурма',drinks:'Напитки',bakery:'Выпечка',extras:'Допы'},map=new Map();
   for(const x of (Array.isArray(data?.sections)?data.sections:[])){
     const id=String(x?.id||'').trim();if(id&&!map.has(id))map.set(id,{...x,id,name:String(x.name||names[id]||id),active:x.active!==false});
   }
   for(const item of menu){
     const id=String(item.c||item.category||'shawarma').trim()||'shawarma';
     if(!map.has(id))map.set(id,{id,name:names[id]||id,emoji:'',active:true});
   }
   return [...map.values()];
 }

 async function load(){
   data=await call('/venue-owner/establishments/'+encodeURIComponent(est));menu=(data.menu||[]).map(x=>({...x}));builder=builderForEdit(data.config||{});
   $('#vName').value=data.name||'';$('#vAddress').value=data.address||'';$('#vDescription').value=data.description||'';$('#vHours').value=data.hours||'';$('#vPrice').value=data.price_label||'';
   $('#vMarkerIcon').value=data.marker_style?.icon||'🥙';$('#vMarkerBg').value=data.marker_style?.background||'#D94343';$('#vBuilderEnabled').checked=data.config?.builder_enabled===true;
   syncThemeInputs(themeForConfig(data.config||{}));
   $('#menuVenueLabel').textContent=data.name||'Заведение';$('#menuEstLabel').textContent=est;
   renderMenu();renderBuilderEditor();await loadOrders();connect();
 }
 async function saveProfile(){try{await call('/venue-owner/establishments/'+encodeURIComponent(est)+'/profile',{method:'PATCH',body:{name:$('#vName').value,address:$('#vAddress').value,description:$('#vDescription').value,hours:$('#vHours').value,price_label:$('#vPrice').value}});toast('Профиль сохранён ✓');await load()}catch(e){toast(e.message)}}
 async function saveTheme(){
   const btn=$('#saveTheme');btn.disabled=true;
   try{
     const j=await call('/venue-owner/establishments/'+encodeURIComponent(est)+'/theme',{method:'PUT',body:{theme:readThemeInputs()}});
     data.config={...(data.config||{}),theme:j.theme};syncThemeInputs(j.theme);toast('Дизайн сохранён ✓');
   }catch(e){toast(e.message)}finally{btn.disabled=false}
 }
 async function saveAppearance(){try{await call('/venue-owner/establishments/'+encodeURIComponent(est)+'/appearance',{method:'PATCH',body:{marker_style:{...(data.marker_style||{}),icon:$('#vMarkerIcon').value||'🥙',background:$('#vMarkerBg').value||'#D94343'}}});toast('Метка обновлена ✓');await load()}catch(e){toast(e.message)}}
 async function saveMenu(){
   readMenu();const btn=$('#saveMenu'),venueAtSave=est;btn.disabled=true;const oldText=btn.textContent;btn.textContent='Сохраняем…';
   try{
     await call('/venue-owner/establishments/'+encodeURIComponent(venueAtSave)+'/menu',{method:'PUT',body:{menu,sections:menuSectionsForSave()}});
     if(est===venueAtSave){toast('Меню и фотографии сохранены ✓');await load()}
   }catch(e){toast(e.message)}finally{btn.disabled=false;btn.textContent=oldText}
 }
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
   const labels={new:'Принят',cooking:'Готовится',ready:'Готово',done:'Выполнен',cancelled:'Отменён'};
   $('#ordersList').innerHTML=rows.length?rows.map(o=>'<article class="orderCard">'+
     '<header><b>'+esc(o.order_number)+'</b><span class="status status-'+esc(o.status)+'">'+esc(labels[o.status]||o.status)+'</span></header>'+
     '<div class="adminOrderMeta"><span>'+new Date(o.created_at).toLocaleString('ru-RU')+'</span><span>'+(o.fulfillment_type==='cafe'?'В заведении':'Доставка')+'</span><span>Метка #'+esc(o.marker_id||'—')+'</span></div>'+
     '<div class="adminOrderMeta">'+(o.customer_name?'<span>👤 '+esc(o.customer_name)+'</span>':'')+(o.phone?'<span>☎ '+esc(o.phone)+'</span>':'')+(o.address?'<span>⌂ '+esc(o.address)+'</span>':'')+'</div>'+
     '<div class="adminOrderItems">'+(o.items||[]).map(x=>'<div>'+esc(x.n||x.name)+' × '+esc(x.q||1)+(x.detail?'<small> · '+esc(x.detail)+'</small>':'')+'</div>').join('')+'</div>'+
     (o.comment?'<div class="notice" style="margin-top:10px">Комментарий: '+esc(o.comment)+'</div>':'')+
     '<div class="adminOrderTotal"><small>Итого</small><b>'+money(o.total)+'</b></div>'+
     '<div class="rowBtns" style="margin-top:10px">'+(o.status==='new'?'<button class="plainBtn" data-order="'+o.id+'" data-status="cooking">Принять</button>':'')+(o.status==='cooking'?'<button class="plainBtn" data-order="'+o.id+'" data-status="ready">Готов</button>':'')+(o.status==='ready'?'<button class="primaryBtn" data-order="'+o.id+'" data-status="done">Выполнен</button>':'')+(!['done','cancelled'].includes(o.status)?'<button class="dangerBtn" data-order="'+o.id+'" data-status="cancelled">Отменить</button>':'')+'</div></article>').join(''):'<div class="empty">Заказов пока нет</div>';
 }
 function connect(){stream?.close();stream=new EventSource(api+'/venue-owner/establishments/'+encodeURIComponent(est)+'/stream?owner_session='+encodeURIComponent(session));stream.addEventListener('order',()=>loadOrders());stream.addEventListener('update',()=>loadOrders());stream.onerror=()=>$('#ordersLive').textContent='RECONNECT'}

 document.querySelector('.tabs').onclick=e=>{const b=e.target.closest('[data-tab]');if(!b)return;document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active',x===b));['profile','menu','orders'].forEach(id=>$('#'+id).classList.toggle('hidden',id!==b.dataset.tab))};
 $('#claimBtn').onclick=claimAccess;
 $('#ordersList').onclick=async e=>{const b=e.target.closest('[data-order]');if(!b)return;b.disabled=true;try{await call('/venue-owner/establishments/'+encodeURIComponent(est)+'/orders/'+b.dataset.order,{method:'PATCH',body:{status:b.dataset.status}});await loadOrders();toast('Статус обновлён')}catch(err){toast(err.message)}finally{b.disabled=false}};
 $('#venueSelect').onchange=async()=>{est=$('#venueSelect').value;await load()};
 $('#saveProfile').onclick=saveProfile;$('#saveAppearance').onclick=saveAppearance;$('#saveMenu').onclick=saveMenu;$('#saveBuilder').onclick=saveBuilder;$('#saveTheme').onclick=saveTheme;
 $('#resetTheme').onclick=()=>{syncThemeInputs(DEFAULT_THEME);toast('Цвета Shaurmeg выбраны · нажмите «Сохранить дизайн»')};
 $('#themePrimary').oninput=()=>syncThemeColor('#themePrimary','#themePrimaryHex');
 $('#themePrimaryHex').onchange=()=>syncThemeColor('#themePrimary','#themePrimaryHex',true);
 $('#themeSecondary').oninput=()=>syncThemeColor('#themeSecondary','#themeSecondaryHex');
 $('#themeSecondaryHex').onchange=()=>syncThemeColor('#themeSecondary','#themeSecondaryHex',true);
 $('#themeTone').onchange=()=>renderThemePreview();
 $('#vName').oninput=()=>renderThemePreview();
 function addMenuItem(){
   readMenu();const id='item_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,6);
   menu.push({id,n:'Новая позиция',d:'',p:0,c:'shawarma',image:'',active:true});renderMenu();
   setTimeout(()=>[...document.querySelectorAll('.menuEditCard')].find(x=>String(x.dataset.itemId)===id)?.querySelector('[data-k="n"]')?.focus(),40);
 }
 $('#addItem').onclick=addMenuItem;
 $('#menuEditor').onclick=e=>{
   const emptyAdd=e.target.closest('[data-add-empty]');if(emptyAdd)return addMenuItem();
   const pick=e.target.closest('[data-photo-pick]');if(pick){const id=String(pick.dataset.photoPick||''),row=[...document.querySelectorAll('.menuEditCard')].find(x=>String(x.dataset.itemId)===id);row?.querySelector('[data-photo-input]')?.click();return}
   const remove=e.target.closest('[data-photo-remove]');if(remove){readMenu();const item=menu.find(x=>String(x.id)===String(remove.dataset.photoRemove));if(item){item.image='';renderMenu();toast('Фото удалено · сохраните меню')}return}
   const del=e.target.closest('[data-del-id]');if(del){
     readMenu();const id=String(del.dataset.delId||''),item=menu.find(x=>String(x.id)===id);
     if(item&&!confirm('Удалить «'+String(item.n||'позицию')+'» из меню?'))return;
     menu=menu.filter(x=>String(x.id)!==id);renderMenu();return;
   }
 };
 $('#menuEditor').oninput=e=>{
   const input=e.target.closest('[data-k="n"]');if(!input)return;
   const card=input.closest('.menuEditCard'),head=card?.querySelector('.menuEditCardHead b');if(head)head.textContent=input.value.trim()||'Новая позиция';
 };
  $('#menuEditor').onchange=async e=>{
   const input=e.target.closest('[data-photo-input]');if(!input)return;
   const file=input.files?.[0];if(!file)return;
   readMenu();
   const itemId=String(input.dataset.photoInput||''),venueAtPick=est,item=menu.find(x=>String(x.id)===itemId);
   if(!item)return;
   const card=input.closest('.menuEditCard');card?.classList.add('photoLoading');toast('Готовим фото…');
   try{
     const encoded=await compressMenuPhoto(file);
     if(est!==venueAtPick)return;
     const target=menu.find(x=>String(x.id)===itemId);if(!target)return;
     target.image=encoded;renderMenu();toast('Фото готово · сохраните меню ✓');tg?.HapticFeedback?.notificationOccurred?.('success');
   }catch(err){toast(err.message||'Не удалось обработать фото')}
   finally{card?.classList.remove('photoLoading');try{input.value=''}catch{}}
 };
 $('#builderAdmin').onclick=e=>{
   const add=e.target.closest('[data-builder-add]');if(add)return addBuilderOption(add.dataset.builderAdd);
   const del=e.target.closest('[data-builder-del]');if(del)return deleteBuilderOption(del.dataset.builderDel,+del.dataset.builderIndex);
 };
 try{tg?.ready();tg?.expand()}catch{};bootstrap().catch(e=>{$('#gateText').textContent=e.message});
})();