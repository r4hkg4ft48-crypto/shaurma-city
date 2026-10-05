(() => {
  const {api,money,esc}=SHAURMEG,tg=SHAURMEG.telegram,$=s=>document.querySelector(s);
  const qs=new URLSearchParams(location.search),marker=qs.get('marker'),est=qs.get('establishment');
  let ctx=null,session=sessionStorage.getItem('shaurmeg_client_session')||'',cart=[],category='all',fulfillment='cafe',builder=null,siteCustomization=null,pendingBuilt=null,builderResultOrigin='custom',builderMode='custom',signatureItems=[],signatureIndex=0,signatureAnimating=false,signaturePointerX=null,menuStream=null,orderStream=null,menuReloadTimer=null,activeOrderRows=[],favoriteIds=new Set(),pendingItem=null,itemSelectionState={},itemChoiceState={},builderState={type:'',bread:'',meat:'',sauces:[],extras:[]};

  let cinema=null,builderStep=0,building=false,buildAttempt=0;
  const cinemaForType=()=>ctx?.venue?.config?.builder_cinema?.find(x=>x.type_id===builderState.type);
  const THEME_KEYS=['emerald','amber','cobalt','cherry','violet','graphite','ocean','citrus'];
  const THEMES={
    emerald:{accent:'#54d9a0',accent2:'#eafff6',bg:'#120f18',panel:'#1a1420',panel2:'#241a2b',hero:'#25352f',glow:'rgba(84,217,160,.24)',ink:'#143326'},
    amber:{accent:'#ffb468',accent2:'#fff2dc',bg:'#151019',panel:'#211720',panel2:'#2d201d',hero:'#4b321e',glow:'rgba(255,180,104,.24)',ink:'#3b2410'},
    cobalt:{accent:'#6d8dff',accent2:'#e9eeff',bg:'#0f101a',panel:'#171927',panel2:'#20243a',hero:'#263f73',glow:'rgba(109,141,255,.27)',ink:'#17244e'},
    cherry:{accent:'#ff709f',accent2:'#ffe8f0',bg:'#160f17',panel:'#24151d',panel2:'#311b27',hero:'#5e2941',glow:'rgba(255,112,159,.25)',ink:'#451529'},
    violet:{accent:'#aa6cff',accent2:'#f1e8ff',bg:'#120d1a',panel:'#1d1426',panel2:'#291a37',hero:'#4a306c',glow:'rgba(170,108,255,.28)',ink:'#2d1749'},
    graphite:{accent:'#cfd3da',accent2:'#f5f7f8',bg:'#111216',panel:'#191b20',panel2:'#23262d',hero:'#39404a',glow:'rgba(207,211,218,.18)',ink:'#20242a'},
    ocean:{accent:'#58c9dc',accent2:'#e4fbff',bg:'#0d1218',panel:'#132028',panel2:'#17303a',hero:'#1c4b58',glow:'rgba(88,201,220,.24)',ink:'#10323a'},
    citrus:{accent:'#c9e768',accent2:'#f5fadf',bg:'#12140e',panel:'#1c2115',panel2:'#28301a',hero:'#40511e',glow:'rgba(201,231,104,.23)',ink:'#29330f'}
  };

  const cartKey='shaurmeg_cart_'+String(est||marker||'');
  try{cart=JSON.parse(localStorage.getItem(cartKey)||'[]')}catch{cart=[]}

  function toast(v){const el=$('#toast');if(!el)return;el.textContent=v;el.classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(()=>el.classList.remove('show'),1800)}
  function themeKey(seed){let h=2166136261;for(const ch of String(seed||'shaurmeg')){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)}return THEME_KEYS[Math.abs(h)%THEME_KEYS.length]}
  function cleanHex(v,fallback='#D94343'){const s=String(v||'').trim().toUpperCase();return /^#[0-9A-F]{6}$/.test(s)?s:fallback}
  function rgb(hex){const s=cleanHex(hex,'#000000').slice(1);return [parseInt(s.slice(0,2),16),parseInt(s.slice(2,4),16),parseInt(s.slice(4,6),16)]}
  function mixHex(a,b,t=.5){
    const A=rgb(a),B=rgb(b),p=Math.max(0,Math.min(1,Number(t)||0));
    return '#'+A.map((v,i)=>Math.round(v+(B[i]-v)*p).toString(16).padStart(2,'0')).join('').toUpperCase();
  }
  function rgba(hex,a=.25){const c=rgb(hex);return 'rgba('+c[0]+','+c[1]+','+c[2]+','+Math.max(0,Math.min(1,a))+')'}
  function colorDistance(a,b){const A=rgb(a),B=rgb(b);return Math.sqrt((A[0]-B[0])**2+(A[1]-B[1])**2+(A[2]-B[2])**2)}
  function luminance(hex){
    const c=rgb(hex).map(v=>{v/=255;return v<=.03928?v/12.92:Math.pow((v+.055)/1.055,2.4)});
    return .2126*c[0]+.7152*c[1]+.0722*c[2];
  }
  function contrastText(hex){return luminance(hex)>.46?'#142033':'#FFFFFF'}
  function customTheme(config={}){
    const key=THEMES[config.theme_key]?config.theme_key:themeKey(est),legacy=THEMES[key]||THEMES.cobalt;
    if(!(config.theme&&typeof config.theme==='object'))return {primary:legacy.accent,secondary:legacy.hero,tone:'balanced',legacyKey:key};
    let primary=cleanHex(config.theme.primary,legacy.accent),secondary=cleanHex(config.theme.secondary,legacy.hero);
    if(colorDistance(primary,secondary)<58)secondary=colorDistance(primary,'#13233B')>=58?'#13233B':'#D94343';
    return {primary,secondary,tone:['dark','light','balanced'].includes(config.theme.tone)?config.theme.tone:'balanced',legacyKey:key};
  }
  function derivedPalette(theme){
    const primary=theme.primary,secondary=theme.secondary,tone=theme.tone;
    let bg,panel,panel2,hero;
    if(tone==='light'){
      bg=mixHex(secondary,'#FFFFFF',.91);panel=mixHex(secondary,'#FFFFFF',.96);panel2=mixHex(secondary,'#FFFFFF',.86);
      hero=mixHex(mixHex(secondary,primary,.26),'#101721',.58);
    }else if(tone==='dark'){
      bg=mixHex(secondary,'#070A10',.72);panel=mixHex(bg,'#FFFFFF',.055);panel2=mixHex(bg,'#FFFFFF',.105);
      hero=mixHex(mixHex(secondary,primary,.18),'#080B11',.42);
    }else{
      bg=mixHex(secondary,'#090C13',.66);panel=mixHex(bg,'#FFFFFF',.06);panel2=mixHex(bg,'#FFFFFF',.11);
      hero=mixHex(mixHex(secondary,primary,.22),'#090D14',.3);
    }
    const ink=contrastText(primary),accent2=ink==='#FFFFFF'?mixHex(primary,'#000000',.12):mixHex(primary,'#FFFFFF',.15);
    return {accent:primary,accent2,bg,panel,panel2,hero,glow:rgba(primary,.27),ink,primary,secondary};
  }
  function applyTheme(config={}){
    const theme=customTheme(config),t=derivedPalette(theme),root=document.documentElement;
    document.body.dataset.theme=theme.legacyKey||'custom';document.body.dataset.tone=theme.tone;
    for(const [k,v] of Object.entries(t))root.style.setProperty('--venue-'+k,v);
    root.style.setProperty('--venue-secondary',theme.secondary);
    root.style.setProperty('--venue-primary',theme.primary);
    root.style.setProperty('--accent',t.accent);root.style.setProperty('--accent2',t.accent2);
    const meta=document.querySelector('meta[name="theme-color"]');if(meta)meta.content=t.bg;
    try{tg?.setHeaderColor?.(t.bg);tg?.setBackgroundColor?.(t.bg)}catch{}
  }
  function siteConfig(config={}){
    const src=config.site_customization&&typeof config.site_customization==='object'?config.site_customization:{};
    const d=src.design&&typeof src.design==='object'?src.design:{},m=src.menu&&typeof src.menu==='object'?src.menu:{},r=src.builder_result&&typeof src.builder_result==='object'?src.builder_result:{};
    return {
      design:{mode:['cinematic','minimal','editorial','glass'].includes(d.mode)?d.mode:'cinematic',background_image:String(d.background_image||''),ambient_strength:Number.isFinite(Number(d.ambient_strength))?Number(d.ambient_strength):.16,radius:Number(d.radius)||20,panel_opacity:Number.isFinite(Number(d.panel_opacity))?Number(d.panel_opacity):.9,contrast:Number.isFinite(Number(d.contrast))?Number(d.contrast):1},
      menu:{layout:['hero-2-3','hero-2','uniform-2','uniform-3'].includes(m.layout)?m.layout:'hero-2-3',card_style:['photo','glass','solid'].includes(m.card_style)?m.card_style:'photo',image_fit:['cover','contain'].includes(m.image_fit)?m.image_fit:'cover',show_descriptions:m.show_descriptions!==false,hero_label:String(m.hero_label||'НАША ГОРДОСТЬ')},
      builder_result:{enabled:r.enabled!==false,image:String(r.image||''),title:String(r.title||'Твоя шаурма готова'),subtitle:String(r.subtitle||'Сборка завершена. Осталось добавить её в корзину.'),singularity:r.singularity!==false,duration_ms:Math.max(650,Math.min(1800,Number(r.duration_ms)||1050))},
      features:src.features&&typeof src.features==='object'?src.features:{}
    };
  }
  function cssImage(v){
    const s=String(v||'').trim();
    if(!(s.startsWith('data:image/')||s.startsWith('https://')))return '';
    return 'url("'+s.replace(/["\\]/g,'')+'")';
  }
  function applySiteCustomization(config={}){
    siteCustomization=siteConfig(config);
    const d=siteCustomization.design,m=siteCustomization.menu,root=document.documentElement,body=document.body;
    body.dataset.siteMode=d.mode;body.dataset.menuLayout=m.layout;body.dataset.cardStyle=m.card_style;body.dataset.menuDescriptions=m.show_descriptions?'show':'hide';
    root.style.setProperty('--site-radius',Math.max(10,Math.min(34,d.radius))+'px');
    root.style.setProperty('--site-ambient',String(Math.max(0,Math.min(.5,d.ambient_strength))));
    root.style.setProperty('--site-panel-opacity',String(Math.max(.45,Math.min(.99,d.panel_opacity))));
    root.style.setProperty('--site-contrast',String(Math.max(.8,Math.min(1.3,d.contrast))));
    const bg=cssImage(d.background_image);if(bg)root.style.setProperty('--site-background-image',bg);else root.style.removeProperty('--site-background-image');
  }

  function cartStats(){return {count:cart.reduce((s,x)=>s+(Number(x.q)||0),0),total:cart.reduce((s,x)=>s+(Number(x.p)||0)*(Number(x.q)||0),0)}}
  function save(){localStorage.setItem(cartKey,JSON.stringify(cart));renderCart()}
  let sheetScrollY=0,sheetLocked=false;
  function lockSheetBackground(){
    if(sheetLocked)return;sheetLocked=true;
    sheetScrollY=Math.max(0,window.scrollY||document.documentElement.scrollTop||0);
    document.documentElement.classList.add('sheetOpen');
    document.body.classList.add('sheetOpen');
    document.body.style.top=(-sheetScrollY)+'px';
    try{tg?.disableVerticalSwipes?.()}catch{}
  }
  function unlockSheetBackground(){
    if(!sheetLocked)return;sheetLocked=false;
    document.documentElement.classList.remove('sheetOpen');
    document.body.classList.remove('sheetOpen');
    document.body.style.top='';
    try{window.scrollTo(0,sheetScrollY)}catch{}
    try{tg?.enableVerticalSwipes?.()}catch{}
  }
  function openSheet(id){
    lockSheetBackground();
    $('#backdrop').classList.add('show');
    document.querySelectorAll('.sheet').forEach(x=>x.classList.toggle('show',x.id===id));
  }
  function closeSheets(){
    buildAttempt++;cinema?.cancel();building=false;if($('#addBuilder'))$('#addBuilder').disabled=false;
    $('#backdrop').classList.remove('show');
    document.querySelectorAll('.sheet').forEach(x=>x.classList.remove('show'));
    unlockSheetBackground();
  }

  async function authTelegram(){
    if(!tg?.initData)return !!session;
    try{
      const r=await fetch(api+'/auth/telegram',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({initData:tg.initData})});
      if(!r.ok)return !!session;
      const j=await r.json();session=j.session;sessionStorage.setItem('shaurmeg_client_session',session);
      if(j.user?.first_name&&!$('#customer').value)$('#customer').value=j.user.first_name;
      return true;
    }catch{return !!session}
  }
  function favoriteHeaders(){return session?{Authorization:'Bearer '+session}:{}}
  async function loadFavoriteState(){
    if(!session||!est){favoriteIds=new Set();renderMenu();return}
    try{
      const r=await fetch(api+'/me/favorites',{headers:favoriteHeaders(),cache:'no-store'});if(!r.ok)throw 0;
      const j=await r.json(),prefix=String(est)+':';
      favoriteIds=new Set((Array.isArray(j.explicit)?j.explicit:[]).filter(x=>String(x).startsWith(prefix)).map(x=>String(x).slice(prefix.length)));
    }catch{favoriteIds=new Set()}
    renderMenu();
  }
  async function toggleFavorite(id){
    if(!session)return toast('Откройте Shaurmeg через Telegram, чтобы сохранять избранное');
    const itemId=String(id),active=favoriteIds.has(itemId),method=active?'DELETE':'PUT';
    try{
      const r=await fetch(api+'/me/favorites/'+encodeURIComponent(est)+'/'+encodeURIComponent(itemId),{method,headers:favoriteHeaders()});
      if(!r.ok)throw 0;
      if(active)favoriteIds.delete(itemId);else favoriteIds.add(itemId);
      renderMenu();toast(active?'Убрано из избранного':'Добавлено в избранное ♥');tg?.HapticFeedback?.selectionChanged?.();
    }catch{toast('Не удалось изменить избранное')}
  }

  function builderConfig(config={}){
    if(config.builder_enabled===false)return null;
    if(config.builder_enabled!==true&&!config.builder)return null;
    const fallback={
      title:'Собери свою шаурму',subtitle:'Выбери основу, лаваш, мясо, соусы и добавки',
      types:[{id:'shawarma',name:'Шаурма',price:330},{id:'flatbread',name:'Лепёшка',price:320}],
      breads:[{id:'classic_lavash',name:'Классический лаваш',price:0}],
      meats:[{id:'chicken',name:'Курица',price:0}],
      sauces:[{id:'standard',name:'Стандартные соусы',price:0},{id:'big_tasty',name:'Биг Тейсти',price:0},{id:'bbq',name:'Барбекю',price:0},{id:'pomegranate',name:'Гранатовый',price:0},{id:'cheese',name:'Сырный',price:0},{id:'garlic',name:'Чесночный',price:0}],
      extras:[{id:'fries',name:'Картошка фри',price:0},{id:'jalapeno',name:'Халапеньо',price:0},{id:'onion',name:'Лук',price:0},{id:'cheese',name:'Сыр',price:0}],
      min_sauces:1,max_sauces:6,max_extras:4
    };
    const raw=config.builder&&typeof config.builder==='object'?config.builder:{};
    const normalize=(key,base)=>Array.isArray(raw[key])?raw[key].map((x,i)=>({id:String(x.id||key+'_'+i),name:String(x.name||x.n||'Опция'),price:Number(x.price??x.price_delta??x.p)||0})):base.map(x=>({...x}));
    const rawTypes=normalize('types',fallback.types),types=rawTypes.length?rawTypes:fallback.types.map(x=>({...x})),breads=normalize('breads',fallback.breads),meats=normalize('meats',fallback.meats),sauces=normalize('sauces',fallback.sauces),extras=normalize('extras',fallback.extras);
    const maxSauces=sauces.length?(Number.isFinite(Number(raw.max_sauces))?Math.max(0,Math.min(sauces.length,Number(raw.max_sauces))):sauces.length):0;
    return {
      title:String(raw.title||fallback.title),subtitle:String(raw.subtitle||fallback.subtitle),
      types,breads,meats,sauces,extras,
      min_sauces:Number.isFinite(Number(raw.min_sauces))?Math.max(0,Math.min(maxSauces,Number(raw.min_sauces))):(sauces.length?fallback.min_sauces:0),
      max_sauces:maxSauces,
      max_extras:extras.length?(Number.isFinite(Number(raw.max_extras))?Math.max(0,Math.min(extras.length,Number(raw.max_extras))):extras.length):0
    };
  }
  function option(list,id){return (list||[]).find(x=>String(x.id)===String(id))||null}
  function optionName(list,id){return option(list,id)?.name||id}
  function optionPrice(list,id){return Number(option(list,id)?.price)||0}
  function optionPriceText(x,base=false){
    const p=Number(x?.price)||0;
    return base?money(p):(p>0?'+ '+money(p):'Без доплаты');
  }
  function signatureImage(x){
    return String(x?.image||ctx?.marker?.hero_image||'assets/menu-shawarma.webp');
  }
  function signatureCollection(){
    const menu=(ctx?.venue?.menu||[]).filter(x=>x&&x.active!==false);
    const sections=new Map((ctx?.venue?.sections||[]).map(x=>[String(x.id),x]));
    const configured=Array.isArray(ctx?.venue?.config?.signature_item_ids)?ctx.venue.config.signature_item_ids.map(String):[];
    const byId=new Map(menu.map(x=>[String(x.id),x])),seen=new Set(),out=[];
    const add=x=>{if(!x)return;const id=String(x.id||'');if(!id||seen.has(id))return;seen.add(id);out.push(x)};
    configured.forEach(id=>add(byId.get(id)));
    const score=x=>{
      const section=sections.get(String(x.c||x.category||''))||{};
      const hay=(String(x.n||x.name||'')+' '+String(section.name||'')+' '+String(x.c||x.category||'')+' '+String(x.badge||x.tag||'')).toLowerCase();
      let s=0;
      if(/фирм|signature|шеф|special/.test(hay))s+=90;
      if(x.featured===true)s+=55;
      if(/шаур|шаверм|донер|кебаб|ролл|wrap|леп[её]ш/.test(hay))s+=35;
      if(/напит|соус|добав|доп|фри|карто|выпеч|десерт|самс|чебур|беляш|кофе|чай|сок|вода|кола/.test(hay))s-=120;
      if(x.image)s+=18;
      return s;
    };
    menu.map((x,i)=>({x,i,s:score(x)})).sort((a,b)=>b.s-a.s||a.i-b.i).forEach(v=>{if(v.s>-100)add(v.x)});
    return out.slice(0,10);
  }
  function fillSignatureCard(){
    const card=$('#signatureCard'),count=signatureItems.length;
    if(!card)return;
    if(!count){
      card.innerHTML='<div class="signaturePhoto"><div class="signaturePhotoFallback"><div><b>SHAURMEG</b><small>Фирменные позиции пока не настроены</small></div></div></div><div class="signatureCardBody"><small>ФИРМЕННАЯ КОЛЛЕКЦИЯ</small><h3>Пока пусто</h3><p>Добавьте основные позиции меню с фотографиями — они появятся здесь автоматически.</p><div class="signatureCardPrice"><b>—</b></div></div>';
      $('#signatureCounter').textContent='00 / 00';$('#signatureDots').innerHTML='';$('#chooseSignature').disabled=true;$('#signaturePrev').disabled=true;$('#signatureNext').disabled=true;return;
    }
    signatureIndex=((signatureIndex%count)+count)%count;
    const x=signatureItems[signatureIndex],name=String(x.n||x.name||'Фирменная шаурма'),desc=String(x.d||x.description||'Фирменное сочетание этого заведения'),img=signatureImage(x),badge=String(x.badge||x.tag||'');
    card.innerHTML='<div class="signaturePhoto">'+
      (img?'<img src="'+esc(img)+'" alt="" draggable="false" onerror="this.remove()">':'<div class="signaturePhotoFallback"><div><b>SHAURMEG</b><small>'+esc(name)+'</small></div></div>')+
      '<span class="signaturePhotoShade"></span><span class="signatureCardBadge">ФИРМЕННАЯ · '+String(signatureIndex+1).padStart(2,'0')+'</span></div>'+
      '<div class="signatureCardBody"><small>ВЫБОР ЗАВЕДЕНИЯ</small><h3>'+esc(name)+'</h3><p>'+esc(desc)+'</p><div class="signatureCardPrice"><b>'+money(x.p??x.price)+'</b><span>'+esc(badge||'готовая сборка')+'</span></div></div>';
    $('#signatureCounter').textContent=String(signatureIndex+1).padStart(2,'0')+' / '+String(count).padStart(2,'0');
    $('#signatureDots').innerHTML=signatureItems.map((_,i)=>'<button type="button" class="'+(i===signatureIndex?'active':'')+'" data-signature-dot="'+i+'" aria-label="Фирменная '+(i+1)+'"></button>').join('');
    $('#chooseSignature').disabled=false;$('#signaturePrev').disabled=count<2;$('#signatureNext').disabled=count<2;
  }
  function shiftSignature(delta){
    const count=signatureItems.length,card=$('#signatureCard');if(count<2||signatureAnimating||!card)return;
    signatureAnimating=true;
    const outClass=delta>0?'signatureOutNext':'signatureOutPrev',inClass=delta>0?'signatureInNext':'signatureInPrev';
    card.classList.remove('signatureOutNext','signatureOutPrev','signatureInNext','signatureInPrev');
    card.classList.add(outClass);
    setTimeout(()=>{
      signatureIndex=(signatureIndex+delta+count)%count;
      fillSignatureCard();
      card.classList.remove(outClass);
      card.classList.add(inClass);
      void card.offsetWidth;
      requestAnimationFrame(()=>card.classList.remove(inClass));
      setTimeout(()=>{signatureAnimating=false},300);
    },175);
    tg?.HapticFeedback?.selectionChanged?.();
  }
  function setBuilderMode(mode){
    if(mode==='signature'&&!signatureItems.length){toast('Фирменные позиции пока не настроены');return}
    if(building)return;
    builderMode=mode==='signature'?'signature':'custom';
    document.querySelectorAll('#builderModeSwitch [data-builder-mode]').forEach(b=>b.classList.toggle('active',b.dataset.builderMode===builderMode));
    $('#builderCustomMode').hidden=builderMode!=='custom';
    $('#builderSignatureMode').hidden=builderMode!=='signature';
    if(builderMode==='signature'){cinema?.cancel();fillSignatureCard();try{$('#builderSheet').scrollTo({top:0,behavior:'smooth'})}catch{}}
  }
  function chooseSignature(){
    const src=signatureItems[signatureIndex];if(!src)return;
    const payload={
      id:String(src.id),
      n:String(src.n||src.name||'Фирменная шаурма'),
      p:Number(src.p??src.price)||0,
      q:1,
      detail:String(src.d||src.description||'Фирменная позиция').slice(0,500),
      previewImage:signatureImage(src),
      signature:true
    };
    showBuilderResult(payload,'signature');
  }
  function builderTotal(){
    if(!builder)return 0;
    const type=option(builder.types,builderState.type);
    return (Number(type?.price)||0)+optionPrice(builder.breads,builderState.bread)+optionPrice(builder.meats,builderState.meat)+
      builderState.sauces.reduce((s,id)=>s+optionPrice(builder.sauces,id),0)+builderState.extras.reduce((s,id)=>s+optionPrice(builder.extras,id),0);
  }
  function renderBuilder(){
    if(building)return;
    if(!builder)return;
    const type=option(builder.types,builderState.type)||builder.types[0];
    if(!builderState.type)builderState.type=String(type?.id||'');
    if(!builderState.bread)builderState.bread=String(builder.breads?.[0]?.id||'');
    if(!builderState.meat)builderState.meat=String(builder.meats?.[0]?.id||'');
    $('#builderTypes').innerHTML=(builder.types||[]).map(x=>'<button class="builderChoice '+(String(x.id)===builderState.type?'active':'')+'" data-btype="'+esc(x.id)+'"><b>'+esc(x.name)+'</b><small>'+optionPriceText(x,true)+'</small></button>').join('');
    $('#builderBreads').innerHTML=(builder.breads||[]).map(x=>'<button class="builderChoice '+(String(x.id)===builderState.bread?'active':'')+'" data-bbread="'+esc(x.id)+'"><b>'+esc(x.name)+'</b><small>'+optionPriceText(x)+'</small></button>').join('');
    $('#builderMeats').innerHTML=(builder.meats||[]).map(x=>'<button class="builderChoice '+(String(x.id)===builderState.meat?'active':'')+'" data-bmeat="'+esc(x.id)+'"><b>'+esc(x.name)+'</b><small>'+optionPriceText(x)+'</small></button>').join('');
    $('#builderSauces').innerHTML=(builder.sauces||[]).map(x=>'<button class="builderChoice '+(builderState.sauces.includes(String(x.id))?'active':'')+'" data-bsauce="'+esc(x.id)+'"><b>'+esc(x.name)+'</b><small>'+optionPriceText(x)+'</small></button>').join('');
    $('#builderExtras').innerHTML=(builder.extras||[]).map(x=>'<button class="builderChoice '+(builderState.extras.includes(String(x.id))?'active':'')+'" data-bextra="'+esc(x.id)+'"><b>'+esc(x.name)+'</b><small>'+optionPriceText(x)+'</small></button>').join('');
    $('#builderBreadBlock').classList.toggle('hidden',!(builder.breads||[]).length);
    $('#builderMeatBlock').classList.toggle('hidden',!(builder.meats||[]).length);
    $('#builderSauces').closest('.builderBlock')?.classList.toggle('hidden',!(builder.sauces||[]).length);
    $('#builderIngredientsBlock').classList.toggle('hidden',!(builder.extras||[]).length);
    $('#builderPrice').textContent=money(builderTotal());
    const bread=optionName(builder.breads,builderState.bread),meat=optionName(builder.meats,builderState.meat);
    $('#builderSummary').textContent=[type?.name,bread,meat].filter(Boolean).join(' · ');
    renderBuilderStep();
    const min=Math.max(0,Number(builder.min_sauces)||0);
    $('#sauceHint').textContent=builderState.sauces.length?'Соусы: '+builderState.sauces.map(id=>optionName(builder.sauces,id)).join(', '):(min?'Выбери минимум '+min+' соус'+(min===1?'':'а'):'Соус можно не добавлять');
  }
  function renderBuilderStep(){
    const blocks=[...document.querySelectorAll('#builderCustomMode .builderBlock')];
    const labels=['ФОРМАТ','ЛАВАШ','МЯСО','СОУСЫ','ДОБАВКИ'];
    blocks.forEach((b,i)=>{b.hidden=i!==builderStep;});
    $('#builderStepLabel').textContent=String(builderStep+1).padStart(2,'0')+' / 05 · '+labels[builderStep];
    $('#builderStepDots').innerHTML=labels.map((_,i)=>'<i class="'+(i<=builderStep?'active':'')+'"></i>').join('');
    $('#builderStepNext').hidden=builderStep===4;$('#addBuilder').hidden=builderStep!==4;
    if(!cinema)cinema=new BuilderCinema.Scene($('#builderCinema'));
    cinema.update(builder,{...builderState,meat:builderStep>=2?builderState.meat:''},cinemaForType());
  }
  function changeBuilderStep(delta){
    if(building)return;
    if(delta>0&&builderStep===3&&builderState.sauces.length<builder.min_sauces)return toast('Выберите соусов: минимум '+builder.min_sauces);
    if(builderStep===0&&delta<0)return closeSheets();
    do{builderStep=Math.max(0,Math.min(4,builderStep+delta));}
    while(builderStep>0&&builderStep<4&&!builder[['types','breads','meats','sauces','extras'][builderStep]]?.length);
    renderBuilderStep();$('#builderSheet').scrollTo({top:0,behavior:'smooth'});
  }
  function openBuilder(startMode='custom'){
    if(!builder)return;
    buildAttempt++;building=false;builderStep=0;cinema?.cancel();$('#addBuilder').disabled=false;
    builderState={type:String(builder.types?.[0]?.id||''),bread:String(builder.breads?.[0]?.id||''),meat:String(builder.meats?.[0]?.id||''),sauces:[],extras:[]};
    pendingBuilt=null;builderResultOrigin='custom';signatureIndex=0;signatureItems=signatureCollection();
    const signatureLabel=document.querySelector('#builderModeSwitch [data-builder-mode="signature"] b');
    if(signatureLabel)signatureLabel.textContent=signatureItems.length===10?'10 фирменных':(signatureItems.length?signatureItems.length+' фирменных':'Фирменные');
    const signatureButton=document.querySelector('#builderModeSwitch [data-builder-mode="signature"]');if(signatureButton)signatureButton.disabled=!signatureItems.length;
    $('#builderStage').hidden=false;$('#builderStage').classList.remove('builderCollapsing');$('#builderResult').hidden=true;
    renderBuilder();openSheet('builderSheet');setBuilderMode(startMode==='signature'&&signatureItems.length?'signature':'custom');
    $('#builderSheet').scrollTo({top:0,behavior:'instant'});
  }
  function toggleBuilder(list,id,max){id=String(id);const i=list.indexOf(id);if(i>=0)list.splice(i,1);else if(list.length<max)list.push(id);else toast('Достигнут максимум');renderBuilder()}
  function builtPayload(){
    if(!builder)return null;
    const min=Math.max(0,Number(builder.min_sauces)||0);if(builderState.sauces.length<min){toast('Нужно выбрать соусов: минимум '+min);return null}
    const type=option(builder.types,builderState.type);if(!type)return null;
    const bread=option(builder.breads,builderState.bread),meat=option(builder.meats,builderState.meat);
    const parts=[];
    if(bread)parts.push('Лаваш: '+bread.name);
    if(meat)parts.push('Мясо: '+meat.name);
    parts.push('Соусы: '+(builderState.sauces.length?builderState.sauces.map(id=>optionName(builder.sauces,id)).join(', '):'без соусов'));
    parts.push('Добавки: '+(builderState.extras.length?builderState.extras.map(id=>optionName(builder.extras,id)).join(', '):'без добавок'));
    return {id:'custom_'+Date.now(),n:type.name+' · своя сборка',p:builderTotal(),q:1,detail:parts.join(' · '),builderData:{type:builderState.type,bread:builderState.bread,meat:builderState.meat,sauces:[...builderState.sauces],extras:[...builderState.extras]}};
  }
  function showBuilderResult(payload,origin='custom'){
    const r=siteCustomization?.builder_result||{};
    pendingBuilt=payload;builderResultOrigin=origin;
    const isSignature=origin==='signature'||payload?.signature===true;
    const img=String(payload?.previewImage||(isSignature?'':cinemaForType()?.reference_url||r.image)||ctx?.marker?.hero_image||'assets/menu-shawarma.webp');
    $('#builderResultImg').src=img;
    $('#builderResultTitle').textContent=isSignature?payload.n:(r.title||'Твоя шаурма готова');
    $('#builderResultSubtitle').textContent=isSignature?(payload.detail||'Фирменная шаурма выбрана. Осталось добавить её в корзину.'):(r.subtitle||'Сборка завершена. Осталось добавить её в корзину.');
    $('#builderResultSummary').textContent=payload.n;$('#builderResultPrice').textContent=money(payload.p);
    $('#builderStage').hidden=true;$('#builderStage').classList.remove('builderCollapsing');$('#builderResult').hidden=false;
    try{$('#builderSheet').scrollTo({top:0,behavior:'smooth'})}catch{}
    tg?.HapticFeedback?.notificationOccurred?.('success');
  }
  async function previewBuilt(){
    if(building)return;
    const payload=builtPayload();if(!payload)return;
    const attempt=++buildAttempt;building=true;$('#addBuilder').disabled=true;
    $('#builderCustomMode').querySelectorAll('.builderChoice').forEach(b=>b.disabled=true);
    $('#builderSheet').scrollTo({top:0,behavior:'smooth'});
    const complete=await cinema.play(builder,builderState,cinemaForType(),{finish:true});
    if(attempt!==buildAttempt)return;
    building=false;$('#addBuilder').disabled=false;
    $('#builderCustomMode').querySelectorAll('.builderChoice').forEach(b=>b.disabled=false);
    if(complete&&$('#builderSheet').classList.contains('show'))showBuilderResult(payload);
  }
  function confirmBuilt(){
    if(!pendingBuilt)return;
    cart.push(pendingBuilt);pendingBuilt=null;save();closeSheets();toast('Сборка добавлена ✓');tg?.HapticFeedback?.notificationOccurred?.('success');
  }
  function editBuilt(){
    const origin=builderResultOrigin;pendingBuilt=null;$('#builderResult').hidden=true;$('#builderStage').hidden=false;$('#builderStage').classList.remove('builderCollapsing');renderBuilder();setBuilderMode(origin==='signature'?'signature':'custom');
    try{$('#builderSheet').scrollTo({top:0,behavior:'smooth'})}catch{}
  }

  async function load(){
    if(!marker||!est)throw new Error('Не выбрана точка');
    const r=await fetch(api+'/menu-context?marker_id='+encodeURIComponent(marker)+'&establishment_id='+encodeURIComponent(est),{cache:'no-store'});
    if(!r.ok)throw new Error('Меню этой точки недоступно');
    ctx=await r.json();applyTheme(ctx.venue.config||{});applySiteCustomization(ctx.venue.config||{});
    $('#topName').textContent=ctx.venue.name;
    $('#topAddress').textContent=ctx.marker.address||'МЕНЮ';
    $('#venueName').textContent=ctx.venue.name;
    $('#venueMeta').textContent=ctx.marker.description||ctx.marker.address||'';
    $('#checkoutVenue').textContent=ctx.venue.name;
    $('#checkoutAddress').textContent=ctx.marker.address||'';
    if(ctx.marker.hours){$('#venueHours').textContent=ctx.marker.hours;$('#venueHours').classList.remove('hidden')}
    if(ctx.marker.price_label){$('#venuePrice').textContent=ctx.marker.price_label;$('#venuePrice').classList.remove('hidden')}
    if(ctx.marker.hero_image){$('#heroImg').src=ctx.marker.hero_image;$('#heroImg').classList.remove('hidden')}
    else $('#hero').classList.add('heroNoImage');
    builder=builderConfig(ctx.venue.config||{});signatureItems=signatureCollection();$('#builderEntry').classList.toggle('hidden',!builder);
    $('#openSignatureBuilder').classList.toggle('hidden',!builder||!signatureItems.length);
    if(builder){
      $('#builderEntryTitle').textContent=builder.title||'Собери свою шаурму';$('#builderEntrySubtitle').textContent=builder.subtitle||'Основа → лаваш → мясо → соусы → добавки';
      $('#signatureEntryTitle').textContent=signatureItems.length===10?'10 фирменных':signatureItems.length+' фирменных';
    }
    const menu=(ctx.venue.menu||[]).filter(x=>x.active!==false),sections=Array.isArray(ctx.venue.sections)?ctx.venue.sections:[];
    const usedCats=new Set(menu.map(x=>String(x.c||x.category||'')).filter(Boolean));
    const visibleSections=sections.filter(x=>usedCats.has(String(x.id)));
    if(category!=='all'&&!visibleSections.some(x=>String(x.id)===String(category)))category='all';
    $('#menuCount').textContent=menu.length+' позиций';
    $('#chips').innerHTML='<button class="chip '+(category==='all'?'active':'')+'" data-cat="all"><span>Все</span></button>'+visibleSections.map(x=>'<button class="chip '+(String(x.id)===String(category)?'active':'')+'" data-cat="'+esc(x.id)+'">'+(x.cover?'<img class="chipPhoto" src="'+esc(x.cover)+'" alt="">':'')+'<span>'+esc(x.name)+'</span></button>').join('');
    if(ctx.marker.hero_image){
      $('#menuSection')?.style.setProperty('--menu-atmosphere','url("'+String(ctx.marker.hero_image).replace(/["\\]/g,'')+'")');
    }
    renderMenu();renderCart();
  }

  function renderMenu(){
    const all=(ctx?.venue?.menu||[]).filter(x=>x.active!==false);
    const visible=all.filter(x=>category==='all'||String(x.c||x.category)===category);
    const sections=Array.isArray(ctx?.venue?.sections)?ctx.venue.sections:[];
    const sectionById=new Map(sections.map(x=>[String(x.id),x]));
    if(category==='all')applyTheme(ctx?.venue?.config||{});
    else{
      const sectionTheme=sectionById.get(String(category))||{},root=document.documentElement;
      const accent=cleanHex(sectionTheme.accent,'#8FE0A9'),hero=cleanHex(sectionTheme.color,'#152A3A');
      root.style.setProperty('--venue-accent',accent);root.style.setProperty('--accent',accent);
      root.style.setProperty('--venue-hero',hero);root.style.setProperty('--venue-glow',rgba(accent,.27));root.style.setProperty('--venue-ink',contrastText(accent));
    }

    const kindFor=x=>{
      const name=String(x.n||x.name||'').toLowerCase();
      const section=sectionById.get(String(x.c||x.category||''))||{};
      const cat=(String(section.name||'')+' '+String(x.c||x.category||'')).toLowerCase();
      const hay=name+' '+cat;
      if(/напит|cola|кола|компот|морс|сок|вода|чай|кофе/.test(hay))return 'drink';
      if(/соус/.test(hay))return 'sauce';
      if(/самс|чебур|беляш|выпеч|бурек|пирож|десерт/.test(hay))return 'pastry';
      if(/леп|тарел|хлеб|лаваш/.test(hay))return 'flatbread';
      return 'shawarma';
    };
    const isMain=x=>{
      if(x.display==='main')return true;
      if(x.display==='compact')return false;
      const section=sectionById.get(String(x.c||x.category||''))||{};
      const hay=(String(section.name||'')+' '+String(x.n||x.name||'')).toLowerCase();
      if(/доп|напит|выпеч|соус|десерт|самс|чебур|беляш|карто|фри/.test(hay))return false;
      const kind=kindFor(x);
      return kind==='shawarma'||kind==='flatbread';
    };
    const fallbackFor=x=>{
      const kind=kindFor(x);
      if(kind==='flatbread'||kind==='pastry')return 'assets/menu-flatbread.webp';
      if(kind==='shawarma')return 'assets/menu-shawarma.webp';
      return '';
    };
    const imageFor=x=>String(x.image||fallbackFor(x)||ctx?.marker?.hero_image||'');
    const photo=x=>{
      const src=imageFor(x),kind=kindFor(x),fit=x.image_fit||siteCustomization?.menu?.image_fit||'cover';
      return '<div class="foodPic '+(!x.image?'foodPicFallback ':'')+'kind-'+kind+' fit-'+fit+'">'+
        (src?'<img src="'+esc(src)+'" alt="" loading="lazy" onerror="this.remove()">':'<span class="foodNoPhoto"><b>SHAURMEG</b><small>'+esc(String(x.n||x.name||'Меню'))+'</small></span>')+
        '<i></i></div>';
    };
    const badgeFor=x=>siteCustomization?.features?.menu_badges===false?'':String(x.badge||x.tag||'').trim();
    const card=(x,mode)=>{
      const id=String(x.id),name=String(x.n||x.name||'Позиция'),description=String(x.d||x.description||''),unavailable=itemUnavailable(x),hasOptions=hasItemOptions(x);
      const meta=[String(x.weight||'').trim(),...(Array.isArray(x.tags)?x.tags.slice(0,2):[])].filter(Boolean);
      const badge=badgeFor(x),cls=mode==='main'?'foodCardMain':'foodCardOther';
      return '<article class="foodCard foodCardRef '+cls+' kind-'+kindFor(x)+(unavailable?' unavailable':'')+'">'+
        '<div class="foodVisual">'+photo(x)+(badge?'<strong class="foodBadge">'+esc(badge)+'</strong>':'')+(unavailable?'<strong class="foodSoldOut">Нет в наличии</strong>':'')+'</div>'+
        '<div class="foodBody">'+
          '<div class="foodTitle"><h3>'+esc(name)+'</h3>'+(siteCustomization?.features?.favorites===false?'':'<button class="foodFavorite '+(favoriteIds.has(id)?'active':'')+'" data-favorite="'+esc(id)+'" aria-label="'+(favoriteIds.has(id)?'Убрать из избранного':'Добавить в избранное')+'">♥</button>')+'</div>'+
          '<p>'+esc(description)+'</p>'+
          (meta.length?'<div class="foodMeta">'+meta.map(v=>'<span>'+esc(v)+'</span>').join('')+'</div>':'')+
          '<div class="foodRow"><b>'+(hasOptions?'от ':'')+money(x.p??x.price)+'</b><button class="addBtn" data-add="'+esc(id)+'" aria-label="Добавить '+esc(name)+'" '+(unavailable?'disabled':'')+'>'+(unavailable?'×':hasOptions?'Выбрать':'+')+'</button></div>'+
        '</div></article>';
    };

    if(!visible.length){
      $('#menuFeature').innerHTML='';
      $('#menuGrid').innerHTML='<div class="empty menuEmpty">В разделе пока нет позиций</div>';
      return;
    }

    let rest=visible;
    if(category==='all'){
      const feature=visible.find(x=>x.featured===true)||visible[0];
      const featureId=String(feature.id),featureName=String(feature.n||feature.name||'Позиция'),featureDesc=String(feature.d||feature.description||'');
      const featureImage=imageFor(feature);
      const featureKind=kindFor(feature);
      $('#menuFeature').innerHTML=
        '<article class="menuFeatureCard kind-'+featureKind+'">'+
          '<div class="menuFeaturePhoto '+(!feature.image?'foodPicFallback':'')+'">'+
            (featureImage?'<img src="'+esc(featureImage)+'" alt="" loading="eager" onerror="this.remove()">':'<div class="menuFeatureFallback"><b>SHAURMEG</b></div>')+
            '<span class="menuFeatureShade"></span>'+
          '</div>'+
          '<div class="menuFeatureCopy">'+
            '<small>'+esc(siteCustomization?.menu?.hero_label||'НАША ГОРДОСТЬ')+'</small>'+
            '<h3>'+esc(featureName)+'</h3>'+
            '<p>'+esc(featureDesc)+'</p>'+
            '<div class="menuFeatureBottom"><b>'+(hasItemOptions(feature)?'от ':'')+money(feature.p??feature.price)+'</b><button data-add="'+esc(featureId)+'" '+(itemUnavailable(feature)?'disabled':'')+'>'+(itemUnavailable(feature)?'Нет в наличии':'Добавить <span>＋</span>')+'</button></div>'+
          '</div>'+
          '<div class="menuFeatureDots"><i></i><i></i><i></i></div>'+
        '</article>';
      rest=visible.filter(x=>String(x.id)!==featureId);
    }else{
      $('#menuFeature').innerHTML='';
    }
    const mainItems=rest.filter(isMain);
    const otherItems=rest.filter(x=>!isMain(x));
    let title='';
    if(category!=='all'){
      const meta=sectionById.get(String(category));
      title=meta?'<div class="menuCategoryLabel">'+(meta.cover?'<img src="'+esc(meta.cover)+'" alt="">':'')+'<b>'+esc(meta.name||'Раздел')+'</b></div>':'';
    }
    const layout=siteCustomization?.menu?.layout||'hero-2-3';
    const firstClass=layout==='uniform-3'?'otherDishGrid':'mainDishGrid';
    const secondClass=layout==='hero-2'||layout==='uniform-2'?'mainDishGrid':'otherDishGrid';
    $('#menuGrid').innerHTML=title+
      (mainItems.length?'<div class="'+firstClass+'">'+mainItems.map(x=>card(x,firstClass==='mainDishGrid'?'main':'other')).join('')+'</div>':'')+
      (otherItems.length?'<div class="'+secondClass+'">'+otherItems.map(x=>card(x,secondClass==='mainDishGrid'?'main':'other')).join('')+'</div>':'');
  }
  function renderCart(){
    const {count,total}=cartStats();
    $('#cartCount').textContent=count;$('#cartTotal').textContent=money(total);$('#sheetTotal').textContent=money(total);
    const summary=$('#cartSummary');if(summary)summary.textContent=count?(cart.slice(0,2).map(x=>x.n).join(', ')+(cart.length>2?'…':'')):'Ваш заказ';
    $('#cartItemsCount').textContent=count;$('#checkoutTotal').textContent=money(total);$('#placeOrderTotal').textContent=money(total);
    $('#cartBtn').classList.toggle('hidden',!count);
    $('#checkoutBtn').disabled=!count;$('#placeOrder').disabled=!count;
    $('#cartItems').innerHTML=count?cart.map(x=>'<div class="cartItem"><div class="cartItemCopy"><b>'+esc(x.n)+'</b>'+
      (x.detail?'<small>'+esc(x.detail)+'</small>':'<small>'+money(x.p)+' за шт.</small>')+
      '</div><div class="qty"><button data-minus="'+esc(x.cart_key||x.id)+'">−</button><b>'+x.q+'</b><button data-plus="'+esc(x.cart_key||x.id)+'">+</button></div></div>').join('')
      :'<div class="empty">Корзина пуста</div>';
    $('#checkoutItems').innerHTML=count?cart.map(x=>'<div class="checkoutQuickItem"><div><b>'+esc(x.n)+'</b>'+(x.detail?'<small>'+esc(x.detail)+'</small>':'')+'</div><span>× '+x.q+'</span><strong>'+money((Number(x.p)||0)*(Number(x.q)||0))+'</strong></div>').join(''):'';
  }

  const FIXED_OPTION_META={
    meats:{name:'Мясо',type:'single'},sizes:{name:'Размер',type:'single'},bases:{name:'Основа',type:'single'},
    sauces:{name:'Соусы',type:'multiple'},extras:{name:'Добавки',type:'multiple'}
  };
  function itemUnavailable(src){return src?.available===false||src?.available_now===false||Number(src?.stock)===0}
  function fixedOptionGroups(src){
    const opts=src?.options&&typeof src.options==='object'?src.options:{},required=new Set(Array.isArray(opts.required_groups)?opts.required_groups:[]);
    return Object.keys(FIXED_OPTION_META).map(id=>{
      const list=Array.isArray(opts[id])?opts[id].filter(x=>x?.active!==false):[];
      return {id,...FIXED_OPTION_META[id],required:required.has(id),options:list};
    }).filter(g=>g.options.length);
  }
  function customOptionGroups(src){
    return (Array.isArray(src?.choice_groups)?src.choice_groups:[]).filter(g=>g&&g.active!==false&&Array.isArray(g.options)&&g.options.some(o=>o?.active!==false));
  }
  function hasItemOptions(src){return fixedOptionGroups(src).length>0||customOptionGroups(src).length>0}
  function defaultItemSelection(src){
    const selection={};
    for(const group of fixedOptionGroups(src)){
      const defaults=group.options.filter(x=>x.default===true);
      if(group.type==='single'){
        const chosen=defaults[0]||(group.required?group.options[0]:null);
        if(chosen)selection[group.id]=String(chosen.id);
      }else{
        let chosen=defaults.map(x=>String(x.id));
        if(!chosen.length&&group.required&&group.options[0])chosen=[String(group.options[0].id)];
        if(chosen.length)selection[group.id]=chosen;
      }
    }
    return selection;
  }
  function defaultCustomChoices(src){
    const out={};
    for(const group of customOptionGroups(src)){
      const active=group.options.filter(o=>o?.active!==false),max=group.type==='single'?1:Math.max(1,Number(group.max)||active.length);
      let chosen=active.filter(o=>o.default===true).slice(0,max).map(o=>String(o.id));
      const min=Math.max(group.required?1:0,Number(group.min)||0);
      if(chosen.length<min)chosen=[...chosen,...active.filter(o=>!chosen.includes(String(o.id))).slice(0,min-chosen.length).map(o=>String(o.id))];
      if(chosen.length)out[String(group.id)]=chosen;
    }
    return out;
  }
  function localSelectionPrice(src,selection={},choices={}){
    let price=Number(src?.p??src?.price)||0;const detail=[];
    for(const group of fixedOptionGroups(src)){
      const raw=selection[group.id],ids=Array.isArray(raw)?raw:(raw?[raw]:[]);
      for(const id of ids){
        const o=group.options.find(x=>String(x.id)===String(id));
        if(o){price+=Number(o.price)||0;detail.push(String(o.name||''))}
      }
    }
    for(const group of customOptionGroups(src)){
      const ids=Array.isArray(choices[group.id])?choices[group.id]:[];
      const picked=[];
      for(const id of ids){
        const o=group.options.find(x=>x?.active!==false&&String(x.id)===String(id));
        if(o){price+=Number(o.price_delta)||0;picked.push(String(o.name||''))}
      }
      if(picked.length)detail.push(String(group.name||'Выбор')+': '+picked.join(', '));
    }
    return {price:Math.max(0,Math.round(price)),detail:detail.filter(Boolean).join(' · ')};
  }
  function cartIdentity(id,selection={},choices={}){
    const stable=o=>Object.keys(o||{}).sort().map(k=>k+':'+(Array.isArray(o[k])?[...o[k]].map(String).sort().join(','):String(o[k]??''))).join('|');
    return String(id)+'::'+stable(selection)+'::'+stable(choices);
  }
  function addConfigured(src,selection={},choices={}){
    if(!src||itemUnavailable(src)){toast('Позиция временно недоступна');return false}
    const priced=localSelectionPrice(src,selection,choices),key=cartIdentity(src.id,selection,choices);
    const minQty=Math.max(1,Number(src.min_qty)||1),stock=src.stock===null||src.stock===undefined?50:Math.max(0,Number(src.stock)||0);
    const maxQty=Math.max(minQty,Math.min(50,Number(src.max_qty)||50,stock||50));
    const x=cart.find(v=>String(v.cart_key||v.id)===key);
    if(x){
      if(x.q>=maxQty){toast('Максимум '+maxQty+' шт.');return false}
      x.q++;
    }else{
      cart.push({cart_key:key,id:String(src.id),n:String(src.n||src.name),p:priced.price,q:minQty,min_qty:minQty,max_qty:maxQty,selection,choices,detail:priced.detail});
    }
    save();
    const cartButton=$('#cartBtn');if(cartButton){cartButton.classList.remove('cartBump');void cartButton.offsetWidth;cartButton.classList.add('cartBump')}
    tg?.HapticFeedback?.impactOccurred?.('light');
    return true;
  }
  function renderItemOptions(){
    const src=pendingItem;if(!src)return;
    $('#itemOptionsTitle').textContent=String(src.n||src.name||'Позиция');
    $('#itemOptionsDescription').textContent=String(src.d||src.description||'');
    $('#itemOptionsBasePrice').textContent=money(Number(src.p??src.price)||0);
    const blocks=[];
    for(const group of fixedOptionGroups(src)){
      const raw=itemSelectionState[group.id],selected=Array.isArray(raw)?raw:(raw?[String(raw)]:[]);
      blocks.push({kind:'fixed',id:group.id,name:group.name,type:group.type,required:group.required,min:group.required?1:0,max:group.type==='single'?1:group.options.length,options:group.options.map(o=>({id:o.id,name:o.name,price:Number(o.price)||0}))});
    }
    for(const group of customOptionGroups(src)){
      blocks.push({kind:'custom',id:String(group.id),name:String(group.name||'Выбор'),type:group.type==='multiple'?'multiple':'single',required:group.required===true,min:Math.max(group.required?1:0,Number(group.min)||0),max:group.type==='single'?1:Math.max(1,Number(group.max)||group.options.length),options:group.options.filter(o=>o?.active!==false).map(o=>({id:o.id,name:o.name,price:Number(o.price_delta)||0}))});
    }
    $('#itemOptionGroups').innerHTML=blocks.map(group=>{
      const raw=group.kind==='fixed'?itemSelectionState[group.id]:itemChoiceState[group.id],selected=Array.isArray(raw)?raw:(raw?[String(raw)]:[]);
      const hint=group.type==='single'?'Выберите один вариант':(group.min?'Минимум '+group.min+', максимум '+group.max:'Можно выбрать до '+group.max);
      return '<section class="itemOptionGroup"><header><div><b>'+esc(group.name)+'</b><small>'+esc(hint)+'</small></div>'+(group.required||group.min?'<em>обязательно</em>':'')+'</header><div class="itemOptionButtons">'+group.options.map(o=>'<button type="button" class="'+(selected.includes(String(o.id))?'active':'')+'" data-option-kind="'+group.kind+'" data-option-group="'+esc(group.id)+'" data-option-id="'+esc(o.id)+'" data-option-type="'+group.type+'" data-option-max="'+group.max+'"><span>'+esc(o.name)+'</span><small>'+(o.price?(o.price>0?'+':'')+money(o.price):'без доплаты')+'</small></button>').join('')+'</div></section>';
    }).join('');
    $('#itemOptionsTotal').textContent=money(localSelectionPrice(src,itemSelectionState,itemChoiceState).price);
  }
  function openItemOptions(src){
    if(itemUnavailable(src)){toast('Позиция временно недоступна');return}
    pendingItem=src;itemSelectionState=defaultItemSelection(src);itemChoiceState=defaultCustomChoices(src);
    renderItemOptions();openSheet('itemOptionsSheet');
  }
  function confirmItemOptions(){
    const src=pendingItem;if(!src)return;
    for(const group of fixedOptionGroups(src)){
      const raw=itemSelectionState[group.id],count=Array.isArray(raw)?raw.length:(raw?1:0);
      if(group.required&&!count){toast('Выберите: '+group.name);return}
    }
    for(const group of customOptionGroups(src)){
      const selected=Array.isArray(itemChoiceState[group.id])?itemChoiceState[group.id]:[];
      const min=Math.max(group.required?1:0,Number(group.min)||0),max=group.type==='single'?1:Math.max(min,Number(group.max)||group.options.length);
      if(selected.length<min){toast('Выберите: '+String(group.name||'вариант'));return}
      if(selected.length>max){toast('Можно выбрать максимум '+max);return}
    }
    if(addConfigured(src,itemSelectionState,itemChoiceState)){pendingItem=null;itemSelectionState={};itemChoiceState={};closeSheets()}
  }
  function add(id){
    const src=(ctx?.venue?.menu||[]).find(x=>String(x.id)===String(id));if(!src)return;
    if(itemUnavailable(src)){toast('Позиция временно недоступна');return}
    if(hasItemOptions(src))return openItemOptions(src);
    if(addConfigured(src,{},{})){
      const name=String(src.n||src.name||'Позиция');toast(name+' добавлена в корзину');
      document.querySelectorAll('[data-add="'+CSS.escape(String(id))+'"]').forEach(btn=>{const prev=btn.innerHTML;btn.classList.add('justAdded');btn.innerHTML='✓';clearTimeout(btn._addedTimer);btn._addedTimer=setTimeout(()=>{btn.classList.remove('justAdded');btn.innerHTML=prev},650)});
    }
  }

  function runQuickFavoriteOrder(){
    const itemId=String(qs.get('quick_item')||'');
    if(!itemId||qs.get('quick_checkout')!=='1')return;
    const src=(ctx?.venue?.menu||[]).find(x=>x.active!==false&&String(x.id)===itemId);
    if(!src){toast('Эта позиция больше недоступна');return}
    const needsOptions=hasItemOptions(src);
    add(itemId);
    if(needsOptions)return;
    try{
      const u=new URL(location.href);u.searchParams.delete('quick_item');u.searchParams.delete('quick_checkout');
      history.replaceState({},'',u.toString());
    }catch{}
    openSheet('checkoutSheet');
    tg?.HapticFeedback?.notificationOccurred?.('success');
  }

  const STATUS_LABELS={new:'Принят',cooking:'Готовится',ready:'Готово',done:'Выполнен',cancelled:'Отменён'};
  const ACTIVE_ORDER_STATUSES=new Set(['new','cooking','ready']);
  function renderActiveOrderBadge(){
    const badge=$('#activeOrderBadge');if(!badge)return;
    const active=(activeOrderRows||[]).filter(o=>ACTIVE_ORDER_STATUSES.has(String(o.status)));
    if(!session||!active.length){badge.classList.add('hidden');return}
    const order=active[0],img=$('#activeOrderImage'),fallback=$('#activeOrderFallback'),count=$('#activeOrderCount');
    badge.dataset.status=ACTIVE_ORDER_STATUSES.has(String(order.status))?String(order.status):'new';
    badge.classList.remove('hidden');
    badge.setAttribute('aria-label','Активные заказы: '+active.length+'. '+(STATUS_LABELS[order.status]||order.status||''));
    fallback.textContent=String(order.venue_name||'Ш').trim().slice(0,1).toUpperCase()||'Ш';
    if(order.marker_id){
      img.onerror=()=>{img.classList.add('hidden');fallback.classList.remove('hidden')};
      img.onload=()=>{img.classList.remove('hidden');fallback.classList.add('hidden')};
      img.src=api+'/map/markers/'+encodeURIComponent(order.marker_id)+'/avatar?order='+encodeURIComponent(order.order_number||'');
    }else{
      img.removeAttribute('src');img.classList.add('hidden');fallback.classList.remove('hidden');
    }
    count.textContent=String(active.length);count.classList.toggle('hidden',active.length<2);
  }
  async function loadActiveOrders(){
    if(!session){activeOrderRows=[];renderActiveOrderBadge();return []}
    try{
      const r=await fetch(api+'/me/orders',{headers:{Authorization:'Bearer '+session},cache:'no-store'});if(!r.ok)throw 0;
      activeOrderRows=await r.json();renderActiveOrderBadge();return activeOrderRows;
    }catch{renderActiveOrderBadge();return activeOrderRows}
  }
  function connectOrderStream(){
    try{orderStream?.close()}catch{};orderStream=null;
    if(!session||typeof EventSource==='undefined')return;
    try{
      orderStream=new EventSource(api+'/me/stream?session='+encodeURIComponent(session));
      const refresh=()=>{loadActiveOrders();if($('#profileSheet')?.classList.contains('show'))myOrders()};
      orderStream.addEventListener('order',refresh);orderStream.addEventListener('update',refresh);orderStream.onerror=()=>{};
    }catch{}
  }
  async function myOrders(){
    if(!session){$('#myOrders').innerHTML='<div class="empty">Откройте Mini App внутри Telegram, чтобы видеть историю заказов.</div>';return}
    try{
      const r=await fetch(api+'/me/orders',{headers:{Authorization:'Bearer '+session}});if(!r.ok)throw 0;
      const rows=await r.json();
      $('#myOrders').innerHTML=rows.length?rows.map(o=>'<article class="orderCard historyCard"><header><div><small>'+esc(o.venue_name||'Shaurmeg')+'</small><b>'+esc(o.order_number)+'</b></div><span class="status status-'+esc(o.status)+'">'+esc(STATUS_LABELS[o.status]||o.status)+'</span></header>'+
        '<div class="historyMeta">'+new Date(o.created_at).toLocaleString('ru-RU')+' · '+(o.fulfillment_type==='cafe'?'в заведении':'доставка')+'</div>'+
        '<div class="historyBottom"><span>'+((o.items||[]).reduce((s,x)=>s+(x.q||1),0))+' поз.</span><b>'+money(o.total)+'</b></div></article>').join('')
        :'<div class="empty">Заказов пока нет</div>';
    }catch{$('#myOrders').innerHTML='<div class="empty">Не удалось загрузить историю</div>'}
  }
  async function submitOrder(){
    const btn=$('#placeOrder');btn.disabled=true;
    const {total}=cartStats();
    try{
      const body={items:cart.map(x=>({id:x.id,q:x.q,...(x.builderData?{builder:x.builderData}:{}),...(x.selection?{selection:x.selection}:{}),...(x.choices?{choices:x.choices}:{})})),marker_id:marker,establishment_id:est,venue_id:ctx.venue.venue_id,fulfillment_type:fulfillment,customer_name:$('#customer').value.trim(),phone:$('#phone').value.trim(),address:$('#address').value.trim(),comment:$('#comment').value.trim(),payment_method:'on_receipt'};
      if(!session&&tg?.initData)body.telegram_init_data=tg.initData;
      const headers={'Content-Type':'application/json'};if(session)headers.Authorization='Bearer '+session;
      const r=await fetch(api+'/orders',{method:'POST',headers,body:JSON.stringify(body)}),j=await r.json().catch(()=>({}));
      if(!r.ok)throw new Error(j.error==='phone_required'?'Укажите телефон':j.error==='address_required'?'Укажите адрес':j.error==='item_unavailable'?'Одна из позиций уже закончилась':j.error==='invalid_quantity'?'Проверьте количество позиции':j.error==='invalid_item_selection'?'Проверьте выбранные параметры позиции':j.error||'Не удалось оформить заказ');
      $('#successNumber').textContent=j.order_number||'Заказ принят';
      $('#successVenue').textContent=(ctx?.venue?.name||'Заведение')+(ctx?.marker?.address?' · '+ctx.marker.address:'');
      $('#successTotal').textContent=money(j.total??total);
      cart=[];save();await loadActiveOrders();openSheet('successSheet');tg?.HapticFeedback?.notificationOccurred?.('success');
    }catch(e){toast(e.message||'Ошибка заказа')}finally{btn.disabled=false}
  }

  function scheduleMenuReload(){
    clearTimeout(menuReloadTimer);
    menuReloadTimer=setTimeout(async()=>{
      try{await load();toast('Меню обновлено')}catch(e){console.warn('menu live reload',e)}
    },180);
  }
  function connectMenuStream(){
    if(menuStream||!marker||!est||typeof EventSource==='undefined')return;
    const u=api+'/menu-context/stream?marker_id='+encodeURIComponent(marker)+'&establishment_id='+encodeURIComponent(est);
    try{
      menuStream=new EventSource(u);
      menuStream.addEventListener('menu_changed',scheduleMenuReload);
      menuStream.addEventListener('venue',scheduleMenuReload);
      menuStream.onerror=()=>{};
    }catch{}
  }

  $('#chips').onclick=e=>{const b=e.target.closest('[data-cat]');if(!b)return;category=b.dataset.cat;document.querySelectorAll('[data-cat]').forEach(x=>x.classList.toggle('active',x===b));renderMenu()};
  $('#menuFeature').onclick=e=>{const b=e.target.closest('[data-add]');if(b)add(b.dataset.add)};
  $('#menuGrid').onclick=e=>{
    const section=e.target.closest('[data-section-cat]');
    if(section){
      category=section.dataset.sectionCat;
      document.querySelectorAll('#chips [data-cat]').forEach(x=>x.classList.toggle('active',x.dataset.cat===category));
      renderMenu();
      try{$('.menuSection')?.scrollIntoView?.({behavior:'smooth',block:'start'})}catch{}
      return;
    }
    const fav=e.target.closest('[data-favorite]');if(fav){toggleFavorite(fav.dataset.favorite);return}
    const b=e.target.closest('[data-add]');if(b)add(b.dataset.add)
  };
  $('#itemOptionGroups').onclick=e=>{
    const b=e.target.closest('[data-option-id]');if(!b||!pendingItem)return;
    const kind=String(b.dataset.optionKind),group=String(b.dataset.optionGroup),id=String(b.dataset.optionId),type=String(b.dataset.optionType),max=Math.max(1,Number(b.dataset.optionMax)||1);
    if(kind==='fixed'){
      const raw=itemSelectionState[group],current=Array.isArray(raw)?[...raw]:(raw?[String(raw)]:[]);
      if(type==='single')itemSelectionState[group]=current.includes(id)?'':id;
      else if(current.includes(id))itemSelectionState[group]=current.filter(x=>x!==id);
      else itemSelectionState[group]=[...current,id];
    }else{
      const current=Array.isArray(itemChoiceState[group])?[...itemChoiceState[group]]:[];
      if(type==='single')itemChoiceState[group]=current.includes(id)?[]:[id];
      else if(current.includes(id))itemChoiceState[group]=current.filter(x=>x!==id);
      else if(current.length>=max)toast('Можно выбрать максимум '+max);
      else itemChoiceState[group]=[...current,id];
    }
    renderItemOptions();
  };
  $('#confirmItemOptions').onclick=confirmItemOptions;
  $('#cartItems').onclick=e=>{
    let b=e.target.closest('[data-plus]');if(b){
      const x=cart.find(v=>String(v.cart_key||v.id)===String(b.dataset.plus));
      if(x){const max=Math.max(Number(x.min_qty)||1,Number(x.max_qty)||50);if(x.q>=max)toast('Максимум '+max+' шт.');else{x.q++;save()}}return
    }
    b=e.target.closest('[data-minus]');if(b){
      const x=cart.find(v=>String(v.cart_key||v.id)===String(b.dataset.minus));
      if(x){const min=Math.max(1,Number(x.min_qty)||1);if(x.q<=min)cart=cart.filter(v=>v!==x);else{x.q--;save()}}
    }
  };
  $('#openBuilder').onclick=()=>openBuilder('custom');
  $('#openSignatureBuilder').onclick=()=>openBuilder('signature');
  $('#builderModeSwitch').onclick=e=>{const b=e.target.closest('[data-builder-mode]');if(b)setBuilderMode(b.dataset.builderMode)};
  $('#signaturePrev').onclick=()=>shiftSignature(-1);
  $('#signatureNext').onclick=()=>shiftSignature(1);
  $('#signatureDots').onclick=e=>{const b=e.target.closest('[data-signature-dot]');if(!b)return;const next=Number(b.dataset.signatureDot);if(!Number.isInteger(next)||next===signatureIndex)return;const delta=next>signatureIndex?1:-1;signatureIndex=(next-delta+signatureItems.length)%signatureItems.length;shiftSignature(delta)};
  $('#chooseSignature').onclick=chooseSignature;
  $('#signatureBack').onclick=()=>setBuilderMode('custom');
  $('#signatureViewport').addEventListener('pointerdown',e=>{signaturePointerX=e.clientX;try{e.currentTarget.setPointerCapture(e.pointerId)}catch{}});
  $('#signatureViewport').addEventListener('pointerup',e=>{if(signaturePointerX===null)return;const dx=e.clientX-signaturePointerX;signaturePointerX=null;if(Math.abs(dx)>36)shiftSignature(dx<0?1:-1)});
  $('#signatureViewport').addEventListener('pointercancel',()=>{signaturePointerX=null});
  $('#builderTypes').onclick=e=>{const b=e.target.closest('[data-btype]');if(b){builderState.type=b.dataset.btype;renderBuilder()}};
  $('#builderBreads').onclick=e=>{const b=e.target.closest('[data-bbread]');if(b){builderState.bread=b.dataset.bbread;renderBuilder()}};
  $('#builderMeats').onclick=e=>{const b=e.target.closest('[data-bmeat]');if(b){builderState.meat=b.dataset.bmeat;renderBuilder()}};
  $('#builderSauces').onclick=e=>{const b=e.target.closest('[data-bsauce]');if(b)toggleBuilder(builderState.sauces,b.dataset.bsauce,Math.max(1,Number(builder.max_sauces)||builder.sauces.length))};
  $('#builderExtras').onclick=e=>{const b=e.target.closest('[data-bextra]');if(!b)return;const max=Number.isFinite(Number(builder.max_extras))?Math.max(0,Number(builder.max_extras)):builder.extras.length;toggleBuilder(builderState.extras,b.dataset.bextra,max)};
  $('#addBuilder').onclick=previewBuilt;
  $('#confirmBuilderCart').onclick=confirmBuilt;
  $('#editBuilder').onclick=editBuilt;
  $('#cartBtn').onclick=()=>openSheet('cartSheet');
  $('#checkoutBtn').onclick=()=>openSheet('checkoutSheet');
  $('#profileBtn').onclick=()=>{openSheet('profileSheet');myOrders()};
  $('#builderStepNext').onclick=()=>changeBuilderStep(1);
  $('#builderStepBack').onclick=()=>changeBuilderStep(-1);
  $('#backdrop').onclick=closeSheets;
  document.querySelectorAll('[data-close]').forEach(x=>x.onclick=closeSheets);
  document.addEventListener('touchmove',e=>{
    if(!sheetLocked)return;
    if(!e.target.closest?.('.sheet.show'))e.preventDefault();
  },{passive:false});
  window.addEventListener('pagehide',()=>{cinema?.cancel();unlockSheetBackground();try{menuStream?.close()}catch{}menuStream=null;try{orderStream?.close()}catch{}orderStream=null});
  $('#fulfillment').onclick=e=>{const b=e.target.closest('[data-value]');if(!b)return;fulfillment=b.dataset.value;document.querySelectorAll('#fulfillment button').forEach(x=>x.classList.toggle('active',x===b));document.querySelectorAll('.delivery').forEach(x=>x.classList.toggle('hidden',fulfillment!=='delivery'))};
  $('#placeOrder').onclick=submitOrder;
  $('#successMenu').onclick=closeSheets;
  $('#successOrders').onclick=()=>{openSheet('profileSheet');myOrders()};
  $('#activeOrderBadge').onclick=()=>{openSheet('profileSheet');myOrders();tg?.HapticFeedback?.selectionChanged?.()};

  function goMap(){
    try{tg?.BackButton?.hide?.()}catch{}
    const fallback=new URL('index.html',location.href);if(marker)fallback.searchParams.set('marker',marker);fallback.hash=location.hash;
    if(qs.get('from')==='map'&&history.length>1)history.back();else location.assign(fallback.toString());
  }
  $('#back').onclick=goMap;
  try{tg?.ready();tg?.expand();tg?.BackButton?.show();tg?.BackButton?.onClick(goMap)}catch{}
  (async()=>{
    try{
      await authTelegram();
      await load();
      connectMenuStream();
      await loadFavoriteState();
      await loadActiveOrders();
      connectOrderStream();
      runQuickFavoriteOrder();
    }catch(e){toast(e.message);$('#venueName').textContent='Меню недоступно'}
  })();
})();
