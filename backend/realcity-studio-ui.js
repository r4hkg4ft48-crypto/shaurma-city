/* Original-photo intake, scoped Astra handoff and review on the existing map. */
(() => {
 'use strict';
 const warnings={low_resolution:'мало пикселей',low_contrast:'низкий контраст',clipped_exposure:'пересвет или глубокие тени',check_focus:'проверьте фокус',source_resolution_limited:'разрешение ограничено исходником',occluded_pixels_unfilled:'есть закрытые участки без второго ракурса'};
 let target='',reviewed='';
 const endpoint=suffix=>'/api/shaurma/admin/astra-realcity/'+encodeURIComponent(astraState.establishment_id)+suffix;
 const signature=draft=>draft?draft.input_revision+':'+new Date(draft.updated_at).toISOString():'';
 const studio=window.RealCityStudio={previewData:null,
  message(e){return ({photo_decode_failed_use_jpeg_or_png:'Формат не декодируется. Пришлите JPEG или PNG; оригинал не был заменён.',photo_dataset_limit_256mb:'Достигнут лимит 256 МБ оригиналов этой точки.',photo_file_limit_16mb:'Один файл должен быть не больше 16 МБ.',photo_processor_busy_retry:'Обрабатывается другой фасад. Повторите через минуту.',astra_inputs_changed_reload_package:'Исходники изменились. Обновите пакет и рецепт.',photo_draft_changed_reload:'Черновик обновился. Откройте его снова перед публикацией.'})[e.body?.error||e.message]||e.body?.error||e.message;},
  refresh(state){
   if(!state)return;
   const key=state.establishment_id+':'+state.marker_id;
   if(key!==target){target=key;reviewed='';$('#astraAccessResult').hidden=true;$('#astraAccessLink').value='';}
   const originals=(state.assets||[]).filter(a=>a.stored),checks=originals.flatMap(a=>(a.metadata?.warnings||[]).map(w=>(a.filename||a.id)+': '+(warnings[w]||w)));
   $('#astraPhotoQuality').textContent=originals.length?originals.length+' оригиналов сохранено. '+(checks.length?checks.slice(0,4).join('; '):'Автоматическая проверка выполнена. Привязка сторон требует анализа Astra.'):'Новые фотографии будут сохранены в исходном качестве. Ранее уменьшенные файлы не восстанавливаются автоматически.';
   const d=state.draft,stale=d&&d.input_revision!==state.manifest?.geometry?.revision;
   $('#astraPreview').disabled=!d||stale;$('#astraPublish').disabled=!d||stale||reviewed!==signature(d);
   $('#astraDraftStatus').textContent=d?(stale?'Исходники изменились — нужно обновить черновик.':'Черновик готов к проверке на карте. '+(d.report?.warnings||[]).map(s=>s.split(': ').map(t=>warnings[t]||t).join(': ')).join('; ')):'Загрузка проверяет исходники. Для реконструкции передайте ссылку Astra; готовый рецепт обрабатывается на сервере.';
  }
 };
 const run=async(button,fn)=>{button.disabled=true;let failure;try{await fn();}catch(e){failure=studio.message(e);}finally{button.disabled=false;if(astraState)studio.refresh(astraState);if(failure)$('#astraDraftStatus').textContent=failure;}};
 $('#astraAccess').onclick=e=>run(e.currentTarget,async()=>{
  if(!await saveAstraStudio())return;
  const j=await api(endpoint('/access'),{method:'POST',body:JSON.stringify({marker_id:astraState.marker_id})});
  $('#astraAccessLink').value=location.origin+j.path;$('#astraAccessResult').hidden=false;
 });
 $('#astraCopyAccess').onclick=async()=>{try{await navigator.clipboard.writeText($('#astraAccessLink').value);toast('Ссылка скопирована');}catch{$('#astraAccessLink').select();}};
 $('#astraRevoke').onclick=e=>run(e.currentTarget,async()=>{await api(endpoint('/access')+'?marker_id='+astraState.marker_id,{method:'DELETE'});$('#astraAccessResult').hidden=true;$('#astraAccessLink').value='';toast('Доступ отозван');});
 $('#astraRecipe').onclick=()=>$('#astraRecipeFile').click();
 $('#astraRecipeFile').onchange=async e=>{
  const file=e.target.files[0];e.target.value='';if(!file)return;
  await run($('#astraRecipe'),async()=>{
   if(file.size>20*1024*1024)throw new Error('Рецепт больше 20 МБ');
   if(!await saveAstraStudio())return;
   $('#astraDraftStatus').textContent='Выправляем перспективу и собираем материалы из оригиналов…';
   await api(endpoint('/process'),{method:'POST',body:JSON.stringify({marker_id:astraState.marker_id,recipe:JSON.parse(await file.text())})});
   await loadAstraStudio();
  });
 };
 $('#astraPreview').onclick=e=>run(e.currentTarget,async()=>{
  const packet=await api(endpoint('/draft')+'?marker_id='+astraState.marker_id);
  if(packet.stale)throw new Error('Исходники изменились. Обновите реконструкцию.');
  studio.previewData=packet;
  const dialog=document.createElement('dialog');dialog.style.cssText='width:calc(100vw - 20px);max-width:1200px;height:92dvh;padding:0;border:1px solid #34475b;border-radius:18px;background:#0f2035;color:white';
  const bar=document.createElement('div');bar.style.cssText='padding:10px;display:flex;align-items:center;gap:12px';
  const close=document.createElement('button');close.className='btn';close.textContent='Закрыть проверку';close.onclick=()=>dialog.close();
  const label=document.createElement('span');label.textContent='Черновик на карте · '+astraState.establishment_id;bar.append(close,label);
  const frame=document.createElement('iframe');frame.title='Проверка RealCity на существующей карте';frame.style.cssText='width:100%;height:calc(100% - 65px);border:0';
  frame.src='/realcity-preview/index.html?marker='+astraState.marker_id+'&realcity_preview=1';
  dialog.append(bar,frame);document.body.append(dialog);dialog.showModal();
  dialog.onclose=()=>{
   let ready=false;try{ready=frame.contentWindow.__SHAURMEG_REALCITY_PREVIEW_READY__===signature(packet.draft);}catch{}
   frame.src='about:blank';dialog.remove();studio.previewData=null;
   if(ready){reviewed=signature(packet.draft);astraState.draft=packet.draft;}
   studio.refresh(astraState);if(!ready)$('#astraDraftStatus').textContent='Карта с черновиком не загрузилась. Повторите проверку перед публикацией.';
  };
 });
 $('#astraPublish').onclick=e=>run(e.currentTarget,async()=>{
  if(reviewed!==signature(astraState.draft))throw new Error('Сначала проверьте текущий черновик на карте.');
  await api(endpoint('/publish'),{method:'POST',body:JSON.stringify({marker_id:astraState.marker_id,expected_revision:astraState.draft.input_revision,expected_draft_updated_at:new Date(astraState.draft.updated_at).toISOString()})});
  await loadAstraStudio();toast('Проверенный фасад опубликован');
 });
 if(astraState)studio.refresh(astraState);
})();
