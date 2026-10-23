'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),express=require('express'),path=require('node:path'),fs=require('node:fs');
const {chromium}=require('playwright');
test('fixed recipe, editable recipe, caption, favorite yes/no and aligned mobile controls',async()=>{
 const app=express();app.use(express.json());const est='SC-MSK-0000000001',favorite=new Set(),writes=[],recipes=new Map();
 const menu=[{id:'fixed',n:'Пицца из печи',p:420,c:'pizza',d:'Томаты и моцарелла',composition:'Тесто, томаты, моцарелла, базилик',weight:'450 г',image:'assets/menu-flatbread.webp',customization_enabled:false,options:{sizes:[{id:'large',name:'Большая',price:100}],required_groups:['sizes']},card_caption:{enabled:true,text:'Печём на огне',color:'#FFAA44',glass:true,style:'pill'}},{id:'custom',n:'Авторская пицца',p:390,c:'pizza',d:'Состав на ваш вкус',tags:['Пицца','Хит'],image:'assets/menu-flatbread.webp',options:{sizes:[{id:'large',name:'Большая',price:100}],required_groups:['sizes']},customization_enabled:true,customization_icon:true},{id:'drink',n:'Морс',p:100,c:'drinks',d:'Свежие ягоды',available:false,image:'assets/menu-flatbread.webp'}];
 app.get('/api/v2/menu-context',(req,res)=>{assert.equal(req.query.marker_id,'1');assert.equal(req.query.establishment_id,est);res.json({marker:{id:1,name:'Тест',address:'Москва'},venue:{name:'Тест',venue_id:'fixture',establishment_id:est,menu,sections:[{id:'pizza',name:'Пицца',accent:'#FF709F',color:'#5E2941'},{id:'drinks',name:'Напитки',accent:'#6D8DFF',color:'#263F73',custom_colors_enabled:true}],config:{builder_enabled:true,builder:{types:[{id:'wrap',name:'Шаурма',price:300}],breads:[],meats:[],sauces:[],extras:[],min_sauces:0,max_sauces:0,max_extras:0}}}})});
 app.get('/api/v2/me/favorites',(req,res)=>res.json({explicit:[...favorite].map(id=>est+':'+id),groups:[{establishment_id:est,venue_id:'fixture',marker_id:'1',items:[...recipes].map(([id,builder_data])=>({item_id:id,builder_data,name:'Своя шаурма',price:300,description:'Собственный рецепт'}))}]}));
 app.put('/api/v2/me/favorites/:est/:id',(req,res)=>{assert.equal(req.params.est,est);assert.equal(req.headers.authorization,'Bearer fixture-client');if(req.params.id.startsWith('custom_')){assert.equal(req.body.marker_id,'1');assert.equal(req.body.venue_id,'fixture');assert.equal(req.body.builder_data.type,'wrap');recipes.set(req.params.id,req.body.builder_data)}else assert.ok(menu.some(x=>x.id===req.params.id));favorite.add(req.params.id);writes.push(req.params.id);res.json({ok:true})});
 app.get('/api/v2/me/orders',(req,res)=>res.json([]));app.get(/stream$/,(req,res)=>{res.setHeader('Content-Type','text/event-stream');res.write(': fixture\n\n')});
 app.use(express.static(path.resolve(__dirname,'../../frontend')));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const origin='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({headless:true,executablePath:process.env.ADMIN_CHROMIUM_EXECUTABLE||undefined,args:['--no-sandbox','--disable-dev-shm-usage','--no-zygote','--single-process']});const page=await browser.newPage({viewport:{width:390,height:844}});const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('https://telegram.org/**',r=>r.fulfill({body:''}));await page.addInitScript(()=>sessionStorage.setItem('shaurmeg_client_session','fixture-client'));
 try{
  await page.goto(origin+'/menu.html?marker=1&establishment='+est+'&api='+encodeURIComponent(origin+'/api/v2'));await page.waitForSelector('#menuFeature [data-add="fixed"]');assert.equal(await page.locator('#menuFeature .dishCaption').textContent(),'Печём на огне');assert.equal(await page.locator('#menuFeature [data-customize]').count(),0);const metadata=await page.locator('#menuGrid .foodMeta').first().textContent();assert.equal(metadata,'Хит','old category tags do not duplicate the configurable caption');
  // Detail views are available for fixed recipes and sold-out items without adding to cart.
  const artifacts=path.resolve(__dirname,'../../../test-artifacts/menu-experience');fs.mkdirSync(artifacts,{recursive:true});
  await page.locator('#menuSection').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(artifacts,'menu-gallery-390.png'),fullPage:true});
  await page.click('#menuFeature .dishReadMore');await page.waitForSelector('#itemOptionsSheet.show');
  assert.equal(await page.locator('#dishCompositionText').textContent(),'Тесто, томаты, моцарелла, базилик');
  assert.match(await page.locator('#dishDetailFacts').textContent(),/450 г/);
  assert.equal(await page.locator('#itemOptionGroups button').count(),0,'disabled customization must not reappear in detail view');
  assert.equal(await page.evaluate(est=>JSON.parse(localStorage.getItem('shaurmeg_cart_'+est)||'[]').length,est),0);
  await page.screenshot({path:path.join(artifacts,'dish-detail-390.png')});
  await page.keyboard.press('Escape');assert.equal(await page.locator('#menuFeature .dishReadMore').evaluate(el=>document.activeElement===el),true);
  await page.click('.dishPhotoButton[data-detail="drink"]');await page.waitForSelector('#itemOptionsSheet.show');
  assert.equal(await page.locator('#confirmItemOptions').isDisabled(),true);
  assert.equal(await page.locator('#dishCompositionText').textContent(),'Заведение пока не указало состав этой позиции.');
  await page.keyboard.press('Escape');
  // Regression: legacy category color must not repaint the venue or builder.
  const theme=()=>page.evaluate(()=>({
    global:document.documentElement.style.getPropertyValue('--venue-accent'),
    local:document.querySelector('#menuSection').style.getPropertyValue('--venue-accent'),
    builder:getComputedStyle(document.querySelector('#builderSheet')).getPropertyValue('--venue-accent').trim()
  }));
  assert.deepEqual(await theme(),{global:'#D94343',local:'',builder:'#D94343'});
  await page.click('#chips [data-cat="pizza"]');
  assert.deepEqual(await theme(),{global:'#D94343',local:'',builder:'#D94343'},'pink legacy accent cannot bleed into the builder');
  await page.click('#chips [data-cat="drinks"]');
  assert.deepEqual(await theme(),{global:'#D94343',local:'#6D8DFF',builder:'#D94343'},'opt-in category color stays inside the menu');
  await page.click('#chips [data-cat="all"]');
  assert.deepEqual(await theme(),{global:'#D94343',local:'',builder:'#D94343'},'venue palette is restored without page reload');
  await page.click('#menuFeature [data-add="fixed"]');await page.waitForSelector('#favoritePrompt.show');assert.equal(await page.locator('#itemOptionsSheet').evaluate(el=>el.classList.contains('show')),false);let cart=await page.evaluate(est=>JSON.parse(localStorage.getItem('shaurmeg_cart_'+est)),est);assert.equal(cart[0].p,420);assert.deepEqual(cart[0].selection,{});await page.screenshot({path:path.join(artifacts,'favorite-glass-390.png')});await page.click('[data-favorite-answer=yes]');await page.waitForFunction(()=>document.querySelector('[data-favorite="custom"]'));await page.waitForTimeout(100);assert.deepEqual(writes,['fixed']);
  await page.click('[data-customize="custom"]');await page.waitForSelector('#itemOptionsSheet.show');await page.click('#confirmItemOptions');await page.waitForSelector('#favoritePrompt.show');await page.click('[data-favorite-answer=no]');cart=await page.evaluate(est=>JSON.parse(localStorage.getItem('shaurmeg_cart_'+est)),est);assert.equal(cart.find(x=>x.id==='custom').p,490);assert.deepEqual(writes,['fixed']);
  for(const width of [320,430,1440]){await page.setViewportSize({width,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'menu fits '+width);const boxes=await page.locator('#menuGrid .foodRow').evaluateAll(rows=>rows.map(row=>[...row.children].map(el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom}})));for(const row of boxes)for(let i=1;i<row.length;i++)assert.ok(row[i-1].bottom<=row[i].top+1||row[i-1].right<=row[i].left+1,'price and buttons do not overlap '+width)}
  await page.setViewportSize({width:390,height:844});await page.click('#openBuilder');while(await page.locator('#builderStepNext').isVisible())await page.click('#builderStepNext');await page.click('#addBuilder');await page.waitForSelector('#builderResult:not([hidden])');await page.click('#confirmBuilderCart');await page.waitForSelector('#favoritePrompt.show');await page.click('[data-favorite-answer=yes]');await page.waitForFunction(()=>document.querySelector('#toast').textContent.includes('Добавлено в избранное'));assert.equal(recipes.size,1);const savedId=[...recipes.keys()][0];await page.goto(origin+'/menu.html?marker=1&establishment='+est+'&api='+encodeURIComponent(origin+'/api/v2')+'&quick_item='+savedId+'&quick_checkout=1');await page.waitForSelector('#checkoutSheet.show');cart=await page.evaluate(est=>JSON.parse(localStorage.getItem('shaurmeg_cart_'+est)),est);assert.equal(cart.at(-1).builderData.type,'wrap');assert.equal(cart.at(-1).p,300);
  assert.deepEqual(errors,[]);
 }finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r))}
});
