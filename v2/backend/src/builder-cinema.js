'use strict';
const crypto=require('crypto');
const D=require('./domain');
const fail=(message,status=422)=>{throw Object.assign(new Error(message),{status});};
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
function plan(builder,typeId,filling=''){
 const type=builder.types.find(x=>x.id===typeId);if(!type)fail('Формат блюда больше не существует');
 const slots=[];
 const add=(key,label)=>slots.push({key,label:String(label).slice(0,180)});
 for(const x of builder.breads)add('breads:'+x.id,x.name+' — open bread base for '+type.name);
 if(!builder.breads.length)add('base','Open bread base for '+type.name);
 if(filling.trim())add('filling',filling.trim());
 for(const group of ['meats','sauces','extras'])for(const x of builder[group])add(group+':'+x.id,x.name);
 if(slots.length>36)fail('Для одной фотосцены доступно до 36 слоёв. Сократите варианты конструктора.');
 return {type:type.name,slots,grid:Math.max(2,Math.ceil(Math.sqrt(slots.length)))};
}
function revision(builder,typeId,filling,reference){return hash({plan:plan(builder,typeId,filling),reference:hash(reference)});}
function photo(v){
 const m=/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(v||''));
 if(!m||m[2].length>1600000)fail('Загрузите фото JPEG, PNG или WebP до 1 МБ');
 return {mime:m[1],bytes:Buffer.from(m[2],'base64')};
}
async function render(reference,recipe,{fetcher=fetch,key=process.env.BUILDER_IMAGE_API_KEY||process.env.OPENAI_API_KEY}={}){
 if(!key)fail('Генерация пока не подключена на сервере. Фото сохранено; нужна настройка BUILDER_IMAGE_API_KEY.',503);
 const input=photo(reference),form=new FormData();
 form.set('model',process.env.BUILDER_IMAGE_MODEL||'gpt-image-2.5-sunburst');
 form.set('image',new Blob([input.bytes],{type:input.mime}),'dish.'+input.mime.split('/')[1]);
 form.set('size','1024x1024');form.set('quality','high');form.set('background','transparent');form.set('output_format','png');
 form.set('prompt',`Create one photorealistic food compositing atlas guided by the attached restaurant dish photo. Match actual bread, roast, ingredient cuts and natural colors, avoid stylization. Infer hidden ingredients only from the explicit list below; this is a reconstruction, not an exact recovery. Use a precisely uniform ${recipe.grid} by ${recipe.grid} grid spanning the entire canvas. Every cell has the same proportions and transparent background, no grid lines, no lettering, no dishes or hands. Directly overhead camera, identical soft upper-left lighting in all cells. Every ingredient is isolated, centered, contained within 12% margins, arranged in a vertical oval mound; bread fills 80% of its cell, all fillings fit inside the bread footprint. Sauce is thin zigzag ribbons with transparent gaps. Do NOT include bread under filling cells. Empty unused cells stay transparent. Dish: ${recipe.type}. Row-major cells, starting at 1: ${recipe.slots.map((s,i)=>`${i+1}: ${s.label}`).join('; ')}. Preserve authentic food photographic detail and restrained shadows. No illustration, no CGI.`);
 const r=await fetcher('https://api.openai.com/v1/images/edits',{method:'POST',headers:{Authorization:'Bearer '+key},body:form,signal:AbortSignal.timeout(210000)});
 if(!r.ok)fail(r.status===401?'Ключ генерации недействителен':r.status===429?'Сервис генерации временно недоступен или исчерпан лимит':'Не удалось подготовить фотослои. Попробуйте позже.',502);
 const j=await r.json(),b64=j.data?.[0]?.b64_json;if(!b64||b64.length>35000000)fail('Некорректный ответ генерации',502);
 const sharp=require('sharp'),buffer=Buffer.from(b64,'base64'),meta=await sharp(buffer,{limitInputPixels:10000000}).metadata();
 if(!meta.hasAlpha)fail('Слои получены без прозрачности. Повторите генерацию.',502);
 const stats=await sharp(buffer).stats();if(stats.channels[3]?.min===255||!stats.channels[3]?.max)fail('Фон слоёв непрозрачный. Повторите генерацию.',502);
 const out=await sharp(buffer).resize({width:1536,withoutEnlargement:true}).webp({quality:88}).toBuffer();
 return 'data:image/webp;base64,'+out.toString('base64');
}
async function ensureSchema(db){await db.query(`CREATE TABLE IF NOT EXISTS shaurmeg_builder_cinema(
 establishment_id TEXT NOT NULL, type_id TEXT NOT NULL, reference TEXT NOT NULL DEFAULT '', filling TEXT NOT NULL DEFAULT '',
 atlas TEXT NOT NULL DEFAULT '', recipe JSONB NOT NULL DEFAULT '{}'::jsonb, revision TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL DEFAULT 'reference', job_id TEXT NOT NULL DEFAULT '', error TEXT NOT NULL DEFAULT '', updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(establishment_id,type_id)
)`);}
function install(router,{db,access,apiUrl,base='/venue-owner/establishments/:establishmentId/builder-cinema',publicImages=true}){
 const wrap=fn=>async(req,res)=>{try{await fn(req,res)}catch(e){res.status(e.status||500).json({error:e.status?e.message:'Не удалось сохранить фотосцену'})}};
 const config=async est=>{const q=await db.query('SELECT config FROM shaurma_venues WHERE establishment_id=$1',[est]);if(!q.rows[0])fail('Заведение не найдено',404);return D.normalizeBuilderConfig(q.rows[0].config?.builder);};
 const images=(est,row)=>{const b=apiUrl+'/api/v2/builder-cinema-image/'+encodeURIComponent(est)+'/'+encodeURIComponent(row.type_id);const v=hash(row.updated_at).slice(0,12);return {reference_url:b+'/reference?v='+v,atlas_url:row.atlas?b+'/atlas?v='+v:''};};
 const describe=(est,row,builder)=>{let stale=true;try{stale=!!row.atlas&&hash(plan(builder,row.type_id,row.filling))!==hash(row.recipe)}catch{}
  return {type_id:row.type_id,filling:row.filling,status:row.status,stale,recipe:row.recipe,error:row.error,...images(est,row)};};
 router.get(base,wrap(async(req,res)=>{const a=await access(req,res,'menu');if(!a)return;const b=await config(a.est);const q=await db.query("SELECT type_id,filling,recipe,status,error,updated_at,atlas<>'' AS atlas,reference<>'' AS reference FROM shaurmeg_builder_cinema WHERE establishment_id=$1",[a.est]);res.json({generation_available:!!(process.env.BUILDER_IMAGE_API_KEY||process.env.OPENAI_API_KEY),scenes:q.rows.map(r=>describe(a.est,r,b))});}));
 router.put(base+'/:typeId/reference',wrap(async(req,res)=>{const a=await access(req,res,'menu');if(!a)return;const b=await config(a.est),type=String(req.params.typeId),reference=String(req.body?.reference||''),filling=String(req.body?.filling||'').trim().slice(0,180);photo(reference);const rev=revision(b,type,filling,reference);
  await db.query(`INSERT INTO shaurmeg_builder_cinema(establishment_id,type_id,reference,filling,revision) VALUES($1,$2,$3,$4,$5)
  ON CONFLICT(establishment_id,type_id) DO UPDATE SET reference=$3,filling=$4,revision=$5,atlas='',recipe='{}'::jsonb,status='reference',job_id='',error='',updated_at=NOW()`,[a.est,type,reference,filling,rev]);res.json({ok:true});
 }));
 router.post(base+'/:typeId/generate',wrap(async(req,res)=>{const a=await access(req,res,'menu');if(!a)return;
  if(!(process.env.BUILDER_IMAGE_API_KEY||process.env.OPENAI_API_KEY))fail('Генерация пока не подключена на сервере. Фото сохранено; нужна настройка BUILDER_IMAGE_API_KEY.',503);
  const b=await config(a.est),type=String(req.params.typeId),job=crypto.randomBytes(16).toString('hex'),filling=String(req.body?.filling||'').trim().slice(0,180);
  const q=await db.query(`UPDATE shaurmeg_builder_cinema SET status='processing',job_id=$3,filling=$4,error='',updated_at=NOW() WHERE establishment_id=$1 AND type_id=$2 AND (status<>'processing' OR updated_at<NOW()-INTERVAL '5 minutes') RETURNING *`,[a.est,type,job,filling]);
  const row=q.rows[0];if(!row)fail('Загрузите фото или дождитесь текущей генерации',409);
  const lease=job;
  try{
   const recipe=plan(b,type,row.filling),rev=revision(b,type,row.filling,row.reference),atlas=await render(row.reference,recipe);
   const latest=await config(a.est);if(revision(latest,type,row.filling,row.reference)!==rev)fail('Состав изменился во время обработки. Подготовьте сцену заново.',409);
   const saved=await db.query(`UPDATE shaurmeg_builder_cinema SET atlas=$4,recipe=$5::jsonb,revision=$6,status='review',updated_at=NOW() WHERE establishment_id=$1 AND type_id=$2 AND job_id=$3 RETURNING *`,[a.est,type,lease,atlas,JSON.stringify(recipe),rev]);
   if(!saved.rows[0])fail('Фото изменилось во время обработки. Подготовьте сцену заново.',409);
   res.json({ok:true,scene:describe(a.est,saved.rows[0],latest)});
  }catch(e){await db.query(`UPDATE shaurmeg_builder_cinema SET status='error',error=$4,updated_at=NOW() WHERE establishment_id=$1 AND type_id=$2 AND job_id=$3`,[a.est,type,lease,e.status?e.message:'Обработка прервалась. Попробуйте ещё раз.']);throw e;}
 }));
 router.post(base+'/:typeId/approve',wrap(async(req,res)=>{const a=await access(req,res,'menu');if(!a)return;
  await db.tx(async c=>{const q=await c.query('SELECT * FROM shaurmeg_builder_cinema WHERE establishment_id=$1 AND type_id=$2 FOR UPDATE',[a.est,String(req.params.typeId)]),row=q.rows[0];
   if(!row?.atlas||!['review','ready'].includes(row.status))fail('Сначала подготовьте и просмотрите фотосцену',409);
   const b=await config(a.est);if(revision(b,row.type_id,row.filling,row.reference)!==row.revision)fail('Состав изменился. Подготовьте сцену заново.',409);
   await c.query("UPDATE shaurmeg_builder_cinema SET status='ready' WHERE establishment_id=$1 AND type_id=$2",[a.est,row.type_id]);});require('./realtime').pushVenue(a.est,'venue',{establishment_id:a.est,reason:'builder_cinema'});res.json({ok:true});
 }));
 if(publicImages)router.get('/builder-cinema-image/:est/:type/:kind',wrap(async(req,res)=>{
  if(!['reference','atlas'].includes(req.params.kind))return res.sendStatus(404);
  const q=await db.query(`SELECT c.* FROM shaurmeg_builder_cinema c JOIN shaurma_venues v ON v.establishment_id=c.establishment_id WHERE c.establishment_id=$1 AND c.type_id=$2 AND v.is_active=TRUE`,[D.establishmentId(req.params.est),req.params.type]),row=q.rows[0];
  if(!row)return res.sendStatus(404);const val=row[req.params.kind];if(!val)return res.sendStatus(404);
  const m=/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(val);if(!m)return res.sendStatus(404);
  res.setHeader('Content-Type',m[1]);res.setHeader('Cache-Control','public,max-age=300');res.setHeader('X-Content-Type-Options','nosniff');res.send(Buffer.from(m[2],'base64'));
 }));
 return {publicScenes:async(est,builder)=>{const q=await db.query("SELECT type_id,filling,recipe,status,error,updated_at,atlas<>'' AS atlas,reference<>'' AS reference FROM shaurmeg_builder_cinema WHERE establishment_id=$1",[est]);return q.rows.map(row=>{const out=describe(est,row,builder);return {...out,atlas_url:out.status==='ready'&&!out.stale?out.atlas_url:'',error:undefined};});}};
}
module.exports={plan,revision,photo,render,ensureSchema,install};
