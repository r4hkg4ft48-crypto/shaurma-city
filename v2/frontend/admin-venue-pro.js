(() => {
'use strict';
const {api,telegram:tg,esc,money}=window.SHAURMEG||{};
const $=s=>document.querySelector(s);
const $$=s=>[...document.querySelectorAll(s)];
const clone=x=>JSON.parse(JSON.stringify(x??null));
let session=sessionStorage.getItem('shaurmeg_venue_owner_session')||'';
let accesses=[],est='',data=null,menu=[],sections=[],stream=null,currentCategory='',editingIndex=-1,itemDraft=null,saveBusy=false,currentView='home',orderFilter='active',orderRows=[],designBusy=false,profileDirty=false,designDirty=false;

const GROUP_META={
  meats:{title:'Варианты мяса',icon:'🥩'},sizes:{title:'Размеры',icon:'↗'},bases:{title:'Основа / хлеб',icon:'🫓'},
  sauces:{title:'Соусы',icon:'🥫'},extras:{title:'Дополнения',icon:'＋'}
};
const SECTION_SETTING_GROUPS=[
  ['meats','Доступные виды мяса'],['sizes','Размеры'],['bases','Типы основы'],['sauces','Группы соусов'],['extras','Дополнения'],['required_fields','Обязательные поля карточки']
];
const DEFAULT_SITE={design:{mode:'cinematic',background_image:'',ambient_strength:.16,radius:20,panel_opacity:.9,contrast:1},menu:{layout:'hero-2-3',card_style:'photo',image_fit:'cover',show_descriptions:true,hero_label:'НАША ГОРДОСТЬ'},features:{favorites:true,menu_badges:true,builder_result:true}};

function toast(v){
  const el=$('#toast');el.textContent=String(v||'');el.classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(()=>el.classList.remove('show'),1900);
}
function normalizeCode(v){
  const raw=String(v||'').normalize('NFKC').toUpperCase().replace(/[\u200B-\u200D\u2060\uFEFF]/g,'').replace(/[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]/g,'-').replace(/\s+/g,'');
  const m=raw.match(/OWN-?([A-F0-9]{10})/);return m?'OWN-'+m[1]:'';
}
async function call(path,opt={}){
  const headers={...(opt.headers||{})};if(session)headers.Authorization='Bearer '+session;
  if(opt.body!==undefined){headers['Content-Type']='application/json';if(typeof opt.body!=='string')opt.body=JSON.stringify(opt.body)}
  const r=await fetch(api+path,{...opt,headers,cache:opt.cache||'no-store'});
  const j=await r.json().catch(()=>null);
  if(!r.ok)throw new Error(j?.error||('HTTP '+r.status));
  return j;
}
async function auth(){
  if(session){
    try{const me=await call('/venue-owner/me');accesses=me.establishments||[];return true}catch{session='';sessionStorage.removeItem('shaurmeg_venue_owner_session')}
  }
  if(!tg?.initData)return false;
  try{
    const r=await fetch(api+'/venue-owner/auth/telegram',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({initData:tg.initData})});
    const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||'auth_failed');
    session=j.session;accesses=j.establishments||[];sessionStorage.setItem('shaurmeg_venue_owner_session',session);return true;
  }catch{return false}
}
async function claim(){
  if(!session)return toast('Откройте админку через Telegram');
  const code=normalizeCode($('#claimCode').value);if(!code)return toast('Нужен ключ OWN-XXXXXXXXXX');
  try{
    const j=await call('/venue-owner/claim',{method:'POST',body:{code}});accesses=j.establishments||[];
    if(!accesses.length)throw new Error('Доступ не появился');
    est=j.establishment_id||accesses[0].establishment_id;await enter();
  }catch(e){toast(e.message==='claim_code_invalid_or_expired'?'Ключ недействителен или уже использован':e.message)}
}
async function bootstrap(){
  tg?.ready?.();tg?.expand?.();
  const ok=await auth();
  if(!ok){$('#gateText').textContent='Откройте эту админку через @Shefofbotsbot. Доступ проверяется по Telegram.';return}
  if(!accesses.length){$('#gateText').textContent='Заведений пока нет. Введите выданный ключ владельца.';return}
  const q=new URLSearchParams(location.search),wanted=q.get('establishment');
  est=accesses.some(x=>x.establishment_id===wanted)?wanted:accesses[0].establishment_id;
  await enter();
}
async function enter(){
  $('#gate').classList.add('hidden');
  $('#venueSelect').innerHTML=accesses.map(x=>'<option value="'+esc(x.establishment_id)+'">'+esc(x.name||x.establishment_id)+'</option>').join('');
  $('#venueSelect').value=est;
  await loadVenue();
  const tab=new URLSearchParams(location.search).get('tab');
  if(tab==='menu')openMenuStudio();else if(['orders','profile','design','settings'].includes(tab))setView(tab);else setView('home');
}
function activeSections(){return sections.filter(x=>x.active!==false).sort((a,b)=>(a.order||0)-(b.order||0))}
function itemCount(sectionId){return menu.filter(x=>x.active!==false&&String(x.c)===String(sectionId)).length}
function photoFor(v){return String(v?.image||v?.cover||'').trim()}
function setSync(text='Синхронизировано',ok=true){
  const el=$('#syncBadge');el.innerHTML='<i></i> '+esc(text);el.style.opacity=ok?'1':'.7';
}
async function loadVenue({quiet=false}={}){
  if(!est)return;
  if(quiet&&(profileDirty||designDirty||designBusy||saveBusy||!$('#itemDrawer').classList.contains('hidden')))return;
  if(!quiet)setSync('Синхронизация…',false);
  const venue=est,response=await call('/venue-owner/establishments/'+encodeURIComponent(venue));if(venue!==est)return;data=response;
  menu=(data.menu||[]).map(x=>({...x}));
  sections=(data.sections_all||data.sections||[]).map(x=>({...x,settings:{...(x.settings||{})}}));
  currentCategory=activeSections().some(x=>x.id===currentCategory)?currentCategory:(activeSections()[0]?.id||'');
  hydrateHeader();renderCategories();renderItemFilters();renderItems();hydrateDesign();hydrateProfile();renderPreview();connectStream();loadHomeStats().catch(()=>{});setSync('Синхронизировано',true);
}
function hydrateHeader(){
  $('#establishmentChip').textContent=data?.establishment_id||est;
  $('#venueNameHero').textContent=data?.name||'Меню заведения';$('#venueAddressHero').textContent=data?.address||'Панель управления заведением';
  const h=photoFor({image:data?.hero_image})||photoFor(activeSections()[0])||photoFor(menu[0]);
  $('#heroPhoto').innerHTML=h?'<img src="'+esc(h)+'" alt="">':'<span>SHAURMEG</span>';
}
function setView(view){
  currentView=view;document.body.dataset.screen=view;
  try{view==='home'?tg?.BackButton?.hide():tg?.BackButton?.show()}catch{}
  const u=new URL(location.href);u.searchParams.set('tab',view);history.replaceState(null,'',u);

  $$('#mainTabs [data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===(['profile','design'].includes(view)?'settings':view)));
  $$('.view').forEach(v=>v.classList.toggle('hidden',v.id!=='view-'+view));
  if(view==='orders')loadOrders();
  if(view==='design')renderPreview();
}
function withEst(url){
  const u=new URL(url,location.href);u.searchParams.set('establishment',est);u.searchParams.set('v','20261005-final4');return u.toString();
}
function openMenuStudio(){location.href=withEst('admin-menu-studio.html')}
function openBuilderStudio(){location.href=withEst('admin-menu-studio.html?view=builder')}
async function loadHomeStats(){
  const s=await call('/venue-owner/establishments/'+encodeURIComponent(est)+'/stats');
  const put=(id,v)=>{const e=$(id);if(e)e.textContent=String(v)};
  put('#homeOrdersToday',s.today??0);put('#homeOrdersNew',s.new??0);put('#homeOrdersCooking',s.cooking??0);put('#homeRevenue',money(s.revenue??0));
  put('#homeActiveOrders',(Number(s.new)||0)+(Number(s.cooking)||0)+(Number(s.ready)||0));
  const rows=await call('/venue-owner/establishments/'+encodeURIComponent(est)+'/orders');
  $('#homeRecentOrders').innerHTML=rows.slice(0,3).map(o=>orderCard(o,false)).join('')||'<div class="empty">Заказов пока нет</div>';
}
function renderCategories(){
  const q=String($('#categorySearch')?.value||'').toLowerCase().trim();
  const root=$('#categoryList'),all=sections.slice().sort((a,b)=>(a.order||0)-(b.order||0)).filter(s=>!q||String(s.name).toLowerCase().includes(q));
  root.innerHTML=all.map(s=>{
    const active=s.active!==false,count=itemCount(s.id),cover=photoFor(s);
    return '<article class="categoryCard '+(active?'':'inactive')+'" data-category="'+esc(s.id)+'">'+
      '<div class="categoryThumb">'+(cover?'<img src="'+esc(cover)+'" alt="">':'<span>'+esc(s.emoji||'•')+'</span>')+'</div>'+
      '<div class="categoryCopy"><h3>'+esc(s.name)+'</h3><p>'+count+' позиций · '+(active?'доступна владельцу':'выключена суперадмином')+'</p>'+
      '<div class="categoryMeta"><span class="status '+(active?'':'locked')+'">'+(active?'● Активна':'🔒 Отключена')+'</span><span class="status">☁ Синхронизировано</span></div></div>'+
      '<button class="editCategory" data-edit-category="'+esc(s.id)+'" '+(active?'':'disabled')+'>›</button></article>';
  }).join('')||'<div class="panel">Категории не найдены</div>';
  if(currentCategory&&activeSections().some(s=>s.id===currentCategory))renderCategoryEditor(currentCategory);
  else $('#categoryEditor').classList.add('hidden');
}
function renderChipGroup(section,key,title){
  const arr=Array.isArray(section.settings?.[key])?section.settings[key]:[];
  return '<div class="settingBlock '+(key==='required_fields'?'wide':'')+'"><div class="settingHead"><b>'+esc(title)+'</b><small>'+arr.length+'</small></div><div class="chipEditor" data-setting-group="'+esc(key)+'">'+
    arr.map((v,i)=>'<span class="editChip">'+esc(v)+'<button data-remove-setting="'+esc(key)+'" data-setting-index="'+i+'">×</button></span>').join('')+
    '<button class="addChip" data-add-setting="'+esc(key)+'">＋ Добавить</button></div></div>';
}
function renderCategoryEditor(id){
  const section=sections.find(x=>x.id===id);if(!section||section.active===false){$('#categoryEditor').classList.add('hidden');return}
  currentCategory=id;const cover=photoFor(section),idx=sections.indexOf(section);
  $('#categoryEditor').classList.remove('hidden');
  $('#categoryEditor').innerHTML='<article class="editorCard">'+
    '<div class="categoryHero">'+(cover?'<img src="'+esc(cover)+'" alt="">':'')+'<div class="categoryHeroShade"></div>'+
      '<div class="categoryHeroCopy"><div><small>НАСТРОЙКИ КАТЕГОРИИ</small><h2>'+esc(section.name)+'</h2></div>'+
      '<div class="categoryHeroActions"><button data-cat-photo>📷 Фото</button><input id="catPhotoInput" type="file" accept="image/*" hidden>'+
      '<button data-cat-up '+(idx<=0?'disabled':'')+'>↑</button><button data-cat-down '+(idx>=sections.length-1?'disabled':'')+'>↓</button></div></div></div>'+
    '<div class="categoryBody"><div class="lockedNote">Включение и выключение категории доступно только в суперадминке. Здесь вы настраиваете её содержимое и внешний вид.</div>'+
    '<div class="formGrid two" style="margin-top:12px"><label class="field"><span>Название категории</span><input id="catName" value="'+esc(section.name)+'"></label>'+
    '<label class="field"><span>Emoji</span><input id="catEmoji" value="'+esc(section.emoji||'')+'"></label>'+
    '<label class="field"><span>Основной цвет</span><div class="colorRow"><input id="catColor" type="color" value="'+esc(section.color||'#0B2945')+'"><input value="'+esc(section.color||'#0B2945')+'" disabled></div></label>'+
    '<label class="field"><span>Акцент</span><div class="colorRow"><input id="catAccent" type="color" value="'+esc(section.accent||'#FF463D')+'"><input value="'+esc(section.accent||'#FF463D')+'" disabled></div></label></div>'+
    '<div class="settingsGrid" style="margin-top:12px">'+SECTION_SETTING_GROUPS.map(([k,t])=>renderChipGroup(section,k,t)).join('')+'</div>'+
    '<label class="toggleLine"><span><b>Ручная сортировка</b><small>Разрешить менять порядок позиций внутри категории</small></span><input id="catManualSort" type="checkbox" '+(section.manual_sort!==false?'checked':'')+'></label>'+
    '<div class="actions"><button class="secondary" data-open-items>Открыть позиции</button><button class="primary" data-save-category>Сохранить изменения</button></div></div></article>';
}
function addSetting(key){
  const section=sections.find(x=>x.id===currentCategory);if(!section)return;
  const v=prompt('Введите значение');if(!v?.trim())return;
  section.settings=section.settings||{};section.settings[key]=Array.isArray(section.settings[key])?section.settings[key]:[];
  if(!section.settings[key].includes(v.trim()))section.settings[key].push(v.trim());
  renderCategoryEditor(currentCategory);
}
function removeSetting(key,index){
  const section=sections.find(x=>x.id===currentCategory);if(!section)return;
  if(Array.isArray(section.settings?.[key]))section.settings[key].splice(index,1);renderCategoryEditor(currentCategory);
}
function moveSection(delta){
  const sorted=sections.slice().sort((a,b)=>(a.order||0)-(b.order||0)),i=sorted.findIndex(x=>x.id===currentCategory),j=i+delta;
  if(i<0||j<0||j>=sorted.length)return;[sorted[i],sorted[j]]=[sorted[j],sorted[i]];sorted.forEach((x,k)=>x.order=k);sections=sorted;renderCategories();
}
async function saveCategory(){
  const s=sections.find(x=>x.id===currentCategory);if(!s)return;
  s.name=$('#catName').value.trim()||s.name;s.emoji=$('#catEmoji').value.trim().slice(0,8);s.color=$('#catColor').value;s.accent=$('#catAccent').value;s.manual_sort=$('#catManualSort').checked;
  await saveMenuRemote('Категория сохранена ✓');
}
async function saveMenuRemote(message='Меню сохранено ✓'){
  if(saveBusy)return false;saveBusy=true;setSync('Сохраняем…',false);
  try{
    const j=await call('/venue-owner/establishments/'+encodeURIComponent(est)+'/menu',{method:'PUT',body:{menu,sections}});
    data={...data,...j};menu=(j.menu||menu).map(x=>({...x}));sections=(j.sections_all||j.sections||sections).map(x=>({...x,settings:{...(x.settings||{})}}));
    toast(message);renderCategories();renderItemFilters();renderItems();renderPreview();setSync('Синхронизировано',true);return true;
  }catch(e){toast(e.message);setSync('Ошибка синхронизации',false);return false}finally{saveBusy=false}
}
function renderItemFilters(){
  const list=activeSections();$('#itemCategoryFilter').innerHTML='<option value="">Все категории</option>'+list.map(s=>'<option value="'+esc(s.id)+'">'+esc(s.name)+'</option>').join('');
  if(currentCategory&&list.some(x=>x.id===currentCategory))$('#itemCategoryFilter').value=currentCategory;
}
function filteredItems(){
  const q=String($('#itemSearch')?.value||'').toLowerCase().trim(),cat=$('#itemCategoryFilter')?.value||'';
  return menu.map((x,index)=>({x,index})).filter(({x})=>(!cat||x.c===cat)&&(!q||String(x.n).toLowerCase().includes(q)||String(x.d||'').toLowerCase().includes(q)));
}
function renderItems(){
  const rows=filteredItems(),active=menu.filter(x=>x.active!==false).length;
  $('#itemSummary').innerHTML='<span>Всего: '+menu.length+'</span><span>Активных: '+active+'</span><span>С фото: '+menu.filter(x=>photoFor(x)).length+'</span>';
  $('#itemGrid').innerHTML=rows.map(({x,index})=>{
    const image=photoFor(x),tags=(x.tags||[]).slice(0,3);
    return '<article class="itemCard" data-item-index="'+index+'" style="--card-color:'+esc(x.card_color||'#fff')+'">'+
      '<div class="itemCardPhoto">'+(image?'<img src="'+esc(image)+'" loading="lazy" alt="">':'')+'</div><div class="itemCardBody">'+
      '<h3>'+esc(x.n)+'</h3><p>'+esc(x.d||'Без описания')+'</p><div class="itemTags">'+tags.map(t=>'<span>'+esc(t)+'</span>').join('')+'</div>'+
      '<div class="itemPrice"><b>'+money(x.p)+'</b><div class="itemActions"><button data-move-item="-1" title="Выше">↑</button><button data-move-item="1" title="Ниже">↓</button><button data-edit-item="'+index+'" title="Редактировать">✎</button></div></div></div></article>';
  }).join('')||'<div class="panel">В этом разделе пока нет позиций.</div>';
}
function categoryDefaults(catId){
  const s=sections.find(x=>x.id===catId),settings=s?.settings||{};
  const opts={};
  for(const g of ['meats','sizes','bases','sauces','extras'])opts[g]=(settings[g]||[]).map((name,i)=>({id:slug(name),name,price:0,active:true,default:i===0}));
  opts.required_groups=[];return opts;
}
function slug(v){return String(v||'opt').toLowerCase().replace(/ё/g,'e').replace(/[^a-z0-9а-я]+/gi,'_').replace(/^_+|_+$/g,'').slice(0,48)||('opt_'+Date.now())}
function newItem(){
  const cat=$('#itemCategoryFilter').value||currentCategory||activeSections()[0]?.id;if(!cat)return toast('Нет включённых категорий');
  editingIndex=-1;itemDraft={id:'item_'+Date.now().toString(36),n:'Новая позиция',c:cat,d:'',p:0,image:'',gallery:[],badge:'',featured:false,recommended:false,display:'auto',image_fit:'cover',active:true,weight:'',sku:'',stock:null,tags:[],card_color:'#FFFFFF',composition:'',schedule:{enabled:false,days:[],from:'',to:''},options:categoryDefaults(cat)};
  openItemDrawer();
}
function openEditItem(index){editingIndex=Number(index);itemDraft=clone(menu[editingIndex]);openItemDrawer()}
function optionGroupHtml(group,list,required){
  const meta=GROUP_META[group];
  return '<div class="optionGroup" data-option-group="'+group+'"><div class="optionHead"><span>'+meta.icon+'</span><b>'+esc(window.ShaurmegDishSettings.label(sections.find(s=>s.id===itemDraft.c),group))+'</b><label><input type="checkbox" data-required-group="'+group+'" '+(required?'checked':'')+'> Обязательный выбор</label></div>'+
    '<div class="optionRows">'+(list||[]).map((o,i)=>'<div class="optionRow" data-option-index="'+i+'"><input data-opt-name value="'+esc(o.name||'')+'" placeholder="Название"><input data-opt-price type="number" value="'+Number(o.price||0)+'" placeholder="+ ₽"><label title="По умолчанию"><input data-opt-default type="checkbox" '+(o.default?'checked':'')+'> ✓</label><button data-remove-option="'+group+'" data-option-index="'+i+'">×</button></div>').join('')+'</div>'+
    '<button class="addChip" data-add-option="'+group+'" style="margin-top:8px">＋ Добавить вариант</button></div>';
}
function openItemDrawer(){
  if(!itemDraft)return;$('#drawerBackdrop').classList.remove('hidden');$('#itemDrawer').classList.remove('hidden');document.body.style.overflow='hidden';
  renderItemEditor();
}
function closeItemDrawer(){syncDraftFromEditor();$('#drawerBackdrop').classList.add('hidden');$('#itemDrawer').classList.add('hidden');document.body.style.overflow=''}
function renderItemEditor(){
  const x=itemDraft,groups=['meats','sizes','bases','sauces','extras'];$('#itemDrawerTitle').textContent=x.n||'Позиция';
  const image=photoFor(x),categoryOptions=activeSections().map(s=>'<option value="'+esc(s.id)+'" '+(s.id===x.c?'selected':'')+'>'+esc(s.name)+'</option>').join('');
  $('#itemEditorBody').innerHTML='<div class="drawerHero">'+(image?'<img src="'+esc(image)+'" alt="">':'')+'<button id="changeItemPhoto">📷 Изменить фото</button><input id="itemPhotoInput" type="file" accept="image/*" hidden></div>'+
    '<div class="drawerForm"><div class="formGrid two">'+
    '<label class="field wide"><span>Название позиции</span><input id="iName" value="'+esc(x.n||'')+'"></label>'+
    '<label class="field wide"><span>Краткое описание</span><textarea id="iDescription" rows="3">'+esc(x.d||'')+'</textarea></label>'+
    '<label class="field"><span>Категория</span><select id="iCategory">'+categoryOptions+'</select></label>'+
    '<label class="field"><span>Цена, ₽</span><input id="iPrice" type="number" min="0" value="'+Number(x.p||0)+'"></label>'+
    '<label class="field"><span>Вес / объём</span><input id="iWeight" value="'+esc(x.weight||'')+'" placeholder="320 г"></label>'+
    '<label class="field"><span>Артикул (SKU)</span><input id="iSku" value="'+esc(x.sku||'')+'"></label>'+
    '<label class="field"><span>Количество на складе</span><input id="iStock" type="number" min="0" value="'+(x.stock===null||x.stock===undefined?'':Number(x.stock))+'" placeholder="Без ограничения"></label>'+
    '<label class="field"><span>Цвет карточки</span><input id="iCardColor" type="color" value="'+esc(x.card_color||'#FFFFFF')+'"></label>'+
    '<label class="field wide"><span>Состав</span><textarea id="iComposition" rows="3">'+esc(x.composition||'')+'</textarea></label>'+
    '<label class="field wide"><span>Теги через запятую</span><input id="iTags" value="'+esc((x.tags||[]).join(', '))+'" placeholder="шаурма, курица, популярное"></label></div>'+
    '<div class="settingsGrid" style="margin-top:10px"><label class="toggleLine settingBlock"><span><b>Показывать в меню</b><small>Доступна гостям</small></span><input id="iActive" type="checkbox" '+(x.active!==false?'checked':'')+'></label>'+
    '<label class="toggleLine settingBlock"><span><b>Рекомендуем</b><small>Выделять позицию</small></span><input id="iRecommended" type="checkbox" '+(x.recommended?'checked':'')+'></label>'+
    '<label class="toggleLine settingBlock"><span><b>Главная карточка</b><small>Hero внутри категории</small></span><input id="iFeatured" type="checkbox" '+(x.featured?'checked':'')+'></label>'+
    '<label class="toggleLine settingBlock"><span><b>Расписание</b><small>Ограничить время</small></span><input id="iScheduleEnabled" type="checkbox" '+(x.schedule?.enabled?'checked':'')+'></label></div>'+
    '<div class="formGrid two" style="margin-top:10px"><label class="field"><span>Доступна с</span><input id="iScheduleFrom" type="time" value="'+esc(x.schedule?.from||'')+'"></label><label class="field"><span>Доступна до</span><input id="iScheduleTo" type="time" value="'+esc(x.schedule?.to||'')+'"></label></div>'+
    groups.map(g=>optionGroupHtml(g,x.options?.[g]||[],(x.options?.required_groups||[]).includes(g))).join('')+
    '<div class="optionGroup"><div class="optionHead"><span>🖼</span><b>Фото и галерея</b><small style="margin-left:auto">'+(x.gallery?.length||0)+' фото</small></div><div class="galleryRow" id="itemGallery">'+(x.gallery||[]).map((p,i)=>'<div class="galleryThumb" data-gallery-index="'+i+'"><img src="'+esc(p)+'"></div>').join('')+'</div><label class="photoUpload" style="display:block;margin-top:8px">＋ Добавить фото<input id="galleryInput" type="file" accept="image/*" multiple hidden></label></div>'+
    '</div>';
  const settings=document.createElement('section');settings.className='consoleItemExtra';settings.id='dishSettings';$('#itemEditorBody .drawerForm').prepend(settings);window.ShaurmegDishSettings.mount(settings,x,sections.find(s=>s.id===x.c),{beforeChange:syncDraftFromEditor,applyPreset:renderItemEditor,onChange:()=>{}});
  const choices=document.createElement('section');choices.id='itemChoiceGroups';choices.className='consoleItemExtra';$('#itemEditorBody .drawerForm').append(choices);window.ShaurmegChoices.mount(choices,x.choice_groups,{beforeChange:syncDraftFromEditor,compress:compressImage,onError:toast,context:()=>est+'|'+itemDraft?.id});
}
function syncDraftFromEditor(){
  if(!itemDraft||$('#itemDrawer').classList.contains('hidden'))return;
  const val=(id,f='')=>$(id)?.value??f;
  itemDraft.n=val('#iName',itemDraft.n).trim();itemDraft.d=val('#iDescription','').trim();itemDraft.c=val('#iCategory',itemDraft.c);
  itemDraft.p=Math.max(0,Number(val('#iPrice',0))||0);itemDraft.weight=val('#iWeight','').trim();itemDraft.sku=val('#iSku','').trim();
  const stock=val('#iStock','');itemDraft.stock=stock===''?null:Math.max(0,Math.floor(Number(stock)||0));itemDraft.card_color=val('#iCardColor','#FFFFFF');itemDraft.composition=val('#iComposition','').trim();
  itemDraft.tags=val('#iTags','').split(',').map(x=>x.trim()).filter(Boolean).slice(0,20);itemDraft.active=$('#iActive')?.checked!==false;itemDraft.recommended=!!$('#iRecommended')?.checked;itemDraft.featured=!!$('#iFeatured')?.checked;
  itemDraft.schedule={...(itemDraft.schedule||{}),enabled:!!$('#iScheduleEnabled')?.checked,from:val('#iScheduleFrom',''),to:val('#iScheduleTo','')};
  itemDraft.options=itemDraft.options||{};const required=[];
  for(const group of Object.keys(GROUP_META)){
    const block=document.querySelector('[data-option-group="'+group+'"]'),arr=[];
    block?.querySelectorAll('.optionRow').forEach((row,i)=>{
      const name=row.querySelector('[data-opt-name]')?.value.trim();if(!name)return;
      const old=itemDraft.options[group]?.[i]||{};arr.push({...old,id:old.id||slug(name||('opt_'+i)),name,price:Number(row.querySelector('[data-opt-price]')?.value)||0,active:old.active!==false,default:!!row.querySelector('[data-opt-default]')?.checked});
    });
    itemDraft.options[group]=arr;if(block?.querySelector('[data-required-group]')?.checked)required.push(group);
  }
  itemDraft.options.required_groups=required;window.ShaurmegDishSettings.read($('#dishSettings'),itemDraft);itemDraft.choice_groups=window.ShaurmegChoices.read($('#itemChoiceGroups'));
}
function addOption(group){
  syncDraftFromEditor();itemDraft.options=itemDraft.options||{};itemDraft.options[group]=Array.isArray(itemDraft.options[group])?itemDraft.options[group]:[];
  itemDraft.options[group].push({id:'new_'+Date.now().toString(36),name:'Новый вариант',price:0,active:true,default:false});renderItemEditor();
}
function removeOption(group,index){syncDraftFromEditor();itemDraft.options?.[group]?.splice(index,1);renderItemEditor()}
async function saveItem(){
  syncDraftFromEditor();if(!itemDraft.n)return toast('Введите название');if(!itemDraft.c)return toast('Выберите категорию');
  if(editingIndex>=0)menu[editingIndex]=clone(itemDraft);else{menu.push(clone(itemDraft));editingIndex=menu.length-1}
  if(await saveMenuRemote('Позиция сохранена и синхронизирована ✓')){closeItemDrawer();renderItems()};
}
async function deleteItem(){
  if(editingIndex<0){closeItemDrawer();return}
  if(!confirm('Удалить эту позицию из меню?'))return;
  menu.splice(editingIndex,1);editingIndex=-1;itemDraft=null;await saveMenuRemote('Позиция удалена ✓');closeItemDrawer();
}
function moveItem(index,delta){
  const target=index+delta;if(target<0||target>=menu.length)return;const a=menu[index],b=menu[target];
  if(a.c!==b.c)return toast('Сортировка работает внутри одной категории');
  [menu[index],menu[target]]=[menu[target],menu[index]];renderItems();saveMenuRemote('Порядок сохранён ✓');
}
function readFile(file){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result||''));r.onerror=reject;r.readAsDataURL(file)})}
async function compressImage(file,max=1200,quality=.82){
  if(!file?.type?.startsWith('image/'))throw new Error('Выберите изображение');
  const raw=await readFile(file),img=new Image();await new Promise((res,rej)=>{img.onload=res;img.onerror=rej;img.src=raw});
  let w=img.naturalWidth,h=img.naturalHeight,scale=Math.min(1,max/Math.max(w,h));w=Math.round(w*scale);h=Math.round(h*scale);
  const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;const cx=canvas.getContext('2d',{alpha:false});cx.fillStyle='#fff';cx.fillRect(0,0,w,h);cx.drawImage(img,0,0,w,h);
  return canvas.toDataURL('image/jpeg',quality);
}
async function setCategoryPhoto(file){
  const s=sections.find(x=>x.id===currentCategory);if(!s)return;try{s.cover=await compressImage(file,1280,.82);renderCategoryEditor(currentCategory);toast('Фото подготовлено · сохраните категорию')}catch(e){toast(e.message)}
}
async function setItemPhoto(file){
  try{syncDraftFromEditor();itemDraft.image=await compressImage(file,1280,.84);renderItemEditor();toast('Фото обновлено')}catch(e){toast(e.message)}
}
async function addGallery(files){
  syncDraftFromEditor();itemDraft.gallery=Array.isArray(itemDraft.gallery)?itemDraft.gallery:[];for(const f of [...files].slice(0,6)){if(itemDraft.gallery.length>=12)break;try{itemDraft.gallery.push(await compressImage(f,1000,.78))}catch{}}
  renderItemEditor();
}
function hydrateDesign(){
  const theme=data?.config?.theme||{primary:'#D94343',secondary:'#13233B',tone:'balanced'},site=mergeSite(data?.config?.site_customization);
  $('#themePrimary').value=safeHex(theme.primary,'#D94343');$('#themePrimaryHex').value=safeHex(theme.primary,'#D94343');$('#themeSecondary').value=safeHex(theme.secondary,'#13233B');$('#themeSecondaryHex').value=safeHex(theme.secondary,'#13233B');$('#themeTone').value=theme.tone||'balanced';
  $('#siteCardStyle').value=site.menu.card_style;$('#siteLayout').value=site.menu.layout;$('#siteRadius').value=site.design.radius;$('#siteRadiusValue').textContent=site.design.radius+' px';$('#showDescriptions').checked=site.menu.show_descriptions!==false;
  $('#view-design').dataset.establishment=est;window.ShaurmegDesign.hydrate($('#view-design'),site);
}
function safeHex(v,f){return /^#[0-9A-F]{6}$/i.test(String(v||''))?String(v).toUpperCase():f}
function mergeSite(raw){return window.ShaurmegDesign.merge(raw)}
function readSite(){
  const current=window.ShaurmegDesign.read($('#view-design'),data?.config?.site_customization);current.design.radius=Number($('#siteRadius').value)||20;current.menu.card_style=$('#siteCardStyle').value;current.menu.layout=$('#siteLayout').value;current.menu.show_descriptions=$('#showDescriptions').checked;return current;
}
async function saveDesign(){
  if(designBusy)return;designBusy=true;$('#saveDesignBtn').disabled=true;
  setSync('Публикуем…',false);try{
    const theme={primary:safeHex($('#themePrimaryHex').value,$('#themePrimary').value),secondary:safeHex($('#themeSecondaryHex').value,$('#themeSecondary').value),tone:$('#themeTone').value};
    const venue=est,site=readSite();
    const saved=await call('/venue-owner/establishments/'+encodeURIComponent(venue)+'/design',{method:'PUT',body:{theme,site_customization:site}});if(est!==venue)return;
    data.config={...(data.config||{}),theme:saved.theme,site_customization:saved.site_customization};designDirty=false;renderPreview();toast('Дизайн опубликован ✓');setSync('Синхронизировано',true);
  }catch(e){toast(e.message);setSync('Не опубликовано · черновик сохранён',false)}finally{designBusy=false;$('#saveDesignBtn').disabled=false}
}
function renderPreview(){
  const root=$('#livePreview');if(!root||!data)return;const secs=activeSections(),items=menu.filter(x=>x.active!==false&&secs.some(s=>s.id===x.c)).slice(0,4),hero=photoFor({image:data.hero_image})||photoFor(items[0]);
  window.ShaurmegDesign.preview(root,{site:readSite(),theme:{primary:safeHex($('#themePrimaryHex').value,$('#themePrimary').value),secondary:safeHex($('#themeSecondaryHex').value,$('#themeSecondary').value),tone:$('#themeTone').value},venue:data,sections:secs,items,money});
}
function hydrateProfile(){
  $('#profileName').value=data?.name||'';$('#profileAddress').value=data?.address||'';$('#profileDescription').value=data?.description||'';$('#profileHours').value=data?.hours||'';$('#profilePrice').value=data?.price_label||'';$('#profileHero').value=data?.hero_image||'';updateProfilePhoto();
}
async function saveProfile(){
  try{
    await call('/venue-owner/establishments/'+encodeURIComponent(est)+'/profile',{method:'PATCH',body:{name:$('#profileName').value.trim(),address:$('#profileAddress').value.trim(),description:$('#profileDescription').value.trim(),hours:$('#profileHours').value.trim(),price_label:$('#profilePrice').value.trim(),hero_image:$('#profileHero').value.trim()}});
    profileDirty=false;toast('Профиль сохранён ✓');await loadVenue({quiet:true});
  }catch(e){toast(e.message)}
}
const STATUS={new:'Новый',cooking:'Готовится',ready:'Готов',done:'Выполнен',cancelled:'Отменён'};
function orderCard(o,actions=true){
 const phone=String(o.phone||'').replace(/[^+0-9]/g,''),date=new Date(o.created_at),time=Number.isNaN(date.getTime())?'':date.toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
 return '<article class="orderCard" data-status="'+esc(o.status)+'"><header><b>'+esc(o.order_number||('#'+o.id))+'</b><span>'+esc(STATUS[o.status]||o.status)+'</span></header><div class="orderCustomer"><span>'+esc(o.customer_name||o.telegram_first_name||'Гость')+'</span>'+(phone?'<a href="tel:'+esc(phone)+'">'+esc(o.phone)+'</a>':'<span>'+esc(time)+'</span>')+'</div><div class="orderItems">'+(o.items||[]).map(x=>esc(x.n||x.name)+' × '+Number(x.q||x.quantity||1)).join('<br>')+'</div><div class="orderBottom"><span>'+esc(o.fulfillment_type==='delivery'?'Доставка':'В заведении')+'</span><strong>'+money(o.total)+'</strong></div>'+(actions?'<div class="orderButtons">'+
 (o.status==='new'?'<button class="primaryStep" data-order-status="cooking" data-order-id="'+esc(o.id)+'">Принять заказ</button>':'')+
 (o.status==='cooking'?'<button class="primaryStep" data-order-status="ready" data-order-id="'+esc(o.id)+'">Заказ готов</button>':'')+
 (o.status==='ready'?'<button class="primaryStep" data-order-status="done" data-order-id="'+esc(o.id)+'">Выдать заказ</button>':'')+
 (!['done','cancelled'].includes(o.status)?'<button data-order-status="cancelled" data-order-id="'+esc(o.id)+'">Отменить</button>':'')+'</div>':'')+'</article>';
}
function renderOrders(){
 const rows=orderRows.filter(o=>orderFilter==='all'||(orderFilter==='active'?!['done','cancelled'].includes(o.status):o.status===orderFilter));
 $('#ordersList').innerHTML=rows.map(o=>orderCard(o)).join('')||'<div class="empty">В этом статусе заказов пока нет</div>';
 $$('#orderStatusFilter [data-filter]').forEach(b=>b.classList.toggle('active',b.dataset.filter===orderFilter));
}
async function loadOrders(){
 try{orderRows=await call('/venue-owner/establishments/'+encodeURIComponent(est)+'/orders');renderOrders()}
 catch(e){$('#ordersList').innerHTML='<div class="empty">Не удалось загрузить заказы: '+esc(e.message)+'</div>'}
}
function updateProfilePhoto(){const e=$('#profilePhotoPreview'),src=$('#profileHero').value.trim();e.hidden=!src;if(src)e.src=src}
function openAdvanced(tab){
 const u=new URL('/venue-owner',new URL(api).origin);u.searchParams.set('establishment',est);u.searchParams.set('tab',tab);u.searchParams.set('from','console');u.searchParams.set('v','20261005-final4');
 // Preserve Telegram launch data across our trusted application origins; it is verified again by the server.
 if(tg?.initData)u.hash='tgWebAppData='+encodeURIComponent(tg.initData)+'&tgWebAppVersion='+encodeURIComponent(tg.version||'8.0')+'&tgWebAppPlatform='+encodeURIComponent(tg.platform||'unknown');
 location.href=u.toString();
}
async function changeOrder(id,status){try{await call('/venue-owner/establishments/'+encodeURIComponent(est)+'/orders/'+encodeURIComponent(id),{method:'PATCH',body:{status}});toast('Статус обновлён');await loadOrders()}catch(e){toast(e.message)}}
function connectStream(){
  try{stream?.close()}catch{};stream=null;if(!session||!est||typeof EventSource==='undefined')return;
  try{
    stream=new EventSource(api+'/venue-owner/establishments/'+encodeURIComponent(est)+'/stream?owner_session='+encodeURIComponent(session));
    const menuRefresh=()=>{setSync('Получаем изменения…',false);clearTimeout(connectStream.t);connectStream.t=setTimeout(()=>loadVenue({quiet:true}).catch(()=>{}),200)};
    stream.addEventListener('venue',menuRefresh);stream.addEventListener('menu_changed',menuRefresh);
    const ordersRefresh=()=>{if(currentView==='orders')loadOrders();loadHomeStats().catch(()=>{})};stream.addEventListener('order',ordersRefresh);stream.addEventListener('update',ordersRefresh);
    stream.onerror=()=>setSync('Переподключение…',false);
  }catch{}
}
function openClientPreview(){
  const markerId=accesses.find(x=>x.establishment_id===est)?.marker_id||data?.marker_id;if(!markerId)return toast('У точки нет marker_id');
  const u=new URL('menu.html',location.href);
  u.search='';
  u.searchParams.set('marker',markerId);
  u.searchParams.set('establishment',est);
  u.searchParams.set('from','admin');
  // Keep the guest menu inside the same Telegram Mini App WebView and preserve Telegram launch auth.
  if(tg?.initData)u.hash='tgWebAppData='+encodeURIComponent(tg.initData)+'&tgWebAppVersion='+encodeURIComponent(tg.version||'8.0')+'&tgWebAppPlatform='+encodeURIComponent(tg.platform||'unknown');
  else if(location.hash)u.hash=location.hash;
  location.href=u.toString();
}
function bind(){
  window.ShaurmegDesign.mount($('#view-design'),{compress:compressImage,onChange:()=>{designDirty=true;renderPreview();setSync('Есть неопубликованные изменения',false)},onError:toast});
  $('#view-design').addEventListener('input',()=>{designDirty=true;renderPreview()});$('#view-profile').addEventListener('input',()=>{profileDirty=true});window.addEventListener('beforeunload',e=>{if(profileDirty||designDirty){e.preventDefault();e.returnValue=''}});
  $('#claimBtn').onclick=claim;$('#backBtn').onclick=()=>{if(currentView!=='home'){setView('home');return}if(tg?.close)tg.close();else history.back()};
  try{tg?.BackButton?.onClick(()=>setView('home'))}catch{}
  $('#navBuilderStudio').onclick=openBuilderStudio;
  $('#view-settings').onclick=e=>{const b=e.target.closest('[data-settings-view]');if(b)setView(b.dataset.settingsView)};
  $('#advancedProfile').onclick=()=>openAdvanced('profile');$('#advancedSite').onclick=()=>setView('design');
  $('#orderStatusFilter').onclick=e=>{const b=e.target.closest('[data-filter]');if(b){orderFilter=b.dataset.filter;renderOrders()}};
  $('#profileHero').oninput=updateProfilePhoto;$('#profilePhotoFile').onchange=async e=>{if(e.target.files?.[0]){try{$('#profileHero').value=await compressImage(e.target.files[0],1100,.8);updateProfilePhoto();toast('Фото подготовлено · сохраните профиль')}catch(x){toast(x.message)}}};
  $('#venueSelect').onchange=async()=>{if(designBusy||saveBusy){$('#venueSelect').value=est;return toast('Дождитесь завершения сохранения')}if((profileDirty||designDirty)&&!await window.ShaurmegConsole.dialog({title:'Переключить заведение?',message:'Несохранённые изменения текущей точки будут отменены.',confirm:'Переключить'})){$('#venueSelect').value=est;return}est=$('#venueSelect').value;profileDirty=false;designDirty=false;currentCategory='';await loadVenue()};
  $('#mainTabs').onclick=e=>{const menu=e.target.closest('#navMenuStudio');if(menu)return openMenuStudio();const b=e.target.closest('[data-view]');if(b)setView(b.dataset.view)};
  $('#heroMenuStudio').onclick=openMenuStudio;$('#heroBuilderStudio').onclick=openBuilderStudio;$('#openMenuStudioCard').onclick=openMenuStudio;$('#openBuilderStudioCard').onclick=openBuilderStudio;
  $('#openClientFromHome').onclick=openClientPreview;
  $('#view-home').onclick=e=>{const b=e.target.closest('[data-home-view]');if(b)setView(b.dataset.homeView)};
  $('#categorySearch').oninput=renderCategories;
  $('#categoryList').onclick=e=>{const b=e.target.closest('[data-edit-category]');if(b){currentCategory=b.dataset.editCategory;renderCategoryEditor(currentCategory);$('#categoryEditor').scrollIntoView({behavior:'smooth',block:'start'})}};
  $('#categoryEditor').onclick=e=>{
    let b=e.target.closest('[data-add-setting]');if(b)return addSetting(b.dataset.addSetting);
    b=e.target.closest('[data-remove-setting]');if(b)return removeSetting(b.dataset.removeSetting,Number(b.dataset.settingIndex));
    if(e.target.closest('[data-cat-photo]'))return $('#catPhotoInput').click();
    if(e.target.closest('[data-cat-up]'))return moveSection(-1);if(e.target.closest('[data-cat-down]'))return moveSection(1);
    if(e.target.closest('[data-save-category]'))return saveCategory();
    if(e.target.closest('[data-open-items]')){$('#itemCategoryFilter').value=currentCategory;setView('items');renderItems()}
  };
  $('#categoryEditor').onchange=e=>{if(e.target.id==='catPhotoInput'&&e.target.files?.[0])setCategoryPhoto(e.target.files[0])};
  $('#itemSearch').oninput=renderItems;$('#itemCategoryFilter').onchange=renderItems;$('#newItemBtn').onclick=newItem;
  $('#itemGrid').onclick=e=>{
    let b=e.target.closest('[data-edit-item]');if(b)return openEditItem(b.dataset.editItem);
    b=e.target.closest('[data-move-item]');if(b)return moveItem(Number(b.closest('[data-item-index]').dataset.itemIndex),Number(b.dataset.moveItem));
  };
  $('#closeItemDrawer').onclick=closeItemDrawer;$('#drawerBackdrop').onclick=closeItemDrawer;$('#saveItemBtn').onclick=saveItem;$('#deleteItemBtn').onclick=deleteItem;$('#itemPreviewBtn').onclick=openClientPreview;
  $('#itemEditorBody').onclick=e=>{
    if(e.target.closest('#changeItemPhoto'))return $('#itemPhotoInput').click();
    let b=e.target.closest('[data-add-option]');if(b)return addOption(b.dataset.addOption);
    b=e.target.closest('[data-remove-option]');if(b)return removeOption(b.dataset.removeOption,Number(b.dataset.optionIndex));
  };
  $('#itemEditorBody').onchange=e=>{if(e.target.id==='iCategory'){syncDraftFromEditor();renderItemEditor();return}
    if(e.target.id==='itemPhotoInput'&&e.target.files?.[0])setItemPhoto(e.target.files[0]);
    if(e.target.id==='galleryInput'&&e.target.files?.length)addGallery(e.target.files);
  };
  $('#themePrimary').oninput=e=>{$('#themePrimaryHex').value=e.target.value.toUpperCase();renderPreview()};$('#themeSecondary').oninput=e=>{$('#themeSecondaryHex').value=e.target.value.toUpperCase();renderPreview()};
  $('#themePrimaryHex').onchange=e=>{const v=safeHex(e.target.value,$('#themePrimary').value);e.target.value=v;$('#themePrimary').value=v};
  $('#themeSecondaryHex').onchange=e=>{const v=safeHex(e.target.value,$('#themeSecondary').value);e.target.value=v;$('#themeSecondary').value=v};
  $('#themePresets').onclick=e=>{const b=e.target.closest('[data-primary]');if(!b)return;$('#themePrimary').value=b.dataset.primary;$('#themePrimaryHex').value=b.dataset.primary;$('#themeSecondary').value=b.dataset.secondary;$('#themeSecondaryHex').value=b.dataset.secondary;renderPreview()};
  $('#siteRadius').oninput=e=>$('#siteRadiusValue').textContent=e.target.value+' px';$('#saveDesignBtn').onclick=saveDesign;$('#previewDesignBtn').onclick=openClientPreview;$('#saveProfileBtn').onclick=saveProfile;$('#refreshOrders').onclick=loadOrders;
  $('#ordersList').onclick=e=>{const b=e.target.closest('[data-order-status]');if(b)changeOrder(b.dataset.orderId,b.dataset.orderStatus)};
}
bind();bootstrap().catch(e=>{$('#gateText').textContent=e.message||'Ошибка загрузки'});
})();
