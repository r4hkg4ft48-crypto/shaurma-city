'use strict';
const crypto=require('crypto');
const db=require('./db');
const D=require('./domain');
const auth=require('./auth');
const rt=require('./realtime');

const norm=x=>String(x??'').trim().normalize('NFKC').toLowerCase().replace(/ё/g,'е');
const error=(message,status=400)=>Object.assign(new Error(message),{status});
const labels={item:'Блюдо',category:'Категория',group:'Группа',option:'Вариант',ingredient:'Ингредиент'};
const prefixes={item:'P',category:'C',group:'G',option:'O',ingredient:'I'};
const valid=x=>/^[a-zа-яё0-9_-]{1,32}$/i.test(String(x||'').trim());
const keyHash=x=>crypto.createHash('sha256').update('coordinator:shaurmeg:'+x).digest('hex');
const codeId=(...parts)=>JSON.stringify(parts.map(x=>String(x)));
let ready;
async function ensureSchema(){
  if(!ready)ready=(async()=>{
    await db.query("CREATE TABLE IF NOT EXISTS shaurma_coordinator_codes (establishment_id text NOT NULL,entity_type text NOT NULL CHECK(entity_type IN ('item','category','group','option','ingredient')),entity_id text NOT NULL,code text NOT NULL,normalized_code text NOT NULL,updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(establishment_id,entity_type,entity_id),UNIQUE(establishment_id,normalized_code))");
    await db.query("CREATE TABLE IF NOT EXISTS shaurma_coordinator_keys (id bigserial PRIMARY KEY,establishment_id text NOT NULL,code_hash text NOT NULL UNIQUE,expires_at timestamptz NOT NULL,redeemed_by text,redeemed_at timestamptz,revoked_at timestamptz,created_at timestamptz NOT NULL DEFAULT now())");
    await db.query("CREATE TABLE IF NOT EXISTS shaurma_coordinator_bindings (telegram_id text PRIMARY KEY,establishment_id text NOT NULL,enabled boolean NOT NULL DEFAULT true,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now())");
    await db.query("CREATE TABLE IF NOT EXISTS shaurma_coordinator_audit (id bigserial PRIMARY KEY,establishment_id text NOT NULL,telegram_id text NOT NULL,entity_type text,entity_id text,command text NOT NULL,old_value jsonb,new_value jsonb,created_at timestamptz NOT NULL DEFAULT now())");
    await db.query("CREATE INDEX IF NOT EXISTS shaurma_coordinator_audit_est ON shaurma_coordinator_audit(establishment_id,created_at DESC)");
  })().catch(e=>{ready=null;throw e});
  return ready;
}
function extractEntities(row){
  const menu=Array.isArray(row.menu)?row.menu:[];
  const sectionList=D.menuSectionsAll(row.config||{},menu);
  const out=sectionList.map(x=>({kind:'category',id:String(x.id),name:String(x.name||x.id)}));
  for(const item of menu){
    const itemId=String(item.id||'');if(!itemId)continue;
    out.push({kind:'item',id:itemId,name:String(item.n||itemId)});
    const options=item.options||{};
    for(const group of ['meats','sizes','bases','sauces','extras']){
      if(!Array.isArray(options[group]))continue;
      out.push({kind:'group',id:codeId(itemId,'options',group),name:(item.n||itemId)+' · '+group});
      for(const opt of options[group])out.push({kind:'option',id:codeId(itemId,'options',group,opt.id),name:(item.n||itemId)+' · '+(opt.name||opt.id)});
    }
    for(const group of (item.choice_groups||[])){
      out.push({kind:'group',id:codeId(itemId,'choice',group.id),name:(item.n||itemId)+' · '+(group.name||group.id)});
      for(const opt of (group.options||[]))out.push({kind:'option',id:codeId(itemId,'choice',group.id,opt.id),name:(item.n||itemId)+' · '+(opt.name||opt.id)});
    }
    const pieces=String(item.composition||'').split(/[,;\n]+/).map(x=>x.trim()).filter(Boolean);
    const seen=new Set();
    for(const part of pieces){
      if(seen.has(norm(part)))continue;seen.add(norm(part));
      out.push({kind:'ingredient',id:codeId(itemId,'ingredient',norm(part)),name:(item.n||itemId)+' · '+part});
    }
  }
  return out;
}
async function ensureCodes(est){
  return db.tx(async c=>{
    const r=await c.query('SELECT menu,config FROM shaurma_venues WHERE establishment_id=$1 AND is_active=true FOR UPDATE',[est]);
    if(!r.rowCount)throw error('Заведение не найдено.',404);
    const entries=extractEntities(r.rows[0]);
    const old=await c.query('SELECT entity_type,entity_id,normalized_code FROM shaurma_coordinator_codes WHERE establishment_id=$1',[est]);
    const byId=new Set(old.rows.map(x=>x.entity_type+':'+x.entity_id));
    const used=new Set(old.rows.map(x=>x.normalized_code));
    for(const e of entries){
      if(byId.has(e.kind+':'+e.id))continue;
      let code='';
      for(let n=0;n<60;n++){
        const suffix=crypto.createHash('sha256').update('shaurmeg:'+e.kind+':'+e.id+':'+n).digest('hex').slice(0,6);
        const candidate=prefixes[e.kind]+suffix;
        if(!used.has(norm(candidate))){code=candidate;break;}
      }
      if(!code)throw error('Не удалось выделить короткий код.',500);
      await c.query('INSERT INTO shaurma_coordinator_codes(establishment_id,entity_type,entity_id,code,normalized_code) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',[est,e.kind,e.id,code,norm(code)]);
      used.add(norm(code));
    }
    const aliases=await c.query('SELECT entity_type,entity_id,code FROM shaurma_coordinator_codes WHERE establishment_id=$1',[est]);
    const map=new Map(aliases.rows.map(x=>[x.entity_type+':'+x.entity_id,x.code]));
    return entries.map(x=>({...x,code:map.get(x.kind+':'+x.id)||null,label:labels[x.kind]}));
  });
}
async function ownerAccess(req,est){
  if(auth.ownerOk(req))return true;
  const session=auth.readToken(req,'venue');
  if(!session)throw error('Требуется авторизация владельца.',401);
  const r=await db.query('SELECT role,permissions FROM shaurma_venue_admins WHERE telegram_user_id=$1 AND establishment_id=$2 AND is_active=true',[String(session.sub),est]);
  const a=r.rows[0];
  if(!a||!(a.role==='owner'||a.role==='manager'||(Array.isArray(a.permissions)&&a.permissions.includes('menu'))))throw error('Нет прав на это заведение.',403);
  return true;
}
function authorizeBridge(req){
  const expected=String(process.env.COORDINATOR_SHA_SECRET||'');
  const actual=String(req.headers['x-coordinator-secret']||'');
  const expectedBytes=Buffer.from(expected),actualBytes=Buffer.from(actual);
  if(expectedBytes.length<32||actualBytes.length!==expectedBytes.length||!crypto.timingSafeEqual(expectedBytes,actualBytes))throw error('coordinator_access_denied',401);
}
async function binding(telegramId){
  const r=await db.query("SELECT b.establishment_id,v.name FROM shaurma_coordinator_bindings b JOIN shaurma_venues v ON v.establishment_id=b.establishment_id WHERE b.telegram_id=$1 AND b.enabled=true AND v.is_active=true",[String(telegramId)]);
  return r.rows[0]||null;
}
async function claim(telegramId,key){
  await ensureSchema();
  const k=String(key||'').trim().toUpperCase();
  if(!/^SHA-MNU-[A-F0-9]{16}$/.test(k))throw error('Неверный формат ключа.');
  return db.tx(async c=>{
    const r=await c.query("SELECT k.id,k.establishment_id,v.name FROM shaurma_coordinator_keys k JOIN shaurma_venues v ON v.establishment_id=k.establishment_id WHERE k.code_hash=$1 AND k.redeemed_at IS NULL AND k.revoked_at IS NULL AND k.expires_at>NOW() AND v.is_active=true FOR UPDATE OF k",[keyHash(k)]);
    const row=r.rows[0];if(!row)throw error('Ключ истёк, недействителен или уже использован.',403);
    await c.query('UPDATE shaurma_coordinator_keys SET redeemed_by=$2,redeemed_at=now() WHERE id=$1',[row.id,String(telegramId)]);
    await c.query('INSERT INTO shaurma_coordinator_bindings(telegram_id,establishment_id,enabled) VALUES($1,$2,true) ON CONFLICT(telegram_id) DO UPDATE SET establishment_id=EXCLUDED.establishment_id,enabled=true,updated_at=now()',[String(telegramId),row.establishment_id]);
    return {ok:true,project:'shaurmeg',venue:row.name,venueId:row.establishment_id};
  });
}
function deref(menu,obj){
  if(obj.entity_type==='item'){
    const item=menu.find(x=>String(x.id)===obj.entity_id);return item?{item,target:item}:null;
  }
  let parts;try{parts=JSON.parse(obj.entity_id)}catch{return null}
  if(!Array.isArray(parts))return null;
  const item=menu.find(x=>String(x.id)===String(parts[0]));
  if(!item)return null;
  if(parts[1]==='ingredient'){
    const pieces=String(item.composition||'').split(/[,;\n]+/).map(x=>x.trim()).filter(Boolean);
    const part=pieces.find(x=>norm(x)===String(parts[2]));
    return part?{item,target:{name:part},ingredient:part}:null;
  }
  const options=item.options||{};
  if(parts[1]==='options'){
    const group=options[parts[2]];
    if(!Array.isArray(group))return null;
    if(parts.length===3)return {item,target:{name:parts[2]},options:group};
    const target=group.find(x=>String(x.id)===String(parts[3]));return target?{item,target}:null;
  }
  if(parts[1]==='choice'){
    const group=(item.choice_groups||[]).find(x=>String(x.id)===String(parts[2]));
    if(!group)return null;
    if(parts.length===3)return {item,target:group};
    const target=(group.options||[]).find(x=>String(x.id)===String(parts[3]));
    return target?{item,target}:null;
  }
  return null;
}
async function execute(telegramId,text){
  await ensureSchema();
  const bind=await binding(telegramId);
  if(!bind)throw error('Сначала подключите заведение ключом.',403);
  await ensureCodes(bind.establishment_id);
  const match=String(text||'').trim().match(/^(\S+)\s+(.+)$/s);
  if(!match)throw error('Формат: КОД действие. Например: 7777 стоп лист');
  const command=match[2].trim(),act=norm(command);
  const result=await db.tx(async c=>{
    const q=await c.query('SELECT menu,config,name FROM shaurma_venues WHERE establishment_id=$1 AND is_active=true FOR UPDATE',[bind.establishment_id]);
    if(!q.rowCount)throw error('Заведение больше не активно.',404);
    const code=await c.query('SELECT entity_type,entity_id,code FROM shaurma_coordinator_codes WHERE establishment_id=$1 AND normalized_code=$2',[bind.establishment_id,norm(match[1])]);
    if(!code.rowCount)throw error('Нет такого идентификатора в текущем заведении.',404);
    const obj=code.rows[0],row=q.rows[0],menu=Array.isArray(row.menu)?row.menu:[],cfg=row.config||{};
    const loc=obj.entity_type==='category'
      ?{target:(D.menuSectionsAll(cfg,menu)).find(x=>String(x.id)===obj.entity_id)}
      :deref(menu,obj);
    if(!loc?.target)throw error('Объект изменён или удалён. Обновите идентификаторы.',409);
    const target=loc.target,before=structuredClone(target);
    const stop=['стоп лист','стоп-лист','стоп','нет в наличии','выключить'].includes(act);
    const restore=['в наличии','вернуть','снять стоп','снять стоп лист','включить'].includes(act);
    if(obj.entity_type==='ingredient'){
      const blocked=Array.isArray(loc.item.coordinator_blocked_ingredients)?loc.item.coordinator_blocked_ingredients:[];
      if(stop)loc.item.coordinator_blocked_ingredients=[...new Set([...blocked,obj.entity_id])];
      else if(restore)loc.item.coordinator_blocked_ingredients=blocked.filter(x=>x!==obj.entity_id&&norm(x)!==norm(obj.code));
      else if(act==='удалить'||act==='убрать'){
        loc.item.composition=String(loc.item.composition||'').split(/[,;\n]+/).map(x=>x.trim()).filter(x=>x&&norm(x)!==norm(loc.ingredient)).join(', ');
        loc.item.coordinator_blocked_ingredients=blocked.filter(x=>x!==obj.entity_id&&norm(x)!==norm(obj.code));
      }else throw error('Для ингредиента: стоп лист, в наличии, убрать.');
    }else if(obj.entity_type==='category'){
      if(!(stop||restore||act==='скрыть'||act==='показать'||act==='удалить'||/^название\s+.+/i.test(command)))throw error('Для категории: стоп лист, в наличии, скрыть, показать, название.');
      const sections=D.menuSectionsAll(cfg,menu);
      const section=sections.find(x=>String(x.id)===obj.entity_id);
      if(/^название\s+.+/i.test(command))section.name=command.replace(/^название\s+/i,'').trim().slice(0,120);
      else section.active=restore||act==='показать';
      cfg.menu_sections=sections;
    }else if(obj.entity_type==='group'&&loc.options){
      if(!(stop||restore||act==='скрыть'||act==='показать'))throw error('Для группы вариантов: стоп лист, в наличии.');
      for(const opt of loc.options)opt.active=restore||act==='показать';
    }else if(stop||restore){
      target[obj.entity_type==='item'?'available':'active']=restore;
    }else if(act==='скрыть'||act==='показать'||act==='удалить'){
      target.active=act==='показать'; // soft archive, no destructive deletion
    }else if(/^цена\s+\d+(?:[.,]\d{1,2})?$/i.test(command)){
      const price=Number(command.replace(/^цена\s+/i,'').replace(',','.'));
      if(price>1000000)throw error('Недопустимая цена.');
      if(obj.entity_type==='item')target.p=price;
      else if(obj.entity_type==='option')target[(JSON.parse(obj.entity_id)[1]==='choice')?'price_delta':'price']=price;
      else throw error('Цену можно задать только позиции или варианту.');
    }else if(/^название\s+.+/i.test(command)){
      const name=command.replace(/^название\s+/i,'').trim().slice(0,140);
      if(obj.entity_type==='item')target.n=name;
      else if(obj.entity_type==='option'||obj.entity_type==='group')target.name=name;
      else throw error('Тип не поддерживает переименование.');
    }else if(/^описание\s+.+/i.test(command)){
      if(obj.entity_type!=='item')throw error('Описание поддерживается только для блюд.');
      target.d=command.replace(/^описание\s+/i,'').trim().slice(0,900);
    }else if(/^состав\s+.+/i.test(command)&&obj.entity_type==='item'){
      const raw=command.replace(/^состав\s+/i,'').trim();
      if(raw.startsWith('+ ')){
        const part=raw.slice(2).trim().slice(0,120);
        if(!part)throw error('Укажите ингредиент.');
        const pieces=String(target.composition||'').split(/[,;\n]+/).map(x=>x.trim()).filter(Boolean);
        if(!pieces.some(x=>norm(x)===norm(part)))pieces.push(part);
        target.composition=pieces.join(', ');
      }else if(raw.startsWith('= '))target.composition=raw.slice(2).trim().slice(0,1200);
      else{
        const ccode=await c.query("SELECT entity_id FROM shaurma_coordinator_codes WHERE establishment_id=$1 AND normalized_code=$2 AND entity_type='ingredient'",[bind.establishment_id,norm(raw.replace(/\s+(?:убрать|удалить)$/i,''))]);
        if(!ccode.rowCount)throw error('Ингредиент не найден. Используйте: КОД состав + название');
        let parsed;try{parsed=JSON.parse(ccode.rows[0].entity_id)}catch{}
        if(parsed?.[0]!==obj.entity_id)throw error('Ингредиент принадлежит другому блюду.',403);
        if(!/\s+(убрать|удалить)$/i.test(raw))throw error('Формат: КОД состав КОД_ИНГРЕДИЕНТА убрать');
        target.composition=String(target.composition||'').split(/[,;\n]+/).map(x=>x.trim()).filter(x=>x&&norm(x)!==String(parsed[2])).join(', ');
      }
    }else throw error('Неизвестная команда. Используйте /помощь.');
    const updated=D.normalizeMenu(menu);
    cfg.menu_revision=(Number(cfg.menu_revision)||0)+1;
    const r=await c.query('UPDATE shaurma_venues SET menu=$2::jsonb,config=$3::jsonb,updated_at=NOW() WHERE establishment_id=$1 RETURNING *',[bind.establishment_id,JSON.stringify(updated),JSON.stringify(cfg)]);
    await c.query('INSERT INTO shaurma_coordinator_audit(establishment_id,telegram_id,entity_type,entity_id,command,old_value,new_value) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb)',[bind.establishment_id,String(telegramId),obj.entity_type,obj.entity_id,command,JSON.stringify(before),JSON.stringify(target)]);
    return {row:r.rows[0],text:'✅ '+(row.name||'Заведение')+' · '+match[1]+' → '+command,revision:cfg.menu_revision};
  });
  rt.pushVenue(bind.establishment_id,'menu_changed',{establishment_id:bind.establishment_id,revision:result.revision});
  rt.pushVenue(bind.establishment_id,'venue',result.row);
  rt.pushOwner('venue',result.row);
  return {ok:true,project:'shaurmeg',venue:bind.name,venueId:bind.establishment_id,text:result.text};
}
const help='🥙 КООРДИНАТОР · ШАУРМЕГ\nКОД стоп лист — приостановить продажу\nКОД в наличии — вернуть в продажу\nКОД скрыть / показать — управлять отображением\nКОД цена 350 — новая цена\nКОД название Новое название\nКОД описание Новый текст\nКОД состав + сыр — добавить ингредиент\nКОД состав = мясо, сыр, соус — заменить состав\nКОД состав КОД_ИНГРЕДИЕНТА убрать — убрать ингредиент\nКОД_ИНГРЕДИЕНТА стоп лист — заблокировать блюдо при отсутствии ингредиента\nКОД удалить — архивировать, сохранив историю.';
function install(app){
  app.get('/api/v2/coordinator/codes',async(req,res)=>{
    try{await ensureSchema();const est=D.establishmentId(req.query.establishment_id);if(!est)throw error('bad_establishment_id');await ownerAccess(req,est);res.setHeader('Cache-Control','no-store');res.json({ok:true,project:'shaurmeg',establishmentId:est,items:await ensureCodes(est)});}
    catch(e){res.status(e.status||500).json({ok:false,error:e.message});}
  });
  app.get('/api/v2/coordinator/staff',async(req,res)=>{
    try{
      await ensureSchema();const est=D.establishmentId(req.query.establishment_id);
      if(!est)throw error('bad_establishment_id');
      await ownerAccess(req,est);
      const r=await db.query('SELECT telegram_id,enabled,created_at,updated_at FROM shaurma_coordinator_bindings WHERE establishment_id=$1 ORDER BY updated_at DESC',[est]);
      res.json({ok:true,staff:r.rows});
    }catch(e){res.status(e.status||500).json({ok:false,error:e.message});}
  });
  app.get('/api/v2/coordinator/audit',async(req,res)=>{
    try{
      await ensureSchema();const est=D.establishmentId(req.query.establishment_id);
      if(!est)throw error('bad_establishment_id');
      await ownerAccess(req,est);
      const r=await db.query('SELECT telegram_id,entity_type,entity_id,command,old_value,new_value,created_at FROM shaurma_coordinator_audit WHERE establishment_id=$1 ORDER BY created_at DESC LIMIT 100',[est]);
      res.json({ok:true,events:r.rows});
    }catch(e){res.status(e.status||500).json({ok:false,error:e.message});}
  });
  app.post('/api/v2/coordinator/revoke',async(req,res)=>{
    try{
      await ensureSchema();const est=D.establishmentId(req.body?.establishment_id),telegramId=String(req.body?.telegramId||'');
      if(!est||!/^\d{4,20}$/.test(telegramId))throw error('invalid_staff_binding');
      await ownerAccess(req,est);
      const r=await db.query('UPDATE shaurma_coordinator_bindings SET enabled=false,updated_at=now() WHERE establishment_id=$1 AND telegram_id=$2 RETURNING telegram_id',[est,telegramId]);
      if(!r.rowCount)throw error('Сотрудник не подключён к этому заведению.',404);
      res.json({ok:true,revoked:telegramId});
    }catch(e){res.status(e.status||500).json({ok:false,error:e.message});}
  });
  app.post('/api/v2/coordinator/set-code',async(req,res)=>{
    try{
      await ensureSchema();const est=D.establishmentId(req.body?.establishment_id);if(!est)throw error('bad_establishment_id');await ownerAccess(req,est);
      const kind=String(req.body?.kind||''),id=String(req.body?.entityId||''),code=String(req.body?.code||'').trim();
      if(!prefixes[kind]||!valid(code))throw error('Код: 1–32 буквы, цифры, дефис или _');
      if(!(await ensureCodes(est)).some(x=>x.kind===kind&&x.id===id))throw error('Объект не принадлежит заведению.',404);
      try{await db.query('UPDATE shaurma_coordinator_codes SET code=$4,normalized_code=$5,updated_at=now() WHERE establishment_id=$1 AND entity_type=$2 AND entity_id=$3',[est,kind,id,code,norm(code)]);}
      catch(e){if(e.code==='23505')throw error('Код уже занят в этом заведении.',409);throw e}
      res.json({ok:true,code});
    }catch(e){res.status(e.status||500).json({ok:false,error:e.message});}
  });
  app.post('/api/v2/coordinator/key',async(req,res)=>{
    try{
      await ensureSchema();const est=D.establishmentId(req.body?.establishment_id);if(!est)throw error('bad_establishment_id');await ownerAccess(req,est);
      const venue=await db.query('SELECT name FROM shaurma_venues WHERE establishment_id=$1 AND is_active=true',[est]);if(!venue.rowCount)throw error('Заведение не найдено.',404);
      const code='SHA-MNU-'+crypto.randomBytes(8).toString('hex').toUpperCase();
      const hours=Math.max(1,Math.min(168,Number(req.body?.hours)||24));
      await db.query("INSERT INTO shaurma_coordinator_keys(establishment_id,code_hash,expires_at) VALUES($1,$2,NOW()+($3::text||' hours')::interval)",[est,keyHash(code),String(hours)]);
      res.json({ok:true,key:code,venue:venue.rows[0].name,expiresInHours:hours});
    }catch(e){res.status(e.status||500).json({ok:false,error:e.message});}
  });
  app.post('/api/v2/coordinator/bridge',async(req,res)=>{
    try{
      authorizeBridge(req);
      const actor=String(req.body?.telegramId||'');
      if(!/^\d{4,20}$/.test(actor))throw error('bad_actor',401);
      const action=String(req.body?.action||'');
      if(action==='claim')return res.json(await claim(actor,req.body?.key));
      if(action==='resolve'){
        const b=await binding(actor);return res.json({ok:true,linked:!!b,project:'shaurmeg',venueId:b?.establishment_id||null,venue:b?.name||null});
      }
      if(action==='execute')return res.json(await execute(actor,req.body?.text));
      throw error('unknown_action',404);
    }catch(e){res.status(e.status||500).json({ok:false,error:e.message});}
  });
}
module.exports={ensureSchema,install,claim,binding,execute,help};
