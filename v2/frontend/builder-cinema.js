/* Photographic, selection-driven composition. No particles, emoji or 3D substitutes. */
(() => {
 const stock=new URL('assets/builder-food-atlas.webp',document.currentScript.src).href;
 const reduced=()=>window.matchMedia('(prefers-reduced-motion: reduce)').matches;
 const known=x=>{
  const n=String(x?.name||x?.id||'').toLowerCase();
  if(/кур|chicken/.test(n))return 2;if(/говя|beef/.test(n))return 3;
  if(/капуст|салат|lettuce/.test(n))return 4;if(/помид|томат|tomato/.test(n))return 5;if(/огур|cucumber/.test(n))return 6;
  if(/халап|jalap/.test(n))return 9;if(/лук|onion/.test(n))return 8;if(/фри|fries/.test(n))return 10;
  if(/сыр|cheese/.test(n))return 7;return null;
 };
 function layers(builder,state,scene){
  const output=[],missing=[];
  const custom=!!scene?.atlas_url;
  const put=(key,label,cell,scale=1)=>{
   if(custom){cell=scene.recipe?.slots?.findIndex(s=>s.key===key);if(cell<0||cell==null){missing.push(label);return;}}
   if(cell==null){missing.push(label);return;}
   output.push({key,label,cell,scale:custom?1:scale,atlas:custom?scene.atlas_url:stock,grid:custom?scene.recipe.grid:4});
  };
  const type=builder.types?.find(x=>x.id===state.type),flat=/леп[её]ш|flatbread/i.test(type?.name||state.type);
  const bread=builder.breads?.find(x=>x.id===state.bread);
  put(bread?'breads:'+bread.id:'base',bread?.name||type?.name||'Основа',flat?1:0);
  if(custom&&scene.recipe?.slots?.some(s=>s.key==='filling'))put('filling',scene.filling||'Начинка',null);
  for(const group of ['meats','extras','sauces']){
   const ids=group==='meats'?[state.meat]:state[group]||[];
   for(const id of ids){const x=builder[group]?.find(v=>v.id===id);if(!x)continue;
    let cell=known(x);
    if(group==='sauces')cell=/барбек|bbq/i.test(x.name)?13:/сыр|cheese/i.test(x.name)?12:/чесноч|garlic|стандарт/i.test(x.name)?11:null;
    put(group+':'+id,x.name,cell,group==='meats'?.77:group==='sauces'?.67:.66);
   }
  }
  return {layers:output,missing};
 }
 class Scene{
  constructor(root){this.root=root;this.token=0;this.nodes=new Map();this.cache=new Map();
   root.innerHTML='<div class="foodStage"><div class="foodLight"></div><div class="foodLayers" aria-hidden="true"></div><div class="foodStageMeta"><span>СОБИРАЕМ ПО ВАШЕМУ ВКУСУ</span><button type="button" class="foodReplay" aria-label="Повторить сборку">↻</button></div><div class="foodStageCaption" aria-live="polite"><b>Основа блюда</b><small>Визуализация · вид блюда может отличаться</small></div></div>';
   this.stack=root.querySelector('.foodLayers');this.title=root.querySelector('.foodStageCaption b');this.note=root.querySelector('.foodStageCaption small');
   root.querySelector('.foodReplay').onclick=()=>{if(this.last)this.play(...this.last);};
  }
  load(url){if(!this.cache.has(url)){this.cache.set(url,new Promise(resolve=>{const i=new Image();i.onload=()=>resolve(true);i.onerror=()=>{this.cache.delete(url);resolve(false);};i.src=url;}));}return this.cache.get(url);}
  cancel(){this.token++;this.stack.classList.remove('foodFolding');this.root.classList.remove('foodPlaying');this.root.querySelector('.foodReplay').disabled=false;}
  clear(){this.stack.replaceChildren();this.nodes.clear();}
  async update(builder,state,scene){this.cancel();const token=this.token;this.last=[builder,JSON.parse(JSON.stringify(state)),scene];const data=layers(builder,state,scene);
   if(!await this.load(data.layers[0]?.atlas||stock)||token!==this.token){if(token===this.token)this.note.textContent='Не удалось загрузить визуализацию';return;}
   this.sync(data.layers);this.title.textContent=data.layers.at(-1)?.label||'Ваше блюдо';
   this.note.textContent=data.missing.length?'В составе также: '+data.missing.join(', '):scene?.atlas_url?'Визуализация по фото заведения':'Визуализация · вид блюда может отличаться';
  }
  sync(items){const keys=new Set(items.map(x=>x.key));for(const [key,node]of this.nodes){if(!keys.has(key)){node.remove();this.nodes.delete(key);}}
   items.forEach((item,i)=>{let node=this.nodes.get(item.key);const isNew=!node;
    if(isNew){node=document.createElement('div');node.className='foodLayer';const cut=document.createElement('div');cut.className='foodCutout';node.append(cut);this.nodes.set(item.key,node);this.stack.append(node);}
    node.style.zIndex=String(i);const cut=node.firstChild;
    cut.style.backgroundImage='url('+JSON.stringify(item.atlas)+')';cut.style.backgroundSize=(item.grid*100)+'% '+(item.grid*100)+'%';
    cut.style.backgroundPosition=(item.cell%item.grid)/(item.grid-1)*100+'% '+Math.floor(item.cell/item.grid)/(item.grid-1)*100+'%';
    cut.style.transform='scale('+item.scale+')';
    if(isNew&&!reduced())node.animate([{opacity:0,transform:'translateY(-42px) scale(1.06)',filter:'blur(3px)'},{opacity:1,transform:'translateY(0) scale(1)',filter:'blur(0)'}],{duration:650,easing:'cubic-bezier(.18,.7,.2,1)',fill:'both'});
   });
  }
  async play(builder,state,scene,{finish=false}={}){
   this.cancel();const token=this.token;this.last=[builder,JSON.parse(JSON.stringify(state)),scene];const data=layers(builder,state,scene);
   const loaded=await this.load(data.layers[0]?.atlas||stock);
   if(token!==this.token)return false;
   if(!loaded){this.note.textContent='Визуализация недоступна · состав сохранён';return finish;}
   this.clear();this.root.classList.add('foodPlaying');this.root.querySelector('.foodReplay').disabled=true;
   const pause=ms=>new Promise(resolve=>setTimeout(resolve,reduced()?0:ms));
   for(let i=0;i<data.layers.length;i++){if(token!==this.token)return false;this.sync(data.layers.slice(0,i+1));this.title.textContent=data.layers[i].label;await pause(i?500:350);}
   if(token!==this.token)return false;
   if(finish){this.title.textContent='Завершаем сборку';this.stack.classList.add('foodFolding');await pause(850);}
   if(token!==this.token)return false;this.root.classList.remove('foodPlaying');this.root.querySelector('.foodReplay').disabled=false;
   return true;
  }
 }
 window.BuilderCinema={Scene,layers};
})();
