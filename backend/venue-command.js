'use strict';

const D=require('../v2/backend/src/domain');
const rt=require('../v2/backend/src/realtime');

const STATUS_LABELS={new:'Принят',cooking:'Готовится',ready:'Готово',done:'Выполнен',cancelled:'Отменён'};
const PERMISSION_BY_INTENT={
  menu_show:'menu',menu_price:'menu',menu_toggle:'menu',menu_add:'menu',menu_rename:'menu',menu_description:'menu',
  category_show:'menu',category_add:'menu',category_toggle:'menu',category_rename:'menu',builder_toggle:'menu',
  venue_show:'profile',venue_name:'profile',venue_address:'profile',venue_hours:'profile',venue_description:'profile',
  venue_phone:'profile',venue_website:'profile',delivery_toggle:'profile',pickup_toggle:'profile',
  orders_show:'orders',order_status:'orders',stats_show:'orders'
};

function clean(v){return String(v||'').trim()}
function norm(v){
  return clean(v).normalize('NFKC').toLowerCase().replace(/ё/g,'е')
    .replace(/[«»“”"]/g,'').replace(/\s+/g,' ').trim();
}
function slug(v){
  return norm(v).replace(/[^a-z0-9а-я]+/gi,'_').replace(/^_+|_+$/g,'').slice(0,48)||'section';
}
function venueShortKey(establishmentId){
  const raw=clean(establishmentId).toUpperCase();
  const tail=(raw.split('-').filter(Boolean).pop()||raw).replace(/[^A-Z0-9]/g,'');
  return (tail||raw.replace(/[^A-Z0-9]/g,'')).slice(0,6);
}
function money(v){
  const n=Number(String(v||'').replace(',','.').replace(/[^\d.]/g,''));
  return Number.isFinite(n)?Math.max(0,Math.min(100000,Math.round(n))):null;
}
function boolWord(v){
  const s=norm(v);
  if(/^(вкл|включи|включить|включено|да|on|1)$/.test(s))return true;
  if(/^(выкл|выключи|выключить|выключено|нет|off|0)$/.test(s))return false;
  return null;
}
function statusWord(v){
  const s=norm(v);
  if(/^(принят|принято)$/.test(s))return 'new';
  if(/^(готовится|готовить|в работу|cooking)$/.test(s))return 'cooking';
  if(/^(готов|готово|ready)$/.test(s))return 'ready';
  if(/^(выполнен|выполнено|выдан|done)$/.test(s))return 'done';
  if(/^(отменен|отменено|отмена|cancelled)$/.test(s))return 'cancelled';
  return '';
}

function parseCommand(text){
  const raw=clean(text),s=norm(raw);
  if(!raw)return {intent:'unknown'};

  if(/^\/?(help|commands|assistant)$/i.test(raw)||/(что умеешь|помощь|команды ассистента)/i.test(s))return {intent:'help'};
  if(/^\/?venues$/i.test(raw)||/^(мои )?(заведения|точки)$/.test(s))return {intent:'venues_show'};

  let m=raw.match(/^\/use\s+(.+)$/i)||raw.match(/^(?:выбери|выбрать|переключись на|переключить на)\s+(?:точку|заведение)\s+(.+)$/i);
  if(m)return {intent:'venue_select',query:clean(m[1])};
  if(/^[A-F0-9]{4,10}$/i.test(raw))return {intent:'venue_select',query:raw.toUpperCase()};

  if(/^(?:покажи|открой|дай)\s+меню$/i.test(raw)||/^меню$/i.test(raw))return {intent:'menu_show'};
  if(/^(?:покажи|дай)\s+категории$/i.test(raw)||/^категории$/i.test(raw))return {intent:'category_show'};
  if(/^(?:покажи|дай)\s+(?:настройки|точку|заведение)$/i.test(raw)||/^(?:настройки точки|информация о точке)$/i.test(raw))return {intent:'venue_show'};
  if(/^(?:покажи|дай)\s+(?:активные\s+)?заказы$/i.test(raw)||/^(?:активные )?заказы$/i.test(raw))return {intent:'orders_show'};
  if(/^(?:покажи|дай)\s+статистику$/i.test(raw)||/^статистика$/i.test(raw))return {intent:'stats_show'};

  m=raw.match(/^(?:поставь\s+)?цен[ау]\s+(?:на\s+)?(.+?)\s+(?:в\s+|на\s+)?(\d+(?:[.,]\d+)?)\s*(?:₽|р|руб(?:лей|ля)?)?$/i)||
    raw.match(/^(?:измени|поменяй|установи)\s+цен[ау]\s+(?:на\s+)?(.+?)\s+(?:на|до)\s+(\d+(?:[.,]\d+)?)\s*(?:₽|р|руб(?:лей|ля)?)?$/i);
  if(m)return {intent:'menu_price',item:clean(m[1]),price:money(m[2])};
  m=raw.match(/^(.+?)\s+цен[ау]\s+(\d+(?:[.,]\d+)?)\s*(?:₽|р|руб(?:лей|ля)?)?$/i);
  if(m)return {intent:'menu_price',item:clean(m[1]),price:money(m[2])};

  m=raw.match(/^(?:выключи|скрой|убери из меню)\s+(?:позицию|блюдо|товар)?\s*(.+)$/i)||
    raw.match(/^убери\s+(.+?)\s+из меню$/i);
  if(m&&!/^категори/i.test(m[1]))return {intent:'menu_toggle',item:clean(m[1]),enabled:false};
  m=raw.match(/^(?:включи|покажи в меню|верни в меню)\s+(?:позицию|блюдо|товар)?\s*(.+)$/i)||
    raw.match(/^верни\s+(.+?)\s+в меню$/i);
  if(m&&!/^категори/i.test(m[1]))return {intent:'menu_toggle',item:clean(m[1]),enabled:true};

  m=raw.match(/^добавь\s+(?:позицию|блюдо|товар)\s+(.+?)\s*\|\s*(.+?)\s*\|\s*(\d+(?:[.,]\d+)?)(?:\s*\|\s*([\s\S]+))?$/i);
  if(m)return {intent:'menu_add',name:clean(m[1]),category:clean(m[2]),price:money(m[3]),description:clean(m[4]||'')};
  m=raw.match(/^добавь\s+(?:позицию|блюдо|товар)\s+(.+?)\s+(?:в|в категорию)\s+(.+?)\s+(?:за|по цене)\s+(\d+(?:[.,]\d+)?)\s*(?:₽|р|руб(?:лей|ля)?)?$/i)||
    raw.match(/^добавь\s+(.+?)\s+в\s+(.+?)\s+за\s+(\d+(?:[.,]\d+)?)\s*(?:₽|р|руб(?:лей|ля)?)?$/i);
  if(m)return {intent:'menu_add',name:clean(m[1]),category:clean(m[2]),price:money(m[3]),description:''};

  m=raw.match(/^переименуй\s+(?:позицию|блюдо|товар)\s+(.+?)\s*(?:->|→|в)\s*(.+)$/i);
  if(m)return {intent:'menu_rename',item:clean(m[1]),name:clean(m[2])};
  m=raw.match(/^(?:описание|измени описание)\s+(?:позиции|блюда|товара)\s+(.+?)\s*(?:=|->|→|на)\s*([\s\S]+)$/i);
  if(m)return {intent:'menu_description',item:clean(m[1]),description:clean(m[2])};

  m=raw.match(/^добавь\s+категори[юя]\s+(.+)$/i);
  if(m)return {intent:'category_add',name:clean(m[1])};
  m=raw.match(/^(?:выключи|скрой)\s+категори[юя]\s+(.+)$/i);
  if(m)return {intent:'category_toggle',category:clean(m[1]),enabled:false};
  m=raw.match(/^(?:включи|покажи)\s+категори[юя]\s+(.+)$/i);
  if(m)return {intent:'category_toggle',category:clean(m[1]),enabled:true};
  m=raw.match(/^переименуй\s+категори[юя]\s+(.+?)\s*(?:->|→|в)\s*(.+)$/i);
  if(m)return {intent:'category_rename',category:clean(m[1]),name:clean(m[2])};

  m=raw.match(/^(?:конструктор|сборка своей шаурмы)\s+(вкл|выкл|включи|выключи|включить|выключить)$/i);
  if(m)return {intent:'builder_toggle',enabled:boolWord(m[1])};

  m=raw.match(/^(?:название точки|название заведения)\s*(?:=|->|→|на)?\s*(.+)$/i)||
    raw.match(/^переименуй\s+(?:точку|заведение)\s+(?:в|на)\s+(.+)$/i);
  if(m)return {intent:'venue_name',value:clean(m[1])};
  m=raw.match(/^адрес(?: точки| заведения)?\s*(?:=|->|→|на)?\s*(.+)$/i);
  if(m)return {intent:'venue_address',value:clean(m[1])};
  m=raw.match(/^(?:часы|режим работы|время работы)\s*(?:=|->|→)?\s*(.+)$/i);
  if(m)return {intent:'venue_hours',value:clean(m[1])};
  m=raw.match(/^описание(?: точки| заведения)?\s*(?:=|->|→|на)?\s*([\s\S]+)$/i);
  if(m)return {intent:'venue_description',value:clean(m[1])};
  m=raw.match(/^телефон(?: точки| заведения)?\s*(?:=|->|→)?\s*(.+)$/i);
  if(m)return {intent:'venue_phone',value:clean(m[1])};
  m=raw.match(/^сайт(?: точки| заведения)?\s*(?:=|->|→)?\s*(.+)$/i);
  if(m)return {intent:'venue_website',value:clean(m[1])};

  m=raw.match(/^доставк[ау]\s+(вкл|выкл|включи|выключи|включить|выключить)$/i);
  if(m)return {intent:'delivery_toggle',enabled:boolWord(m[1])};
  m=raw.match(/^(?:самовывоз|выдача на месте)\s+(вкл|выкл|включи|выключи|включить|выключить)$/i);
  if(m)return {intent:'pickup_toggle',enabled:boolWord(m[1])};

  m=raw.match(/^заказ\s+#?(\d+)\s+(принят|принято|готовится|готовить|готов|готово|выполнен|выполнено|выдан|отменен|отменено|отмена)$/i);
  if(m)return {intent:'order_status',order_id:m[1],status:statusWord(m[2])};

  return {intent:'unknown'};
}

function helpText(){
  return [
    '🤖 <b>Ассистент управления заведением</b>',
    '',
    '<b>Меню</b>',
    '• <code>покажи меню</code>',
    '• <code>цена Классическая шаурма 390</code>',
    '• <code>выключи блюдо Айран</code>',
    '• <code>включи блюдо Айран</code>',
    '• <code>добавь блюдо Айран | Напитки | 150 | Домашний айран</code>',
    '• <code>переименуй блюдо Айран -> Тан</code>',
    '• <code>описание блюда Тан = Холодный кисломолочный напиток</code>',
    '',
    '<b>Категории</b>',
    '• <code>покажи категории</code>',
    '• <code>добавь категорию Десерты</code>',
    '• <code>выключи категорию Выпечка</code>',
    '• <code>переименуй категорию Напитки -> Бар</code>',
    '',
    '<b>Точка</b>',
    '• <code>покажи настройки</code>',
    '• <code>название точки Лепёшка 24</code>',
    '• <code>адрес ул. Примерная, 10</code>',
    '• <code>режим работы 10:00–23:00</code>',
    '• <code>телефон +7...</code>',
    '• <code>доставка вкл</code> / <code>доставка выкл</code>',
    '• <code>самовывоз вкл</code>',
    '• <code>конструктор вкл</code>',
    '',
    '<b>Заказы</b>',
    '• <code>покажи активные заказы</code>',
    '• <code>заказ 42 готов</code>',
    '• <code>покажи статистику</code>',
    '',
    'Если заведений несколько: <code>/use Лепёшка</code>, <code>/use 5E435A</code> или просто отправьте короткий ключ <code>5E435A</code>.'
  ].join('\n');
}

function canUse(access,permission){
  if(!permission)return true;
  const permissions=Array.isArray(access?.permissions)?access.permissions:[];
  return access?.role==='owner'||permissions.includes(permission);
}

function sectionsFrom(config={},menu=[]){
  const raw=Array.isArray(config?.menu_sections)?config.menu_sections:[];
  const out=raw.map((x,i)=>({
    id:clean(x?.id||slug(x?.name||('section_'+i))),
    name:clean(x?.name||x?.title||x?.id||'Раздел'),
    emoji:clean(x?.emoji||'').slice(0,8),
    active:x?.active!==false,
    order:i
  })).filter(x=>x.id&&x.name);
  const seen=new Set(out.map(x=>x.id));
  for(const item of Array.isArray(menu)?menu:[]){
    const id=clean(item?.c||item?.category||'shawarma');
    if(!id||seen.has(id))continue;
    seen.add(id);out.push({id,name:id,emoji:'',active:true,order:out.length});
  }
  return out.map((x,i)=>({...x,order:i}));
}

function findNamed(list,query,getName=x=>x?.name||x?.n||''){
  const q=norm(query);
  if(!q)return {item:null,matches:[]};
  const exact=list.filter(x=>norm(getName(x))===q);
  if(exact.length===1)return {item:exact[0],matches:exact};
  const partial=list.filter(x=>norm(getName(x)).includes(q)||q.includes(norm(getName(x))));
  if(partial.length===1)return {item:partial[0],matches:partial};
  return {item:null,matches:(exact.length?exact:partial).slice(0,8)};
}

function menuLine(x){
  return (x.active===false?'○ ':'● ')+String(x.n||x.name||'Позиция')+' · '+Number(x.p??x.price??0)+' ₽ · '+String(x.c||x.category||'');
}
function orderLine(o){
  return '• #'+o.id+' · '+String(o.order_number||'')+' · '+(STATUS_LABELS[o.status]||o.status)+' · '+Number(o.total||0)+' ₽';
}

function createVenueCommandBus({DB,publishVenue,pushOwner}){
  async function accessesFor(userId){
    const q=await DB.query('SELECT a.establishment_id,a.role,a.permissions,v.name,v.venue_id,v.config,v.menu,'+
      '(SELECT id FROM shaurmeg_markers m WHERE m.establishment_id=a.establishment_id ORDER BY id LIMIT 1) marker_id '+
      'FROM shaurma_venue_admins a JOIN shaurma_venues v ON v.establishment_id=a.establishment_id '+
      'WHERE a.telegram_user_id=$1 AND a.is_active=TRUE AND v.is_active=TRUE ORDER BY v.name',[String(userId)]);
    return q.rows;
  }

  async function audit(est,userId,action,payload={}){
    await DB.query('INSERT INTO shaurma_venue_audit(establishment_id,telegram_user_id,action,payload) VALUES($1,$2,$3,$4::jsonb)',
      [est,String(userId),action,JSON.stringify({...payload,source:'owner_text_assistant'})]).catch(()=>{});
  }

  async function currentContext(userId){
    const q=await DB.query('SELECT establishment_id FROM shaurma_owner_command_context WHERE telegram_user_id=$1',[String(userId)]);
    return clean(q.rows[0]?.establishment_id);
  }
  async function setContext(userId,est){
    await DB.query('INSERT INTO shaurma_owner_command_context(telegram_user_id,establishment_id,updated_at) VALUES($1,$2,NOW()) '+
      'ON CONFLICT(telegram_user_id) DO UPDATE SET establishment_id=EXCLUDED.establishment_id,updated_at=NOW()',
      [String(userId),est]);
  }

  function chooseByQuery(accesses,query){
    const q=norm(query);
    if(!q)return null;
    const upper=clean(query).toUpperCase();
    const est=upper.match(/SC-MSK-[A-F0-9]{10}/)?.[0];
    if(est)return accesses.find(x=>x.establishment_id===est)||null;

    const byShort=accesses.filter(x=>{
      const key=venueShortKey(x.establishment_id);
      return key===upper||String(x.establishment_id||'').toUpperCase().endsWith('-'+upper);
    });
    if(byShort.length===1)return byShort[0];
    if(byShort.length>1)return null;

    const exact=accesses.filter(x=>norm(x.name)===q);
    if(exact.length===1)return exact[0];
    const partial=accesses.filter(x=>norm(x.name).includes(q)||q.includes(norm(x.name)));
    return partial.length===1?partial[0]:null;
  }

  async function resolveAccess(userId,command){
    const accesses=await accessesFor(userId);
    if(!accesses.length)return {error:'Нет подключённых заведений. Сначала добавьте точку ключом OWN-…',accesses};

    if(command.intent==='venue_select'){
      const selected=chooseByQuery(accesses,command.query);
      if(!selected)return {error:'Не смог однозначно определить заведение.\n\n'+accesses.map(x=>'• '+x.name+' · ключ '+venueShortKey(x.establishment_id)+' · '+x.establishment_id).join('\n'),accesses};
      await setContext(userId,selected.establishment_id);
      return {access:selected,accesses,selected:true};
    }

    if(accesses.length===1){
      await setContext(userId,accesses[0].establishment_id).catch(()=>{});
      return {access:accesses[0],accesses};
    }
    const ctx=await currentContext(userId);
    const chosen=accesses.find(x=>x.establishment_id===ctx);
    if(chosen)return {access:chosen,accesses};
    return {error:'У вас несколько заведений. Сначала выберите активное:\n\n'+accesses.map(x=>'• /use '+venueShortKey(x.establishment_id)+' — '+x.name).join('\n')+'\n\nМожно также написать название заведения или просто короткий ключ.',accesses};
  }

  async function loadVenue(est){
    const q=await DB.query('SELECT v.*,m.id marker_id,m.address,m.description,m.hours,m.price_label,m.hero_image,m.marker_avatar '+
      'FROM shaurma_venues v LEFT JOIN LATERAL(SELECT * FROM shaurmeg_markers WHERE establishment_id=v.establishment_id ORDER BY id LIMIT 1)m ON TRUE '+
      'WHERE v.establishment_id=$1 LIMIT 1',[est]);
    return q.rows[0]||null;
  }

  async function saveMenu(access,userId,menu,config,action,payload){
    const normalized=D.normalizeMenu(menu);
    const q=await DB.query('UPDATE shaurma_venues SET menu=$2::jsonb,config=$3::jsonb,updated_at=NOW() WHERE establishment_id=$1 RETURNING *',
      [access.establishment_id,JSON.stringify(normalized),JSON.stringify(config||{})]);
    if(q.rows[0])publishVenue(q.rows[0]);
    await audit(access.establishment_id,userId,action,payload);
    return q.rows[0];
  }

  async function handle({user,text}){
    const command=parseCommand(text);
    if(command.intent==='help')return {handled:true,text:helpText()};
    if(command.intent==='unknown')return {handled:false};

    if(command.intent==='venues_show'){
      const accesses=await accessesFor(user.id);
      if(!accesses.length)return {handled:true,text:'У вас пока нет подключённых заведений.'};
      const ctx=await currentContext(user.id);
      return {handled:true,text:'🏪 <b>Ваши заведения</b>\n\n'+accesses.map(x=>(x.establishment_id===ctx?'→ ':'• ')+x.name+' · ключ '+venueShortKey(x.establishment_id)+' · '+x.establishment_id).join('\n')};
    }

    const resolved=await resolveAccess(user.id,command);
    if(resolved.error)return {handled:true,text:resolved.error};
    const access=resolved.access;
    if(command.intent==='venue_select'){
      return {handled:true,text:'✅ Активная точка: <b>'+access.name+'</b>\nКороткий ключ: '+venueShortKey(access.establishment_id)+'\n'+access.establishment_id};
    }

    const permission=PERMISSION_BY_INTENT[command.intent];
    if(permission&&!canUse(access,permission))return {handled:true,text:'⛔️ У вас нет права <code>'+permission+'</code> для этой точки.'};

    const venue=await loadVenue(access.establishment_id);
    if(!venue)return {handled:true,text:'Точка не найдена.'};
    const menu=Array.isArray(venue.menu)?venue.menu.map(x=>({...x})):[];
    const config=venue.config&&typeof venue.config==='object'?{...venue.config}:{};
    const sections=sectionsFrom(config,menu);

    if(command.intent==='menu_show'){
      const visible=menu.slice(0,80);
      return {handled:true,text:'🍽 <b>'+venue.name+' · меню</b>\n\n'+(visible.length?visible.map(menuLine).join('\n'):'Меню пустое.')+(menu.length>visible.length?'\n\n…ещё '+(menu.length-visible.length)+' поз.':'')};
    }

    if(command.intent==='category_show'){
      return {handled:true,text:'🗂 <b>Категории</b>\n\n'+(sections.length?sections.map(x=>(x.active===false?'○ ':'● ')+x.name+' · <code>'+x.id+'</code>').join('\n'):'Категорий нет.')};
    }

    if(command.intent==='venue_show'){
      return {handled:true,text:[
        '🏪 <b>'+venue.name+'</b>',
        '<code>'+venue.establishment_id+'</code>',
        '',
        'Адрес: '+(venue.address||'—'),
        'Режим: '+(venue.hours||'—'),
        'Телефон: '+(config.phone||'—'),
        'Сайт: '+(config.website||'—'),
        'Доставка: '+(config.delivery_enabled===false?'выкл':'вкл'),
        'Самовывоз: '+(config.pickup_enabled===false?'выкл':'вкл'),
        'Конструктор: '+(config.builder_enabled===true?'вкл':'выкл'),
        'Позиций меню: '+menu.length
      ].join('\n')};
    }

    if(command.intent==='menu_price'||command.intent==='menu_toggle'||command.intent==='menu_rename'||command.intent==='menu_description'){
      const found=findNamed(menu,command.item,x=>x.n||x.name);
      if(!found.item){
        const hint=found.matches.length?'\nВозможно:\n'+found.matches.map(x=>'• '+(x.n||x.name)).join('\n'):'';
        return {handled:true,text:'Не нашёл позицию «'+command.item+'».'+hint};
      }
      const item=found.item;
      if(command.intent==='menu_price'){
        const old=Number(item.p??item.price??0);item.p=command.price;
        await saveMenu(access,user.id,menu,{...config,menu_sections:sections},'assistant_menu_price',{item_id:item.id,old_price:old,new_price:command.price});
        return {handled:true,text:'✅ '+(item.n||item.name)+': '+old+' ₽ → <b>'+command.price+' ₽</b>'};
      }
      if(command.intent==='menu_toggle'){
        item.active=command.enabled;
        await saveMenu(access,user.id,menu,{...config,menu_sections:sections},'assistant_menu_toggle',{item_id:item.id,active:command.enabled});
        return {handled:true,text:'✅ '+(item.n||item.name)+' — '+(command.enabled?'включено в меню':'скрыто из меню')+'.'};
      }
      if(command.intent==='menu_rename'){
        const old=item.n||item.name;item.n=command.name;
        await saveMenu(access,user.id,menu,{...config,menu_sections:sections},'assistant_menu_rename',{item_id:item.id,old_name:old,new_name:command.name});
        return {handled:true,text:'✅ «'+old+'» → <b>'+command.name+'</b>'};
      }
      item.d=command.description;
      await saveMenu(access,user.id,menu,{...config,menu_sections:sections},'assistant_menu_description',{item_id:item.id});
      return {handled:true,text:'✅ Описание «'+(item.n||item.name)+'» обновлено.'};
    }

    if(command.intent==='menu_add'){
      const categoryFound=findNamed(sections,command.category,x=>x.name||x.id);
      let category=categoryFound.item;
      if(!category){
        category={id:slug(command.category),name:command.category,emoji:'',active:true,order:sections.length};
        sections.push(category);
      }
      const existing=findNamed(menu,command.name,x=>x.n||x.name);
      if(existing.item&&norm(existing.item.n||existing.item.name)===norm(command.name))return {handled:true,text:'Такая позиция уже есть: '+(existing.item.n||existing.item.name)+'.'};
      const id=slug(command.name)+'_'+Date.now().toString(36).slice(-5);
      menu.push({id,n:command.name,c:category.id,d:command.description||'',p:command.price,image:'',badge:'',featured:false,display:'auto',image_fit:'cover',active:true});
      await saveMenu(access,user.id,menu,{...config,menu_sections:sections},'assistant_menu_add',{item_id:id,name:command.name,category:category.id,price:command.price});
      return {handled:true,text:'✅ Добавлено: <b>'+command.name+'</b>\nКатегория: '+category.name+'\nЦена: '+command.price+' ₽'};
    }

    if(command.intent==='category_add'){
      const found=findNamed(sections,command.name,x=>x.name||x.id);
      if(found.item)return {handled:true,text:'Категория уже существует: '+found.item.name+'.'};
      const section={id:slug(command.name),name:command.name,emoji:'',active:true,order:sections.length};
      sections.push(section);
      await saveMenu(access,user.id,menu,{...config,menu_sections:sections},'assistant_category_add',{category_id:section.id,name:section.name});
      return {handled:true,text:'✅ Категория <b>'+section.name+'</b> добавлена.'};
    }

    if(command.intent==='category_toggle'||command.intent==='category_rename'){
      const found=findNamed(sections,command.category,x=>x.name||x.id);
      if(!found.item)return {handled:true,text:'Не нашёл категорию «'+command.category+'».'};
      const section=found.item;
      if(command.intent==='category_toggle'){
        section.active=command.enabled;
        const states=config.assistant_category_item_state&&typeof config.assistant_category_item_state==='object'
          ? {...config.assistant_category_item_state}:{};
        const categoryItems=menu.filter(x=>String(x.c||x.category||'')===String(section.id));
        if(command.enabled){
          const saved=states[section.id]&&typeof states[section.id]==='object'?states[section.id]:{};
          for(const item of categoryItems)item.active=Object.prototype.hasOwnProperty.call(saved,String(item.id))?saved[String(item.id)]!==false:true;
          delete states[section.id];
        }else{
          states[section.id]=Object.fromEntries(categoryItems.map(item=>[String(item.id),item.active!==false]));
          for(const item of categoryItems)item.active=false;
        }
        const nextConfig={...config,menu_sections:sections,assistant_category_item_state:states};
        await saveMenu(access,user.id,menu,nextConfig,'assistant_category_toggle',{category_id:section.id,active:command.enabled,items:categoryItems.length});
        return {handled:true,text:'✅ Категория '+section.name+' — '+(command.enabled?'включена':'скрыта вместе с её позициями')+'.'};
      }
      const old=section.name;section.name=command.name;
      await saveMenu(access,user.id,menu,{...config,menu_sections:sections},'assistant_category_rename',{category_id:section.id,old_name:old,new_name:command.name});
      return {handled:true,text:'✅ Категория «'+old+'» → <b>'+command.name+'</b>'};
    }

    if(command.intent==='builder_toggle'){
      config.builder_enabled=command.enabled;
      const q=await DB.query('UPDATE shaurma_venues SET config=$2::jsonb,updated_at=NOW() WHERE establishment_id=$1 RETURNING *',
        [access.establishment_id,JSON.stringify(config)]);
      if(q.rows[0])publishVenue(q.rows[0]);
      await audit(access.establishment_id,user.id,'assistant_builder_toggle',{enabled:command.enabled});
      return {handled:true,text:'✅ Конструктор — '+(command.enabled?'включён':'выключен')+'.'};
    }

    if(['venue_name','venue_address','venue_hours','venue_description','venue_phone','venue_website','delivery_toggle','pickup_toggle'].includes(command.intent)){
      const nextName=command.intent==='venue_name'?command.value:venue.name;
      const nextAddress=command.intent==='venue_address'?command.value:(venue.address||'');
      const nextHours=command.intent==='venue_hours'?command.value:(venue.hours||'');
      const nextDescription=command.intent==='venue_description'?command.value:(venue.description||'');
      const nextConfig={...config};
      if(command.intent==='venue_phone')nextConfig.phone=command.value;
      if(command.intent==='venue_website')nextConfig.website=command.value;
      if(command.intent==='delivery_toggle')nextConfig.delivery_enabled=command.enabled;
      if(command.intent==='pickup_toggle')nextConfig.pickup_enabled=command.enabled;

      await DB.query('UPDATE shaurma_venues SET name=$2,config=$3::jsonb,updated_at=NOW() WHERE establishment_id=$1',
        [access.establishment_id,nextName,JSON.stringify(nextConfig)]);
      await DB.query('UPDATE shaurmeg_markers SET name=$2,address=$3,description=$4,hours=$5,metadata_locked=TRUE,updated_at=NOW() WHERE establishment_id=$1',
        [access.establishment_id,nextName,nextAddress,nextDescription,nextHours]);
      const updated=(await DB.query('SELECT * FROM shaurma_venues WHERE establishment_id=$1',[access.establishment_id])).rows[0];
      if(updated)publishVenue(updated);
      await audit(access.establishment_id,user.id,'assistant_'+command.intent,{value:command.value,enabled:command.enabled});
      const labels={venue_name:'Название точки',venue_address:'Адрес',venue_hours:'Режим работы',venue_description:'Описание',venue_phone:'Телефон',venue_website:'Сайт',delivery_toggle:'Доставка',pickup_toggle:'Самовывоз'};
      const value=command.intent.endsWith('_toggle')?(command.enabled?'включено':'выключено'):command.value;
      return {handled:true,text:'✅ '+labels[command.intent]+': <b>'+String(value)+'</b>'};
    }

    if(command.intent==='orders_show'){
      const q=await DB.query("SELECT * FROM shaurma_orders WHERE establishment_id=$1 AND status NOT IN ('done','cancelled') ORDER BY created_at DESC LIMIT 12",[access.establishment_id]);
      return {handled:true,text:'🧾 <b>Активные заказы</b>\n\n'+(q.rows.length?q.rows.map(orderLine).join('\n'):'Активных заказов нет.')};
    }

    if(command.intent==='stats_show'){
      const q=await DB.query("SELECT * FROM shaurma_orders WHERE establishment_id=$1 AND created_at>=NOW()-INTERVAL '1 day'",[access.establishment_id]);
      const rows=q.rows,revenue=rows.filter(x=>x.status!=='cancelled').reduce((s,x)=>s+(Number(x.total)||0),0);
      return {handled:true,text:'📊 <b>Сегодня</b>\n\nЗаказов: '+rows.length+'\nНовых: '+rows.filter(x=>x.status==='new').length+'\nГотовятся: '+rows.filter(x=>x.status==='cooking').length+'\nГотовы: '+rows.filter(x=>x.status==='ready').length+'\nВыручка: '+revenue+' ₽'};
    }

    if(command.intent==='order_status'){
      const q=await DB.query('SELECT * FROM shaurma_orders WHERE id=$1 AND establishment_id=$2',[command.order_id,access.establishment_id]);
      const order=q.rows[0];if(!order)return {handled:true,text:'Заказ #'+command.order_id+' не найден в этой точке.'};
      const allowed={new:['cooking','cancelled'],cooking:['ready','cancelled'],ready:['done','cancelled'],done:[],cancelled:[]};
      if(order.status!==command.status&&!allowed[order.status]?.includes(command.status)){
        return {handled:true,text:'Статус не изменён. Сейчас: '+(STATUS_LABELS[order.status]||order.status)+'. Допустимо: '+((allowed[order.status]||[]).map(x=>STATUS_LABELS[x]).join(', ')||'нет переходов')+'.'};
      }
      if(order.status===command.status)return {handled:true,text:'Заказ #'+order.id+' уже имеет статус «'+STATUS_LABELS[order.status]+'».'};
      const upd=await DB.query('UPDATE shaurma_orders SET status=$3,updated_at=NOW() WHERE id=$1 AND establishment_id=$2 RETURNING *',[order.id,access.establishment_id,command.status]);
      const changed=upd.rows[0];
      if(changed){
        pushOwner('update',changed);
        rt.pushVenue(changed.establishment_id,'update',changed);
        if(changed.telegram_user_id)rt.pushUser(changed.telegram_user_id,'update',changed);
      }
      await audit(access.establishment_id,user.id,'assistant_order_status',{order_id:order.id,status:command.status});
      return {handled:true,text:'✅ Заказ #'+order.id+' → <b>'+STATUS_LABELS[command.status]+'</b>'};
    }

    return {handled:false};
  }

  return {handle};
}

module.exports={createVenueCommandBus,parseCommand,helpText,norm,slug,findNamed,venueShortKey};
