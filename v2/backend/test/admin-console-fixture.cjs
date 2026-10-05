const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const ROOT=path.resolve(__dirname,'../../..');
const sections=[{id:'shawarma',name:'Шаурма',cover:'/realcity-preview/assets/menu-shawarma.webp',active:true,order:0,settings:{meats:['Курица','Говядина'],sizes:['Стандарт','Большая'],bases:['Лаваш'],sauces:['Чесночный'],extras:['Сыр']}},{id:'flatbread',name:'Лепёшки',cover:'/realcity-preview/assets/menu-flatbread.webp',active:true,order:1,settings:{}},{id:'drinks',name:'Напитки',active:true,order:2,settings:{}}];
const menu=[{id:'classic',n:'Шаурма классическая',c:'shawarma',p:420,d:'Курица с гриля, свежие овощи и фирменный соус',image:'/realcity-preview/assets/menu-shawarma.webp',active:true,options:{meats:[{id:'chicken-stable-id',name:'Курица',price:0,image:'/realcity-preview/assets/menu-shawarma.webp',default:true}],sizes:[{id:'standard',name:'Стандарт',price:0}],sauces:[],bases:[],extras:[],required_groups:['meats']}},{id:'cheese',n:'Шаурма сырная',c:'shawarma',p:450,d:'Сочная курица и сырный соус',image:'/realcity-preview/assets/menu-shawarma.webp',active:true},{id:'flat',n:'Лепёшка фирменная',c:'flatbread',p:350,d:'Горячая лепёшка с начинкой',image:'/realcity-preview/assets/menu-flatbread.webp',active:true}];
function makeState(){const venue={venue_id:'lepyoshka',establishment_id:'SC-MSK-9342972B1F',marker_id:12,name:'Лепёшка',address:'Москва, Жулебинский бульвар, 12',hero_image:'/realcity-preview/assets/menu-flatbread.webp',hours:'10:00–23:00',price_label:'₽₽',menu:structuredClone(menu),sections:structuredClone(sections),sections_all:structuredClone(sections),config:{menu_sections:structuredClone(sections),builder_enabled:true,builder:{types:[{id:'wrap',name:'Шаурма',price:300}],breads:[],meats:[],sauces:[],extras:[],min_sauces:0,max_sauces:0,max_extras:0}}};return {venue,requests:[],failNextMenu:false,orders:['new','cooking','ready','done'].map((status,i)=>({id:i+1,order_number:'#038'+(7-i),status,total:540,customer_name:['Иван Петров','Анна Смирнова','Максим К.','Елена'][i],phone:'+7 912 345-67-78',fulfillment_type:i===1?'delivery':'pickup',created_at:'2026-10-05T12:34:00Z',items:[{n:'Шаурма классическая',q:1},{n:'Морс ягодный',q:1}]}))}}
function createServer(){const state=makeState();const server=http.createServer(async(req,res)=>{
 const u=new URL(req.url,'http://127.0.0.1');const p=u.pathname;let body='';for await(const b of req)body+=b;let payload={};try{payload=JSON.parse(body)}catch{};
 const json=(v,status=200)=>{res.writeHead(status,{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'});res.end(JSON.stringify(v))};
 if(p==='/telegram.js'){res.writeHead(200,{'Content-Type':'text/javascript'});return res.end('window.Telegram={WebApp:{initData:"fixture",version:"8.0",platform:"web",isFullscreen:true,ready(){},expand(){},setHeaderColor(){},setBackgroundColor(){},onEvent(){},BackButton:{show(){},hide(){},onClick(){}},close(){}}}');}
 if(p.startsWith('/api/')){
 state.requests.push({path:p,method:req.method,body:payload});
 if(p.endsWith('/stream')){res.writeHead(200,{'Content-Type':'text/event-stream'});res.write(': ready\n\n');req.on('close',()=>res.end());return}
 if(p.includes('auth'))return json({session:'fixture-session',establishments:[state.venue],user:{first_name:'Администратор'}});
 if(p.endsWith('/me'))return json({establishments:[state.venue]});
 if(p.endsWith('/admin/venues'))return json([state.venue,{...state.venue,name:'Шаурмег · Тверская',establishment_id:'SC-MSK-ABCDEF1234',is_active:true},{...state.venue,name:'Шаурмег · Арбат',establishment_id:'SC-MSK-1111111111',is_active:false}]);
 if(p.startsWith('/api/shaurma/venues/'))return json(state.venue);
 if(p.endsWith('/venue')&&req.method==='PUT'){if(state.failNextMenu){state.failNextMenu=false;return json({error:'Не удалось сохранить'},503)}state.venue.menu=payload.menu||state.venue.menu;state.venue.config=payload.config||state.venue.config;state.venue.sections=state.venue.sections_all=state.venue.config.menu_sections;return json(state.venue)}
 if(p.endsWith('/bot-health'))return json([{id:'master_admin',ok:true,enabled:true},{id:'venue_owner',ok:true,enabled:true}]);
 if(p.endsWith('/admins'))return json([]);
 if(p.endsWith('/invites')&&req.method==='POST')return json({id:1,claim_code:'OWN-AABBCCDDEE',expires_at:'2030-01-01T00:00:00Z'},201);
 if(p.endsWith('/invites'))return json([{id:1,role:'owner',expires_at:'2030-01-01T00:00:00Z',max_uses:1,uses:0,is_active:true}]);
 if(p.endsWith('/stats'))return json({today:41,new:3,cooking:7,ready:2,revenue:24850});
 if(p.endsWith('/menu')&&req.method==='PUT'){if(state.failNextMenu){state.failNextMenu=false;return json({error:'Не удалось сохранить'},503)}Object.assign(state.venue,{menu:payload.menu,sections:payload.sections,sections_all:payload.sections});return json(state.venue)}
 if(p.includes('/orders/')&&req.method==='PATCH'){const o=state.orders.find(x=>String(x.id)===p.split('/').pop());if(o)o.status=payload.status;return json(o||{})}
 if(p.endsWith('/orders'))return json(state.orders);
 if(p.endsWith('/design')){if(state.failNextDesign){state.failNextDesign=false;return json({error:'Дизайн не сохранён'},503)}state.venue.config.theme=payload.theme;state.venue.config.site_customization=payload.site_customization;return json({theme:payload.theme,site_customization:payload.site_customization})}
 if(p.endsWith('/theme')){state.venue.config.theme=payload.theme;return json({theme:payload.theme})}
 if(p.endsWith('/site')){if(state.failNextDesign){state.failNextDesign=false;return json({error:'Дизайн не сохранён'},503)}state.venue.config.site_customization=payload.site_customization;return json({site_customization:payload.site_customization})}
 if(p.endsWith('/profile'))return json({ok:true});
 if(p.endsWith('/builder'))return json({builder:state.venue.config.builder,builder_enabled:true});
 if(p.endsWith('/builder-cinema'))return json({cinema:{enabled:false},builder:state.venue.config.builder});
 if(p.includes('/establishments/')&&!p.endsWith('/admins'))return json(state.venue);
 if(p.includes('order-analytics'))return json({revenue:24850,orders:41,average:606,products:[],timeline:[]});
 if(p.includes('/markers'))return json([]);
 return json({});
 }
 const aliases={'/master-admin':'backend/master-admin.html','/shaurma-owner':'backend/shaurma-owner.html','/shaurmeg-owner':'backend/shaurmeg-owner.html','/venue-owner':'backend/venue-owner.html'};
 let relative=aliases[p]||(p.startsWith('/realcity-preview/')?'v2/frontend/'+p.slice(18):p.startsWith('/backend/')?p.slice(1):'v2/frontend/'+p.slice(1));
 const file=path.resolve(ROOT,relative);if(!file.startsWith(ROOT+path.sep)||!fs.existsSync(file)){res.writeHead(404);return res.end('Not found '+relative)}
 const ext=path.extname(file),type={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.webp':'image/webp'}[ext]||'application/octet-stream';
 let bytes=fs.readFileSync(file);if(ext==='.html')bytes=Buffer.from(bytes.toString().replace('https://telegram.org/js/telegram-web-app.js','/telegram.js'));
 res.writeHead(200,{'Content-Type':type});res.end(bytes);
 });return {server,state}}
module.exports={createServer};
if(require.main===module){const {server}=createServer();server.listen(4173,'127.0.0.1',()=>console.log('Admin fixture: http://127.0.0.1:4173'))}
