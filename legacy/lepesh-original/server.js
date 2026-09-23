const express=require('express');
const path=require('path');
const fs=require('fs');
const {Pool}=require('pg');

const app=express();
app.use(express.json());
app.use(express.static(__dirname));

const PORT=process.env.PORT||3000;
const DB=process.env.DATABASE_URL?new Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}}):null;
const DATA_FILE=path.join('/tmp','beautyflow-aggregator.json');

const seed={
 cities:[
  {id:'moscow',name:'Москва'},{id:'spb',name:'Санкт-Петербург'},{id:'kazan',name:'Казань'},
  {id:'sochi',name:'Сочи'},{id:'ekb',name:'Екатеринбург'},{id:'nsk',name:'Новосибирск'}
 ],
 salons:[
  {id:1,city:'Москва',name:'LUNA Beauty Space',district:'Хамовники',rating:4.9,reviews:384,price:'₽₽₽',image:'🌙',tags:['Волосы','Ногти','Брови'],today:'Сегодня 16:30',promo:'−15% на первое посещение'},
  {id:2,city:'Москва',name:'MUSE Studio',district:'Патриаршие',rating:4.8,reviews:271,price:'₽₽₽',image:'✦',tags:['Волосы','Уход'],today:'Сегодня 18:00',promo:'Свободное окно'},
  {id:3,city:'Москва',name:'NUDE Lab',district:'Чистые пруды',rating:5.0,reviews:146,price:'₽₽',image:'◌',tags:['Ногти','Брови','Ресницы'],today:'Сегодня 19:30',promo:'Маникюр от 2 490 ₽'},
  {id:4,city:'Санкт-Петербург',name:'VELVET Beauty',district:'Петроградская',rating:4.9,reviews:312,price:'₽₽',image:'❦',tags:['Волосы','Ногти'],today:'Завтра 10:00',promo:'−10% по будням'},
  {id:5,city:'Казань',name:'AURA Studio',district:'Центр',rating:4.8,reviews:198,price:'₽₽',image:'✧',tags:['Брови','Уход'],today:'Сегодня 17:15',promo:'Уход + диагностика'}
 ],
 services:[
  {id:1,salon_id:1,name:'Маникюр + покрытие',category:'Ногти',price:3200,duration:90,emoji:'💅'},
  {id:2,salon_id:1,name:'Укладка',category:'Волосы',price:2800,duration:60,emoji:'✂️'},
  {id:3,salon_id:2,name:'Стрижка + укладка',category:'Волосы',price:4500,duration:75,emoji:'✂️'},
  {id:4,salon_id:2,name:'Уход за лицом',category:'Уход',price:5400,duration:80,emoji:'🫧'},
  {id:5,salon_id:3,name:'Оформление бровей',category:'Брови',price:1900,duration:60,emoji:'✨'},
  {id:6,salon_id:3,name:'Маникюр',category:'Ногти',price:2490,duration:80,emoji:'💅'}
 ],
 masters:[
  {id:1,salon_id:1,name:'Алина',specialty:'Nail master',experience:5,rating:4.9},
  {id:2,salon_id:1,name:'Мила',specialty:'Hair stylist',experience:7,rating:4.9},
  {id:3,salon_id:2,name:'София',specialty:'Hair stylist',experience:6,rating:5.0},
  {id:4,salon_id:3,name:'Ева',specialty:'Brow artist',experience:4,rating:4.9}
 ],
 bookings:[]
};

function cloneSeed(){return JSON.parse(JSON.stringify(seed))}
function readStore(){try{return JSON.parse(fs.readFileSync(DATA_FILE,'utf8'))}catch{const d=cloneSeed();fs.writeFileSync(DATA_FILE,JSON.stringify(d));return d}}
function writeStore(v){fs.writeFileSync(DATA_FILE,JSON.stringify(v))}

async function initDb(){
 if(!DB)return;
 await DB.query(`
 CREATE TABLE IF NOT EXISTS salons(id SERIAL PRIMARY KEY,city TEXT NOT NULL,name TEXT NOT NULL,district TEXT,rating NUMERIC(2,1),reviews INT DEFAULT 0,price TEXT,image TEXT,promo TEXT,today TEXT,tags JSONB DEFAULT '[]'::jsonb);
 CREATE TABLE IF NOT EXISTS services(id SERIAL PRIMARY KEY,salon_id INT REFERENCES salons(id) ON DELETE CASCADE,name TEXT NOT NULL,category TEXT NOT NULL,price INT NOT NULL,duration INT NOT NULL,emoji TEXT);
 CREATE TABLE IF NOT EXISTS masters(id SERIAL PRIMARY KEY,salon_id INT REFERENCES salons(id) ON DELETE CASCADE,name TEXT NOT NULL,specialty TEXT NOT NULL,experience INT DEFAULT 0,rating NUMERIC(2,1) DEFAULT 5.0);
 CREATE TABLE IF NOT EXISTS bookings(id BIGSERIAL PRIMARY KEY,salon_id INT,service_name TEXT NOT NULL,master_name TEXT,booking_date TEXT NOT NULL,booking_time TEXT NOT NULL,client_name TEXT DEFAULT 'Гость',client_phone TEXT,status TEXT DEFAULT 'confirmed',created_at TIMESTAMPTZ DEFAULT NOW());
 `);
 const c=await DB.query('SELECT COUNT(*)::int c FROM salons');
 if(c.rows[0].c===0){
  for(const s of seed.salons) await DB.query('INSERT INTO salons(city,name,district,rating,reviews,price,image,promo,today,tags) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[s.city,s.name,s.district,s.rating,s.reviews,s.price,s.image,s.promo,s.today,JSON.stringify(s.tags)]);
  for(const s of seed.services) await DB.query('INSERT INTO services(salon_id,name,category,price,duration,emoji) VALUES($1,$2,$3,$4,$5,$6)',[s.salon_id,s.name,s.category,s.price,s.duration,s.emoji]);
  for(const m of seed.masters) await DB.query('INSERT INTO masters(salon_id,name,specialty,experience,rating) VALUES($1,$2,$3,$4,$5)',[m.salon_id,m.name,m.specialty,m.experience,m.rating]);
 }
}

app.get('/api/health',(req,res)=>res.json({ok:true,mode:'aggregator',storage:DB?'postgres':'temporary'}));

app.get('/api/discover',async(req,res)=>{
 const city=req.query.city||'Москва',q=(req.query.q||'').toLowerCase(),category=req.query.category||'Все';
 try{
  let salons,services,masters;
  if(DB){
   salons=(await DB.query('SELECT * FROM salons WHERE city=$1 ORDER BY rating DESC,reviews DESC',[city])).rows;
   services=(await DB.query('SELECT * FROM services')).rows;
   masters=(await DB.query('SELECT * FROM masters')).rows;
  }else{
   const d=readStore();salons=d.salons.filter(x=>x.city===city);services=d.services;masters=d.masters;
  }
  if(q) salons=salons.filter(s=>s.name.toLowerCase().includes(q)||s.district.toLowerCase().includes(q)||s.tags.join(' ').toLowerCase().includes(q));
  if(category!=='Все') salons=salons.filter(s=>(s.tags||[]).includes(category));
  res.json({cities:seed.cities,salons,services,masters});
 }catch(e){res.status(500).json({error:e.message})}
});

app.get('/api/salons/:id',async(req,res)=>{
 const id=Number(req.params.id);
 try{
  let salon,services,masters;
  if(DB){
   salon=(await DB.query('SELECT * FROM salons WHERE id=$1',[id])).rows[0];
   services=(await DB.query('SELECT * FROM services WHERE salon_id=$1 ORDER BY id',[id])).rows;
   masters=(await DB.query('SELECT * FROM masters WHERE salon_id=$1 ORDER BY rating DESC',[id])).rows;
  }else{
   const d=readStore();salon=d.salons.find(x=>x.id===id);services=d.services.filter(x=>x.salon_id===id);masters=d.masters.filter(x=>x.salon_id===id);
  }
  if(!salon)return res.sendStatus(404);
  res.json({salon,services,masters});
 }catch(e){res.status(500).json({error:e.message})}
});

app.get('/api/bookings',async(req,res)=>{
 try{if(DB){return res.json((await DB.query('SELECT * FROM bookings ORDER BY created_at DESC')).rows)}
 const d=readStore();res.json(d.bookings.slice().reverse())}catch(e){res.status(500).json({error:e.message})}
});

app.post('/api/bookings',async(req,res)=>{
 const {salon_id,service_name,master_name,booking_date,booking_time,client_name,client_phone}=req.body||{};
 if(!service_name||!booking_date||!booking_time)return res.status(400).json({error:'missing_fields'});
 try{
  if(DB){const q=await DB.query('INSERT INTO bookings(salon_id,service_name,master_name,booking_date,booking_time,client_name,client_phone) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',[salon_id||null,service_name,master_name||null,booking_date,booking_time,client_name||'Гость',client_phone||null]);return res.status(201).json(q.rows[0])}
  const d=readStore();const item={id:Date.now(),salon_id:salon_id||null,service_name,master_name:master_name||null,booking_date,booking_time,client_name:client_name||'Гость',client_phone:client_phone||null,status:'confirmed',created_at:new Date().toISOString()};d.bookings.push(item);writeStore(d);res.status(201).json(item);
 }catch(e){res.status(500).json({error:e.message})}
});

app.patch('/api/bookings/:id',async(req,res)=>{
 const {status,booking_date,booking_time}=req.body||{};const id=req.params.id;
 try{
  if(DB){const q=await DB.query('UPDATE bookings SET status=COALESCE($1,status),booking_date=COALESCE($2,booking_date),booking_time=COALESCE($3,booking_time) WHERE id=$4 RETURNING *',[status||null,booking_date||null,booking_time||null,id]);return q.rows[0]?res.json(q.rows[0]):res.sendStatus(404)}
  const d=readStore(),x=d.bookings.find(v=>String(v.id)===String(id));if(!x)return res.sendStatus(404);if(status)x.status=status;if(booking_date)x.booking_date=booking_date;if(booking_time)x.booking_time=booking_time;writeStore(d);res.json(x);
 }catch(e){res.status(500).json({error:e.message})}
});

app.get('/api/admin/stats',async(req,res)=>{
 try{
  const bookings=DB?(await DB.query('SELECT * FROM bookings')).rows:readStore().bookings;
  const active=bookings.filter(x=>x.status!=='cancelled');
  res.json({bookings:bookings.length,active:active.length,cancelled:bookings.length-active.length,revenue:active.length*3200,salons:DB?(await DB.query('SELECT COUNT(*)::int c FROM salons')).rows[0].c:readStore().salons.length});
 }catch(e){res.status(500).json({error:e.message})}
});

app.get('/admin',(req,res)=>res.sendFile(path.join(__dirname,'admin.html')));
app.use((req,res)=>res.sendFile(path.join(__dirname,'index.html')));

initDb().catch(e=>console.error('DB init:',e.message)).finally(()=>app.listen(PORT,()=>console.log('BeautyFlow aggregator on '+PORT)));
