(() => {
'use strict';
const MASTER=new URLSearchParams(location.search).get('master')==='1',SESSION_KEY=MASTER?'sc_admin_tg_session':'shaurmeg_venue_owner_session';
const S=window.SHAURMEG||{},api=MASTER?new URL(S.api).origin+'/api':S.api,tg=S.telegram,esc=S.esc||((v)=>String(v??'')),money=S.money||((v)=>Number(v||0)+' ₽');
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)],clone=x=>JSON.parse(JSON.stringify(x??null));
let session=sessionStorage.getItem(SESSION_KEY)||'',accesses=[],est='',data=null,menu=[],sections=[],stream=null,currentCategory='',editingIndex=-1,itemDraft=null,busy=false,categoryFilter='all',dirty=false,designBusy=false,loadRevision=0,menuDirty=false,designDirty=false;
function markMenuDirty(){menuDirty=true;dirty=true}
const GROUPS=['meats','sizes','bases','sauces','extras'];
const GROUP_LABELS={meats:'Варианты мяса',sizes:'Размеры',bases:'Лаваш / основа',sauces:'Соусы',extras:'Дополнения',required_fields:'Обязательные параметры для карточки'};
const DEFAULT_SITE={design:{mode:'cinematic',background_image:'',ambient_strength:.16,radius:20,panel_opacity:.9,contrast:1},menu:{layout:'hero-2-3',card_style:'photo',image_fit:'cover',show_descriptions:true,hero_label:'НАША ГОРДОСТЬ'},features:{favorites:true,menu_badges:true,builder_result:true}};
const PRESET_COLORS=[['#0B2945','Midnight Blue'],['#FF463D','Warm Red'],['#313A46','Graphite'],['#F7F8FA','Light']];

function toast(v){const el=$('#toast');el.textContent=String(v||'');el.classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(()=>el.classList.remove('show'),1800)}
function code(v){const s=String(v||'').normalize('NFKC').toUpperCase().replace(/[\u200B-\u200D\u2060\uFEFF]/g,'').replace(/[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]/g,'-').replace(/\s+/g,'');const m=s.match(/OWN-?([A-F0-9]{10})/);return m?'OWN-'+m[1]:''}
function safeHex(v,f='#0B2945'){const s=String(v||'').trim().toUpperCase();return /^#[0-9A-F]{6}$/.test(s)?s:f}
function resolvedImage(v){const s=String(v||'').trim();if(!s)return '';if(s.startsWith('data:image/')||s.startsWith('http://')||s.startsWith('https://')||s.startsWith('/'))return s;return s}
async function call(path,opt={}){
  const headers={...(opt.headers||{})};if(session)headers.Authorization='Bearer '+session;if(MASTER&&!session){const token=sessionStorage.getItem('sc_owner_token');if(token)headers['X-Owner-Token']=token}
  if(opt.body!==undefined){headers['Content-Type']='application/json';if(typeof opt.body!=='string')opt.body=JSON.stringify(opt.body)}
  if(MASTER&&path.startsWith('/venue-owner/establishments/')){
    const suffix=path.split('/').slice(4).join('/');
    if(!suffix){const v=accesses.find(x=>x.establishment_id===est);if(!v)throw new Error('Заведение не выбрано');path='/shaurma/venues/'+encodeURIComponent(v.venue_id)}
    else if(suffix==='menu'){path='/shaurma/admin/establishments/'+encodeURIComponent(est)+'/venue';const input=JSON.parse(opt.body);opt.body=JSON.stringify({menu:input.menu,config:{...(data?.config||{}),menu_sections:input.sections}})}
  }
  const r=await fetch(api+path,{...opt,headers,cache:'no-store'}),j=await r.json().catch(()=>null);
  if(!r.ok)throw new Error(j?.error||('HTTP '+r.status));return j
}
async function auth(){
  if(MASTER){try{accesses=await call('/shaurma/admin/venues');return true}catch{if(!tg?.initData)return false;try{const r=await fetch(api+'/shaurma/admin-telegram-auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({initData:tg.initData})});const j=await r.json();if(!r.ok)return false;session=j.session;sessionStorage.setItem(SESSION_KEY,session);accesses=await call('/shaurma/admin/venues');return true}catch{return false}}}

  if(session){try{const me=await call('/venue-owner/me');accesses=me.establishments||[];return true}catch{session='';sessionStorage.removeItem(SESSION_KEY)}}
  if(!tg?.initData)return false;
  try{const r=await fetch(api+'/venue-owner/auth/telegram',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({initData:tg.initData})}),j=await r.json();if(!r.ok)throw 0;session=j.session;accesses=j.establishments||[];sessionStorage.setItem(SESSION_KEY,session);return true}catch{return false}
}
async function claim(){
  const c=code($('#claimCode').value);if(!session)return toast('Откройте через @Shefofbotsbot');if(!c)return toast('Нужен ключ OWN-XXXXXXXXXX');
  try{const j=await call('/venue-owner/claim',{method:'POST',body:{code:c}});accesses=j.establishments||[];est=j.establishment_id||accesses[0]?.establishment_id||'';if(!est)throw new Error('Доступ не появился');await enter()}catch(e){toast(e.message==='claim_code_invalid_or_expired'?'Ключ недействителен или уже использован':e.message)}
}
async function bootstrap(){
  try{tg?.ready?.();tg?.expand?.()}catch{}
  const ok=await auth();if(!ok){$('#gateText').textContent='Откройте редактор через @Shefofbotsbot.';return}
  if(!accesses.length){$('#gateText').textContent='Введите ключ заведения, выданный суперадмином.';return}
  const wanted=new URLSearchParams(location.search).get('establishment');est=accesses.some(x=>x.establishment_id===wanted)?wanted:accesses[0].establishment_id;await enter()
}
async function enter(){
  $('#gate').classList.add('hidden');$('#venueSelect').innerHTML=accesses.map(x=>'<option value="'+esc(x.establishment_id)+'">'+esc(x.name||x.establishment_id)+'</option>').join('');$('#venueSelect').value=est;await load();
  const initial=new URLSearchParams(location.search).get('view');if(['categories','items','design','builder'].includes(initial))setView(initial)
}
function setSync(text='Синхронизировано'){
  const c=$('#syncCard');if(!c)return;c.querySelector('b').textContent=text;$('#syncTime').textContent=new Date().toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})
}
function activeSections(){return sections.filter(x=>x.active!==false).sort((a,b)=>(a.order||0)-(b.order||0))}
function sectionOf(id){return sections.find(x=>String(x.id)===String(id))}
function itemCount(id){return menu.filter(x=>x.active!==false&&String(x.c)===String(id)).length}
function imageOf(x){return resolvedImage(x?.image||x?.cover||'')}
function currentHero(){
  const s=sectionOf(currentCategory)||activeSections()[0];return imageOf(s)||imageOf(menu.find(x=>x.c===s?.id))||imageOf(menu[0])||''
}
function hydrateHeader(){
  $('#estChip').textContent=data?.establishment_id||est;$('#venueChip').textContent=data?.name||'Заведение';
  const hero=currentHero();$('#studioHero').style.backgroundImage=hero?'url("'+hero.replace(/"/g,'')+'")':''
}
async function load({quiet=false}={}){
  if(quiet&&(dirty||designBusy||!$('#itemEditor').classList.contains('hidden')))return;
  const revision=++loadRevision,requestedEst=est;
  if(!quiet)setSync('Синхронизация…');
  const response=await call('/venue-owner/establishments/'+encodeURIComponent(requestedEst));if(revision!==loadRevision||requestedEst!==est)return;data=response;dirty=false;menuDirty=false;designDirty=false;$('#view-design').dataset.establishment=est;menu=(data.menu||[]).map(x=>({...x}));sections=(data.sections_all||data.sections||data.config?.menu_sections||[]).map(x=>({...x,settings:{...(x.settings||{})},gallery:Array.isArray(x.gallery)?x.gallery:[]}));
  if(!currentCategory||!activeSections().some(x=>x.id===currentCategory))currentCategory=activeSections()[0]?.id||'';
  hydrateHeader();renderCategories();renderItemFilters();renderItems();hydrateDesign();renderGuestPreview();connect();setSync()
}
function setView(v){
  syncCategoryDraft();
  $$('#studioTabs [data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===v));$$('.view').forEach(x=>x.classList.toggle('hidden',x.id!=='view-'+v));
  if(v==='design')renderGuestPreview();
  if(v==='builder'){
    const frame=$('#builderFrame');
    if(frame&&!frame.dataset.loaded){
      const u=new URL(MASTER?'/venue-owner':'admin-venue.html',location.href);if(MASTER){u.searchParams.set('master','1');u.searchParams.set('from','master');}u.searchParams.set('establishment',est);u.searchParams.set('tab',MASTER?'site':'menu');u.searchParams.set('focus','builder');u.searchParams.set('embed',MASTER?'console':'builder');u.searchParams.set('v','20261005-final4');frame.src=u.toString();frame.dataset.loaded='1';
    }
  }
}
function renderCategories(){
  const q=String($('#categorySearch').value||'').trim().toLowerCase(),rows=sections.slice().sort((a,b)=>(a.order||0)-(b.order||0)).filter(s=>(categoryFilter==='all'||(categoryFilter==='active'&&s.active!==false)||(categoryFilter==='locked'&&s.active===false))&&(!q||String(s.name).toLowerCase().includes(q)));
  $('#categoryList').innerHTML=rows.map(s=>{
    const img=imageOf(s)||imageOf(menu.find(x=>x.c===s.id)),active=s.active!==false;
    return '<article class="categoryRow '+(s.id===currentCategory?'activeSelection ':'')+(active?'':'locked')+'" data-cat="'+esc(s.id)+'">'+
      '<div class="categoryPhoto">'+(img?'<img src="'+esc(img)+'" alt="">':'')+'</div>'+
      '<div class="categoryCopy"><h3>'+esc(s.name)+'</h3><p>'+itemCount(s.id)+' позиций</p><div class="categoryState"><span class="stateChip '+(active?'':'off')+'">'+(active?'Активна':'Отключена суперадмином')+'</span><span class="stateChip sync">Синхронизировано</span></div></div>'+
      '<button class="rowArrow" data-open-cat="'+esc(s.id)+'" '+(active||MASTER?'':'disabled')+'>›</button></article>';
  }).join('');
  if(currentCategory)renderCategoryEditor(currentCategory)
}
function matchedOptionImage(section,key,name){
  const item=menu.find(x=>x.c===section.id&&Array.isArray(x.options?.[key])&&x.options[key].some(o=>String(o.name).toLowerCase()===String(name).toLowerCase()));
  const opt=item?.options?.[key]?.find(o=>String(o.name).toLowerCase()===String(name).toLowerCase());
  return imageOf(opt)||imageOf(item)||imageOf(section)
}
function visualSettings(section,key){
  const arr=Array.isArray(section.settings?.[key])?section.settings[key]:[];
  if(!arr.length)return '';
  return '<div class="visualOptions">'+arr.slice(0,8).map((name,i)=>{const img=matchedOptionImage(section,key,name);return '<div class="visualOption '+(i===0?'selected':'')+'">'+(img?'<img src="'+esc(img)+'">':'')+'<b>'+esc(name)+'</b></div>'}).join('')+'</div>'
}
function settingsPills(section,key){
  const arr=Array.isArray(section.settings?.[key])?section.settings[key]:[];
  return '<div class="pills" data-setting-group="'+key+'">'+arr.map((v,i)=>'<span class="pill '+(i>2?'gray':'')+'">'+esc(v)+'<button data-remove-setting="'+key+'" data-index="'+i+'">×</button></span>').join('')+'<button class="addPill" data-add-setting="'+key+'">＋ Добавить</button></div>'
}
function syncCategoryDraft(){const s=sectionOf(currentCategory);if(!s||!$('#catName'))return;s.name=$('#catName').value.trim()||s.name;s.subtitle=$('#catSubtitle').value.trim();s.manual_sort=$('#catManualSort').checked;s.inherit_template=$('#catInherit').checked;if(MASTER)s.active=$('#catActive')?.checked!==false}
function renderCategoryEditor(id){
  const s=sectionOf(id);if(!s||(!MASTER&&s.active===false)){$('#categoryEditor').innerHTML='';return}
  currentCategory=id;hydrateHeader();const cover=imageOf(s)||imageOf(menu.find(x=>x.c===id)),gallery=Array.isArray(s.gallery)?s.gallery:[];
  $('#categoryEditor').innerHTML='<section class="categoryEditor">'+
   '<div class="categoryEditorHero">'+(cover?'<img src="'+esc(cover)+'">':'')+'<div class="catHeroActions"><button class="darkPhotoBtn" data-cat-move="-1">↑ Выше</button><button class="darkPhotoBtn" data-cat-move="1">↓ Ниже</button><button class="darkPhotoBtn" data-cat-photo>▣ Изменить фото</button><input id="catPhotoInput" type="file" accept="image/*" hidden></div></div>'+
   '<div class="categoryEditorTop"><div class="catMiniPhoto">'+(cover?'<img src="'+esc(cover)+'">':'')+'</div><div><h2>'+esc(s.name)+'</h2><p>Настройте параметры и наполнение категории</p></div>'+ (MASTER?'<label class="lockedSwitch">Доступна гостям <input id="catActive" type="checkbox" '+(s.active!==false?'checked':'')+'></label>':'<div class="lockedSwitch">Категория активна <span class="switch"></span></div>')+'</div>'+
   '<div class="catFields"><div class="fieldGrid"><label class="field"><b>Название категории</b><input id="catName" value="'+esc(s.name)+'"></label><label class="field"><b>Короткая подпись</b><input id="catSubtitle" value="'+esc(s.subtitle||'')+'" placeholder="Например: свежо с гриля"></label></div></div>'+
   '<div class="settingGrid">'+
     '<div class="settingCard"><div class="blockTitle"><b>Доступные виды мяса</b><span>параметры</span></div>'+visualSettings(s,'meats')+settingsPills(s,'meats')+'</div>'+
     '<div class="settingCard"><div class="blockTitle"><b>Размеры</b><span>варианты</span></div>'+visualSettings(s,'sizes')+settingsPills(s,'sizes')+'</div>'+
     '<div class="settingCard"><div class="blockTitle"><b>Типы основы</b><span>варианты</span></div>'+visualSettings(s,'bases')+settingsPills(s,'bases')+'</div>'+
     '<div class="settingCard"><div class="blockTitle"><b>Группы соусов</b><span>варианты</span></div>'+visualSettings(s,'sauces')+settingsPills(s,'sauces')+'</div>'+
     '<div class="settingCard wide"><div class="blockTitle"><b>Обязательные параметры для карточки</b><span>контроль наполнения</span></div>'+settingsPills(s,'required_fields')+'</div>'+
     '<div class="settingCard wide"><div class="blockTitle"><b>Дополнения</b><span>варианты</span></div>'+visualSettings(s,'extras')+settingsPills(s,'extras')+'</div>'+
     '<div class="settingCard wide"><div class="blockTitle"><b>Цвет страницы категории</b><span>вид для гостя</span></div><div class="colorChoices">'+PRESET_COLORS.map(([c,n])=>'<button class="colorChoice '+(safeHex(s.color)===c?'active':'')+'" data-cat-color="'+c+'"><i style="background:'+c+'"></i>'+esc(n)+'</button>').join('')+'</div></div>'+
   '</div>'+
   '<div class="toggleRows"><label class="toggleRow"><div><b>Наследовать шаблон</b><small>Использовать стартовые параметры сети</small></div><input id="catInherit" type="checkbox" '+(s.inherit_template!==false?'checked':'')+'></label><label class="toggleRow"><div><b>Ручная сортировка</b><small>Менять порядок позиций в категории</small></div><input id="catManualSort" type="checkbox" '+(s.manual_sort!==false?'checked':'')+'></label></div>'+
   '<div class="galleryBlock"><div class="blockTitle"><b>Галерея категории</b><span>'+gallery.length+' фото</span></div><div class="galleryStrip"><label class="galleryAdd">＋ Добавить фото<input id="catGalleryInput" type="file" accept="image/*" multiple hidden></label>'+gallery.map((p,i)=>'<div class="galleryTile" data-cat-gallery="'+i+'"><img src="'+esc(p)+'"></div>').join('')+'</div></div>'+
   '<div class="consoleCategoryToolbar"><code>ID: '+esc(s.id)+'</code>'+(MASTER?'<button type="button" data-delete-category>Удалить категорию</button>':'<span class="muted">Категории управляются сетью</span>')+'</div><button class="saveBar" data-save-cat><span data-icon="arrow"></span>Сохранить изменения</button></section>';window.ShaurmegConsole?.icons($('#categoryEditor'));
}
async function addSetting(key){
  syncCategoryDraft();const s=sectionOf(currentCategory);if(!s)return;const v=await window.ShaurmegConsole.dialog({title:'Добавить параметр',message:GROUP_LABELS[key]||'Параметры категории',input:true,confirm:'Добавить'});if(!v)return;s.settings=s.settings||{};s.settings[key]=Array.isArray(s.settings[key])?s.settings[key]:[];if(!s.settings[key].includes(v))s.settings[key].push(v);markMenuDirty();renderCategoryEditor(currentCategory)
}
function removeSetting(key,i){syncCategoryDraft();const s=sectionOf(currentCategory);if(Array.isArray(s?.settings?.[key]))s.settings[key].splice(i,1);markMenuDirty();renderCategoryEditor(currentCategory)}
async function moveCategory(delta){
  const ordered=sections.slice().sort((a,b)=>(a.order||0)-(b.order||0)),i=ordered.findIndex(x=>x.id===currentCategory),to=i+Number(delta);
  if(i<0||to<0||to>=ordered.length)return;
  [ordered[i],ordered[to]]=[ordered[to],ordered[i]];ordered.forEach((x,k)=>x.order=k);sections=ordered;
  await saveMenu('Порядок категорий сохранён ✓');
}
async function moveItem(index,delta){
  const item=menu[Number(index)];if(!item)return;
  const peers=menu.map((x,i)=>({x,i})).filter(v=>String(v.x.c)===String(item.c)),p=peers.findIndex(v=>v.i===Number(index)),target=peers[p+Number(delta)];
  if(p<0||!target)return;
  [menu[Number(index)],menu[target.i]]=[menu[target.i],menu[Number(index)]];
  await saveMenu('Порядок позиций сохранён ✓');
}
async function saveCategory(){
  syncCategoryDraft();await saveMenu('Категория сохранена ✓')
}
async function saveMenu(msg='Меню сохранено ✓'){
  if(busy)return false;busy=true;setSync('Сохраняем…');
  try{const j=await call('/venue-owner/establishments/'+encodeURIComponent(est)+'/menu',{method:'PUT',body:{menu,sections}});data={...data,...j};menu=(j.menu||menu).map(x=>({...x}));sections=(j.sections_all||j.sections||j.config?.menu_sections||sections).map(x=>({...x,settings:{...(x.settings||{})},gallery:Array.isArray(x.gallery)?x.gallery:[]}));menuDirty=false;dirty=designDirty;toast(msg);renderCategories();renderItemFilters();renderItems();renderGuestPreview();setSync();return true}
  catch(e){toast(e.message);setSync('Ошибка синхронизации');return false}finally{busy=false}
}
function renderItemFilters(){
  const list=activeSections();$('#itemCategoryFilter').innerHTML='<option value="">Все категории</option>'+list.map(s=>'<option value="'+esc(s.id)+'">'+esc(s.name)+'</option>').join('');if(currentCategory&&list.some(x=>x.id===currentCategory))$('#itemCategoryFilter').value=currentCategory
}
function filteredItems(){
  const q=String($('#itemSearch').value||'').trim().toLowerCase(),cat=$('#itemCategoryFilter').value||'';return menu.map((x,index)=>({x,index})).filter(({x})=>(!cat||x.c===cat)&&(!q||String(x.n).toLowerCase().includes(q)||String(x.d||'').toLowerCase().includes(q)))
}
function renderItems(){
  const rows=filteredItems();$('#itemsSummary').innerHTML='<span>Всего: '+menu.length+'</span><span>Активных: '+menu.filter(x=>x.active!==false).length+'</span><span>С фото: '+menu.filter(x=>imageOf(x)).length+'</span>';
  $('#itemsGrid').innerHTML=rows.map(({x,index})=>'<article class="itemCard"><div class="itemCardPhoto">'+(imageOf(x)?'<img src="'+esc(imageOf(x))+'">':'')+(x.featured?'<span class="itemBadge">ГЛАВНАЯ</span>':'')+'</div><div class="itemCardBody"><h3>'+esc(x.n)+'</h3><p>'+esc(x.d||'Без описания')+'</p><div class="itemMeta">'+[x.weight,...(x.tags||[]).slice(0,2)].filter(Boolean).map(v=>'<span>'+esc(v)+'</span>').join('')+'</div><div class="itemBottom"><b>'+money(x.p)+'</b><div style="margin-left:auto;display:flex;gap:5px"><button class="itemEdit" data-move-item="-1" data-index="'+index+'">↑</button><button class="itemEdit" data-move-item="1" data-index="'+index+'">↓</button><button class="itemEdit" data-edit-item="'+index+'">›</button></div></div></div></article>').join('')||'<div class="designPanel">В категории пока нет позиций.</div>'
}
function defaultOptions(cat){
  const s=sectionOf(cat),out={required_groups:[]};for(const g of GROUPS)out[g]=(s?.settings?.[g]||[]).map((name,i)=>({id:slug(name),name,price:0,active:true,default:i===0,image:''}));return out
}
function slug(v){return String(v||'option').toLowerCase().replace(/ё/g,'e').replace(/[^a-z0-9а-я]+/gi,'_').replace(/^_+|_+$/g,'').slice(0,48)||('opt_'+Date.now())}
function newItem(){
  const cat=$('#itemCategoryFilter').value||currentCategory||activeSections()[0]?.id;if(!cat)return toast('Нет активных категорий');editingIndex=-1;itemDraft={id:'item_'+Date.now().toString(36),n:'Новая позиция',c:cat,d:'',p:0,image:imageOf(sectionOf(cat)),gallery:[],badge:'',featured:false,recommended:false,display:'auto',image_fit:'cover',active:true,weight:'',sku:'',stock:null,tags:[],card_color:'#FFFFFF',composition:'',schedule:{enabled:false,days:[],from:'',to:''},options:defaultOptions(cat)};openItemEditor()
}
function openEdit(i){editingIndex=Number(i);itemDraft=clone(menu[editingIndex]);openItemEditor()}
function openItemEditor(){if(!itemDraft)return;$('#itemEditor').classList.remove('hidden');document.body.style.overflow='hidden';renderItemEditor()}
function closeItemEditor(){syncItemDraft();$('#itemEditor').classList.add('hidden');document.body.style.overflow=''}
function optionCard(group,o,i){
  const img=imageOf(o)||imageOf(itemDraft);return '<div class="optionCard '+(o.default?'default':'')+'" data-option-card="'+group+'" data-index="'+i+'">'+(img?'<img src="'+esc(img)+'">':'<div style="height:58px;background:#112b3d"></div>')+'<input class="optName" data-opt-name value="'+esc(o.name||'')+'" aria-label="Название варианта"><input class="optPrice" data-opt-price type="number" value="'+Number(o.price||0)+'" aria-label="Доплата"><label class="consoleOptionState">Доступен гостям <input type="checkbox" data-opt-active '+(o.active!==false?'checked':'')+'></label><div class="optActions"><button title="Фото варианта" data-opt-photo="'+group+'" data-index="'+i+'">▣</button><button title="По умолчанию" data-opt-default="'+group+'" data-index="'+i+'">✓</button><button title="Удалить вариант" data-opt-remove="'+group+'" data-index="'+i+'">×</button></div></div>'
}
function itemGroup(group){
  const list=itemDraft.options?.[group]||[],required=(itemDraft.options?.required_groups||[]).includes(group);
  return '<section class="itemSection" data-group="'+group+'"><div class="itemSectionHead"><b>'+GROUP_LABELS[group]+'</b><label class="requiredLine">Обязательный выбор <input type="checkbox" data-required="'+group+'" '+(required?'checked':'')+'></label></div><div class="optionCards">'+list.map((o,i)=>optionCard(group,o,i)).join('')+'<button class="addOptionCard" data-opt-add="'+group+'">＋ Добавить</button></div></section>'
}
function renderItemEditor(){
  const x=itemDraft,img=imageOf(x),gallery=Array.isArray(x.gallery)?x.gallery:[],cats=activeSections().map(s=>'<option value="'+esc(s.id)+'" '+(s.id===x.c?'selected':'')+'>'+esc(s.name)+'</option>').join('');
  $('#itemEditorBody').innerHTML='<div class="itemHero">'+(img?'<img src="'+esc(img)+'">':'')+'<button class="changePhotoBtn" id="itemPhotoBtn">▣ Изменить фото</button><input id="itemPhotoInput" type="file" accept="image/*" hidden></div><div class="itemCanvas">'+
   '<section class="itemBasics"><div class="fieldGrid"><label class="field wide"><b>Название позиции</b><input id="iName" value="'+esc(x.n||'')+'"></label><label class="field wide"><b>Краткое описание</b><input id="iDesc" value="'+esc(x.d||'')+'"></label><label class="field"><b>Категория</b><select id="iCat">'+cats+'</select></label><label class="field"><b>Базовая цена</b><input id="iPrice" type="number" value="'+Number(x.p||0)+'"></label><label class="field"><b>Вес / объём</b><input id="iWeight" value="'+esc(x.weight||'')+'" placeholder="320 г"></label><label class="field"><b>Артикул SKU</b><input id="iSku" value="'+esc(x.sku||'')+'"></label><label class="field wide"><b>Состав</b><textarea id="iComposition" rows="3">'+esc(x.composition||'')+'</textarea></label><label class="field wide"><b>Теги через запятую</b><input id="iTags" value="'+esc((x.tags||[]).join(', '))+'"></label></div></section>'+
   GROUPS.map(itemGroup).join('')+
   '<section class="itemSection"><div class="itemSectionHead"><b>Показывать в категории</b><span class="switch '+(x.active===false?'off':'')+'" id="activeSwitch"></span></div></section>'+
   '<section class="itemSection"><div class="itemSectionHead"><b>Фото и галерея</b><small>'+gallery.length+' фото</small></div><div class="photoGallery"><label class="galleryAdd">＋ Фото<input id="itemGalleryInput" type="file" accept="image/*" multiple hidden></label>'+gallery.map((p,i)=>'<div class="galleryTile" data-item-gallery="'+i+'"><img src="'+esc(p)+'"></div>').join('')+'</div></section>'+
   '<section class="itemSection"><div class="itemSectionHead"><b>Дополнительные параметры</b></div><div class="fieldGrid"><label class="field"><b>Количество на складе</b><input id="iStock" type="number" value="'+(x.stock??'')+'"></label><label class="field"><b>Цвет карточки</b><input id="iCardColor" type="color" value="'+safeHex(x.card_color,'#FFFFFF')+'"></label><label class="field"><b>Доступна с</b><input id="iFrom" type="time" value="'+esc(x.schedule?.from||'')+'"></label><label class="field"><b>Доступна до</b><input id="iTo" type="time" value="'+esc(x.schedule?.to||'')+'"></label></div><div class="toggleRows" style="padding:10px 0 0"><label class="toggleRow"><div><b>Главная карточка</b><small>Hero-позиция</small></div><input id="iFeatured" type="checkbox" '+(x.featured?'checked':'')+'></label><label class="toggleRow"><div><b>Рекомендуем</b><small>Выделить в меню</small></div><input id="iRecommended" type="checkbox" '+(x.recommended?'checked':'')+'></label></div></section>'+
   '</div><div class="stickySave"><button class="previewBtn" id="itemPreview">Предпросмотр</button><button class="saveItemBtn" id="saveItemBtn">♛ Сохранить позицию</button></div>';
  const extra=document.createElement('section');extra.className='consoleItemExtra';extra.innerHTML='<h3>Публикация и доступность</h3><div class="fieldGrid"><label class="field"><b>Вид карточки</b><select id="iDisplay"><option value="auto">Автоматический</option><option value="main">Главная карточка</option><option value="compact">Компактная</option></select></label><label class="field"><b>Размещение фото</b><select id="iImageFit"><option value="cover">Заполнить</option><option value="contain">Полностью</option></select></label><label class="field"><b>Метка блюда</b><input id="iBadge" maxlength="40"></label><label class="field"><b>Минимум в заказе</b><input id="iMinQty" type="number" min="1" max="50"></label><label class="field"><b>Максимум в заказе</b><input id="iMaxQty" type="number" min="1" max="50"></label></div><div class="toggleRows"><label class="toggleRow"><b>Доступна к заказу</b><input id="iAvailable" type="checkbox"></label><label class="toggleRow"><b>Применять расписание</b><input id="iScheduleEnabled" type="checkbox"></label></div><div class="consoleDays">'+['Вс','Пн','Вт','Ср','Чт','Пт','Сб'].map((name,day)=>'<label><input type="checkbox" data-item-day="'+day+'" '+((x.schedule?.days||[]).includes(day)?'checked':'')+'>'+name+'</label>').join('')+'</div><small class="consoleChoiceHint">Не выбраны дни — доступно ежедневно. Время учитывается в часовом поясе заведения.</small>';
  $('.itemBasics').append(extra);$('#iDisplay').value=x.display||'auto';$('#iImageFit').value=x.image_fit||'cover';$('#iBadge').value=x.badge||'';$('#iMinQty').value=x.min_qty||1;$('#iMaxQty').value=x.max_qty||50;$('#iAvailable').checked=x.available!==false;$('#iScheduleEnabled').checked=x.schedule?.enabled===true;
  const choices=document.createElement('section');choices.className='itemSection consoleChoices';choices.id='itemChoiceGroups';$('.itemCanvas').append(choices);window.ShaurmegChoices.mount(choices,x.choice_groups,{beforeChange:syncItemDraft,onChange:markMenuDirty,compress,onError:toast,context:()=>est+'|'+itemDraft?.id});
}
function syncItemDraft(){
  if(!itemDraft||$('#itemEditor').classList.contains('hidden'))return;
  itemDraft.n=$('#iName')?.value.trim()||itemDraft.n;itemDraft.d=$('#iDesc')?.value.trim()||'';itemDraft.c=$('#iCat')?.value||itemDraft.c;itemDraft.p=Math.max(0,Number($('#iPrice')?.value)||0);itemDraft.weight=$('#iWeight')?.value.trim()||'';itemDraft.sku=$('#iSku')?.value.trim()||'';itemDraft.composition=$('#iComposition')?.value.trim()||'';itemDraft.tags=String($('#iTags')?.value||'').split(',').map(x=>x.trim()).filter(Boolean).slice(0,20);const stock=$('#iStock')?.value;itemDraft.stock=stock===''||stock===undefined?null:Math.max(0,Number(stock)||0);itemDraft.card_color=$('#iCardColor')?.value||'#FFFFFF';itemDraft.featured=!!$('#iFeatured')?.checked;itemDraft.recommended=!!$('#iRecommended')?.checked;itemDraft.schedule={...(itemDraft.schedule||{}),enabled:!!($('#iFrom')?.value||$('#iTo')?.value),from:$('#iFrom')?.value||'',to:$('#iTo')?.value||''};
  itemDraft.options=itemDraft.options||{};const required=[];for(const g of GROUPS){const root=document.querySelector('[data-group="'+g+'"]'),arr=[];root?.querySelectorAll('[data-option-card]').forEach((card,i)=>{const name=card.querySelector('[data-opt-name]')?.value.trim();if(!name)return;const old=itemDraft.options[g]?.[i]||{};arr.push({...old,id:old.id||slug(name),name,price:Number(card.querySelector('[data-opt-price]')?.value)||0,active:card.querySelector('[data-opt-active]')?.checked!==false})});itemDraft.options[g]=arr;if(root?.querySelector('[data-required="'+g+'"]')?.checked)required.push(g)}itemDraft.options.required_groups=required;
  itemDraft.available=$('#iAvailable').checked;itemDraft.badge=$('#iBadge').value.trim();itemDraft.display=$('#iDisplay').value;itemDraft.image_fit=$('#iImageFit').value;itemDraft.min_qty=Math.max(1,Math.min(50,Number($('#iMinQty').value)||1));itemDraft.max_qty=Math.max(itemDraft.min_qty,Math.min(50,Number($('#iMaxQty').value)||50));itemDraft.schedule.enabled=$('#iScheduleEnabled').checked;itemDraft.schedule.days=$$('[data-item-day]:checked').map(el=>Number(el.dataset.itemDay));itemDraft.choice_groups=window.ShaurmegChoices.read($('#itemChoiceGroups'));
}
function addOption(g){syncItemDraft();itemDraft.options[g]=itemDraft.options[g]||[];itemDraft.options[g].push({id:'opt_'+Date.now().toString(36),name:'Новый вариант',price:0,active:true,default:false,image:''});markMenuDirty();renderItemEditor()}
function removeOption(g,i){syncItemDraft();itemDraft.options[g]?.splice(i,1);markMenuDirty();renderItemEditor()}
function defaultOption(g,i){syncItemDraft();(itemDraft.options[g]||[]).forEach((o,k)=>o.default=k===i);markMenuDirty();renderItemEditor()}
async function saveItem(){
  if(busy)return;syncItemDraft();if(!itemDraft.n)return toast('Введите название позиции');if(editingIndex>=0)menu[editingIndex]=clone(itemDraft);else{menu.push(clone(itemDraft));editingIndex=menu.length-1}if(await saveMenu('Позиция сохранена и обновлена в меню ✓')){closeItemEditor();renderItems()}
}
async function deleteItem(){if(busy)return;if(editingIndex<0){closeItemEditor();return}if(!await window.ShaurmegConsole.dialog({title:'Удалить позицию?',message:itemDraft.n+' будет удалена из меню выбранного заведения.',confirm:'Удалить'}))return;const previous=clone(menu);menu.splice(editingIndex,1);if(await saveMenu('Позиция удалена ✓')){editingIndex=-1;closeItemEditor()}else menu=previous}
async function deleteCategory(){if(!MASTER||busy)return;syncCategoryDraft();const s=sectionOf(currentCategory);if(menu.some(x=>x.c===s.id))return toast('Сначала перенесите или удалите все позиции этой категории');if(!await window.ShaurmegConsole.dialog({title:'Удалить категорию?',message:s.name+'. Пустая категория будет удалена из меню этой точки.',confirm:'Удалить'}))return;const previous=clone(sections),id=currentCategory;sections=sections.filter(x=>x.id!==id);currentCategory=sections[0]?.id||'';if(!await saveMenu('Категория удалена ✓')){sections=previous;currentCategory=id}renderCategories()}
function readFile(f){return new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(String(r.result||''));r.onerror=rej;r.readAsDataURL(f)})}
async function compress(file,max=1400,q=.84){
  const raw=await readFile(file),img=new Image();await new Promise((res,rej)=>{img.onload=res;img.onerror=rej;img.src=raw});
  const scale=Math.min(1,max/Math.max(img.naturalWidth,img.naturalHeight));let w=Math.max(220,Math.round(img.naturalWidth*scale)),h=Math.max(160,Math.round(img.naturalHeight*scale));
  const limit=max<=800?260000:620000,qualities=[q,.76,.68,.60,.52,.45];
  for(const quality of qualities){
    const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;const x=canvas.getContext('2d',{alpha:false});if(!x)throw new Error('Не удалось обработать фото');
    x.fillStyle='#fff';x.fillRect(0,0,w,h);x.drawImage(img,0,0,w,h);
    const out=canvas.toDataURL('image/jpeg',quality);if(out.length<=limit)return out;
    w=Math.max(220,Math.round(w*.82));h=Math.max(160,Math.round(h*.82));
  }
  throw new Error('Фото слишком тяжёлое — выберите другое изображение');
}
async function catPhoto(file){syncCategoryDraft();const s=sectionOf(currentCategory),venue=est;if(!s)return;const image=await compress(file);if(est!==venue||currentCategory!==s.id)return;syncCategoryDraft();s.cover=image;markMenuDirty();renderCategoryEditor(currentCategory);hydrateHeader();toast('Фото подготовлено · сохраните категорию')}
async function catGallery(files){syncCategoryDraft();const s=sectionOf(currentCategory),venue=est;if(!s)return;s.gallery=Array.isArray(s.gallery)?s.gallery:[];for(const f of [...files].slice(0,6)){if(s.gallery.length>=12)break;const image=await compress(f,1100,.8);if(est!==venue||currentCategory!==s.id)return;s.gallery.push(image)}markMenuDirty();renderCategoryEditor(currentCategory)}
async function itemPhoto(file){syncItemDraft();const draft=itemDraft,venue=est,image=await compress(file);if(draft!==itemDraft||venue!==est)return;syncItemDraft();draft.image=image;markMenuDirty();renderItemEditor();toast('Фото обновлено')}
async function itemGallery(files){syncItemDraft();const draft=itemDraft,venue=est;draft.gallery=Array.isArray(draft.gallery)?draft.gallery:[];for(const f of [...files].slice(0,6)){if(draft.gallery.length>=12)break;const image=await compress(f,1100,.8);if(draft!==itemDraft||venue!==est)return;draft.gallery.push(image)}markMenuDirty();renderItemEditor()}
async function optionPhoto(g,i,file){syncItemDraft();const draft=itemDraft,venue=est,o=draft.options?.[g]?.[i];if(!o)return;const image=await compress(file,700,.8);if(draft!==itemDraft||venue!==est)return;syncItemDraft();const target=draft.options[g].find(x=>x.id===o.id);if(!target)return;target.image=image;markMenuDirty();renderItemEditor()}
function mergeSite(r){return window.ShaurmegDesign.merge(r)}
function readTheme(){return {primary:safeHex($('#themePrimaryHex').value,$('#themePrimary').value),secondary:safeHex($('#themeSecondaryHex').value,$('#themeSecondary').value),tone:$('#themeTone').value}}
function readSite(){const s=window.ShaurmegDesign.read($('#view-design'),data?.config?.site_customization);s.menu.layout=$('#siteLayout').value;s.menu.card_style=$('#studioCardStyle').value;s.design.radius=Number($('#studioRadius').value);s.menu.show_descriptions=$('#studioDescriptions').checked;return s}
function hydrateDesign(){const t=data?.config?.theme||{primary:'#D94343',secondary:'#13233B',tone:'balanced'},s=mergeSite(data?.config?.site_customization);$('#themePrimary').value=safeHex(t.primary,'#D94343');$('#themePrimaryHex').value=safeHex(t.primary,'#D94343');$('#themeSecondary').value=safeHex(t.secondary,'#13233B');$('#themeSecondaryHex').value=safeHex(t.secondary,'#13233B');$('#themeTone').value=t.tone||'balanced';$('#siteLayout').value=s.menu.layout;$('#studioCardStyle').value=s.menu.card_style;$('#studioRadius').value=s.design.radius;$('#studioDescriptions').checked=s.menu.show_descriptions;window.ShaurmegDesign.hydrate($('#view-design'),s)}
function renderGuestPreview(){if(!data)return;const secs=activeSections(),items=menu.filter(x=>x.active!==false&&secs.some(s=>s.id===x.c));window.ShaurmegDesign.preview($('#guestPreview'),{site:readSite(),theme:readTheme(),venue:data,sections:secs,items,money})}
async function saveDesign(){
  if(designBusy||busy)return;designBusy=true;$('#saveDesignBtn').disabled=true;const venue=est,theme=readTheme(),site=readSite();setSync('Публикуем…');
  try{if(MASTER){const saved=await call('/shaurma/admin/establishments/'+encodeURIComponent(venue)+'/venue',{method:'PUT',body:{menu,config:{...(data.config||{}),menu_sections:sections,theme,site_customization:site}}});if(est!==venue)return;data={...data,...saved}}else{const saved=await call('/venue-owner/establishments/'+encodeURIComponent(venue)+'/design',{method:'PUT',body:{theme,site_customization:site}});if(est!==venue)return;data.config={...(data.config||{}),theme:saved.theme,site_customization:saved.site_customization}} designDirty=false;if(MASTER)menuDirty=false;dirty=menuDirty;toast('Дизайн опубликован ✓');renderGuestPreview();setSync()}
  catch(e){toast(e.message);setSync('Не опубликовано · черновик сохранён')}finally{designBusy=false;$('#saveDesignBtn').disabled=false}
}
function clientPreview(){const marker=data?.marker_id||accesses.find(x=>x.establishment_id===est)?.marker_id;if(!marker)return toast('У точки нет marker_id');const u=new URL('menu.html',location.href);u.searchParams.set('marker',marker);u.searchParams.set('establishment',est);window.open(u.toString(),'_blank')}
function connect(){try{stream?.close()}catch{};if(MASTER||!session||!est)return;try{stream=new EventSource(api+'/venue-owner/establishments/'+encodeURIComponent(est)+'/stream?owner_session='+encodeURIComponent(session));const refresh=()=>{clearTimeout(connect.t);connect.t=setTimeout(()=>load({quiet:true}).catch(()=>{}),220)};stream.addEventListener('venue',refresh);stream.addEventListener('menu_changed',refresh);stream.onerror=()=>setSync('Переподключение…')}catch{}}

function bind(){
  window.ShaurmegDesign.mount($('#view-design'),{compress,onChange:()=>{designDirty=true;dirty=true;renderGuestPreview();setSync('Есть неопубликованные изменения')},onError:toast});
  $('#view-design').addEventListener('input',()=>{designDirty=true;dirty=true;renderGuestPreview();setSync('Есть неопубликованные изменения')});$('#categoryEditor').addEventListener('input',()=>{markMenuDirty();setSync('Есть несохранённые изменения')});$('#itemEditor').addEventListener('input',markMenuDirty);
  window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue=''}});
  $('#claimBtn').onclick=claim;const back=()=>{if(!$('#itemEditor').classList.contains('hidden'))return closeItemEditor();location.href=MASTER?'/master-admin?tab=sites':'admin-venue-pro.html?establishment='+encodeURIComponent(est)+'&v=20261005-final4'};$('#studioBack').onclick=back;try{tg?.BackButton?.show();tg?.BackButton?.onClick(back)}catch{};
  if(MASTER){$('#newCategoryBtn').classList.remove('hidden');$('#advancedMenuBtn').classList.remove('hidden');$('#newCategoryBtn').onclick=async()=>{syncCategoryDraft();const name=await window.ShaurmegConsole.dialog({title:'Новая категория',message:'Категория будет создана только в выбранном заведении.',input:true,confirm:'Создать'});if(!name)return;const id='category-'+Date.now().toString(36);sections.push({id,name,active:true,order:sections.length,settings:{}});currentCategory=id;markMenuDirty();await saveMenu('Категория создана ✓')};$('#advancedMenuBtn').onclick=()=>{location.href='/shaurma-owner?section=menu&from=master&establishment='+encodeURIComponent(est)}}
  $('#venueSelect').onchange=async()=>{if(busy||designBusy){$('#venueSelect').value=est;return toast('Дождитесь завершения сохранения')}if(dirty&&!await window.ShaurmegConsole.dialog({title:'Переключить заведение?',message:'Несохранённые изменения текущей точки будут отменены.',confirm:'Переключить'})){$('#venueSelect').value=est;return}est=$('#venueSelect').value;currentCategory='';const frame=$('#builderFrame');if(frame){frame.dataset.loaded='';frame.removeAttribute('src')}await load()};
  $('#studioTabs').onclick=e=>{const b=e.target.closest('[data-view]');if(b)setView(b.dataset.view)};
  $('#categorySearch').oninput=renderCategories;$('#categoryFilterBtn').onclick=()=>{categoryFilter=categoryFilter==='all'?'active':categoryFilter==='active'?'locked':'all';$('#categoryFilterBtn').textContent=categoryFilter==='all'?'Все категории⌄':categoryFilter==='active'?'Только активные⌄':'Отключённые⌄';renderCategories()};
  $('#categoryList').onclick=e=>{const b=e.target.closest('[data-open-cat]');if(!b)return;syncCategoryDraft();currentCategory=b.dataset.openCat;renderCategories();setTimeout(()=>$('#categoryEditor').scrollIntoView({behavior:'smooth',block:'start'}),30)};
  $('#categoryEditor').onclick=e=>{
    if(e.target.closest('[data-delete-category]'))return deleteCategory();syncCategoryDraft();
    let g=e.target.closest('[data-cat-gallery]');if(g){const s=sectionOf(currentCategory);s?.gallery?.splice(Number(g.dataset.catGallery),1);return renderCategoryEditor(currentCategory)}
    let b=e.target.closest('[data-add-setting]');if(b)return addSetting(b.dataset.addSetting);
    b=e.target.closest('[data-remove-setting]');if(b)return removeSetting(b.dataset.removeSetting,Number(b.dataset.index));
    b=e.target.closest('[data-cat-color]');if(b){sectionOf(currentCategory).color=b.dataset.catColor;sectionOf(currentCategory).accent=b.dataset.catColor==='#F7F8FA'?'#FF463D':'#FF463D';return renderCategoryEditor(currentCategory)}
    b=e.target.closest('[data-cat-move]');if(b)return moveCategory(Number(b.dataset.catMove));
    if(e.target.closest('[data-cat-photo]'))return $('#catPhotoInput').click();
    if(e.target.closest('[data-save-cat]'))return saveCategory();
  };
  $('#categoryEditor').onchange=e=>{if(e.target.id==='catPhotoInput'&&e.target.files?.[0])catPhoto(e.target.files[0]).catch(x=>toast(x.message));if(e.target.id==='catGalleryInput'&&e.target.files?.length)catGallery(e.target.files).catch(x=>toast(x.message))};
  $('#itemSearch').oninput=renderItems;$('#itemCategoryFilter').onchange=renderItems;$('#newItemBtn').onclick=newItem;$('#itemsGrid').onclick=e=>{let b=e.target.closest('[data-move-item]');if(b)return moveItem(Number(b.dataset.index),Number(b.dataset.moveItem));b=e.target.closest('[data-edit-item]');if(b)openEdit(b.dataset.editItem)};
  $('#itemEditorBack').onclick=closeItemEditor;$('#deleteItemBtn').onclick=deleteItem;
  $('#itemEditorBody').onclick=e=>{
    let g=e.target.closest('[data-item-gallery]');if(g){syncItemDraft();itemDraft.gallery?.splice(Number(g.dataset.itemGallery),1);return renderItemEditor()}
    if(e.target.closest('#itemPhotoBtn'))return $('#itemPhotoInput').click();
    let b=e.target.closest('[data-opt-add]');if(b)return addOption(b.dataset.optAdd);
    b=e.target.closest('[data-opt-remove]');if(b)return removeOption(b.dataset.optRemove,Number(b.dataset.index));
    b=e.target.closest('[data-opt-default]');if(b)return defaultOption(b.dataset.optDefault,Number(b.dataset.index));
    b=e.target.closest('[data-opt-photo]');if(b){syncItemDraft();const input=document.createElement('input');input.type='file';input.accept='image/*';input.onchange=()=>input.files?.[0]&&optionPhoto(b.dataset.optPhoto,Number(b.dataset.index),input.files[0]).catch(x=>toast(x.message));input.click();return}
    if(e.target.closest('#activeSwitch')){syncItemDraft();itemDraft.active=itemDraft.active===false?true:false;markMenuDirty();renderItemEditor()}
    if(e.target.closest('#saveItemBtn'))return saveItem();
    if(e.target.closest('#itemPreview'))return clientPreview();
  };
  $('#itemEditorBody').onchange=e=>{if(e.target.id==='itemPhotoInput'&&e.target.files?.[0])itemPhoto(e.target.files[0]).catch(x=>toast(x.message));if(e.target.id==='itemGalleryInput'&&e.target.files?.length)itemGallery(e.target.files).catch(x=>toast(x.message))};
  $('#themePrimary').oninput=e=>$('#themePrimaryHex').value=e.target.value.toUpperCase();$('#themeSecondary').oninput=e=>$('#themeSecondaryHex').value=e.target.value.toUpperCase();
  $('#themePresets').onclick=e=>{const b=e.target.closest('[data-primary]');if(!b)return;$('#themePrimary').value=b.dataset.primary;$('#themePrimaryHex').value=b.dataset.primary;$('#themeSecondary').value=b.dataset.secondary;$('#themeSecondaryHex').value=b.dataset.secondary};
  $('#saveDesignBtn').onclick=saveDesign;
}
bind();bootstrap().catch(e=>{$('#gateText').textContent=e.message||'Ошибка загрузки'});
})();
