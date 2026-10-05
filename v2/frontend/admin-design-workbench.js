/* The same complete design editor is used by owners and network administrators. */
(() => {
  'use strict';
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const defaults={design:{mode:'cinematic',background_image:'',ambient_strength:.16,radius:20,panel_opacity:.9,contrast:1},menu:{layout:'hero-2-3',card_style:'photo',image_fit:'cover',show_descriptions:true,hero_label:'НАША ГОРДОСТЬ'},features:{favorites:true,menu_badges:true,builder_result:true},builder_result:{enabled:true,image:'',title:'Твоя шаурма готова',subtitle:'Сборка завершена. Осталось добавить её в корзину.',singularity:true,duration_ms:1050}};
  const fields=[
    ['design.mode','Режим оформления','select',[['cinematic','Кинематографичный'],['minimal','Минималистичный'],['editorial','Редакционный'],['glass','Стекло']]],
    ['design.background_image','Фотография фона','photo'],
    ['design.ambient_strength','Сила фонового свечения','range',0,.5,.01],
    ['design.panel_opacity','Непрозрачность панелей','range',.45,.99,.01],
    ['design.contrast','Контраст','range',.8,1.3,.01],
    ['menu.image_fit','Размещение фотографий','select',[['cover','Заполнить карточку'],['contain','Показать полностью']]],
    ['menu.hero_label','Подпись главной карточки','text',40],
    ['features.favorites','Избранное','check'],
    ['features.menu_badges','Метки блюд','check'],
    ['features.builder_result','Экран результата сборки','check'],
    ['builder_result.enabled','Показывать завершённую сборку','check'],
    ['builder_result.image','Фотография результата','photo'],
    ['builder_result.title','Заголовок результата','text',100],
    ['builder_result.subtitle','Описание результата','text',180],
    ['builder_result.singularity','Финальный визуальный эффект','check'],
    ['builder_result.duration_ms','Длительность результата, мс','range',650,1800,50]
  ];
  function merge(raw={}){const out={...raw};for(const key of Object.keys(defaults))out[key]={...defaults[key],...(raw[key]||{})};return out}
  function control(f){const [path,label,type,a,b,step]=f,id='workbench-'+path.replace('.','-');let input='';
    if(type==='select')input='<select id="'+id+'" data-design-path="'+path+'">'+a.map(([value,name])=>'<option value="'+value+'">'+name+'</option>').join('')+'</select>';
    else if(type==='check')input='<input id="'+id+'" data-design-path="'+path+'" type="checkbox">';
    else if(type==='range')input='<div class="consoleRange"><input id="'+id+'" data-design-path="'+path+'" type="range" min="'+a+'" max="'+b+'" step="'+step+'"><output for="'+id+'"></output></div>';
    else if(type==='photo')input='<div class="consoleWorkbenchPhoto"><img data-design-photo="'+path+'" alt="" hidden><label class="consolePhotoUpload"><span data-icon="camera"></span>Загрузить фото<input type="file" accept="image/*" data-design-upload="'+path+'" hidden></label><button type="button" data-design-clear="'+path+'" hidden aria-label="Удалить фотографию">×</button></div><input id="'+id+'" data-design-path="'+path+'" placeholder="Или ссылка на изображение">';
    else input='<input id="'+id+'" data-design-path="'+path+'" maxlength="'+a+'">';
    return '<div class="consoleDesignField '+(type==='check'?'consoleDesignToggle':'')+(type==='photo'?' consoleDesignWide':'')+'"><label for="'+id+'">'+label+'</label>'+input+'</div>';
  }
  function mount(root,{compress,onChange,onError}={}){
    if(root.querySelector('.consoleDesignAdvanced'))return;
    const host=document.createElement('div');host.className='consoleDesignAdvanced';
    host.innerHTML='<div class="consoleDesignSection"><div class="consoleDesignSectionHead"><span>01</span><div><h3>Атмосфера и поверхности</h3><p>Фотографии, прозрачность и читаемость интерфейса</p></div></div><div class="consoleDesignFields">'+fields.slice(0,5).map(control).join('')+'</div></div><div class="consoleDesignSection"><div class="consoleDesignSectionHead"><span>02</span><div><h3>Карточки и возможности</h3><p>Фотографии блюд, подписи, избранное и акценты</p></div></div><div class="consoleDesignFields">'+fields.slice(5,10).map(control).join('')+'</div></div><div class="consoleDesignSection"><div class="consoleDesignSectionHead"><span>03</span><div><h3>Завершение сборки</h3><p>Настройте финальный экран конструктора</p></div></div><div class="consoleDesignFields">'+fields.slice(10).map(control).join('')+'</div></div>';
    const anchor=root.querySelector('.guestPreview')||root.querySelector('.actions');anchor.before(host);
    host.addEventListener('input',()=>{refresh(root);onChange?.()});
    host.addEventListener('click',e=>{const b=e.target.closest('[data-design-clear]');if(!b)return;root.querySelector('[data-design-path="'+b.dataset.designClear+'"]').value='';refresh(root);onChange?.()});
    host.addEventListener('change',async e=>{const path=e.target.dataset.designUpload;if(!path||!e.target.files?.[0])return;const target=root.querySelector('[data-design-path="'+path+'"]'),venue=root.dataset.establishment,file=e.target.files[0];e.target.disabled=true;
      try{const image=await compress(file,1100,.8);if(root.dataset.establishment!==venue)return;target.value=image;refresh(root);onChange?.()}catch(err){onError?.(err.message)}finally{e.target.disabled=false;e.target.value=''}
    });window.ShaurmegConsole?.icons(host);
  }
  function hydrate(root,raw){const site=merge(raw);for(const el of root.querySelectorAll('[data-design-path]')){const [group,key]=el.dataset.designPath.split('.');if(el.type==='checkbox')el.checked=site[group][key]!==false;else el.value=site[group][key]??''}refresh(root)}
  function read(root,raw){const site=merge(raw);for(const el of root.querySelectorAll('[data-design-path]')){const [group,key]=el.dataset.designPath.split('.');site[group][key]=el.type==='checkbox'?el.checked:el.type==='range'?Number(el.value):el.value.trim()}return site}
  function refresh(root){for(const el of root.querySelectorAll('[data-design-path]')){if(el.type==='range')el.nextElementSibling.textContent=el.value;const image=root.querySelector('[data-design-photo="'+el.dataset.designPath+'"]');if(image){image.hidden=!el.value;el.hidden=el.value.startsWith('data:image/');root.querySelector('[data-design-clear="'+el.dataset.designPath+'"]').hidden=!el.value;if(el.value)image.src=el.value;else image.removeAttribute('src')}}}
  function preview(root,{site,theme,venue,sections,items,money}){
    site=merge(site);const hero=venue.hero_image||items[0]?.image||'',light=theme.tone==='light';
    root.innerHTML='<div class="consolePreviewLabel"><span>МОДЕЛЬ ОТОБРАЖЕНИЯ</span><small>Изменения до публикации</small></div><div class="consoleDesignSimulation '+(light?'isLight':'')+'"><header>'+(hero?'<img src="'+esc(hero)+'" alt="">':'')+'<div><small>'+esc(venue.name)+'</small><h3>Меню</h3><span>'+esc(site.menu.hero_label)+'</span></div></header><div class="consoleSimulationBody"><nav>'+sections.slice(0,4).map(s=>'<span>'+esc(s.name)+'</span>').join('')+'</nav><div class="consoleSimulationGrid">'+items.slice(0,4).map(x=>'<article>'+((x.image||x.i)?'<img src="'+esc(x.image||x.i)+'" alt="">':'')+'<div><b>'+esc(x.n)+'</b>'+(site.menu.show_descriptions?'<p>'+esc(x.d)+'</p>':'')+'<strong>'+esc(money(x.p))+'</strong><button type="button" tabindex="-1" aria-label="Пример кнопки добавления">+</button></div></article>').join('')+'</div></div></div>'+(site.features.builder_result&&site.builder_result.enabled?'<div class="consoleResultPreview">'+(site.builder_result.image?'<img src="'+esc(site.builder_result.image)+'" alt="">':'<span data-icon="recipe"></span>')+'<div><small>РЕЗУЛЬТАТ СБОРКИ</small><b>'+esc(site.builder_result.title)+'</b><p>'+esc(site.builder_result.subtitle)+'</p></div></div>':'');
    const view=root.querySelector('.consoleDesignSimulation');view.style.setProperty('--preview-primary',theme.primary);view.style.setProperty('--preview-secondary',theme.secondary);view.style.setProperty('--preview-radius',site.design.radius+'px');view.style.setProperty('--preview-opacity',site.design.panel_opacity);view.style.filter='contrast('+site.design.contrast+')';if(site.design.background_image)view.style.backgroundImage='linear-gradient(#07111be0,#07111be0),url("'+site.design.background_image.replace(/["\\\n\r]/g,'')+'")';
    view.dataset.layout=site.menu.layout;view.dataset.cardStyle=site.menu.card_style;view.dataset.designMode=site.design.mode;view.style.boxShadow='0 0 40px '+theme.primary+Math.round(site.design.ambient_strength*255).toString(16).padStart(2,'0');view.querySelectorAll('article img').forEach(img=>img.style.objectFit=site.menu.image_fit);window.ShaurmegConsole?.icons(root);
  }
  window.ShaurmegDesign={mount,hydrate,read,merge,preview};
})();
