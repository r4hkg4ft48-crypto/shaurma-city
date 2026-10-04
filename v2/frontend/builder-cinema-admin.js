(() => {
 class Editor{
  constructor(root,{request,compress,base}){
   this.root=root;this.request=request;this.compress=compress;this.base=base;this.serial=0;
   root.classList.add('cinemaAdmin');root.innerHTML=`<h3>Фотосборка блюда</h3><p>Загрузите настоящее фото готового блюда. По нему будут подготовлены отдельные слои лаваша, мяса и выбранных наполнителей. Перед включением просмотрите результат: скрытая начинка восстанавливается приблизительно.</p>
   <div class="field"><label>Формат блюда</label><select data-cinema="type"></select></div>
   <div class="field"><label>Постоянная начинка</label><input data-cinema="filling" maxlength="180" placeholder="Например: капуста, помидоры, огурцы"><small>То, что входит в любую сборку. Оставьте пустым, если постоянной начинки нет.</small></div>
   <label class="cinemaPhotoLabel">Загрузить фото блюда и подготовить сборку<input data-cinema="file" type="file" accept="image/jpeg,image/png,image/webp"></label>
   <img class="cinemaReference" data-cinema="reference" alt="Настоящее блюдо заведения" hidden>
   <div class="cinemaStatus" data-cinema="status" role="status"></div>
   <div data-cinema="preview" hidden></div>
   <div class="cinemaActions"><button type="button" class="plainBtn" data-cinema="generate" hidden>Подготовить заново</button><button type="button" class="plainBtn" data-cinema="refresh">Обновить статус</button><button type="button" class="primaryBtn" data-cinema="approve" hidden>Включить для гостей</button></div>`;
   this.el=k=>root.querySelector('[data-cinema="'+k+'"]');
   this.el('type').onchange=()=>this.show();this.el('file').onchange=e=>this.upload(e.target.files?.[0]);
   this.el('generate').onclick=()=>this.generate();this.el('refresh').onclick=()=>this.load();this.el('approve').onclick=()=>this.approve();
  }
  endpoint(type=''){return this.base(this.est)+(type?'/'+encodeURIComponent(type):'');}
  async setContext(est,builder){this.serial++;this.scene?.cancel();this.est=est;this.builder=builder;this.scenes=[];this.el('type').replaceChildren();
   for(const x of builder?.types||[]){const option=document.createElement('option');option.value=x.id;option.textContent=x.name;this.el('type').append(option);}
   this.busy(false);await this.load();
  }
  busy(value){this.root.querySelectorAll('button,input,select').forEach(x=>x.disabled=value);}
  async load(){const version=this.serial;if(!this.est)return;try{const result=await this.request(this.endpoint());if(version!==this.serial)return;this.scenes=result.scenes;this.available=result.generation_available;this.show();}catch(e){if(version===this.serial)this.el('status').textContent=e.message;}}
  show(){this.scene?.cancel();const item=this.scenes.find(x=>x.type_id===this.el('type').value);this.el('filling').value=item?.filling||'';
   const photo=this.el('reference');photo.hidden=!item?.reference_url;if(item?.reference_url)photo.src=item.reference_url;
   this.el('generate').hidden=!item;this.el('approve').hidden=!(item?.status==='review'&&!item.stale);this.el('preview').hidden=!item?.atlas_url;
   const labels={reference:'Фото сохранено. Можно подготовить фотослои.',processing:'Готовим фотослои. Это может занять несколько минут. Если вы закрыли окно, обновите статус позже.',review:'Просмотрите сборку и включите её для гостей.',ready:'Фотосборка включена для гостей.',error:item?.error||'Не удалось подготовить сцену.'};
   this.el('status').textContent=(item?item.stale&&item.atlas_url?'Состав изменился. Подготовьте фотосцену заново.':labels[item.status]:'Сначала сохраните состав конструктора, затем загрузите фото выбранного формата.')+(this.available?'':'\nАвтоматическая подготовка пока не подключена на сервере. Фото можно сохранить.');
   if(item?.atlas_url){if(!this.scene)this.scene=new BuilderCinema.Scene(this.el('preview'));
    const b=this.builder,state={type:item.type_id,bread:b.breads?.[0]?.id||'',meat:b.meats?.[0]?.id||'',sauces:b.sauces?.slice(0,1).map(x=>x.id)||[],extras:b.extras?.slice(0,2).map(x=>x.id)||[]};
    this.scene.play(b,state,item);
   }
  }
  async upload(file){if(!file)return;const version=this.serial,type=this.el('type').value,url=this.endpoint(type),filling=this.el('filling').value;
   if(!type)return;this.busy(true);this.el('status').textContent='Сохраняем фото…';
   try{const reference=await this.compress(file);if(version!==this.serial)return;
    await this.request(url+'/reference',{method:'PUT',body:{reference,filling}});if(version!==this.serial)return;
    await this.load();if(version!==this.serial)return;if(this.available)await this.generate();
   }catch(e){if(version===this.serial)this.el('status').textContent=e.message;}finally{if(version===this.serial){this.busy(false);this.el('file').value='';}}
  }
  async generate(){const version=this.serial,type=this.el('type').value;this.busy(true);this.el('status').textContent='Готовим фотослои по вашему блюду… Обычно несколько минут. Можно вернуться позже и обновить статус.';
   try{await this.request(this.endpoint(type)+'/generate',{method:'POST',body:{filling:this.el('filling').value}});if(version===this.serial)await this.load();}
   catch(e){if(version===this.serial)this.el('status').textContent=e.message;}finally{if(version===this.serial)this.busy(false);}
  }
  async approve(){const version=this.serial;this.busy(true);try{await this.request(this.endpoint(this.el('type').value)+'/approve',{method:'POST',body:{}});if(version===this.serial)await this.load();}catch(e){if(version===this.serial)this.el('status').textContent=e.message;}finally{if(version===this.serial)this.busy(false);}}
 }
 window.BuilderCinemaEditor=Editor;
})();
