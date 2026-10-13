'use strict';
/* Guided 30-frame intake. Uses existing Astra original storage and strict marker scoping. */
(function(){
 const plan=window.RealCityShotPlan;
 if(!plan)return;
 const $=s=>document.querySelector(s);
 let selectedGroup='all',busy=false,pendingSlot=null;
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const getAsset=id=>astraAssets.find(a=>a.id===id);
 const byShot=id=>astraAssets.find(a=>a.shot_id===id);
 const notice=s=>{const node=$('#rcGuideStatus');if(node)node.textContent=s};
 const thumbnail=a=>String(a?.src||'').startsWith('data:image/')?'<img loading="lazy" src="'+esc(a.src)+'" alt="Фото ракурса">':a?.src?'<div class="rcEmptyPhoto">Фото по внешней ссылке</div>':'<div class="rcEmptyPhoto"><span>＋</span>Фотография не загружена</div>';
 const shortmeta=a=>a?.metadata?[a.metadata.width&&a.metadata.height?a.metadata.width+'×'+a.metadata.height:null,a.metadata.gps?'GPS ✓':'Без GPS',a.metadata.heading_deg!=null?'EXIF: направление ✓':null,(a.metadata.warnings||[]).length?'Требуется проверка качества':null].filter(Boolean).join(' · '):'Ракурс назначен вручную; положение камеры ещё не подтверждено';
 const assignFields=(a,s)=>{a.shot_id=s.id;a.category=s.category;a.subtype=s.subtype;a.role=s.category==='main_building'?'hero_facade':s.category==='panorama'?'environment':s.category==='neighbor_building'?'context_building':s.category==='road_ground'?'ground':s.category==='vegetation'?'vegetation':'street_object';a.angle=s.angle;a.label=s.title;a.subject_id=s.subject;a.view_zone=s.position;a.primary=s.id==='RC01';};
 function render(){
  const root=$('#rcGuide');if(!root)return;
  const data=plan.describe(astraAssets);
  $('#rcGuideCount').textContent=data.filled+' / 30 фотографий';
  $('#rcGuideBar').style.width=(data.filled/30*100)+'%';
  $('#rcGuideHelp').textContent=data.filled===30?'Все 30 мест заполнены. Перед публикацией всё равно нужна проверка соответствия изображения и геометрии на карте.':'Заполнено '+data.filled+' из 30. Съёмка по этим местам связывает наблюдения; реальное совпадение фасадов и стен проверяется отдельно.';
  $('#rcGuideGroups').innerHTML='<button type="button" data-rc-group="all" class="'+(selectedGroup==='all'?'active':'')+'">Все 30</button>'+plan.groups.map(g=>'<button type="button" data-rc-group="'+g.id+'" class="'+(selectedGroup===g.id?'active':'')+'">'+esc(g.name.split(' · ')[1])+' · '+plan.slots.filter(s=>s.group===g.id&&byShot(s.id)).length+'/'+plan.slots.filter(s=>s.group===g.id).length+'</button>').join('');
  const slots=plan.slots.filter(s=>selectedGroup==='all'||s.group===selectedGroup);
  $('#rcGuideSlots').innerHTML=slots.map(s=>{
   const a=byShot(s.id),linked=s.links.filter(id=>byShot(id)),linkedNames=s.links.map(id=>plan.get(id).title);
   return '<article class="rcShot '+(a?'isFilled':'')+'" data-rc-slot="'+s.id+'">'+
    '<div class="rcShotPreview">'+thumbnail(a)+'<span class="rcShotNumber">'+s.id.slice(2)+'</span>'+(a?'<span class="rcShotReady">✓ Привязано</span>':'')+'</div>'+
    '<div class="rcShotBody"><b>'+esc(s.title)+'</b><p class="rcPosition"><strong>Откуда снимать:</strong> '+esc(s.position)+'</p>'+
    '<p><strong>Что должно быть в кадре:</strong> '+esc(s.focus)+'</p>'+
    '<p class="rcShotLinks">Связи: '+esc(linked.length?s.links.map(id=>(byShot(id)?'✓ ':'○ ')+plan.get(id).title).join(' · '):linkedNames.join(' · '))+'</p>'+
    (a?'<p class="rcShotMeta">'+esc(shortmeta(a))+'</p><label class="rcNotes">Уточнение для обработки<input type="text" data-rc-note="'+esc(a.id)+'" maxlength="900" value="'+esc(a.notes||'')+'" placeholder="Необязательно: что ещё важно в кадре"></label>':'')+
    '<div class="rcShotActions"><button type="button" data-rc-upload="'+s.id+'">'+(a?'Заменить фотографию':'＋ Загрузить сюда')+'</button>'+(a?'<button type="button" class="secondary" data-rc-unassign="'+s.id+'">Открепить</button>':'')+'</div></div></article>';
  }).join('');
  const extras=astraAssets.filter(a=>!plan.get(a.shot_id));
  $('#rcExtraCount').textContent=extras.length;
  $('#rcExtraAssets').innerHTML=extras.length?extras.map(a=>'<div class="rcLoose"><div class="rcLoosePreview">'+thumbnail(a)+'</div><div><b>'+esc(a.label||a.filename||'Исходная фотография')+'</b><small>'+esc(shortmeta(a))+'</small><select data-rc-assign="'+esc(a.id)+'"><option value="">Указать, что изображено на снимке…</option>'+plan.slots.map(s=>'<option value="'+s.id+'" '+(byShot(s.id)?'disabled':'')+'>'+s.id.slice(2)+' · '+esc(s.title)+'</option>').join('')+'</select></div></div>').join(''):'<p class="muted">Все фотографии распределены либо пакет ещё пуст.</p>';
  $('#rcExtras').hidden=!extras.length;
 }
 async function commitAssignment(assetId,slotId){
  const a=getAsset(assetId),s=plan.get(slotId);if(!a||!s)return;
  if(byShot(s.id))return notice('Сначала освободите место '+s.id+'. Каждое место содержит один основной кадр.');
  const original={...a};assignFields(a,s);render();
  if(!await saveAstraStudio()){Object.assign(a,original);render();notice('Не получилось сохранить назначение. Повторите.');return}
  notice('Фотография '+s.id+' привязана к '+s.title+'. Связи с другими ракурсами обновлены.');
 }
 async function unassign(slotId){
  const a=byShot(slotId);if(!a)return;
  const old=a.shot_id;a.shot_id=null;render();
  if(!await saveAstraStudio()){a.shot_id=old;render();notice('Не удалось открепить фото');return}
  notice('Исходная фотография сохранена в наборе. Назначьте её другому месту ниже.');
 }
 async function upload(slotId,file){
  const slot=plan.get(slotId);if(!slot||!file||!astraState||busy)return;
  if(file.size>16*1024*1024)return notice('Файл больше 16 МБ. Выберите оригинал до 16 МБ.');
  const occupied=byShot(slotId),priorTarget=astraState.marker_id,priorEst=astraState.establishment_id;
  if(occupied&&!confirm('Заменить фото '+slot.title+'? Предыдущее фото останется в нераспределённых оригиналах.'))return;
  if(astraAssets.length>=120)return notice('В этой точке уже 120 материалов; предел хранилища.');
  busy=true;notice('Сохраняем параметры и загружаем оригинал '+file.name+'…');
  $('#rcGuide').classList.add('rcWorking');
  try{
   if(!await saveAstraStudio())throw new Error('Сначала сохраните текущие настройки');
   const url='/api/shaurma/admin/astra-realcity/'+encodeURIComponent(priorEst)+'/assets?marker_id='+encodeURIComponent(priorTarget)+'&shot_id='+slot.id+'&filename='+encodeURIComponent(file.name);
   const j=await api(url,{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:file});
   if(String(priorTarget)!==String(astraState.marker_id)||priorEst!==astraState.establishment_id)throw new Error('Точка изменилась. Перезагрузите раздел.');
   applyAstraState({...astraState,...j,markers:astraState.markers});
   // A previous observation is retained, not deleted, when a slot is replaced.
   const duplicates=astraAssets.filter(a=>a.shot_id===slotId);
   if(duplicates.length>1){
    const justAdded=duplicates.find(a=>a.filename===file.name&&a.id!==occupied?.id)||duplicates[duplicates.length-1];
    duplicates.filter(a=>a.id!==justAdded.id).forEach(a=>{a.shot_id=null});
    if(!await saveAstraStudio())throw new Error('Оригинал загружен, но назначение замены не сохранено. Проверьте список.');
   }
   notice('Снимок '+slot.id+' сохранён с меткой «'+slot.title+'». Извлечённые EXIF/качество доступны в карточке.');
  }catch(e){notice('Не удалось загрузить '+file.name+': '+(e.body?.error||e.message));}
  finally{busy=false;$('#rcGuide').classList.remove('rcWorking');render();}
 }
 const root=$('#rcGuide');
 if(!root)return;
 root.addEventListener('click',e=>{
  const group=e.target.closest('[data-rc-group]');if(group){selectedGroup=group.dataset.rcGroup;render();return}
  const up=e.target.closest('[data-rc-upload]');if(up){pendingSlot=up.dataset.rcUpload;$('#rcGuideFile').click();return}
  const free=e.target.closest('[data-rc-unassign]');if(free&&!busy)void unassign(free.dataset.rcUnassign);
 });
 root.addEventListener('change',e=>{
  const sel=e.target.closest('[data-rc-assign]');if(sel&&!busy&&sel.value){void commitAssignment(sel.dataset.rcAssign,sel.value);return}
  const n=e.target.closest('[data-rc-note]');if(n&&!busy){const a=getAsset(n.dataset.rcNote);if(a){const old=a.notes;a.notes=n.value;void saveAstraStudio().then(ok=>{if(!ok){a.notes=old;notice('Описание не сохранено')}else notice('Примечание сохранено')})}}
 });
 $('#rcGuideFile').addEventListener('change',e=>{const slot=pendingSlot,file=e.target.files?.[0];e.target.value='';pendingSlot=null;if(slot&&file)void upload(slot,file)});
 window.RealCityPhotoGuide={render};
 render();
})();
