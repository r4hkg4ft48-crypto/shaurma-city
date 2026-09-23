const express=require('express');
const path=require('path');
const fs=require('fs');
const {Pool}=require('pg');
const crypto=require('crypto');
const {analyzeRealCityProfile}=require('./realcity-analyzer');
const {discoverMoscowVenues,appearanceFor}=require('./venue-discovery');
const {installVenueOwner}=require('./venue-owner');

const app=express();
app.use(express.json({limit:'24mb'}));
app.use((req,res,next)=>{
 res.setHeader('Access-Control-Allow-Origin','*');
 res.setHeader('Access-Control-Allow-Headers','Content-Type, X-Owner-Token, Authorization');
 res.setHeader('Access-Control-Allow-Methods','GET,POST,PUT,PATCH,DELETE,OPTIONS');
 if(req.method==='OPTIONS') return res.sendStatus(204);
 next();
});
app.use(express.static(__dirname));
require('./realcity')(app);

const PORT=process.env.PORT||3000;
const VENUE_DISCOVERY_ENABLED=process.env.VENUE_DISCOVERY_ENABLED==='true';
const DB=process.env.DATABASE_URL?new Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}}):null;
const DATA_FILE=path.join('/tmp','shaurma-city-orders.json');

const realCityJobs=new Map();
let discoveryJob=null;
function queueRealCityProfile(markerId){
 if(!DB)return null;
 const key=String(markerId);if(realCityJobs.has(key))return realCityJobs.get(key);
 const job=(async()=>{
  try{
   await DB.query("UPDATE shaurmeg_markers SET realcity_status='processing' WHERE id=$1",[markerId]);
   const q=await DB.query("SELECT id,venue_id,name,address,description,lat,lon,hero_image,gallery,realcity_reference_images FROM shaurmeg_markers WHERE id=$1 LIMIT 1",[markerId]);
   const marker=q.rows[0];if(!marker)return;
   const profile=await analyzeRealCityProfile(marker);
   await DB.query("UPDATE shaurmeg_markers SET realcity_profile=$2::jsonb,realcity_status='ready',realcity_quality=$3,realcity_updated_at=NOW() WHERE id=$1",[markerId,JSON.stringify(profile),profile.quality||'heuristic']);
   console.log('RealCity profile ready:',markerId,profile.quality);
  }catch(e){
   console.error('RealCity profile:',markerId,e.message);
   await DB.query("UPDATE shaurmeg_markers SET realcity_status='failed',realcity_updated_at=NOW() WHERE id=$1",[markerId]).catch(()=>{});
  }
 })().finally(()=>realCityJobs.delete(key));
 realCityJobs.set(key,job);return job;
}
async function bootstrapRealCityProfiles(){
 if(!DB)return;
 try{
  const q=await DB.query("SELECT id FROM shaurmeg_markers WHERE is_active=TRUE AND (COALESCE(auto_imported,FALSE)=FALSE OR realcity_profile<>'{}'::jsonb) AND (realcity_status<>'ready' OR COALESCE((realcity_profile->>'version')::int,0)<7) ORDER BY updated_at DESC LIMIT 24");
  q.rows.forEach(row=>queueRealCityProfile(row.id));
 }catch(e){console.error('RealCity bootstrap:',e.message)}
}

const DEFAULT_VENUE_ID='lepyoshka';
const venueClients=new Map();
const DEFAULT_VENUE={venue_id:DEFAULT_VENUE_ID,slug:DEFAULT_VENUE_ID,name:'В Лепёшке',is_active:true,config:{},menu:[]};
const SEEDED_VENUES=[
 {venue_id:'lepyoshka',slug:'lepyoshka',name:'В Лепёшке',config:{subtitle:'ФИРМЕННОЕ МЕНЮ',builder_enabled:true},menu:[
  {id:'lep_classic',n:'Шаурма классическая',c:'shawarma',d:'Курица, свежие овощи и фирменный соус',p:280},
  {id:'lep_cheese',n:'Шаурма сырная',c:'shawarma',d:'Курица, сыр, овощи и сливочный соус',p:330},
  {id:'lep_flat',n:'Лепёшка фирменная',c:'flatbread',d:'Сочная начинка в горячей лепёшке',p:270},
  {id:'lep_fries',n:'Картошка фри',c:'extras',d:'Хрустящая порция',p:150},
  {id:'lep_mors',n:'Морс ягодный',c:'drinks',d:'Холодный домашний морс',p:120},
  {id:'lep_samsa',n:'Самса с курицей',c:'bakery',d:'Горячая и хрустящая',p:160}
 ]},
 {venue_id:'obrucheva',slug:'obrucheva',name:'Шаурма на Обручева',config:{subtitle:'ТЕСТОВОЕ МЕНЮ',builder_enabled:false},menu:[
  {id:'obr_small',n:'Шаурма мини',c:'shawarma',d:'Курица, томаты, огурцы и чесночный соус',p:230},
  {id:'obr_big',n:'Шаурма большая',c:'shawarma',d:'Двойная курица, овощи и два соуса',p:390},
  {id:'obr_spicy',n:'Шаурма острая',c:'shawarma',d:'Курица, халапеньо и острый соус',p:340},
  {id:'obr_fries',n:'Фри с сырным соусом',c:'extras',d:'Большая хрустящая порция',p:190},
  {id:'obr_cola',n:'Кола',c:'drinks',d:'Холодная, 0,5 л',p:130},
  {id:'obr_ayran',n:'Айран',c:'drinks',d:'Освежающий кисломолочный напиток',p:110}
 ]},
 {venue_id:'flotskaya',slug:'flotskaya',name:'Шаурма на Флотской',config:{subtitle:'ТЕСТОВОЕ МЕНЮ',builder_enabled:false},menu:[
  {id:'flt_classic',n:'Шаверма классика',c:'shawarma',d:'Курица гриль, капуста, томаты и белый соус',p:300},
  {id:'flt_beef',n:'Шаверма с говядиной',c:'shawarma',d:'Говядина, овощи и соус барбекю',p:420},
  {id:'flt_plate',n:'Шаурма на тарелке',c:'flatbread',d:'Мясо, овощи, фри и два соуса',p:450},
  {id:'flt_cheese',n:'Сырные палочки',c:'extras',d:'Пять штук с соусом',p:240},
  {id:'flt_compote',n:'Компот',c:'drinks',d:'Домашний, 0,5 л',p:100},
  {id:'flt_cheburek',n:'Чебурек с мясом',c:'bakery',d:'Хрустящий с сочной начинкой',p:180}
 ]}
];

const seed={shaurma_orders:[]};

function cloneSeed(){return JSON.parse(JSON.stringify(seed))}
function readStore(){try{return JSON.parse(fs.readFileSync(DATA_FILE,'utf8'))}catch{const d=cloneSeed();fs.writeFileSync(DATA_FILE,JSON.stringify(d));return d}}
function writeStore(v){fs.writeFileSync(DATA_FILE,JSON.stringify(v))}

async function initDb(){
 if(!DB)return;

 if(process.env.RESET_TO_SHAURMA==='true'){
  await DB.query('DROP TABLE IF EXISTS shaurma_orders CASCADE');
 }

 await DB.query(`
  CREATE TABLE IF NOT EXISTS shaurma_orders(
    id BIGSERIAL PRIMARY KEY,
    order_number TEXT UNIQUE NOT NULL,
    items JSONB NOT NULL DEFAULT '[]'::jsonb,
    total INT NOT NULL DEFAULT 0,
    customer_name TEXT DEFAULT 'Гость',
    phone TEXT,
    address TEXT,
    comment TEXT,
    status TEXT NOT NULL DEFAULT 'new',
    source TEXT NOT NULL DEFAULT 'web',
    telegram_user_id TEXT,
    telegram_username TEXT,
    telegram_first_name TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_shaurma_orders_created_at
    ON shaurma_orders(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_shaurma_orders_status
    ON shaurma_orders(status);
 `);
 await DB.query("ALTER TABLE shaurma_orders ADD COLUMN IF NOT EXISTS telegram_username TEXT");
 await DB.query("ALTER TABLE shaurma_orders ADD COLUMN IF NOT EXISTS telegram_first_name TEXT");
 await DB.query("ALTER TABLE shaurma_orders ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'web'");
 await DB.query("ALTER TABLE shaurma_orders ADD COLUMN IF NOT EXISTS telegram_user_id TEXT");
 await DB.query("ALTER TABLE shaurma_orders ADD COLUMN IF NOT EXISTS fulfillment_type TEXT NOT NULL DEFAULT 'delivery'");
 await DB.query("ALTER TABLE shaurma_orders ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'pending'");
 await DB.query("ALTER TABLE shaurma_orders ADD COLUMN IF NOT EXISTS payment_method TEXT");
 await DB.query("ALTER TABLE shaurma_orders ADD COLUMN IF NOT EXISTS venue_id TEXT NOT NULL DEFAULT 'lepyoshka'");
 await DB.query("ALTER TABLE shaurma_orders ADD COLUMN IF NOT EXISTS venue_name TEXT NOT NULL DEFAULT 'В Лепёшке'");
 await DB.query("CREATE INDEX IF NOT EXISTS idx_shaurma_orders_telegram_user ON shaurma_orders(telegram_user_id, created_at DESC)");
 await DB.query("CREATE INDEX IF NOT EXISTS idx_shaurma_orders_venue_created ON shaurma_orders(venue_id, created_at DESC)");
 await DB.query("ALTER TABLE shaurma_orders ADD COLUMN IF NOT EXISTS establishment_id TEXT NOT NULL DEFAULT ''");

 await DB.query(`
  CREATE TABLE IF NOT EXISTS shaurma_venues(
    venue_id TEXT PRIMARY KEY,
    slug TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    config JSONB NOT NULL DEFAULT '{}'::jsonb,
    menu JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_shaurma_venues_active ON shaurma_venues(is_active, name);
 `);
 await DB.query("ALTER TABLE shaurma_venues ADD COLUMN IF NOT EXISTS establishment_id TEXT");
 await DB.query("UPDATE shaurma_venues SET establishment_id='SC-MSK-'||UPPER(SUBSTR(MD5(venue_id),1,10)) WHERE establishment_id IS NULL OR establishment_id=''");
 await DB.query("CREATE UNIQUE INDEX IF NOT EXISTS idx_shaurma_venues_establishment ON shaurma_venues(establishment_id)");
 for(const venue of SEEDED_VENUES.filter(v=>v.venue_id===DEFAULT_VENUE_ID)){
  await DB.query(`
   INSERT INTO shaurma_venues(venue_id,slug,name,is_active,config,menu,establishment_id)
   VALUES($1,$2,$3,TRUE,$4::jsonb,$5::jsonb,$6)
   ON CONFLICT(venue_id) DO UPDATE SET
    slug=EXCLUDED.slug,
    establishment_id=COALESCE(shaurma_venues.establishment_id,EXCLUDED.establishment_id),
    name=EXCLUDED.name,
    config=CASE WHEN shaurma_venues.config='{}'::jsonb THEN EXCLUDED.config ELSE shaurma_venues.config END,
    menu=CASE WHEN jsonb_array_length(shaurma_venues.menu)=0 THEN EXCLUDED.menu ELSE shaurma_venues.menu END,
    updated_at=NOW()
  `,[venue.venue_id,venue.slug,venue.name,JSON.stringify(venue.config),JSON.stringify(venue.menu),establishmentIdForVenue(venue.venue_id)]);
 }

 await DB.query(`
  CREATE TABLE IF NOT EXISTS shaurmeg_markers(
    id BIGSERIAL PRIMARY KEY,
    venue_id TEXT NOT NULL REFERENCES shaurma_venues(venue_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    name TEXT NOT NULL,
    address TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    lat DOUBLE PRECISION NOT NULL,
    lon DOUBLE PRECISION NOT NULL,
    hero_image TEXT NOT NULL DEFAULT '',
    gallery JSONB NOT NULL DEFAULT '[]'::jsonb,
    hours TEXT NOT NULL DEFAULT '',
    price_label TEXT NOT NULL DEFAULT '',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_shaurmeg_markers_active ON shaurmeg_markers(is_active,updated_at DESC);
  CREATE INDEX IF NOT EXISTS idx_shaurmeg_markers_venue ON shaurmeg_markers(venue_id);
 `);
 await DB.query("ALTER TABLE shaurmeg_markers ADD COLUMN IF NOT EXISTS panorama_image TEXT NOT NULL DEFAULT ''");
 await DB.query("ALTER TABLE shaurmeg_markers ADD COLUMN IF NOT EXISTS immersive_scene_url TEXT NOT NULL DEFAULT ''");
 await DB.query("ALTER TABLE shaurmeg_markers ADD COLUMN IF NOT EXISTS immersive_poster TEXT NOT NULL DEFAULT ''");
 await DB.query("ALTER TABLE shaurmeg_markers ADD COLUMN IF NOT EXISTS immersive_config JSONB NOT NULL DEFAULT '{}'::jsonb");
 await DB.query("ALTER TABLE shaurmeg_markers ADD COLUMN IF NOT EXISTS realcity_reference_images JSONB NOT NULL DEFAULT '[]'::jsonb");
 await DB.query("ALTER TABLE shaurmeg_markers ADD COLUMN IF NOT EXISTS realcity_profile JSONB NOT NULL DEFAULT '{}'::jsonb");
 await DB.query("ALTER TABLE shaurmeg_markers ADD COLUMN IF NOT EXISTS realcity_status TEXT NOT NULL DEFAULT 'pending'");
 await DB.query("ALTER TABLE shaurmeg_markers ADD COLUMN IF NOT EXISTS realcity_quality TEXT NOT NULL DEFAULT 'heuristic'");
 await DB.query("ALTER TABLE shaurmeg_markers ADD COLUMN IF NOT EXISTS realcity_updated_at TIMESTAMPTZ");
 await DB.query("ALTER TABLE shaurmeg_markers ADD COLUMN IF NOT EXISTS marker_avatar TEXT NOT NULL DEFAULT ''");
 await DB.query("ALTER TABLE shaurmeg_markers ADD COLUMN IF NOT EXISTS marker_style JSONB NOT NULL DEFAULT '{}'::jsonb");
 await DB.query("ALTER TABLE shaurmeg_markers ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'shawarma'");
 await DB.query("ALTER TABLE shaurmeg_markers ADD COLUMN IF NOT EXISTS source_provider TEXT NOT NULL DEFAULT ''");
 await DB.query("ALTER TABLE shaurmeg_markers ADD COLUMN IF NOT EXISTS source_id TEXT NOT NULL DEFAULT ''");
 await DB.query("ALTER TABLE shaurmeg_markers ADD COLUMN IF NOT EXISTS source_data JSONB NOT NULL DEFAULT '{}'::jsonb");
 await DB.query("ALTER TABLE shaurmeg_markers ADD COLUMN IF NOT EXISTS source_first_seen_at TIMESTAMPTZ");
 await DB.query("ALTER TABLE shaurmeg_markers ADD COLUMN IF NOT EXISTS source_last_seen_at TIMESTAMPTZ");
 await DB.query("ALTER TABLE shaurmeg_markers ADD COLUMN IF NOT EXISTS source_checked_at TIMESTAMPTZ");
 await DB.query("ALTER TABLE shaurmeg_markers ADD COLUMN IF NOT EXISTS verification_status TEXT NOT NULL DEFAULT 'manual'");
 await DB.query("ALTER TABLE shaurmeg_markers ADD COLUMN IF NOT EXISTS verification_score DOUBLE PRECISION NOT NULL DEFAULT 1");
 await DB.query("ALTER TABLE shaurmeg_markers ADD COLUMN IF NOT EXISTS verification_details JSONB NOT NULL DEFAULT '{}'::jsonb");
 await DB.query("ALTER TABLE shaurmeg_markers ADD COLUMN IF NOT EXISTS relevance_score DOUBLE PRECISION NOT NULL DEFAULT 1");
 await DB.query("ALTER TABLE shaurmeg_markers ADD COLUMN IF NOT EXISTS auto_imported BOOLEAN NOT NULL DEFAULT FALSE");
 await DB.query("ALTER TABLE shaurmeg_markers ADD COLUMN IF NOT EXISTS position_locked BOOLEAN NOT NULL DEFAULT FALSE");
 await DB.query("ALTER TABLE shaurmeg_markers ADD COLUMN IF NOT EXISTS appearance_locked BOOLEAN NOT NULL DEFAULT FALSE");
 await DB.query("ALTER TABLE shaurmeg_markers ADD COLUMN IF NOT EXISTS metadata_locked BOOLEAN NOT NULL DEFAULT FALSE");
 await DB.query("ALTER TABLE shaurmeg_markers ADD COLUMN IF NOT EXISTS source_suppressed BOOLEAN NOT NULL DEFAULT FALSE");
 await DB.query("ALTER TABLE shaurmeg_markers ADD COLUMN IF NOT EXISTS establishment_id TEXT");
 await DB.query("UPDATE shaurmeg_markers m SET establishment_id=v.establishment_id FROM shaurma_venues v WHERE m.venue_id=v.venue_id AND (m.establishment_id IS NULL OR m.establishment_id='')");
 await DB.query("CREATE INDEX IF NOT EXISTS idx_shaurmeg_markers_establishment ON shaurmeg_markers(establishment_id)");
 await DB.query("CREATE UNIQUE INDEX IF NOT EXISTS idx_shaurmeg_markers_source ON shaurmeg_markers(source_provider,source_id) WHERE source_provider<>'' AND source_id<>''");
 await DB.query("CREATE INDEX IF NOT EXISTS idx_shaurmeg_markers_category ON shaurmeg_markers(category,is_active)");
 await DB.query("CREATE INDEX IF NOT EXISTS idx_shaurmeg_markers_geo ON shaurmeg_markers(lat,lon)");
 await DB.query(`
  CREATE TABLE IF NOT EXISTS shaurmeg_discovery_runs(
    id BIGSERIAL PRIMARY KEY,
    provider TEXT NOT NULL,
    region TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'running',
    reason TEXT NOT NULL DEFAULT 'auto',
    raw_count INT NOT NULL DEFAULT 0,
    discovered_count INT NOT NULL DEFAULT 0,
    inserted_count INT NOT NULL DEFAULT 0,
    updated_count INT NOT NULL DEFAULT 0,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at TIMESTAMPTZ
  );
  CREATE INDEX IF NOT EXISTS idx_shaurmeg_discovery_runs_latest ON shaurmeg_discovery_runs(provider,region,started_at DESC);
 `);
 await DB.query("UPDATE shaurmeg_discovery_runs SET status='interrupted',details=COALESCE(details,'{}'::jsonb)||jsonb_build_object('interrupted_at',NOW()),finished_at=NOW() WHERE status='running'");
 await DB.query("UPDATE shaurmeg_markers SET realcity_status='pending' WHERE realcity_profile='{}'::jsonb");
 await DB.query("UPDATE shaurma_orders o SET establishment_id=v.establishment_id FROM shaurma_venues v WHERE o.venue_id=v.venue_id AND (o.establishment_id IS NULL OR o.establishment_id='')");
 await DB.query("CREATE INDEX IF NOT EXISTS idx_shaurma_orders_establishment_created ON shaurma_orders(establishment_id,created_at DESC)");
 await DB.query(`
  CREATE TABLE IF NOT EXISTS shaurma_venue_admins(
    id BIGSERIAL PRIMARY KEY,
    establishment_id TEXT NOT NULL REFERENCES shaurma_venues(establishment_id) ON UPDATE CASCADE ON DELETE CASCADE,
    telegram_user_id TEXT NOT NULL,
    telegram_username TEXT NOT NULL DEFAULT '',
    telegram_first_name TEXT NOT NULL DEFAULT '',
    role TEXT NOT NULL DEFAULT 'owner',
    permissions JSONB NOT NULL DEFAULT '["menu","profile","media","appearance","orders"]'::jsonb,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    added_by TEXT NOT NULL DEFAULT 'superadmin',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(establishment_id,telegram_user_id)
  );
  CREATE INDEX IF NOT EXISTS idx_venue_admins_user ON shaurma_venue_admins(telegram_user_id,is_active);
  CREATE TABLE IF NOT EXISTS shaurma_venue_invites(
    id BIGSERIAL PRIMARY KEY,
    establishment_id TEXT NOT NULL REFERENCES shaurma_venues(establishment_id) ON UPDATE CASCADE ON DELETE CASCADE,
    code_hash TEXT UNIQUE NOT NULL,
    role TEXT NOT NULL DEFAULT 'owner',
    permissions JSONB NOT NULL DEFAULT '["menu","profile","media","appearance","orders"]'::jsonb,
    expires_at TIMESTAMPTZ NOT NULL,
    max_uses INT NOT NULL DEFAULT 1,
    uses INT NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_by TEXT NOT NULL DEFAULT 'superadmin',
    last_used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_venue_invites_establishment ON shaurma_venue_invites(establishment_id,is_active);
  CREATE TABLE IF NOT EXISTS shaurma_venue_audit(
    id BIGSERIAL PRIMARY KEY,
    establishment_id TEXT NOT NULL,
    telegram_user_id TEXT NOT NULL DEFAULT '',
    action TEXT NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_venue_audit_establishment ON shaurma_venue_audit(establishment_id,created_at DESC);
 `);
 await DB.query(`DELETE FROM shaurma_venues v WHERE v.venue_id IN ('obrucheva','flotskaya','d92e85a3c6c5') AND NOT EXISTS (SELECT 1 FROM shaurmeg_markers m WHERE m.venue_id=v.venue_id)`);

 await DB.query(`
  CREATE TABLE IF NOT EXISTS shaurma_users(
    telegram_user_id TEXT PRIMARY KEY,
    username TEXT,
    first_name TEXT,
    last_name TEXT,
    language_code TEXT,
    is_premium BOOLEAN NOT NULL DEFAULT FALSE,
    profile JSONB NOT NULL DEFAULT '{}'::jsonb,
    favorites JSONB NOT NULL DEFAULT '[]'::jsonb,
    preferences JSONB NOT NULL DEFAULT '{}'::jsonb,
    payment_provider TEXT,
    payment_customer_id TEXT,
    payment_method_id TEXT,
    payment_card_brand TEXT,
    payment_card_last4 TEXT,
    autopay_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_shaurma_users_last_seen ON shaurma_users(last_seen_at DESC);
 `);

}

app.get('/api/health',(req,res)=>res.json({ok:true,mode:'shaurma-city',storage:DB?'postgres':'temporary',identity:'telegram-user-id',profile_storage:DB?'postgres':'unavailable',multi_venue:true,default_venue_id:DEFAULT_VENUE_ID}));








function canonicalVenueName(value){
 return String(value||'').toLowerCase().replace(/ё/g,'е').replace(/[^a-zа-я0-9]+/gi,' ').replace(/\b(кафе|ресторан|быстрое питание|fast food|точка|киоск)\b/g,' ').replace(/\s+/g,' ').trim();
}
function venueNamesLikelySame(a,b){
 const x=canonicalVenueName(a),y=canonicalVenueName(b);if(!x||!y)return false;
 if(x===y||x.includes(y)||y.includes(x))return true;
 const A=new Set(x.split(' ').filter(t=>t.length>2)),B=new Set(y.split(' ').filter(t=>t.length>2));
 let common=0;for(const t of A)if(B.has(t))common++;
 return common>=1&&common/Math.max(1,Math.min(A.size,B.size))>=.67;
}
async function findNearbyManualMatch(client,r){
 const latPad=.00036,lonPad=.00058;
 const q=await client.query(`SELECT id,venue_id,name,position_locked,appearance_locked,metadata_locked,source_suppressed,auto_imported
  FROM shaurmeg_markers
  WHERE lat BETWEEN $1 AND $2 AND lon BETWEEN $3 AND $4 AND source_provider=''
  ORDER BY ((lat-$5)*(lat-$5)+(lon-$6)*(lon-$6)) ASC LIMIT 8`,
  [r.lat-latPad,r.lat+latPad,r.lon-lonPad,r.lon+lonPad,r.lat,r.lon]);
 return q.rows.find(x=>venueNamesLikelySame(x.name,r.name))||null;
}

async function runMoscowDiscovery({reason='auto'}={}){
 if(!DB)return null;if(discoveryJob)return discoveryJob;
 discoveryJob=(async()=>{
  let runId=null;
  try{
   const run=await DB.query("INSERT INTO shaurmeg_discovery_runs(provider,region,status,reason) VALUES('openstreetmap','moscow','running',$1) RETURNING id",[reason]);
   runId=run.rows[0].id;
   const found=await discoverMoscowVenues();
   const client=await DB.connect();let inserted=0,updated=0;
   try{
    await client.query('BEGIN');
    for(const r of found.records){
     await client.query(`
      INSERT INTO shaurma_venues(venue_id,slug,name,is_active,config,menu,establishment_id)
      VALUES($1,$1,$2,TRUE,$3::jsonb,'[]'::jsonb,$4)
      ON CONFLICT(venue_id) DO UPDATE SET
       establishment_id=COALESCE(shaurma_venues.establishment_id,EXCLUDED.establishment_id),
       name=CASE WHEN EXISTS(SELECT 1 FROM shaurmeg_markers m WHERE m.venue_id=$1 AND m.metadata_locked=TRUE) THEN shaurma_venues.name ELSE EXCLUDED.name END,
       is_active=CASE WHEN EXISTS(SELECT 1 FROM shaurmeg_markers m WHERE m.venue_id=$1 AND m.source_suppressed=TRUE) THEN FALSE ELSE TRUE END,
       updated_at=NOW()
     `,[r.venue_id,r.name,JSON.stringify({subtitle:'ЗАВЕДЕНИЕ НА КАРТЕ',builder_enabled:false,source:'openstreetmap'}),establishmentIdForVenue(r.venue_id)]);
     const existing=await client.query("SELECT id,position_locked,appearance_locked,metadata_locked,source_suppressed FROM shaurmeg_markers WHERE source_provider=$1 AND source_id=$2 LIMIT 1",['openstreetmap',r.source_id]);
     let attachedManual=null;
     if(!existing.rows[0])attachedManual=await findNearbyManualMatch(client,r);
     if(attachedManual){
      await client.query(`UPDATE shaurmeg_markers SET source_provider='openstreetmap',source_id=$2,source_data=$3::jsonb,source_first_seen_at=COALESCE(source_first_seen_at,NOW()),source_last_seen_at=NOW(),source_checked_at=NOW(),verification_details=verification_details||$4::jsonb,relevance_score=GREATEST(relevance_score,$5),updated_at=NOW() WHERE id=$1`,
       [attachedManual.id,r.source_id,JSON.stringify(r.source_data),JSON.stringify({linked_source:r.verification_details}),r.relevance_score]);
      updated++;
     }else if(existing.rows[0]){
      const x=existing.rows[0];
      await client.query(`
       UPDATE shaurmeg_markers SET
        name=CASE WHEN metadata_locked THEN name ELSE $3 END,
        address=CASE WHEN metadata_locked THEN address ELSE $4 END,
        description=CASE WHEN metadata_locked THEN description ELSE $5 END,
        hours=CASE WHEN metadata_locked THEN hours ELSE $6 END,
        lat=CASE WHEN position_locked THEN lat ELSE $7 END,
        lon=CASE WHEN position_locked THEN lon ELSE $8 END,
        category=$9,
        marker_style=CASE WHEN appearance_locked THEN marker_style ELSE $10::jsonb END,
        source_data=$11::jsonb,
        source_last_seen_at=NOW(),source_checked_at=NOW(),
        verification_status=CASE WHEN verification_status='manual_verified' THEN verification_status ELSE $12 END,
        verification_score=CASE WHEN verification_status='manual_verified' THEN verification_score ELSE $13 END,
        verification_details=CASE WHEN verification_status='manual_verified' THEN verification_details ELSE $14::jsonb END,
        relevance_score=$15,
        auto_imported=TRUE,
        is_active=CASE WHEN source_suppressed THEN FALSE ELSE TRUE END,
        updated_at=NOW()
       WHERE id=$1
      `,[x.id,r.venue_id,r.name,r.address,r.description,r.hours,r.lat,r.lon,r.category,JSON.stringify(r.marker_style),JSON.stringify(r.source_data),r.verification_status,r.verification_score,JSON.stringify(r.verification_details),r.relevance_score]);
      updated++;
     }else{
      await client.query(`
       INSERT INTO shaurmeg_markers(
        venue_id,establishment_id,name,address,description,lat,lon,hours,category,marker_style,
        source_provider,source_id,source_data,source_first_seen_at,source_last_seen_at,source_checked_at,
        verification_status,verification_score,verification_details,relevance_score,auto_imported,
        realcity_status,realcity_quality,is_active
       ) VALUES($1,$16,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,'openstreetmap',$10,$11::jsonb,NOW(),NOW(),NOW(),$12,$13,$14::jsonb,$15,TRUE,'pending','heuristic',TRUE)
      `,[r.venue_id,r.name,r.address,r.description,r.lat,r.lon,r.hours,r.category,JSON.stringify(r.marker_style),r.source_id,JSON.stringify(r.source_data),r.verification_status,r.verification_score,JSON.stringify(r.verification_details),r.relevance_score,establishmentIdForVenue(r.venue_id)]);
      inserted++;
     }
    }
    await client.query('COMMIT');
   }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}finally{client.release()}
   await DB.query("UPDATE shaurmeg_discovery_runs SET status='ready',raw_count=$2,discovered_count=$3,inserted_count=$4,updated_count=$5,details=$6::jsonb,finished_at=NOW() WHERE id=$1",[runId,found.raw_count,found.count,inserted,updated,JSON.stringify({scope:found.scope,categories:found.counts,queried_at:found.queried_at,coverage:found.coverage??1,failed_cells:found.failed_cells||[]})]);
   console.log('Moscow discovery ready:',found.count,'inserted',inserted,'updated',updated);
   return {count:found.count,inserted,updated,categories:found.counts};
  }catch(e){
   console.error('Moscow discovery:',e.message);
   if(runId)await DB.query("UPDATE shaurmeg_discovery_runs SET status='failed',details=$2::jsonb,finished_at=NOW() WHERE id=$1",[runId,JSON.stringify({error:e.message})]).catch(()=>{});
   throw e;
  }
 })().finally(()=>{discoveryJob=null});
 return discoveryJob;
}
async function maybeAutoDiscoverMoscow(reason='startup'){
 if(!VENUE_DISCOVERY_ENABLED||!DB||discoveryJob)return;
 try{
  const q=await DB.query("SELECT finished_at FROM shaurmeg_discovery_runs WHERE provider='openstreetmap' AND region='moscow' AND status='ready' ORDER BY finished_at DESC LIMIT 1");
  const last=q.rows[0]?.finished_at?new Date(q.rows[0].finished_at).getTime():0;
  if(last&&Date.now()-last<20*60*60*1000)return;
  runMoscowDiscovery({reason}).catch(()=>{});
 }catch(e){console.error('Auto discovery check:',e.message)}
}

const ownerClients=new Set();
const telegramClients=new Map();

function verifyTelegramInitDataWithToken(initData,botToken){
 if(!botToken) throw new Error('telegram_not_configured');
 const p=new URLSearchParams(initData||'');
 const hash=p.get('hash'); if(!hash) throw new Error('bad_init_data');
 p.delete('hash');
 const authDate=Number(p.get('auth_date')||0);
 const age=Math.floor(Date.now()/1000)-authDate;
 if(!authDate || age>86400 || age < -300) throw new Error('expired_init_data');
 const dataCheck=[...p.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>k+'='+v).join('\n');
 const secret=crypto.createHmac('sha256','WebAppData').update(botToken).digest();
 const calc=crypto.createHmac('sha256',secret).update(dataCheck).digest('hex');
 if(calc.length!==hash.length || !crypto.timingSafeEqual(Buffer.from(calc),Buffer.from(hash))) throw new Error('bad_hash');
 let user={}; try{user=JSON.parse(p.get('user')||'{}')}catch{}
 if(!user.id) throw new Error('no_user');
 return user;
}
function verifyTelegramInitData(initData){return verifyTelegramInitDataWithToken(initData,process.env.CLIENT_TELEGRAM_BOT_TOKEN||process.env.CUSTOMER_BOT_TOKEN||process.env.TELEGRAM_BOT_TOKEN)}
function clientBotToken(){
 return process.env.CLIENT_TELEGRAM_BOT_TOKEN||process.env.CUSTOMER_BOT_TOKEN||process.env.TELEGRAM_BOT_TOKEN||'';
}
function sessionSecret(){
 const token=clientBotToken();
 if(!token)throw new Error('telegram_not_configured');
 return crypto.createHmac('sha256','ShaurmaCitySessionV1').update(token).digest();
}
function b64url(v){return Buffer.from(v).toString('base64url')}
function newTelegramSession(user){
 const now=Math.floor(Date.now()/1000);
 const payload={sub:String(user.id),username:user.username||'',first_name:user.first_name||'',last_name:user.last_name||'',iat:now,exp:now+7*24*60*60};
 const body=b64url(JSON.stringify(payload));
 const sig=crypto.createHmac('sha256',sessionSecret()).update(body).digest('base64url');
 return body+'.'+sig;
}
function telegramSession(req){
 try{
  const auth=req.get('authorization')||'';
  const token=auth.startsWith('Bearer ')?auth.slice(7):(req.query.session||'');
  const [body,sig,extra]=String(token||'').split('.');
  if(!body||!sig||extra)return null;
  const expected=crypto.createHmac('sha256',sessionSecret()).update(body).digest('base64url');
  const a=Buffer.from(sig),b=Buffer.from(expected);
  if(a.length!==b.length||!crypto.timingSafeEqual(a,b))return null;
  const payload=JSON.parse(Buffer.from(body,'base64url').toString('utf8'));
  const now=Math.floor(Date.now()/1000);
  if(!payload.sub||!payload.exp||payload.exp<now)return null;
  return {user:{id:String(payload.sub),username:payload.username||'',first_name:payload.first_name||'',last_name:payload.last_name||''},exp:payload.exp*1000};
 }catch{return null}
}
async function upsertTelegramUser(user){
 if(!DB)return null;
 const q=await DB.query(`
  INSERT INTO shaurma_users(telegram_user_id,username,first_name,last_name,language_code,is_premium,last_seen_at,updated_at)
  VALUES($1,$2,$3,$4,$5,$6,NOW(),NOW())
  ON CONFLICT(telegram_user_id) DO UPDATE SET
   username=EXCLUDED.username,
   first_name=EXCLUDED.first_name,
   last_name=EXCLUDED.last_name,
   language_code=EXCLUDED.language_code,
   is_premium=EXCLUDED.is_premium,
   last_seen_at=NOW(),
   updated_at=NOW()
  RETURNING telegram_user_id,username,first_name,last_name,language_code,is_premium,profile,favorites,preferences,
   payment_provider,payment_card_brand,payment_card_last4,autopay_enabled,created_at,last_seen_at,updated_at
 `,[String(user.id),user.username||null,user.first_name||null,user.last_name||null,user.language_code||null,!!user.is_premium]);
 return q.rows[0];
}
function publicUserProfile(row){
 if(!row)return null;
 return {
  id:String(row.telegram_user_id),
  username:row.username||'',
  first_name:row.first_name||'',
  last_name:row.last_name||'',
  language_code:row.language_code||'',
  is_premium:!!row.is_premium,
  profile:row.profile||{},
  favorites:Array.isArray(row.favorites)?row.favorites:[],
  preferences:row.preferences||{},
  payment:{
   provider:row.payment_provider||null,
   card_brand:row.payment_card_brand||null,
   card_last4:row.payment_card_last4||null,
   autopay_enabled:!!row.autopay_enabled,
   linked:!!row.payment_card_last4
  },
  created_at:row.created_at,
  last_seen_at:row.last_seen_at,
  updated_at:row.updated_at
 };
}
function adminSessionSecret(){
 const token=process.env.ADMIN_TELEGRAM_BOT_TOKEN||process.env.OWNER_API_TOKEN||'';
 if(!token)throw new Error('admin_not_configured');
 return crypto.createHmac('sha256','ShaurmaCityAdminSessionV1').update(token).digest();
}
function newAdminTelegramSession(user){
 const now=Math.floor(Date.now()/1000);
 const payload={sub:String(user.id),username:user.username||'',first_name:user.first_name||'',iat:now,exp:now+7*24*60*60};
 const body=Buffer.from(JSON.stringify(payload)).toString('base64url');
 const sig=crypto.createHmac('sha256',adminSessionSecret()).update(body).digest('base64url');
 return body+'.'+sig;
}
function adminTelegramSession(req){
 try{
  const auth=req.get('authorization')||'';
  const token=auth.startsWith('Bearer ')?auth.slice(7):(req.query.admin_session||'');
  const [body,sig,extra]=String(token||'').split('.');
  if(!body||!sig||extra)return null;
  const expected=crypto.createHmac('sha256',adminSessionSecret()).update(body).digest('base64url');
  const a=Buffer.from(sig),b=Buffer.from(expected);
  if(a.length!==b.length||!crypto.timingSafeEqual(a,b))return null;
  const payload=JSON.parse(Buffer.from(body,'base64url').toString('utf8'));
  const now=Math.floor(Date.now()/1000);
  if(!payload.sub||!payload.exp||payload.exp<now)return null;
  if(!adminTelegramAllowed(payload.sub))return null;
  return {user:{id:String(payload.sub),username:payload.username||'',first_name:payload.first_name||''},exp:payload.exp*1000};
 }catch{return null}
}
function adminTelegramAllowed(userId){
 const raw=[process.env.ADMIN_TELEGRAM_IDS||'',process.env.ADDITIONAL_ADMIN_TELEGRAM_IDS||''].filter(Boolean).join(',');
 return raw.split(',').map(x=>x.trim()).filter(Boolean).includes(String(userId));
}
function pushTelegram(userId,event,payload){
 const set=telegramClients.get(String(userId)); if(!set)return;
 const data='event: '+event+'\n'+'data: '+JSON.stringify(payload)+'\n\n';
 for(const res of set){try{res.write(data)}catch{set.delete(res)}}
}
function ownerOk(req){if(process.env.OWNER_API_TOKEN && (req.get('x-owner-token')===process.env.OWNER_API_TOKEN || req.query.token===process.env.OWNER_API_TOKEN))return true;return !!adminTelegramSession(req)}
function pushOwner(event,payload){
 const data='event: '+event+'\n'+'data: '+JSON.stringify(payload)+'\n\n';
 for(const res of ownerClients){try{res.write(data)}catch{ownerClients.delete(res)}}
}
function normalizeVenueId(value){
 const id=String(value||'').trim().toLowerCase().replace(/^venue_/,'');
 return /^[a-z0-9_-]{1,64}$/.test(id)?id:null;
}
function establishmentIdForVenue(venueId){
 const id=normalizeVenueId(venueId);if(!id)return null;
 return 'SC-MSK-'+crypto.createHash('md5').update(id).digest('hex').slice(0,10).toUpperCase();
}
async function resolveVenue(value,{includeInactive=false}={}){
 const id=normalizeVenueId(value)||DEFAULT_VENUE_ID;
 if(!DB){
  const venue=SEEDED_VENUES.find(v=>v.venue_id===id||v.slug===id);
  return venue?{...venue,is_active:true}:null;
 }
 const where=includeInactive?'':' AND is_active=TRUE';
 const q=await DB.query(`SELECT venue_id,slug,name,is_active,config,menu,created_at,updated_at FROM shaurma_venues WHERE (venue_id=$1 OR slug=$1)${where} LIMIT 1`,[id]);
 return q.rows[0]||null;
}
function orderNumber(){return 'SC-'+Date.now().toString().slice(-7)+'-'+Math.floor(10+Math.random()*90)}
let clientBotInfo=null;
async function clientTelegramApi(method,body={}){
 const token=clientBotToken();if(!token)throw new Error('telegram_not_configured');
 const r=await fetch('https://api.telegram.org/bot'+token+'/'+method,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 const j=await r.json().catch(()=>({}));if(!r.ok||!j.ok)throw new Error(j.description||('HTTP '+r.status));return j.result;
}
async function getClientBotInfo(){
 if(clientBotInfo)return clientBotInfo;
 const token=clientBotToken();
 if(!token)return null;
 const r=await fetch('https://api.telegram.org/bot'+token+'/getMe');
 const j=await r.json().catch(()=>({}));
 if(!r.ok||!j.ok||!j.result?.username)throw new Error(j.description||('HTTP '+r.status));
 clientBotInfo=j.result;
 return clientBotInfo;
}
async function syncTelegramMiniApp(){
 const token=process.env.CLIENT_TELEGRAM_BOT_TOKEN||process.env.CUSTOMER_BOT_TOKEN||process.env.TELEGRAM_BOT_TOKEN;
 if(!token){console.log('Telegram client bot token not configured');return}
 try{
  await getClientBotInfo();
  const r=await fetch('https://api.telegram.org/bot'+token+'/setChatMenuButton',{
   method:'POST',
   headers:{'Content-Type':'application/json'},
   body:JSON.stringify({menu_button:{type:'web_app',text:'Открыть Шаурмег',web_app:{url:String(process.env.CLIENT_MINI_APP_URL||'https://shaurma-city-app.onrender.com/?source=telegram&b=81').trim()}}})
  });
  const j=await r.json().catch(()=>({}));
  if(!r.ok||!j.ok)throw new Error(j.description||('HTTP '+r.status));
  await clientTelegramApi('deleteWebhook',{drop_pending_updates:false});
  console.log('Telegram Mini App menu synced to Shaurma City');
 }catch(e){console.error('Telegram Mini App sync:',e.message)}
}

async function syncAdminTelegramMiniApp(){
 const token=process.env.ADMIN_TELEGRAM_BOT_TOKEN;
 if(!token){console.log('Telegram admin bot token not configured');return}
 try{
  const r=await fetch('https://api.telegram.org/bot'+token+'/setChatMenuButton',{
   method:'POST',
   headers:{'Content-Type':'application/json'},
   body:JSON.stringify({menu_button:{type:'web_app',text:'Админка Shaurma City',web_app:{url:'https://shaurma-city-api.onrender.com/shaurma-owner?v=4'}}})
  });
  const j=await r.json().catch(()=>({}));
  if(!r.ok||!j.ok)throw new Error(j.description||('HTTP '+r.status));
  console.log('Telegram admin Mini App menu synced to Shaurma City');
 }catch(e){console.error('Telegram admin Mini App sync:',e.message)}
}


app.post('/api/shaurma/login',(req,res)=>{
 if(!process.env.OWNER_PASSWORD||!process.env.OWNER_API_TOKEN)return res.status(503).json({error:'owner_not_configured'});
 if((req.body||{}).password!==process.env.OWNER_PASSWORD)return res.status(401).json({error:'invalid_password'});
 res.json({ok:true,token:process.env.OWNER_API_TOKEN});
});

app.get('/api/shaurma/venues',async(req,res)=>{
 try{
  res.setHeader('Cache-Control','no-store, no-cache, must-revalidate');
  if(!DB)return res.json([SEEDED_VENUES[0]].map(v=>({venue_id:v.venue_id,slug:v.slug,name:v.name,is_active:true,config:v.config})));
  const q=await DB.query(`SELECT DISTINCT v.establishment_id,v.venue_id,v.slug,v.name,v.is_active,v.config,v.updated_at FROM shaurma_venues v LEFT JOIN shaurmeg_markers m ON m.venue_id=v.venue_id WHERE v.is_active=TRUE AND (v.venue_id=$1 OR m.id IS NOT NULL) ORDER BY v.name`,[DEFAULT_VENUE_ID]);
  res.json(q.rows);
 }catch(e){console.error('venue list:',e.message);res.status(500).json({error:'venue_list_failed'})}
});

app.get('/api/shaurma/admin/venues',async(req,res)=>{
 if(!ownerOk(req))return res.sendStatus(401);
 try{
  res.setHeader('Cache-Control','no-store, no-cache, must-revalidate');
  if(!DB)return res.json([SEEDED_VENUES[0]].map(v=>({venue_id:v.venue_id,slug:v.slug,name:v.name,is_active:true,config:v.config})));
  const q=await DB.query(`SELECT DISTINCT v.establishment_id,v.venue_id,v.slug,v.name,v.is_active,v.config,v.updated_at,COUNT(m.id)::int AS marker_count FROM shaurma_venues v LEFT JOIN shaurmeg_markers m ON m.venue_id=v.venue_id WHERE v.venue_id=$1 OR m.id IS NOT NULL GROUP BY v.venue_id ORDER BY v.name`,[DEFAULT_VENUE_ID]);
  res.json(q.rows);
 }catch(e){console.error('admin venue list:',e.message);res.status(500).json({error:'venue_list_failed'})}
});

app.get('/api/shaurma/client-config',async(req,res)=>{
 try{
  res.setHeader('Cache-Control','no-store, no-cache, must-revalidate');
  const botInfo=await getClientBotInfo();
  const botUsername=botInfo?.username||'';
  if(!botUsername)return res.status(503).json({error:'telegram_not_configured'});
  const shortName=String(process.env.CLIENT_MINI_APP_SHORT_NAME||'').trim();
  const base=shortName?`https://t.me/${botUsername}/${shortName}?startapp=venue_{venue_id}`:`https://t.me/${botUsername}?startapp=venue_{venue_id}`;
  res.json({bot_username:botUsername,mini_app_short_name:shortName||null,has_main_mini_app:Boolean(botInfo.has_main_web_app),default_venue_id:DEFAULT_VENUE_ID,launch_url_template:base});
 }catch(e){console.error('client config:',e.message);res.status(502).json({error:'telegram_lookup_failed'})}
});

function publishVenue(venue){
 const clients=venueClients.get(venue.venue_id);if(!clients)return;
 const payload='event: venue\ndata: '+JSON.stringify(venue)+'\n\n';
 for(const client of clients){try{client.write(payload)}catch{clients.delete(client)}}
 if(!clients.size)venueClients.delete(venue.venue_id);
}

function normalizeRealCityReferences(value){
 const allowed=new Set(['hero_facade','street_left','street_right','neighbor','courtyard','environment']);
 if(!Array.isArray(value))return [];
 return value.slice(0,8).map((item,index)=>{
  if(typeof item==='string'){
   const src=String(item||'').trim();
   return src.startsWith('data:image/')?{src,role:index===0?'hero_facade':'environment'}:null;
  }
  if(!item||typeof item!=='object')return null;
  const src=String(item.src||item.image||item.data||'').trim();
  if(!src.startsWith('data:image/'))return null;
  const role=allowed.has(item.role)?item.role:(index===0?'hero_facade':'environment');
  return {src,role};
 }).filter(Boolean);
}
function normalizeHex(v,fallback){
 const s=String(v||'').trim();
 return /^#[0-9a-f]{6}$/i.test(s)?s.toLowerCase():fallback;
}
function normalizeMarkerStyle(value,category='shawarma'){
 const base=appearanceFor(category);
 const v=value&&typeof value==='object'&&!Array.isArray(value)?value:{};
 const shapes=new Set(['pin','circle','rounded','square']);
 return {
  icon:String(v.icon??base.icon).trim().slice(0,8)||base.icon,
  background:normalizeHex(v.background,base.background),
  border:normalizeHex(v.border,base.border),
  text:normalizeHex(v.text,base.text),
  glow:normalizeHex(v.glow,base.glow),
  shape:shapes.has(v.shape)?v.shape:base.shape,
  size:Math.max(28,Math.min(72,Number(v.size)||base.size)),
  scale:Math.max(.65,Math.min(1.8,Number(v.scale)||base.scale)),
  opacity:Math.max(.3,Math.min(1,Number(v.opacity)||base.opacity)),
  pulse:v.pulse===undefined?!!base.pulse:!!v.pulse,
  label_visible:!!v.label_visible
 };
}
function markerPayload(body={}){
 const gallery=Array.isArray(body.gallery)?body.gallery.map(x=>String(x||'').trim()).filter(Boolean).slice(0,6):[];
 const realcity_reference_images=normalizeRealCityReferences(body.realcity_reference_images);
 return {
  venue_id:normalizeVenueId(body.venue_id),name:String(body.name||'').trim().slice(0,160),address:String(body.address||'').trim().slice(0,300),
  description:String(body.description||'').trim().slice(0,1400),lat:Number(body.lat),lon:Number(body.lon),hero_image:String(body.hero_image||'').trim().slice(0,1800000),
  gallery,realcity_reference_images,hours:String(body.hours||'').trim().slice(0,160),price_label:String(body.price_label||'').trim().slice(0,80),is_active:body.is_active!==false,
  category:String(body.category||'shawarma').trim().slice(0,64)||'shawarma',
  marker_avatar:String(body.marker_avatar||'').trim().slice(0,900000),
  marker_style:normalizeMarkerStyle(body.marker_style,body.category||'shawarma')
 };
}
function markerValid(x,{requireVenue=true}={}){return (!requireVenue||x.venue_id)&&x.name&&Number.isFinite(x.lat)&&Number.isFinite(x.lon)&&x.lat>=-90&&x.lat<=90&&x.lon>=-180&&x.lon<=180}
function publicMarker(row){
 const menu=Array.isArray(row.menu)?row.menu.slice(0,6).map(x=>({id:String(x.id||''),name:String(x.n||x.name||'Позиция'),description:String(x.d||x.description||''),price:x.p??x.price??null,category:String(x.c||x.category||'')})):[];
 const style=normalizeMarkerStyle(row.marker_style,row.category||'shawarma');
 return {id:row.id,marker_id:row.id,establishment_id:row.establishment_id||null,venue_id:row.venue_id,name:row.name,address:row.address,description:row.description,lat:row.lat,lon:row.lon,hero_image:row.hero_image,gallery:Array.isArray(row.gallery)?row.gallery:[],hours:row.hours,price_label:row.price_label,category:row.category||'shawarma',marker_style:style,has_avatar:!!row.marker_avatar,verification_status:row.verification_status||'manual',verification_score:Number(row.verification_score??1),source_provider:row.source_provider||'',realcity_status:row.realcity_status||'pending',realcity_quality:row.realcity_quality||'heuristic',realcity_updated_at:row.realcity_updated_at||null,menu};
}

app.get('/api/shaurmeg/markers',async(req,res)=>{
 res.setHeader('Cache-Control','no-store, no-cache, must-revalidate');
 if(!DB)return res.json([]);
 try{
  const q=await DB.query(`SELECT m.*,v.menu FROM shaurmeg_markers m JOIN shaurma_venues v ON v.venue_id=m.venue_id WHERE m.is_active=TRUE AND v.is_active=TRUE ORDER BY m.updated_at DESC`);
  if(req.query.lite==='1')return res.json(q.rows.map(row=>({id:row.id,venue_id:row.venue_id,name:row.name,address:row.address,lat:row.lat,lon:row.lon,category:row.category||'shawarma',marker_style:normalizeMarkerStyle(row.marker_style,row.category||'shawarma'),has_avatar:!!row.marker_avatar,verification_status:row.verification_status||'manual',verification_score:Number(row.verification_score??1),realcity_status:row.realcity_status||'pending',realcity_quality:row.realcity_quality||'heuristic'})));
  res.json(q.rows.map(publicMarker));
 }catch(e){console.error('marker list:',e.message);res.status(500).json({error:'marker_list_failed'})}
});

app.get('/api/shaurmeg/admin/markers',async(req,res)=>{
 if(!ownerOk(req))return res.sendStatus(401);if(!DB)return res.json([]);
 try{
  if(req.query.summary==='1'){
   const q=await DB.query(`SELECT id,establishment_id,venue_id,name,address,lat,lon,category,marker_style,(marker_avatar<>'') AS has_avatar,verification_status,verification_score,source_provider,source_id,auto_imported,position_locked,appearance_locked,metadata_locked,source_suppressed,is_active,updated_at FROM shaurmeg_markers ORDER BY id`);
   return res.json(q.rows.map(row=>({...row,marker_style:normalizeMarkerStyle(row.marker_style,row.category||'shawarma'),has_avatar:!!row.has_avatar,auto_imported:!!row.auto_imported,position_locked:!!row.position_locked,appearance_locked:!!row.appearance_locked,metadata_locked:!!row.metadata_locked,source_suppressed:!!row.source_suppressed,verification_score:Number(row.verification_score??1)})));
  }
  const q=await DB.query(`SELECT m.*,v.menu FROM shaurmeg_markers m JOIN shaurma_venues v ON v.venue_id=m.venue_id ORDER BY m.updated_at DESC`);
  res.json(q.rows.map(row=>({...publicMarker(row),marker_avatar:row.marker_avatar||'',marker_style:normalizeMarkerStyle(row.marker_style,row.category||'shawarma'),realcity_reference_images:Array.isArray(row.realcity_reference_images)?row.realcity_reference_images:[],realcity_profile:row.realcity_profile&&typeof row.realcity_profile==='object'?row.realcity_profile:{},source_id:row.source_id||'',source_data:row.source_data||{},verification_details:row.verification_details||{},auto_imported:!!row.auto_imported,position_locked:!!row.position_locked,appearance_locked:!!row.appearance_locked,metadata_locked:!!row.metadata_locked,source_suppressed:!!row.source_suppressed,is_active:row.is_active,created_at:row.created_at,updated_at:row.updated_at})));
 }catch(e){res.status(500).json({error:'marker_list_failed'})}
});

app.get('/api/shaurmeg/admin/markers/:id',async(req,res)=>{
 if(!ownerOk(req))return res.sendStatus(401);if(!DB)return res.sendStatus(404);
 try{
  const q=await DB.query(`SELECT m.*,v.menu FROM shaurmeg_markers m JOIN shaurma_venues v ON v.venue_id=m.venue_id WHERE m.id=$1 LIMIT 1`,[req.params.id]);
  const row=q.rows[0];if(!row)return res.sendStatus(404);
  res.json({...publicMarker(row),marker_avatar:row.marker_avatar||'',marker_style:normalizeMarkerStyle(row.marker_style,row.category||'shawarma'),realcity_reference_images:Array.isArray(row.realcity_reference_images)?row.realcity_reference_images:[],realcity_profile:row.realcity_profile&&typeof row.realcity_profile==='object'?row.realcity_profile:{},source_id:row.source_id||'',source_data:row.source_data||{},verification_details:row.verification_details||{},auto_imported:!!row.auto_imported,position_locked:!!row.position_locked,appearance_locked:!!row.appearance_locked,metadata_locked:!!row.metadata_locked,source_suppressed:!!row.source_suppressed,is_active:row.is_active,created_at:row.created_at,updated_at:row.updated_at});
 }catch(e){res.status(500).json({error:'marker_read_failed'})}
});

app.post('/api/shaurmeg/admin/markers',async(req,res)=>{
 if(!ownerOk(req))return res.sendStatus(401);if(!DB)return res.status(503).json({error:'persistent_storage_required'});
 const x=markerPayload(req.body);if(!markerValid(x,{requireVenue:false}))return res.status(400).json({error:'invalid_marker'});
 const client=await DB.connect();
 try{
  await client.query('BEGIN');
  const venueId=x.venue_id||crypto.randomBytes(8).toString('hex'),establishmentId=establishmentIdForVenue(venueId);
  const venue=await client.query(`INSERT INTO shaurma_venues(venue_id,slug,name,is_active,config,menu,establishment_id) VALUES($1,$1,$2,$3,$4::jsonb,'[]'::jsonb,$5) ON CONFLICT(venue_id) DO UPDATE SET name=EXCLUDED.name,is_active=EXCLUDED.is_active,establishment_id=COALESCE(shaurma_venues.establishment_id,EXCLUDED.establishment_id),updated_at=NOW() RETURNING *`,[venueId,x.name,x.is_active,JSON.stringify({subtitle:'МЕНЮ ЗАВЕДЕНИЯ',builder_enabled:false}),establishmentId]);
  const q=await client.query(`INSERT INTO shaurmeg_markers(venue_id,establishment_id,name,address,description,lat,lon,hero_image,gallery,realcity_reference_images,hours,price_label,is_active,category,marker_avatar,marker_style,realcity_status,realcity_quality,verification_status,verification_score,metadata_locked,position_locked) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11,$12,$13,$14,$15,$16::jsonb,'pending','heuristic','manual',1,TRUE,TRUE) RETURNING *`,[venueId,establishmentId,x.name,x.address,x.description,x.lat,x.lon,x.hero_image,JSON.stringify(x.gallery),JSON.stringify(x.realcity_reference_images),x.hours,x.price_label,x.is_active,x.category,x.marker_avatar,JSON.stringify(x.marker_style)]);
  await client.query('COMMIT');publishVenue(venue.rows[0]);queueRealCityProfile(q.rows[0].id);res.status(201).json(q.rows[0]);
 }catch(e){await client.query('ROLLBACK').catch(()=>{});console.error('marker create:',e.message);res.status(500).json({error:'marker_create_failed'})}finally{client.release()}
});

app.put('/api/shaurmeg/admin/markers/:id',async(req,res)=>{
 if(!ownerOk(req))return res.sendStatus(401);if(!DB)return res.status(503).json({error:'persistent_storage_required'});
 const x=markerPayload(req.body);if(!markerValid(x,{requireVenue:false}))return res.status(400).json({error:'invalid_marker'});
 const client=await DB.connect();
 try{
  await client.query('BEGIN');
  const current=await client.query('SELECT venue_id FROM shaurmeg_markers WHERE id=$1 FOR UPDATE',[req.params.id]);if(!current.rows[0]){await client.query('ROLLBACK');return res.sendStatus(404)}
  const venueId=current.rows[0].venue_id;
  const q=await client.query(`UPDATE shaurmeg_markers SET name=$1,address=$2,description=$3,lat=$4,lon=$5,hero_image=$6,gallery=$7::jsonb,realcity_reference_images=$8::jsonb,hours=$9,price_label=$10,is_active=$11,category=$12,marker_avatar=$13,marker_style=$14::jsonb,metadata_locked=TRUE,position_locked=TRUE,appearance_locked=TRUE,realcity_status='pending',updated_at=NOW() WHERE id=$15 RETURNING *`,[x.name,x.address,x.description,x.lat,x.lon,x.hero_image,JSON.stringify(x.gallery),JSON.stringify(x.realcity_reference_images),x.hours,x.price_label,x.is_active,x.category,x.marker_avatar,JSON.stringify(x.marker_style),req.params.id]);
  const venue=await client.query('UPDATE shaurma_venues SET name=$1,is_active=$2,updated_at=NOW() WHERE venue_id=$3 RETURNING *',[x.name,x.is_active,venueId]);
  await client.query('COMMIT');if(venue.rows[0])publishVenue(venue.rows[0]);queueRealCityProfile(req.params.id);res.json(q.rows[0]);
 }catch(e){await client.query('ROLLBACK').catch(()=>{});console.error('marker update:',e.message);res.status(500).json({error:'marker_update_failed'})}finally{client.release()}
});


app.get('/api/shaurmeg/map-points',async(req,res)=>{
 res.setHeader('Cache-Control','public, max-age=120, stale-while-revalidate=600');
 if(!DB)return res.json([]);
 try{
  const q=await DB.query(`SELECT m.id,m.establishment_id,m.venue_id,m.name,m.address,m.lat,m.lon,m.category,m.marker_style,(m.marker_avatar<>'') AS has_avatar,m.verification_status,m.verification_score,m.updated_at,(jsonb_array_length(v.menu)>0) AS has_menu
    FROM shaurmeg_markers m JOIN shaurma_venues v ON v.venue_id=m.venue_id
    WHERE m.is_active=TRUE AND v.is_active=TRUE AND COALESCE(m.source_suppressed,FALSE)=FALSE
    ORDER BY m.id`);
  res.json(q.rows.map(row=>({id:row.id,marker_id:row.id,establishment_id:row.establishment_id||null,venue_id:row.venue_id,name:row.name,address:row.address,lat:row.lat,lon:row.lon,category:row.category||'shawarma',marker_style:normalizeMarkerStyle(row.marker_style,row.category||'shawarma'),has_avatar:!!row.has_avatar,has_menu:!!row.has_menu,verification_status:row.verification_status||'manual',verification_score:Number(row.verification_score??1),updated_at:row.updated_at})));
 }catch(e){console.error('map points:',e.message);res.status(500).json({error:'map_points_failed'})}
});

app.get('/api/shaurmeg/markers/:id/avatar',async(req,res)=>{
 if(!DB)return res.sendStatus(404);
 try{
  const q=await DB.query("SELECT marker_avatar FROM shaurmeg_markers WHERE id=$1 AND is_active=TRUE LIMIT 1",[req.params.id]);
  const raw=String(q.rows[0]?.marker_avatar||'');
  const m=raw.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/s);
  if(!m)return res.sendStatus(404);
  const buf=Buffer.from(m[2],'base64');
  res.setHeader('Cache-Control','public, max-age=86400, immutable');
  res.type(m[1]).send(buf);
 }catch{res.sendStatus(404)}
});

app.patch('/api/shaurmeg/admin/markers/:id/position',async(req,res)=>{
 if(!ownerOk(req))return res.sendStatus(401);if(!DB)return res.status(503).json({error:'persistent_storage_required'});
 const lat=Number(req.body?.lat),lon=Number(req.body?.lon);
 if(!Number.isFinite(lat)||!Number.isFinite(lon)||lat<-90||lat>90||lon<-180||lon>180)return res.status(400).json({error:'invalid_position'});
 try{
  const q=await DB.query("UPDATE shaurmeg_markers SET lat=$2,lon=$3,position_locked=TRUE,realcity_status='pending',updated_at=NOW() WHERE id=$1 RETURNING id,lat,lon",[req.params.id,lat,lon]);
  if(!q.rows[0])return res.sendStatus(404);
  queueRealCityProfile(req.params.id);res.json(q.rows[0]);
 }catch(e){res.status(500).json({error:'position_update_failed'})}
});

app.patch('/api/shaurmeg/admin/markers/:id/appearance',async(req,res)=>{
 if(!ownerOk(req))return res.sendStatus(401);if(!DB)return res.status(503).json({error:'persistent_storage_required'});
 try{
  const current=await DB.query("SELECT category,marker_style FROM shaurmeg_markers WHERE id=$1 LIMIT 1",[req.params.id]);
  if(!current.rows[0])return res.sendStatus(404);
  const style=normalizeMarkerStyle(req.body?.marker_style||current.rows[0].marker_style,current.rows[0].category||'shawarma');
  const avatar=String(req.body?.marker_avatar??'').trim().slice(0,900000);
  const q=await DB.query("UPDATE shaurmeg_markers SET marker_style=$2::jsonb,marker_avatar=$3,appearance_locked=TRUE,updated_at=NOW() WHERE id=$1 RETURNING id,marker_style,(marker_avatar<>'') AS has_avatar",[req.params.id,JSON.stringify(style),avatar]);
  res.json(q.rows[0]);
 }catch(e){res.status(500).json({error:'appearance_update_failed'})}
});

app.post('/api/shaurmeg/admin/markers/:id/verify',async(req,res)=>{
 if(!ownerOk(req))return res.sendStatus(401);if(!DB)return res.status(503).json({error:'persistent_storage_required'});
 const status=['manual_verified','needs_review','closed'].includes(req.body?.status)?req.body.status:'manual_verified';
 const score=status==='manual_verified'?1:status==='closed'?0:.45;
 try{
  const q=await DB.query("UPDATE shaurmeg_markers SET verification_status=$2,verification_score=$3,verification_details=COALESCE(verification_details,'{}'::jsonb)||$4::jsonb,is_active=CASE WHEN $2='closed' THEN FALSE WHEN $2='manual_verified' THEN TRUE ELSE is_active END,source_suppressed=CASE WHEN auto_imported AND $2='closed' THEN TRUE WHEN $2='manual_verified' THEN FALSE ELSE source_suppressed END,updated_at=NOW() WHERE id=$1 RETURNING id,verification_status,verification_score,is_active,source_suppressed",[req.params.id,status,score,JSON.stringify({manual_verified_at:new Date().toISOString(),manual_note:String(req.body?.note||'').slice(0,300)})]);
  if(!q.rows[0])return res.sendStatus(404);res.json(q.rows[0]);
 }catch(e){res.status(500).json({error:'verification_update_failed'})}
});

app.get('/api/shaurmeg/catalog-stats',async(req,res)=>{
 res.setHeader('Cache-Control','no-store');
 if(!DB)return res.json({total:0});
 try{
  const [total,cats,verify,run]=await Promise.all([
    DB.query("SELECT COUNT(*)::int total FROM shaurmeg_markers WHERE is_active=TRUE AND COALESCE(source_suppressed,FALSE)=FALSE"),
    DB.query("SELECT category,COUNT(*)::int count FROM shaurmeg_markers WHERE is_active=TRUE AND COALESCE(source_suppressed,FALSE)=FALSE GROUP BY category ORDER BY count DESC"),
    DB.query("SELECT verification_status,COUNT(*)::int count FROM shaurmeg_markers WHERE is_active=TRUE AND COALESCE(source_suppressed,FALSE)=FALSE GROUP BY verification_status ORDER BY count DESC"),
    DB.query("SELECT id,provider,region,status,reason,raw_count,discovered_count,inserted_count,updated_count,details,started_at,finished_at FROM shaurmeg_discovery_runs ORDER BY started_at DESC LIMIT 1")
  ]);
  res.json({total:total.rows[0]?.total||0,categories:cats.rows,verification:verify.rows,last_run:run.rows[0]||null});
 }catch(e){res.status(500).json({error:'catalog_stats_failed'})}
});

app.post('/api/shaurmeg/admin/discovery/moscow',async(req,res)=>{
 if(!ownerOk(req))return res.sendStatus(401);
 if(!VENUE_DISCOVERY_ENABLED)return res.status(409).json({error:'discovery_disabled',message:'Каталог зафиксирован. Новые точки добавляются вручную.'});
 const promise=runMoscowDiscovery({reason:'manual'});res.status(202).json({ok:true,running:true});
 promise.catch(()=>{});
});

app.get('/api/shaurmeg/realcity-profile/:id',async(req,res)=>{
 if(!DB)return res.status(503).json({error:'persistent_storage_required'});
 try{
  const q=await DB.query("SELECT id,venue_id,realcity_profile,realcity_status,realcity_quality,realcity_updated_at FROM shaurmeg_markers WHERE id=$1 AND is_active=TRUE LIMIT 1",[req.params.id]);
  const row=q.rows[0];if(!row)return res.sendStatus(404);
  const profile=row.realcity_profile&&typeof row.realcity_profile==='object'?row.realcity_profile:{};
  if(row.realcity_status!=='ready'||Number(profile.version||0)<7)queueRealCityProfile(row.id);
  res.setHeader('Cache-Control','public, max-age=60, stale-while-revalidate=600');
  res.json({marker_id:row.id,venue_id:row.venue_id,status:row.realcity_status||'pending',quality:row.realcity_quality||'heuristic',updated_at:row.realcity_updated_at||null,profile});
 }catch(e){res.status(500).json({error:'realcity_profile_failed'})}
});

app.post('/api/shaurmeg/admin/markers/:id/rebuild-realcity',async(req,res)=>{
 if(!ownerOk(req))return res.sendStatus(401);if(!DB)return res.status(503).json({error:'persistent_storage_required'});
 const q=await DB.query("UPDATE shaurmeg_markers SET realcity_status='pending' WHERE id=$1 RETURNING id",[req.params.id]);
 if(!q.rows[0])return res.sendStatus(404);queueRealCityProfile(req.params.id);res.status(202).json({ok:true,status:'pending'});
});


app.delete('/api/shaurmeg/admin/markers/:id',async(req,res)=>{
 if(!ownerOk(req))return res.sendStatus(401);if(!DB)return res.status(503).json({error:'persistent_storage_required'});
 const client=await DB.connect();
 try{
  await client.query('BEGIN');
  const existing=await client.query('SELECT id,venue_id,auto_imported FROM shaurmeg_markers WHERE id=$1 FOR UPDATE',[req.params.id]);
  if(!existing.rows[0]){await client.query('ROLLBACK');return res.sendStatus(404)}
  if(existing.rows[0].auto_imported){
   await client.query("UPDATE shaurmeg_markers SET is_active=FALSE,source_suppressed=TRUE,updated_at=NOW() WHERE id=$1",[req.params.id]);
   await client.query("UPDATE shaurma_venues SET is_active=FALSE,updated_at=NOW() WHERE venue_id=$1",[existing.rows[0].venue_id]);
  }else{
   await client.query('DELETE FROM shaurmeg_markers WHERE id=$1',[req.params.id]);
   const venueId=existing.rows[0].venue_id;
   if(venueId!==DEFAULT_VENUE_ID)await client.query('DELETE FROM shaurma_venues v WHERE v.venue_id=$1 AND NOT EXISTS (SELECT 1 FROM shaurmeg_markers m WHERE m.venue_id=v.venue_id)',[venueId]);
  }
  await client.query('COMMIT');res.json({ok:true,id:existing.rows[0].id,suppressed:!!existing.rows[0].auto_imported});
 }catch(e){await client.query('ROLLBACK').catch(()=>{});res.status(500).json({error:'marker_delete_failed'})}finally{client.release()}
});

app.get('/api/shaurma/venues/:venueId',async(req,res)=>{
 try{
  res.setHeader('Cache-Control','no-store, no-cache, must-revalidate');
  const id=normalizeVenueId(req.params.venueId);
  if(!id)return res.status(400).json({error:'bad_venue_id'});
  const venue=await resolveVenue(id);
  if(!venue)return res.status(404).json({error:'venue_not_found'});
  res.json(venue);
 }catch(e){console.error('venue read:',e.message);res.status(500).json({error:'venue_read_failed'})}
});

app.get('/api/shaurma/venues/:venueId/stream',async(req,res)=>{
 const venue=await resolveVenue(req.params.venueId).catch(()=>null);
 if(!venue)return res.status(404).json({error:'venue_not_found'});
 res.setHeader('Content-Type','text/event-stream');
 res.setHeader('Cache-Control','no-cache, no-transform');
 res.setHeader('Connection','keep-alive');
 res.flushHeaders?.();
 const id=venue.venue_id,clients=venueClients.get(id)||new Set();
 clients.add(res);venueClients.set(id,clients);
 res.write('event: venue\ndata: '+JSON.stringify(venue)+'\n\n');
 const keep=setInterval(()=>{try{res.write(': ping\n\n')}catch{}},20000);
 req.on('close',()=>{clearInterval(keep);clients.delete(res);if(!clients.size)venueClients.delete(id)});
});

app.put('/api/shaurma/venues/:venueId',async(req,res)=>{
 if(!ownerOk(req))return res.sendStatus(401);
 if(!DB)return res.status(503).json({error:'persistent_storage_required'});
 const venueId=normalizeVenueId(req.params.venueId);
 const body=req.body||{};
 const slug=normalizeVenueId(body.slug||venueId);
 const name=String(body.name||'').trim().slice(0,160);
 const config=body.config&&typeof body.config==='object'&&!Array.isArray(body.config)?body.config:{};
 const menu=Array.isArray(body.menu)?body.menu:[];
 if(!venueId||!slug||!name)return res.status(400).json({error:'invalid_venue'});
 if(JSON.stringify(config).length>50000||JSON.stringify(menu).length>500000)return res.status(413).json({error:'venue_too_large'});
 try{
  const q=await DB.query(`
   INSERT INTO shaurma_venues(venue_id,slug,name,is_active,config,menu,establishment_id)
   VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7)
   ON CONFLICT(venue_id) DO UPDATE SET slug=EXCLUDED.slug,name=EXCLUDED.name,is_active=EXCLUDED.is_active,
    config=EXCLUDED.config,menu=EXCLUDED.menu,establishment_id=COALESCE(shaurma_venues.establishment_id,EXCLUDED.establishment_id),updated_at=NOW()
   RETURNING *
  `,[venueId,slug,name,body.is_active!==false,JSON.stringify(config),JSON.stringify(menu),establishmentIdForVenue(venueId)]);
  publishVenue(q.rows[0]);
  res.json(q.rows[0]);
 }catch(e){
  if(e.code==='23505')return res.status(409).json({error:'venue_slug_exists'});
  console.error('venue upsert:',e.message);res.status(500).json({error:'venue_update_failed'});
 }
});

app.get('/api/shaurma/stream',(req,res)=>{
 if(!ownerOk(req))return res.sendStatus(401);
 res.setHeader('Content-Type','text/event-stream');
 res.setHeader('Cache-Control','no-cache');
 res.setHeader('Connection','keep-alive');
 res.flushHeaders?.();
 res.write('event: ready\ndata: {"ok":true}\n\n');
 ownerClients.add(res);
 const keep=setInterval(()=>{try{res.write(': ping\n\n')}catch{}},20000);
 req.on('close',()=>{clearInterval(keep);ownerClients.delete(res)});
});


app.post('/api/shaurma/admin-telegram-auth',(req,res)=>{
 try{
  const user=verifyTelegramInitDataWithToken((req.body||{}).initData||'',process.env.ADMIN_TELEGRAM_BOT_TOKEN);
  if(!adminTelegramAllowed(user.id))return res.status(403).json({error:'admin_not_allowed',user_id:String(user.id)});
  const session=newAdminTelegramSession(user);
  res.json({ok:true,session,user:{id:String(user.id),username:user.username||'',first_name:user.first_name||'',last_name:user.last_name||''}});
 }catch(e){
  if(e.message==='telegram_not_configured')return res.status(503).json({error:e.message});
  res.status(401).json({error:e.message||'admin_telegram_auth_failed'});
 }
});

app.post('/api/shaurma/telegram-auth',async(req,res)=>{
 try{
  const user=verifyTelegramInitData((req.body||{}).initData||'');
  const session=newTelegramSession(user);
  const stored=await upsertTelegramUser(user);
  res.json({ok:true,session,user:stored?publicUserProfile(stored):{id:String(user.id),username:user.username||'',first_name:user.first_name||'',last_name:user.last_name||'',profile:{},favorites:[],preferences:{},payment:{linked:false,autopay_enabled:false}}});
 }catch(e){
  if(e.message==='telegram_not_configured') return res.status(503).json({error:e.message});
  console.error('telegram auth:',e.message);
  res.status(401).json({error:e.message||'telegram_auth_failed'});
 }
});

app.get('/api/shaurma/me',async(req,res)=>{
 const sess=telegramSession(req);if(!sess)return res.sendStatus(401);
 if(!DB)return res.status(503).json({error:'persistent_storage_required'});
 try{
  const q=await DB.query(`SELECT telegram_user_id,username,first_name,last_name,language_code,is_premium,profile,favorites,preferences,
   payment_provider,payment_card_brand,payment_card_last4,autopay_enabled,created_at,last_seen_at,updated_at
   FROM shaurma_users WHERE telegram_user_id=$1`,[String(sess.user.id)]);
  if(!q.rows[0])return res.sendStatus(404);
  res.json(publicUserProfile(q.rows[0]));
 }catch(e){res.status(500).json({error:'profile_read_failed'})}
});

app.patch('/api/shaurma/me',async(req,res)=>{
 const sess=telegramSession(req);if(!sess)return res.sendStatus(401);
 if(!DB)return res.status(503).json({error:'persistent_storage_required'});
 try{
  const body=req.body||{};
  const profile=(body.profile&&typeof body.profile==='object'&&!Array.isArray(body.profile))?body.profile:null;
  const preferences=(body.preferences&&typeof body.preferences==='object'&&!Array.isArray(body.preferences))?body.preferences:null;
  const favorites=Array.isArray(body.favorites)?body.favorites.slice(0,100):null;
  if(profile && JSON.stringify(profile).length>12000)return res.status(413).json({error:'profile_too_large'});
  if(preferences && JSON.stringify(preferences).length>20000)return res.status(413).json({error:'preferences_too_large'});
  if(favorites && JSON.stringify(favorites).length>30000)return res.status(413).json({error:'favorites_too_large'});
  const q=await DB.query(`
   UPDATE shaurma_users SET
    profile=CASE WHEN $2::jsonb IS NULL THEN profile ELSE profile || $2::jsonb END,
    preferences=CASE WHEN $3::jsonb IS NULL THEN preferences ELSE preferences || $3::jsonb END,
    favorites=COALESCE($4::jsonb,favorites),
    updated_at=NOW()
   WHERE telegram_user_id=$1
   RETURNING telegram_user_id,username,first_name,last_name,language_code,is_premium,profile,favorites,preferences,
    payment_provider,payment_card_brand,payment_card_last4,autopay_enabled,created_at,last_seen_at,updated_at
  `,[String(sess.user.id),profile?JSON.stringify(profile):null,preferences?JSON.stringify(preferences):null,favorites?JSON.stringify(favorites):null]);
  if(!q.rows[0])return res.sendStatus(404);
  res.json(publicUserProfile(q.rows[0]));
 }catch(e){console.error('profile update:',e.message);res.status(500).json({error:'profile_update_failed'})}
});

app.get('/api/shaurma/my-orders',async(req,res)=>{
 const sess=telegramSession(req); if(!sess)return res.sendStatus(401);
 try{
  const uid=String(sess.user.id);
  const rows=DB?(await DB.query('SELECT * FROM shaurma_orders WHERE telegram_user_id=$1 ORDER BY created_at DESC LIMIT 100',[uid])).rows:(readStore().shaurma_orders||[]).filter(x=>String(x.telegram_user_id)===uid).sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
  res.json(rows);
 }catch(e){res.status(500).json({error:e.message})}
});

app.get('/api/shaurma/my-stream',(req,res)=>{
 const sess=telegramSession(req); if(!sess)return res.sendStatus(401);
 const uid=String(sess.user.id);
 res.setHeader('Content-Type','text/event-stream');
 res.setHeader('Cache-Control','no-cache');
 res.setHeader('Connection','keep-alive');
 res.flushHeaders?.();
 res.write('event: ready\ndata: {"ok":true}\n\n');
 if(!telegramClients.has(uid)) telegramClients.set(uid,new Set());
 const set=telegramClients.get(uid); set.add(res);
 const keep=setInterval(()=>{try{res.write(': ping\n\n')}catch{}},20000);
 req.on('close',()=>{clearInterval(keep);set.delete(res);if(!set.size)telegramClients.delete(uid)});
});

app.post('/api/shaurma/orders',async(req,res)=>{
 const {items,total,customer_name,phone,address,comment,telegram_init_data,fulfillment_type,payment_status,payment_method,venue_id}=req.body||{};
 const sess=telegramSession(req);
 let tgUser=sess?sess.user:null;
 if(!tgUser && telegram_init_data){
  try{tgUser=verifyTelegramInitData(telegram_init_data)}catch{}
 }
 if(!Array.isArray(items)||!items.length)return res.status(400).json({error:'empty_order'});
 const fulfillment=fulfillment_type==='cafe'?'cafe':'delivery';
 if(fulfillment==='delivery' && !phone)return res.status(400).json({error:'phone_required'});
 if(fulfillment==='delivery' && !address)return res.status(400).json({error:'address_required'});
 const requestedVenueId=normalizeVenueId(venue_id||DEFAULT_VENUE_ID);
 if(!requestedVenueId)return res.status(400).json({error:'bad_venue_id'});
 const num=orderNumber();
 try{
  const venue=await resolveVenue(requestedVenueId);
  if(!venue)return res.status(404).json({error:'venue_not_found'});
  const venueMenu=new Map((Array.isArray(venue.menu)?venue.menu:[]).map(item=>[String(item.id),item]));
  const normalizedItems=[];
  for(const item of items){
   const qty=Math.max(1,Math.min(50,Math.floor(Number(item.q)||1))),menuItem=venueMenu.get(String(item.id));
   if(menuItem){
    const price=Number(menuItem.p??menuItem.price);
    if(!Number.isFinite(price)||price<0)return res.status(400).json({error:'invalid_menu_price',item_id:item.id});
    normalizedItems.push({id:String(menuItem.id),n:String(menuItem.n||menuItem.name||'Позиция'),p:price,q:qty,detail:String(item.detail||'').slice(0,500)});
   }else if(venue.config?.builder_enabled!==false&&item.builder){
    const price=Math.max(0,Math.min(100000,Number(item.p)||0));
    normalizedItems.push({id:String(item.id),n:String(item.n||'Своя сборка').slice(0,160),p:price,q:qty,detail:String(item.detail||'').slice(0,500),builder:true});
   }else return res.status(400).json({error:'item_not_in_venue_menu',item_id:item.id});
  }
  const calculatedTotal=normalizedItems.reduce((sum,item)=>sum+item.p*item.q,0);
  let order;
  const safePaymentStatus=['pending','paid','failed','cancelled'].includes(payment_status)?payment_status:'pending';
  if(DB){
   const q=await DB.query(
    'INSERT INTO shaurma_orders(order_number,items,total,customer_name,phone,address,comment,source,telegram_user_id,telegram_username,telegram_first_name,fulfillment_type,payment_status,payment_method,venue_id,venue_name) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *',
    [num,JSON.stringify(normalizedItems),calculatedTotal,customer_name||(tgUser?.first_name||'Гость'),fulfillment==='delivery'?(phone||null):null,fulfillment==='delivery'?(address||null):null,comment||'',tgUser?'telegram':'web',tgUser?String(tgUser.id):null,tgUser?.username||null,tgUser?.first_name||null,fulfillment,safePaymentStatus,payment_method||null,venue.venue_id,venue.name]
   );
   order=q.rows[0];
  }else{
   const d=readStore();d.shaurma_orders=d.shaurma_orders||[];
   order={id:Date.now(),order_number:num,items:normalizedItems,total:calculatedTotal,customer_name:customer_name||(tgUser?.first_name||'Гость'),phone:fulfillment==='delivery'?(phone||null):null,address:fulfillment==='delivery'?(address||null):null,comment:comment||'',status:'new',source:tgUser?'telegram':'web',telegram_user_id:tgUser?String(tgUser.id):null,telegram_username:tgUser?.username||null,telegram_first_name:tgUser?.first_name||null,fulfillment_type:fulfillment,payment_status:safePaymentStatus,payment_method:payment_method||null,venue_id:venue.venue_id,venue_name:venue.name,created_at:new Date().toISOString(),updated_at:new Date().toISOString()};
   d.shaurma_orders.push(order);writeStore(d);
  }
  pushOwner('order',order);
  if(order.telegram_user_id) pushTelegram(order.telegram_user_id,'order',order);
  res.status(201).json(order);
 }catch(e){console.error('create order:',e.message);res.status(500).json({error:'order_create_failed'})}
});

app.get('/api/shaurma/orders',async(req,res)=>{
 if(!ownerOk(req))return res.sendStatus(401);
 try{
  const venueId=req.query.venue_id?normalizeVenueId(req.query.venue_id):null;
  if(req.query.venue_id&&!venueId)return res.status(400).json({error:'bad_venue_id'});
  const rows=DB?(venueId?(await DB.query('SELECT * FROM shaurma_orders WHERE venue_id=$1 ORDER BY created_at DESC LIMIT 200',[venueId])).rows:(await DB.query('SELECT * FROM shaurma_orders ORDER BY created_at DESC LIMIT 200')).rows):(readStore().shaurma_orders||[]).filter(x=>!venueId||x.venue_id===venueId).slice().reverse();
  res.json(rows);
 }catch(e){res.status(500).json({error:e.message})}
});

app.patch('/api/shaurma/orders/:id',async(req,res)=>{
 if(!ownerOk(req))return res.sendStatus(401);
 const allowed=['new','cooking','ready','done','cancelled'];
 const status=(req.body||{}).status;
 if(!allowed.includes(status))return res.status(400).json({error:'bad_status'});
 try{
  let order;
  if(DB){
   const q=await DB.query('UPDATE shaurma_orders SET status=$1,updated_at=NOW() WHERE id=$2 RETURNING *',[status,req.params.id]);
   order=q.rows[0]; if(!order)return res.sendStatus(404);
  }else{
   const d=readStore(),arr=d.shaurma_orders||[],x=arr.find(v=>String(v.id)===String(req.params.id));if(!x)return res.sendStatus(404);x.status=status;x.updated_at=new Date().toISOString();writeStore(d);order=x;
  }
  pushOwner('update',order);if(order.telegram_user_id)pushTelegram(order.telegram_user_id,'update',order);res.json(order);
 }catch(e){res.status(500).json({error:e.message})}
});

app.get('/api/shaurma/stats',async(req,res)=>{
 if(!ownerOk(req))return res.sendStatus(401);
 try{
  const rows=DB?(await DB.query('SELECT * FROM shaurma_orders WHERE created_at >= NOW()-INTERVAL \'1 day\'')).rows:(readStore().shaurma_orders||[]).filter(x=>Date.now()-new Date(x.created_at).getTime()<86400000);
  res.json({
   today:rows.length,
   new:rows.filter(x=>x.status==='new').length,
   cooking:rows.filter(x=>x.status==='cooking').length,
   ready:rows.filter(x=>x.status==='ready').length,
   revenue:rows.filter(x=>x.status!=='cancelled').reduce((a,x)=>a+(Number(x.total)||0),0)
  });
 }catch(e){res.status(500).json({error:e.message})}
});

const sendOwner=(req,res)=>{res.setHeader('Cache-Control','no-store, no-cache, must-revalidate, max-age=0');res.setHeader('Pragma','no-cache');res.setHeader('Expires','0');res.sendFile(path.join(__dirname,'shaurma-owner.html'))};
const sendShaurmegOwner=(req,res)=>res.sendFile(path.join(__dirname,'shaurmeg-owner.html'));
app.get('/shaurma-owner',sendOwner);
app.get('/admin',sendOwner);
app.get('/owner',sendOwner);
app.get('/shaurmeg-owner',sendShaurmegOwner);

app.use((req,res)=>res.status(404).json({error:'not_found'}));

initDb().then(async()=>{console.log('Shaurma City database ready');await bootstrapRealCityProfiles();await syncTelegramMiniApp();await syncAdminTelegramMiniApp();if(VENUE_DISCOVERY_ENABLED){maybeAutoDiscoverMoscow('startup');setInterval(()=>maybeAutoDiscoverMoscow('interval'),6*60*60*1000).unref?.()}else console.log('Moscow discovery disabled · catalog frozen')}).catch(e=>console.error('DB init:',e.message)).finally(()=>app.listen(PORT,()=>console.log('Shaurma City API on '+PORT)));
