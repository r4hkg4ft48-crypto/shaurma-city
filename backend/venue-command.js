'use strict';

const D=require('../v2/backend/src/domain');
const rt=require('../v2/backend/src/realtime');

const STATUS_LABELS={new:'Принят',cooking:'Готовится',ready:'Готово',done:'Выполнен',cancelled:'Отменён'};
const PERMISSION_BY_INTENT={
  menu_show:'menu',menu_price:'menu',menu_price_context:'menu',menu_toggle:'menu',menu_add:'menu',menu_rename:'menu',menu_description:'menu',
  menu_item_select:'menu',menu_item_show:'menu',menu_available:'menu',menu_badge:'menu',menu_featured:'menu',menu_display:'menu',menu_image_remove:'menu',menu_image_fit:'menu',
  menu_category_move:'menu',menu_delete:'menu',menu_duplicate:'menu',menu_qty:'menu',menu_weight:'menu',menu_composition:'menu',menu_sku:'menu',menu_stock:'menu',menu_tags:'menu',menu_recommended:'menu',menu_card_color:'menu',menu_schedule:'menu',
  fixed_option_add:'menu',fixed_option_delete:'menu',fixed_option_price:'menu',fixed_option_toggle:'menu',fixed_option_default:'menu',
  choice_group_add:'menu',choice_group_select:'menu',choice_group_delete:'menu',choice_group_rename:'menu',choice_group_toggle:'menu',choice_group_required:'menu',choice_group_type:'menu',choice_group_limit:'menu',
  choice_option_add:'menu',choice_option_price:'menu',choice_option_toggle:'menu',choice_option_delete:'menu',choice_option_rename:'menu',choice_option_default:'menu',
  category_show:'menu',category_add:'menu',category_toggle:'menu',category_rename:'menu',category_delete:'menu',category_emoji:'menu',category_order:'menu',
  builder_toggle:'menu',builder_show:'menu',builder_option_add:'menu',builder_option_delete:'menu',builder_option_price:'menu',builder_option_rename:'menu',builder_limit:'menu',builder_title:'menu',builder_subtitle:'menu',
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

  m=raw.match(/^\/item\s+(.+)$/i)||
    raw.match(/^(?:работаем с|работать с|настрой|настраиваем|редактируй|редактируем|открой)\s+(?:позицию|блюдо|товар)?\s*(.+)$/i);
  if(m&&!/^(?:выбор|выбором|групп|параметр)/i.test(clean(m[1])))return {intent:'menu_item_select',item:clean(m[1])};

  m=raw.match(/^(?:покажи|дай)\s+(?:настройки\s+)?(?:позиции|блюда|товара)\s+(.+)$/i);
  if(m)return {intent:'menu_item_show',item:clean(m[1])};
  if(/^(?:покажи|дай)\s+(?:настройки\s+)?(?:позиции|блюда|товара)$/i.test(raw)||/^(?:что у позиции|настройки позиции)$/i.test(raw))return {intent:'menu_item_show'};

  m=raw.match(/^(?:нет в наличии|закончил(?:ся|ась|ось)|стоп)\s*(?:позиция|блюдо|товар)?\s*(.*)$/i);
  if(m)return {intent:'menu_available',item:clean(m[1]),available:false};
  m=raw.match(/^(?:верни|вернуть)\s*(?:позицию|блюдо|товар)?\s*(.+?)\s+(?:в наличие|в продажу)$/i)||
    raw.match(/^есть\s+(?:позиция|блюдо|товар)?\s*(.+)$/i);
  if(m&&clean(m[1]))return {intent:'menu_available',item:clean(m[1]),available:true};
  if(/^(?:верни в наличие|снова в наличии|есть в наличии)$/i.test(raw))return {intent:'menu_available',available:true};

  m=raw.match(/^(?:цена|поставь цену|измени цену|поменяй цену)\s+(\d+(?:[.,]\d+)?)\s*(?:₽|р|руб(?:лей|ля)?)?$/i);
  if(m)return {intent:'menu_price_context',price:money(m[1])};

  m=raw.match(/^(?:бейдж|метка|ярлык)\s*(?:=|:)?\s*(.+)$/i);
  if(m)return {intent:'menu_badge',value:clean(m[1])};
  if(/^(?:убери|удали|очисти)\s+(?:бейдж|метку|ярлык)$/i.test(raw))return {intent:'menu_badge',value:''};

  if(/^(?:сделай|поставь)\s+(?:ее|его|позицию)?\s*(?:главной|главным|в главное)$/i.test(s)||/^главная позиция$/i.test(raw))return {intent:'menu_featured',enabled:true};
  if(/^(?:убери|сними)\s+(?:ее|его|позицию)?\s*(?:из главных|с главной)$/i.test(s))return {intent:'menu_featured',enabled:false};

  m=raw.match(/^(?:вид|отображение|карточка)\s+(главная|крупная|компактная|обычная|авто)$/i);
  if(m)return {intent:'menu_display',display:/главн|крупн/i.test(m[1])?'main':/компакт/i.test(m[1])?'compact':'auto'};
  if(/^(?:убери|удали|очисти)\s+фото$/i.test(raw))return {intent:'menu_image_remove'};
  if(/^(?:фото|изображение)\s+(?:вписать|целиком|contain)$/i.test(raw))return {intent:'menu_image_fit',image_fit:'contain'};
  if(/^(?:фото|изображение)\s+(?:обрезать|заполнить|cover)$/i.test(raw))return {intent:'menu_image_fit',image_fit:'cover'};


  m=raw.match(/^перенеси\s+(.+?)\s+в\s+(?:категори[юя]\s+)?(.+)$/i);
  if(m)return {intent:'menu_category_move',item:clean(m[1]),category:clean(m[2])};
  m=raw.match(/^(?:перенеси|перемести)\s+(?:в\s+)?(?:категори[юя]\s+)?(.+)$/i);
  if(m)return {intent:'menu_category_move',category:clean(m[1])};

  m=raw.match(/^(?:удали|удалить)\s+(?:позицию|блюдо|товар)\s+(.+)$/i);
  if(m)return {intent:'menu_delete',item:clean(m[1])};
  if(/^(?:удали|удалить)\s+(?:эту\s+)?(?:позицию|блюдо|товар)$/i.test(raw))return {intent:'menu_delete'};

  m=raw.match(/^(?:дублируй|дублировать|скопируй|копия)\s+(?:позицию|блюдо|товар)?\s*(.*)$/i);
  if(m)return {intent:'menu_duplicate',item:clean(m[1])};

  m=raw.match(/^(?:минимум|min)\s+(?:по\s+)?(\d+)\s*(?:шт|штук|штуки)\s*(?:в заказе)?$/i)||
    raw.match(/^минимальное количество\s+(\d+)$/i);
  if(m)return {intent:'menu_qty',field:'min_qty',value:Number(m[1])};
  m=raw.match(/^(?:максимум|max)\s+(?:по\s+)?(\d+)\s*(?:шт|штук|штуки)\s*(?:в заказе)?$/i)||
    raw.match(/^максимальное количество\s+(\d+)$/i);
  if(m)return {intent:'menu_qty',field:'max_qty',value:Number(m[1])};

  m=raw.match(/^(?:вес|масса)\s*(?:=|:)?\s*(.+)$/i);
  if(m)return {intent:'menu_weight',value:clean(m[1])};
  m=raw.match(/^(?:состав|ингредиенты)\s*(?:=|:)?\s*(.+)$/i);
  if(m)return {intent:'menu_composition',value:clean(m[1])};
  m=raw.match(/^(?:sku|артикул)\s*(?:=|:)?\s*(.+)$/i);
  if(m)return {intent:'menu_sku',value:clean(m[1])};
  m=raw.match(/^(?:остаток|в наличии)\s*(?:=|:)?\s*(\d+)$/i);
  if(m)return {intent:'menu_stock',value:Number(m[1])};
  if(/^(?:остаток|запас)\s+(?:безлимит|без ограничений|не считать)$/i.test(raw))return {intent:'menu_stock',value:null};
  m=raw.match(/^(?:теги|метки)\s*(?:=|:)?\s*(.+)$/i);
  if(m)return {intent:'menu_tags',value:clean(m[1]).split(/[,;]+/).map(clean).filter(Boolean)};
  if(/^(?:рекомендовать|сделай рекомендованной|в рекомендации)$/i.test(raw))return {intent:'menu_recommended',enabled:true};
  if(/^(?:не рекомендовать|убери из рекомендаций)$/i.test(raw))return {intent:'menu_recommended',enabled:false};
  m=raw.match(/^(?:цвет карточки|цвет блюда)\s*(?:=|:)?\s*(#[0-9a-f]{6})$/i);
  if(m)return {intent:'menu_card_color',value:m[1].toUpperCase()};
  if(/^(?:расписание|время доступности)\s+(?:выкл|выключи|всегда)$/i.test(raw))return {intent:'menu_schedule',enabled:false};
  m=raw.match(/^(?:расписание|доступна|доступно|продаем|продаётся)\s+(?:с\s+)?(\d{1,2}:\d{2})\s+(?:до|-|–)\s*(\d{1,2}:\d{2})$/i);
  if(m)return {intent:'menu_schedule',enabled:true,from:m[1],to:m[2]};

  m=raw.match(/^(?:добавь|создай)\s+(?:вариант\s+)(мясо|мяса|размер|размера|основу|основы|соус|соуса|добавку|добавки)\s+(.+?)(?:\s+([+-]\d+(?:[.,]\d+)?)\s*(?:₽|р|руб)?)?$/i)||
    raw.match(/^(?:добавь|создай)\s+в позицию\s+(мясо|мяса|размер|размера|основу|основы|соус|соуса|добавку|добавки)\s+(.+?)(?:\s+([+-]\d+(?:[.,]\d+)?)\s*(?:₽|р|руб)?)?$/i);
  if(m)return {intent:'fixed_option_add',group:clean(m[1]),name:clean(m[2]),price:m[3]?Number(String(m[3]).replace(',','.')):0};
  m=raw.match(/^(?:удали|убери)\s+(?:вариант\s+)?(мяса|размера|основы|соуса|добавки)\s+(.+)$/i);
  if(m)return {intent:'fixed_option_delete',group:clean(m[1]),option:clean(m[2])};
  m=raw.match(/^(?:цена|доплата)\s+(?:варианта\s+)?(мяса|размера|основы|соуса|добавки)\s+(.+?)\s+([+-]?\d+(?:[.,]\d+)?)\s*(?:₽|р|руб)?$/i);
  if(m)return {intent:'fixed_option_price',group:clean(m[1]),option:clean(m[2]),price:Number(String(m[3]).replace(',','.'))};
  m=raw.match(/^(?:выключи|скрой)\s+(?:вариант\s+)?(мяса|размера|основы|соуса|добавки)\s+(.+)$/i);
  if(m)return {intent:'fixed_option_toggle',group:clean(m[1]),option:clean(m[2]),enabled:false};
  m=raw.match(/^(?:включи|верни)\s+(?:вариант\s+)?(мяса|размера|основы|соуса|добавки)\s+(.+)$/i);
  if(m)return {intent:'fixed_option_toggle',group:clean(m[1]),option:clean(m[2]),enabled:true};
  m=raw.match(/^(?:сделай|поставь)\s+(?:вариант\s+)?(мяса|размера|основы|соуса|добавки)\s+(.+?)\s+(?:по умолчанию|дефолтным)$/i);
  if(m)return {intent:'fixed_option_default',group:clean(m[1]),option:clean(m[2])};


  m=raw.match(/^(?:добавь|создай)\s+(?:выбор|группу|параметр)\s+(.+)$/i);
  if(m)return {intent:'choice_group_add',name:clean(m[1])};
  m=raw.match(/^(?:работаем с|открой|выбери)\s+(?:выбор|выбором|группу|группой|параметр|параметром)\s+(.+)$/i);
  if(m)return {intent:'choice_group_select',group:clean(m[1])};
  m=raw.match(/^(?:удали|убери)\s+(?:выбор|группу|параметр)\s*(.*)$/i);
  if(m)return {intent:'choice_group_delete',group:clean(m[1])};
  m=raw.match(/^переименуй\s+(?:выбор|группу|параметр)\s+(.+?)\s*(?:->|→|в)\s*(.+)$/i);
  if(m)return {intent:'choice_group_rename',group:clean(m[1]),name:clean(m[2])};
  m=raw.match(/^(?:выключи|скрой)\s+(?:выбор|группу|параметр)\s+(.+)$/i);
  if(m)return {intent:'choice_group_toggle',group:clean(m[1]),enabled:false};
  m=raw.match(/^(?:включи|верни)\s+(?:выбор|группу|параметр)\s+(.+)$/i);
  if(m)return {intent:'choice_group_toggle',group:clean(m[1]),enabled:true};


  if(/^(?:сделай\s+)?(?:выбор\s+)?обязательн(?:ым|ый)$/i.test(raw))return {intent:'choice_group_required',required:true};
  if(/^(?:сделай\s+)?(?:выбор\s+)?необязательн(?:ым|ый)$/i.test(raw))return {intent:'choice_group_required',required:false};
  if(/^(?:один вариант|только один|одиночный выбор)$/i.test(raw))return {intent:'choice_group_type',type:'single'};
  if(/^(?:можно несколько|несколько вариантов|множественный выбор)$/i.test(raw))return {intent:'choice_group_type',type:'multiple'};
  m=raw.match(/^(?:можно выбрать|максимум)\s+(?:до\s+)?(\d+)$/i);
  if(m)return {intent:'choice_group_limit',field:'max',value:Number(m[1])};
  m=raw.match(/^(?:нужно выбрать|минимум)\s+(?:хотя бы\s+)?(\d+)$/i);
  if(m)return {intent:'choice_group_limit',field:'min',value:Number(m[1])};

  m=raw.match(/^(?:добавь|создай)\s+(?:вариант|опцию)\s+(.+?)(?:\s+([+-]\d+(?:[.,]\d+)?)\s*(?:₽|р|руб)?)?$/i);
  if(m)return {intent:'choice_option_add',name:clean(m[1]),price_delta:m[2]?Number(String(m[2]).replace(',','.')):0};
  m=raw.match(/^(?:цена|доплата)\s+(?:варианта|опции)\s+(.+?)\s+([+-]?\d+(?:[.,]\d+)?)\s*(?:₽|р|руб)?$/i);
  if(m)return {intent:'choice_option_price',option:clean(m[1]),price_delta:Number(String(m[2]).replace(',','.'))};
  m=raw.match(/^(?:выключи|скрой|стоп)\s+(?:вариант|опцию)\s+(.+)$/i);
  if(m)return {intent:'choice_option_toggle',option:clean(m[1]),enabled:false};
  m=raw.match(/^(?:включи|верни)\s+(?:вариант|опцию)\s+(.+)$/i);
  if(m)return {intent:'choice_option_toggle',option:clean(m[1]),enabled:true};
  m=raw.match(/^(?:удали|убери)\s+(?:вариант|опцию)\s+(.+)$/i);
  if(m)return {intent:'choice_option_delete',option:clean(m[1])};
  m=raw.match(/^переименуй\s+(?:вариант|опцию)\s+(.+?)\s*(?:->|→|в)\s*(.+)$/i);
  if(m)return {intent:'choice_option_rename',option:clean(m[1]),name:clean(m[2])};
  m=raw.match(/^(?:сделай|поставь)\s+(?:вариант|опцию)\s+(.+?)\s+(?:по умолчанию|дефолтной)$/i);
  if(m)return {intent:'choice_option_default',option:clean(m[1])};


  if(/^(?:покажи|открой|дай)\s+конструктор$/i.test(raw)||/^конструктор настройки$/i.test(raw))return {intent:'builder_show'};

  m=raw.match(/^добавь\s+(формат|тип|лаваш|мясо|соус|добавку|добавка)\s+(.+?)(?:\s+([+-]?\d+(?:[.,]\d+)?)\s*(?:₽|р|руб)?)?$/i);
  if(m)return {intent:'builder_option_add',group:clean(m[1]),name:clean(m[2]),price:m[3]?Number(String(m[3]).replace(',','.')):0};
  m=raw.match(/^(?:удали|убери)\s+(формат|тип|лаваш|мясо|соус|добавку|добавка)\s+(.+)$/i);
  if(m)return {intent:'builder_option_delete',group:clean(m[1]),option:clean(m[2])};
  m=raw.match(/^(?:цена|доплата)\s+(формата|типа|лаваша|мяса|соуса|добавки)\s+(.+?)\s+([+-]?\d+(?:[.,]\d+)?)\s*(?:₽|р|руб)?$/i);
  if(m)return {intent:'builder_option_price',group:clean(m[1]),option:clean(m[2]),price:Number(String(m[3]).replace(',','.'))};
  m=raw.match(/^переименуй\s+(формат|тип|лаваш|мясо|соус|добавку|добавка)\s+(.+?)\s*(?:->|→|в)\s*(.+)$/i);
  if(m)return {intent:'builder_option_rename',group:clean(m[1]),option:clean(m[2]),name:clean(m[3])};

  m=raw.match(/^(минимум|максимум)\s+соус(?:ов|а)?\s+(\d+)$/i);
  if(m)return {intent:'builder_limit',field:/минимум/i.test(m[1])?'min_sauces':'max_sauces',value:Number(m[2])};
  m=raw.match(/^максимум\s+добав(?:ок|ки)\s+(\d+)$/i);
  if(m)return {intent:'builder_limit',field:'max_extras',value:Number(m[1])};

  m=raw.match(/^название\s+конструктора\s*(?:=|:)?\s*(.+)$/i);
  if(m)return {intent:'builder_title',value:clean(m[1])};
  m=raw.match(/^(?:описание|подзаголовок)\s+конструктора\s*(?:=|:)?\s*(.+)$/i);
  if(m)return {intent:'builder_subtitle',value:clean(m[1])};

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
  m=raw.match(/^(?:удали|удалить)\s+категори[юя]\s+(.+)$/i);
  if(m)return {intent:'category_delete',category:clean(m[1])};
  m=raw.match(/^(?:эмодзи|иконка)\s+категории\s+(.+?)\s+(.+)$/i);
  if(m)return {intent:'category_emoji',category:clean(m[1]),emoji:clean(m[2])};
  m=raw.match(/^категория\s+(.+?)\s+(?:номер|позиция)\s+(\d+)$/i);
  if(m)return {intent:'category_order',category:clean(m[1]),order:Number(m[2])};


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
    '🤖 Ассистент меню Shaurmeg',
    '',
    'Можно писать обычными фразами. Сначала выберите точку и при желании позицию.',
    '',
    'ТОЧКА',
    '• мои заведения',
    '• /use 5E435A',
    '• выбери точку Лепёшка',
    '',
    'ПОЗИЦИЯ',
    '• работаем с сырной шаурмой',
    '• покажи настройки позиции Айран',
    '• цена 420',
    '• нет в наличии',
    '• верни в наличие',
    '• скрой блюдо Айран / верни Айран в меню',
    '• бейдж Хит / убери бейдж',
    '• сделай главной',
    '• карточка компактная',
    '• перенеси в категорию Напитки',
    '• минимум 1 шт / максимум 5 шт',
    '• вес 450 г',
    '• состав курица, овощи, соус',
    '• SKU SH-001',
    '• остаток 12 / остаток безлимит',
    '• теги острое, хит',
    '• рекомендовать / не рекомендовать',
    '• цвет карточки #FF463D',
    '• расписание с 10:00 до 22:00 / расписание выкл',
    '• дублируй позицию',
    '• удали позицию',
    '',
    'НОВАЯ ПОЗИЦИЯ',
    '• добавь Морс в Напитки за 170',
    '• добавь блюдо Айран | Напитки | 150 | Домашний айран',
    '',
    'КАТЕГОРИИ',
    '• покажи категории',
    '• добавь категорию Десерты',
    '• выключи категорию Выпечка',
    '• переименуй категорию Напитки -> Бар',
    '',
    'ВСТРОЕННЫЕ ВАРИАНТЫ БЛЮДА',
    '• добавь вариант мяса Говядина +100',
    '• добавь вариант размера Большая +80',
    '• доплата варианта соуса Сырный 30',
    '• выключи вариант добавки Халапеньо',
    '',
    'КНОПКИ И ПРОИЗВОЛЬНЫЕ ВЫБОРЫ ВНУТРИ БЛЮДА',
    '• добавь выбор Размер',
    '• сделай обязательным',
    '• можно несколько',
    '• можно выбрать до 2',
    '• нужно выбрать минимум 1',
    '• добавь вариант Маленькая',
    '• добавь вариант Большая +80',
    '• доплата варианта Большая 100',
    '• выключи вариант Большая',
    '• переименуй вариант Большая -> XL',
    '• сделай вариант Средняя по умолчанию',
    '• удали вариант XL',
    '• удали выбор Размер',
    '',
    'ФОТО',
    '• выберите позицию и просто отправьте фото',
    '• или подпишите фото: «фото для Айран»',
    '',
    'КОНСТРУКТОР «СОБЕРИ СВОЮ»',
    '• покажи конструктор',
    '• конструктор вкл / конструктор выкл',
    '• добавь формат Большая 450',
    '• добавь мясо Говядина +100',
    '• добавь соус Сырный +30',
    '• добавь добавку Халапеньо +40',
    '• цена соуса Сырный 50',
    '• удали соус Барбекю',
    '• минимум соусов 1 / максимум соусов 2',
    '• максимум добавок 4',
    '',
    'Все изменения сразу идут в общее меню и Mini App. Для изменения меню нужны права владельца/менеджера.'
  ].join('\n');
}

function canUse(access,permission){
  if(!permission)return true;
  const permissions=Array.isArray(access?.permissions)?access.permissions:[];
  return access?.role==='owner'||permissions.includes(permission);
}

function sectionsFrom(config={},menu=[]){
  if(typeof D.normalizeMenuSections==='function')return D.normalizeMenuSections(config?.menu_sections,menu,true);
  const raw=Array.isArray(config?.menu_sections)?config.menu_sections:[];
  return raw.map((x,i)=>({...x,order:i}));
}

function looseWords(v){
  return norm(v).split(/[^a-z0-9а-я]+/i).filter(Boolean)
    .filter(x=>!['с','со','и','в','во','на','для','из','по'].includes(x))
    .map(x=>x.length>=5?x.slice(0,4):x);
}
function findNamed(list,query,getName=x=>x?.name||x?.n||''){
  const q=norm(query);
  if(!q)return {item:null,matches:[]};
  const exact=list.filter(x=>norm(getName(x))===q);
  if(exact.length===1)return {item:exact[0],matches:exact};
  const partial=list.filter(x=>norm(getName(x)).includes(q)||q.includes(norm(getName(x))));
  if(partial.length===1)return {item:partial[0],matches:partial};
  const qWords=[...new Set(looseWords(q))];
  if(qWords.length){
    const scored=list.map(x=>{
      const words=new Set(looseWords(getName(x)));
      const hits=qWords.filter(w=>words.has(w)).length;
      return {x,hits,ratio:hits/qWords.length};
    }).filter(r=>r.hits>0).sort((a,b)=>b.ratio-a.ratio||b.hits-a.hits);
    if(scored.length&&scored[0].ratio===1&&(scored.length===1||scored[1].ratio<1))return {item:scored[0].x,matches:[scored[0].x]};
    const best=scored.filter(r=>r.ratio===scored[0]?.ratio&&r.hits===scored[0]?.hits).map(r=>r.x);
    if(best.length===1&&scored[0].ratio>=.67)return {item:best[0],matches:best};
    if(best.length)return {item:null,matches:best.slice(0,8)};
  }
  return {item:null,matches:(exact.length?exact:partial).slice(0,8)};
}
function itemSettingsText(item,sections=[]){
  if(!item)return '';
  const section=sections.find(x=>String(x.id)===String(item.c||item.category||'')),groups=Array.isArray(item.choice_groups)?item.choice_groups:[];
  const fixed=item.options&&typeof item.options==='object'?item.options:{};
  const schedule=item.schedule&&typeof item.schedule==='object'?item.schedule:{};
  const lines=[
    '🍽 '+String(item.n||item.name||'Позиция'),
    'ID: '+String(item.id),
    'Категория: '+String(section?.name||item.c||item.category||'—'),
    'Цена: '+Number(item.p??item.price??0)+' ₽',
    'В меню: '+(item.active===false?'нет':'да'),
    'В наличии: '+(item.available===false||Number(item.stock)===0?'нет':'да'),
    'Остаток: '+(item.stock===null||item.stock===undefined?'не ограничен':String(item.stock)),
    'Вес: '+String(item.weight||'—'),
    'SKU: '+String(item.sku||'—'),
    'Состав: '+String(item.composition||'—'),
    'Теги: '+((Array.isArray(item.tags)&&item.tags.length)?item.tags.join(', '):'—'),
    'Карточка: '+String(item.display||'auto')+' · фото '+String(item.image_fit||'cover'),
    'Главная: '+(item.featured===true?'да':'нет')+' · рекомендованная: '+(item.recommended===true?'да':'нет'),
    'Бейдж: '+String(item.badge||'—'),
    'Цвет карточки: '+String(item.card_color||'—'),
    'Количество: '+Math.max(1,Number(item.min_qty)||1)+'–'+Math.max(1,Number(item.max_qty)||50),
    'Расписание: '+(schedule.enabled===true?String(schedule.from||'00:00')+'–'+String(schedule.to||'23:59'):'всегда'),
    'Произвольных групп выбора: '+groups.length
  ];
  if(item.d||item.description)lines.push('Описание: '+String(item.d||item.description));
  for(const key of ['meats','sizes','bases','sauces','extras']){
    const list=Array.isArray(fixed[key])?fixed[key]:[];
    if(!list.length)continue;
    lines.push('',fixedGroupLabel(key)+(Array.isArray(fixed.required_groups)&&fixed.required_groups.includes(key)?' · обязательно':'')+':');
    for(const o of list)lines.push('  - '+(o.active===false?'○ ':'● ')+String(o.name||'Вариант')+(Number(o.price)?' '+(Number(o.price)>0?'+':'')+Number(o.price)+' ₽':'')+(o.default===true?' · по умолчанию':''));
  }
  for(const g of groups){
    const opts=Array.isArray(g.options)?g.options:[];
    lines.push('', '• '+String(g.name||'Выбор')+' · '+(g.active===false?'выкл · ':'')+(g.type==='multiple'?'несколько':'один')+' · '+Math.max(g.required?1:0,Number(g.min)||0)+'–'+Math.max(1,Number(g.max)||1));
    for(const o of opts)lines.push('  - '+(o.active===false?'○ ':'● ')+String(o.name||'Вариант')+(Number(o.price_delta)?' '+(Number(o.price_delta)>0?'+':'')+Number(o.price_delta)+' ₽':'')+(o.default===true?' · по умолчанию':''));
  }
  return lines.join('\n').slice(0,3900);
}

function menuLine(x){
  return (x.active===false?'○ ':'● ')+String(x.n||x.name||'Позиция')+' · '+Number(x.p??x.price??0)+' ₽ · '+String(x.c||x.category||'');
}
function orderLine(o){
  return '• #'+o.id+' · '+String(o.order_number||'')+' · '+(STATUS_LABELS[o.status]||o.status)+' · '+Number(o.total||0)+' ₽';
}
function fixedGroupKey(v){
  const s=norm(v);
  if(/мяс/.test(s))return 'meats';
  if(/размер/.test(s))return 'sizes';
  if(/основ/.test(s))return 'bases';
  if(/соус/.test(s))return 'sauces';
  if(/добав/.test(s))return 'extras';
  return '';
}
function fixedGroupLabel(key){return ({meats:'Мясо',sizes:'Размер',bases:'Основа',sauces:'Соусы',extras:'Добавки'})[key]||key}
function builderGroupKey(v){
  const s=norm(v);
  if(/формат|тип/.test(s))return 'types';
  if(/лаваш/.test(s))return 'breads';
  if(/мяс/.test(s))return 'meats';
  if(/соус/.test(s))return 'sauces';
  if(/добав/.test(s))return 'extras';
  return '';
}
function builderGroupLabel(key){return ({types:'Форматы',breads:'Лаваш',meats:'Мясо',sauces:'Соусы',extras:'Добавки'})[key]||key}

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
    await DB.query('INSERT INTO shaurma_owner_command_context(telegram_user_id,establishment_id,selected_item_id,selected_group_id,updated_at) VALUES($1,$2,NULL,NULL,NOW()) '+
      'ON CONFLICT(telegram_user_id) DO UPDATE SET '+
      'selected_item_id=CASE WHEN shaurma_owner_command_context.establishment_id=EXCLUDED.establishment_id THEN shaurma_owner_command_context.selected_item_id ELSE NULL END,'+
      'selected_group_id=CASE WHEN shaurma_owner_command_context.establishment_id=EXCLUDED.establishment_id THEN shaurma_owner_command_context.selected_group_id ELSE NULL END,'+
      'establishment_id=EXCLUDED.establishment_id,updated_at=NOW()',
      [String(userId),est]);
  }
  async function editorContext(userId){
    const q=await DB.query('SELECT establishment_id,selected_item_id,selected_group_id FROM shaurma_owner_command_context WHERE telegram_user_id=$1',[String(userId)]);
    return q.rows[0]||{};
  }
  async function selectItemContext(userId,itemId){
    await DB.query('UPDATE shaurma_owner_command_context SET selected_item_id=$2,selected_group_id=NULL,updated_at=NOW() WHERE telegram_user_id=$1',[String(userId),String(itemId||'')]);
  }
  async function selectGroupContext(userId,groupId){
    await DB.query('UPDATE shaurma_owner_command_context SET selected_group_id=$2,updated_at=NOW() WHERE telegram_user_id=$1',[String(userId),String(groupId||'')]);
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
    const nextConfig={...(config||{}),menu_revision:(Number(config?.menu_revision)||0)+1};
    const q=await DB.query('UPDATE shaurma_venues SET menu=$2::jsonb,config=$3::jsonb,updated_at=NOW() WHERE establishment_id=$1 RETURNING *',
      [access.establishment_id,JSON.stringify(normalized),JSON.stringify(nextConfig)]);
    if(q.rows[0])publishVenue(q.rows[0]);
    await audit(access.establishment_id,userId,action,{...payload,menu_revision:nextConfig.menu_revision});
    return q.rows[0];
  }
  async function saveBuilder(access,userId,config,builder,action,payload={}){
    const normalized=D.normalizeBuilderConfig(builder||{});
    const next={...(config||{}),builder:normalized};
    const q=await DB.query('UPDATE shaurma_venues SET config=$2::jsonb,updated_at=NOW() WHERE establishment_id=$1 RETURNING *',
      [access.establishment_id,JSON.stringify(next)]);
    if(q.rows[0])publishVenue(q.rows[0]);
    await audit(access.establishment_id,userId,action,payload);
    return {row:q.rows[0],builder:normalized,config:next};
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


    const editor=await editorContext(user.id);
    const contextItem=menu.find(x=>String(x.id)===String(editor.selected_item_id||''));
    const resolveItem=(query)=>{
      if(clean(query)){
        const found=findNamed(menu,query,x=>x.n||x.name);
        return {item:found.item,matches:found.matches||[]};
      }
      return {item:contextItem||null,matches:[]};
    };
    const itemMissing=(query,matches=[])=>{
      const hint=matches.length?'\nВозможно:\n'+matches.map(x=>'• '+String(x.n||x.name)).join('\n'):'';
      return {handled:true,text:clean(query)?'Не нашёл позицию «'+query+'».'+hint:'Сначала выберите позицию: «работаем с сырной шаурмой».'};
    };
    const resolveGroup=(item,query)=>{
      const groups=Array.isArray(item?.choice_groups)?item.choice_groups:[];
      if(clean(query)){
        const found=findNamed(groups,query,x=>x.name);
        return {group:found.item,matches:found.matches||[]};
      }
      const selected=groups.find(g=>String(g.id)===String(editor.selected_group_id||''));
      if(selected)return {group:selected,matches:[]};
      if(groups.length===1)return {group:groups[0],matches:[]};
      return {group:null,matches:groups};
    };

    if(command.intent==='menu_item_select'){
      const found=resolveItem(command.item);
      if(!found.item)return itemMissing(command.item,found.matches);
      await selectItemContext(user.id,found.item.id);
      return {handled:true,text:'✅ Работаем с: '+String(found.item.n||found.item.name)+'\n\n'+itemSettingsText(found.item,sections)+'\n\nТеперь можно писать коротко: «цена 420», «нет в наличии», «добавь выбор Размер».'};
    }

    if(command.intent==='menu_item_show'){
      const found=resolveItem(command.item);
      if(!found.item)return itemMissing(command.item,found.matches);
      await selectItemContext(user.id,found.item.id);
      return {handled:true,text:itemSettingsText(found.item,sections)};
    }

    if(command.intent==='menu_price_context'||command.intent==='menu_available'||command.intent==='menu_badge'||command.intent==='menu_featured'||command.intent==='menu_display'||command.intent==='menu_image_remove'||command.intent==='menu_image_fit'||command.intent==='menu_category_move'||command.intent==='menu_delete'||command.intent==='menu_duplicate'||command.intent==='menu_qty'||command.intent==='menu_weight'||command.intent==='menu_composition'||command.intent==='menu_sku'||command.intent==='menu_stock'||command.intent==='menu_tags'||command.intent==='menu_recommended'||command.intent==='menu_card_color'||command.intent==='menu_schedule'){
      const found=resolveItem(command.item);
      if(!found.item)return itemMissing(command.item,found.matches);
      const item=found.item,index=menu.indexOf(item);
      await selectItemContext(user.id,item.id);

      if(command.intent==='menu_price_context'){
        const old=Number(item.p??item.price??0);item.p=command.price;
        await saveMenu(access,user.id,menu,{...config,menu_sections:sections},'assistant_menu_price',{item_id:item.id,old_price:old,new_price:command.price});
        return {handled:true,text:'✅ '+String(item.n||item.name)+': '+old+' ₽ → '+command.price+' ₽'};
      }
      if(command.intent==='menu_available'){
        item.available=command.available;
        await saveMenu(access,user.id,menu,{...config,menu_sections:sections},'assistant_menu_available',{item_id:item.id,available:command.available});
        return {handled:true,text:'✅ '+String(item.n||item.name)+' — '+(command.available?'снова в наличии':'добавлено в стоп-лист. В Mini App останется видно, но заказать нельзя.')};
      }
      if(command.intent==='menu_badge'){
        item.badge=String(command.value||'').slice(0,40);
        await saveMenu(access,user.id,menu,{...config,menu_sections:sections},'assistant_menu_badge',{item_id:item.id,badge:item.badge});
        return {handled:true,text:'✅ Метка '+String(item.n||item.name)+': '+(item.badge||'убрана')};
      }
      if(command.intent==='menu_featured'){
        if(command.enabled)for(const x of menu)x.featured=false;
        item.featured=command.enabled;
        await saveMenu(access,user.id,menu,{...config,menu_sections:sections},'assistant_menu_featured',{item_id:item.id,featured:command.enabled});
        return {handled:true,text:'✅ '+String(item.n||item.name)+' — '+(command.enabled?'главная позиция меню':'убрана из главной позиции')};
      }
      if(command.intent==='menu_display'){
        item.display=command.display;
        await saveMenu(access,user.id,menu,{...config,menu_sections:sections},'assistant_menu_display',{item_id:item.id,display:command.display});
        return {handled:true,text:'✅ Вид карточки: '+command.display};
      }
      if(command.intent==='menu_image_remove'){
        item.image='';
        await saveMenu(access,user.id,menu,{...config,menu_sections:sections},'assistant_menu_image_remove',{item_id:item.id});
        return {handled:true,text:'✅ Фото позиции «'+String(item.n||item.name)+'» удалено.'};
      }
      if(command.intent==='menu_image_fit'){
        item.image_fit=command.image_fit;
        await saveMenu(access,user.id,menu,{...config,menu_sections:sections},'assistant_menu_image_fit',{item_id:item.id,image_fit:item.image_fit});
        return {handled:true,text:'✅ Отображение фото: '+(item.image_fit==='contain'?'вписать целиком':'заполнять карточку')+'.'};
      }
      if(command.intent==='menu_category_move'){
        let category=findNamed(sections,command.category,x=>x.name||x.id).item;
        if(!category){
          category={id:slug(command.category),name:command.category,emoji:'',active:true,order:sections.length};
          sections.push(category);
        }
        item.c=category.id;
        await saveMenu(access,user.id,menu,{...config,menu_sections:sections},'assistant_menu_category_move',{item_id:item.id,category_id:category.id});
        return {handled:true,text:'✅ '+String(item.n||item.name)+' → категория «'+category.name+'»'};
      }
      if(command.intent==='menu_delete'){
        const name=String(item.n||item.name);
        menu.splice(index,1);
        await saveMenu(access,user.id,menu,{...config,menu_sections:sections},'assistant_menu_delete',{item_id:item.id,name});
        await selectItemContext(user.id,'');
        return {handled:true,text:'✅ Позиция «'+name+'» удалена из меню.'};
      }
      if(command.intent==='menu_duplicate'){
        const copy={...item,id:slug(item.n||item.name)+'_'+Date.now().toString(36).slice(-6),n:String(item.n||item.name)+' — копия',featured:false,choice_groups:JSON.parse(JSON.stringify(item.choice_groups||[]))};
        menu.splice(index+1,0,copy);
        await saveMenu(access,user.id,menu,{...config,menu_sections:sections},'assistant_menu_duplicate',{source_item_id:item.id,item_id:copy.id});
        await selectItemContext(user.id,copy.id);
        return {handled:true,text:'✅ Создана копия: '+copy.n+'\nТеперь работаем с ней.'};
      }
      if(command.intent==='menu_qty'){
        const value=Math.max(1,Math.min(50,Math.floor(Number(command.value)||1)));
        item[command.field]=value;
        const min=Math.max(1,Number(item.min_qty)||1),max=Math.max(min,Number(item.max_qty)||50);
        item.min_qty=min;item.max_qty=max;
        if(command.field==='min_qty'&&item.max_qty<value)item.max_qty=value;
        if(command.field==='max_qty'&&item.min_qty>value)item.min_qty=value;
        await saveMenu(access,user.id,menu,{...config,menu_sections:sections},'assistant_menu_qty',{item_id:item.id,min_qty:item.min_qty,max_qty:item.max_qty});
        return {handled:true,text:'✅ Количество для '+String(item.n||item.name)+': '+item.min_qty+'–'+item.max_qty+' шт.'};
      }
      if(command.intent==='menu_weight'){
        item.weight=String(command.value||'').slice(0,40);
        await saveMenu(access,user.id,menu,{...config,menu_sections:sections},'assistant_menu_weight',{item_id:item.id,weight:item.weight});
        return {handled:true,text:'✅ Вес: '+(item.weight||'не указан')};
      }
      if(command.intent==='menu_composition'){
        item.composition=String(command.value||'').slice(0,1200);
        await saveMenu(access,user.id,menu,{...config,menu_sections:sections},'assistant_menu_composition',{item_id:item.id});
        return {handled:true,text:'✅ Состав позиции обновлён.'};
      }
      if(command.intent==='menu_sku'){
        item.sku=String(command.value||'').slice(0,80);
        await saveMenu(access,user.id,menu,{...config,menu_sections:sections},'assistant_menu_sku',{item_id:item.id,sku:item.sku});
        return {handled:true,text:'✅ SKU: '+(item.sku||'не задан')};
      }
      if(command.intent==='menu_stock'){
        item.stock=command.value===null?null:Math.max(0,Math.min(1000000,Math.floor(Number(command.value)||0)));
        item.available=item.stock===0?false:item.available!==false;
        await saveMenu(access,user.id,menu,{...config,menu_sections:sections},'assistant_menu_stock',{item_id:item.id,stock:item.stock});
        return {handled:true,text:'✅ Остаток: '+(item.stock===null?'без ограничений':item.stock)+(item.stock===0?' · позиция недоступна':'')};
      }
      if(command.intent==='menu_tags'){
        item.tags=(Array.isArray(command.value)?command.value:[]).map(x=>String(x).slice(0,40)).filter(Boolean).slice(0,20);
        await saveMenu(access,user.id,menu,{...config,menu_sections:sections},'assistant_menu_tags',{item_id:item.id,tags:item.tags});
        return {handled:true,text:'✅ Теги: '+(item.tags.join(', ')||'убраны')};
      }
      if(command.intent==='menu_recommended'){
        item.recommended=command.enabled;
        await saveMenu(access,user.id,menu,{...config,menu_sections:sections},'assistant_menu_recommended',{item_id:item.id,recommended:item.recommended});
        return {handled:true,text:'✅ '+String(item.n||item.name)+' — '+(item.recommended?'добавлена в рекомендации':'убрана из рекомендаций')};
      }
      if(command.intent==='menu_card_color'){
        item.card_color=String(command.value||'#FFFFFF').toUpperCase();
        await saveMenu(access,user.id,menu,{...config,menu_sections:sections},'assistant_menu_card_color',{item_id:item.id,card_color:item.card_color});
        return {handled:true,text:'✅ Цвет карточки: '+item.card_color};
      }
      if(command.intent==='menu_schedule'){
        item.schedule=command.enabled?{enabled:true,days:[0,1,2,3,4,5,6],from:command.from,to:command.to}:{enabled:false,days:[],from:'',to:''};
        await saveMenu(access,user.id,menu,{...config,menu_sections:sections},'assistant_menu_schedule',{item_id:item.id,schedule:item.schedule});
        return {handled:true,text:'✅ Доступность по времени: '+(item.schedule.enabled?item.schedule.from+'–'+item.schedule.to:'всегда')};
      }
    }

    if(['fixed_option_add','fixed_option_delete','fixed_option_price','fixed_option_toggle','fixed_option_default'].includes(command.intent)){
      const found=resolveItem(command.item);
      if(!found.item)return itemMissing(command.item,found.matches);
      const item=found.item;await selectItemContext(user.id,item.id);
      const key=fixedGroupKey(command.group);
      if(!key)return {handled:true,text:'Не понял тип варианта. Используйте мясо, размер, основу, соус или добавку.'};
      item.options=item.options&&typeof item.options==='object'?JSON.parse(JSON.stringify(item.options)):{meats:[],sizes:[],bases:[],sauces:[],extras:[],required_groups:[]};
      item.options[key]=Array.isArray(item.options[key])?item.options[key]:[];
      const list=item.options[key];
      if(command.intent==='fixed_option_add'){
        const id=slug(command.name)+'_'+Date.now().toString(36).slice(-4);
        list.push({id,name:command.name,price:Number(command.price)||0,active:true,default:false,image:''});
        await saveMenu(access,user.id,menu,{...config,menu_sections:sections},'assistant_fixed_option_add',{item_id:item.id,group:key,option_id:id});
        return {handled:true,text:'✅ '+fixedGroupLabel(key)+': добавлен вариант «'+command.name+'»'+(Number(command.price)?' '+(Number(command.price)>0?'+':'')+Number(command.price)+' ₽':'')};
      }
      const optFound=findNamed(list,command.option,x=>x.name);
      if(!optFound.item)return {handled:true,text:'Не нашёл вариант «'+String(command.option||'')+'» в разделе '+fixedGroupLabel(key)+'.'};
      const option=optFound.item;
      if(command.intent==='fixed_option_delete')item.options[key]=list.filter(x=>String(x.id)!==String(option.id));
      if(command.intent==='fixed_option_price')option.price=Math.max(-100000,Math.min(100000,Math.round(Number(command.price)||0)));
      if(command.intent==='fixed_option_toggle')option.active=command.enabled;
      if(command.intent==='fixed_option_default'){
        if(['meats','sizes','bases'].includes(key))for(const x of list)x.default=false;
        option.default=true;
      }
      await saveMenu(access,user.id,menu,{...config,menu_sections:sections},'assistant_'+command.intent,{item_id:item.id,group:key,option_id:option.id});
      const label=command.intent==='fixed_option_delete'?'удалён':command.intent==='fixed_option_price'?'цена '+option.price+' ₽':command.intent==='fixed_option_toggle'?(command.enabled?'включён':'выключен'):'по умолчанию';
      return {handled:true,text:'✅ '+fixedGroupLabel(key)+': «'+String(option.name)+'» — '+label+'.'};
    }

    if(command.intent==='choice_group_add'||command.intent==='choice_group_select'||command.intent==='choice_group_delete'||command.intent==='choice_group_rename'||command.intent==='choice_group_toggle'||command.intent==='choice_group_required'||command.intent==='choice_group_type'||command.intent==='choice_group_limit'||command.intent==='choice_option_add'||command.intent==='choice_option_price'||command.intent==='choice_option_toggle'||command.intent==='choice_option_delete'||command.intent==='choice_option_rename'||command.intent==='choice_option_default'){
      const found=resolveItem(command.item);
      if(!found.item)return itemMissing(command.item,found.matches);
      const item=found.item;
      await selectItemContext(user.id,item.id);
      item.choice_groups=Array.isArray(item.choice_groups)?item.choice_groups.map(g=>({...g,options:Array.isArray(g.options)?g.options.map(o=>({...o})):[]})):[];
      let selectedGroup=resolveGroup(item,command.group);

      if(command.intent==='choice_group_add'){
        const id=slug(command.name)+'_'+Date.now().toString(36).slice(-4);
        const group={id,name:command.name,type:'single',required:false,min:0,max:1,active:true,options:[]};
        item.choice_groups.push(group);
        await saveMenu(access,user.id,menu,{...config,menu_sections:sections},'assistant_choice_group_add',{item_id:item.id,group_id:id,name:command.name});
        await selectGroupContext(user.id,id);
        return {handled:true,text:'✅ Добавлен выбор «'+command.name+'» для '+String(item.n||item.name)+'.\nПо умолчанию: один вариант, необязательно.\nТеперь можно: «сделай обязательным», «можно несколько», «добавь вариант Большая +80».'};
      }

      if(command.intent==='choice_group_select'){
        if(!selectedGroup.group){
          const hint=selectedGroup.matches.length?'\n'+selectedGroup.matches.map(g=>'• '+g.name).join('\n'):'';
          return {handled:true,text:'Не нашёл группу «'+command.group+'».'+hint};
        }
        await selectGroupContext(user.id,selectedGroup.group.id);
        return {handled:true,text:'✅ Работаем с выбором «'+selectedGroup.group.name+'».\nВарианты:\n'+((selectedGroup.group.options||[]).map(o=>'• '+o.name+(Number(o.price_delta)?' '+(Number(o.price_delta)>0?'+':'')+Number(o.price_delta)+' ₽':'')).join('\n')||'пока нет вариантов')};
      }

      if(!selectedGroup.group){
        return {handled:true,text:'Сначала выберите группу параметров. Например: «открой выбор Размер». Доступно:\n'+(selectedGroup.matches.map(g=>'• '+g.name).join('\n')||'групп пока нет')};
      }
      const group=selectedGroup.group;
      await selectGroupContext(user.id,group.id);

      if(command.intent==='choice_group_delete'){
        item.choice_groups=item.choice_groups.filter(g=>String(g.id)!==String(group.id));
        await saveMenu(access,user.id,menu,{...config,menu_sections:sections},'assistant_choice_group_delete',{item_id:item.id,group_id:group.id});
        await selectGroupContext(user.id,'');
        return {handled:true,text:'✅ Выбор «'+group.name+'» удалён.'};
      }
      if(command.intent==='choice_group_rename'){
        const old=group.name;group.name=String(command.name||'').slice(0,120);
        await saveMenu(access,user.id,menu,{...config,menu_sections:sections},'assistant_choice_group_rename',{item_id:item.id,group_id:group.id,old_name:old,new_name:group.name});
        return {handled:true,text:'✅ Выбор «'+old+'» → «'+group.name+'».'};
      }
      if(command.intent==='choice_group_toggle'){
        group.active=command.enabled;
        await saveMenu(access,user.id,menu,{...config,menu_sections:sections},'assistant_choice_group_toggle',{item_id:item.id,group_id:group.id,active:group.active});
        return {handled:true,text:'✅ Выбор «'+group.name+'» — '+(group.active?'включён':'временно отключён')+'.'};
      }
      if(command.intent==='choice_group_required'){
        group.required=command.required;
        if(command.required&&Number(group.min||0)<1)group.min=1;
        if(!command.required&&Number(group.min||0)===1)group.min=0;
        await saveMenu(access,user.id,menu,{...config,menu_sections:sections},'assistant_choice_group_required',{item_id:item.id,group_id:group.id,required:group.required});
        return {handled:true,text:'✅ «'+group.name+'» — '+(group.required?'обязательный выбор':'необязательный выбор')};
      }
      if(command.intent==='choice_group_type'){
        group.type=command.type;
        if(command.type==='single')group.max=1;
        else group.max=Math.max(1,Number(group.max)||Math.max(1,(group.options||[]).length));
        await saveMenu(access,user.id,menu,{...config,menu_sections:sections},'assistant_choice_group_type',{item_id:item.id,group_id:group.id,type:group.type});
        return {handled:true,text:'✅ «'+group.name+'»: '+(group.type==='multiple'?'можно выбирать несколько':'можно выбрать один вариант')};
      }
      if(command.intent==='choice_group_limit'){
        const value=Math.max(0,Math.min(60,Math.floor(Number(command.value)||0)));
        group[command.field]=value;
        if(group.type==='single')group.max=1;
        if(Number(group.max||1)<Number(group.min||0))group.max=group.min;
        group.required=Number(group.min||0)>0;
        await saveMenu(access,user.id,menu,{...config,menu_sections:sections},'assistant_choice_group_limit',{item_id:item.id,group_id:group.id,min:group.min,max:group.max});
        return {handled:true,text:'✅ «'+group.name+'»: выбрать '+Number(group.min||0)+'–'+Number(group.max||1)};
      }

      const options=group.options||[];
      if(command.intent==='choice_option_add'){
        const id=slug(command.name)+'_'+Date.now().toString(36).slice(-4);
        options.push({id,name:command.name,price_delta:Number(command.price_delta)||0,active:true,default:false});
        group.options=options;
        if(group.type==='multiple'&&Number(group.max||0)<1)group.max=options.length;
        await saveMenu(access,user.id,menu,{...config,menu_sections:sections},'assistant_choice_option_add',{item_id:item.id,group_id:group.id,option_id:id,name:command.name,price_delta:Number(command.price_delta)||0});
        return {handled:true,text:'✅ В «'+group.name+'» добавлен вариант «'+command.name+'»'+(Number(command.price_delta)?' '+(Number(command.price_delta)>0?'+':'')+Number(command.price_delta)+' ₽':'')};
      }

      const optionFound=findNamed(options,command.option,x=>x.name);
      const option=optionFound.item;
      if(!option){
        const hint=optionFound.matches.length?'\n'+optionFound.matches.map(o=>'• '+o.name).join('\n'):'';
        return {handled:true,text:'Не нашёл вариант «'+String(command.option||'')+'» в «'+group.name+'».'+hint};
      }
      if(command.intent==='choice_option_price')option.price_delta=Math.max(-100000,Math.min(100000,Math.round(Number(command.price_delta)||0)));
      if(command.intent==='choice_option_toggle')option.active=command.enabled;
      if(command.intent==='choice_option_delete')group.options=options.filter(o=>String(o.id)!==String(option.id));
      if(command.intent==='choice_option_rename')option.name=command.name;
      if(command.intent==='choice_option_default'){
        if(group.type==='single')for(const o of options)o.default=false;
        option.default=true;
      }
      await saveMenu(access,user.id,menu,{...config,menu_sections:sections},'assistant_choice_option_update',{item_id:item.id,group_id:group.id,option_id:option.id,intent:command.intent});
      const label=command.intent==='choice_option_delete'?'удалён':command.intent==='choice_option_toggle'?(command.enabled?'включён':'выключен'):command.intent==='choice_option_price'?'доплата '+option.price_delta+' ₽':command.intent==='choice_option_rename'?'переименован в '+option.name:'по умолчанию';
      return {handled:true,text:'✅ Вариант «'+String(option.name)+'» — '+label+'.'};
    }

    if(command.intent==='menu_price'||command.intent==='menu_toggle'||command.intent==='menu_rename'||command.intent==='menu_description'){
      const found=findNamed(menu,command.item,x=>x.n||x.name);
      if(!found.item){
        const hint=found.matches.length?'\nВозможно:\n'+found.matches.map(x=>'• '+(x.n||x.name)).join('\n'):'';
        return {handled:true,text:'Не нашёл позицию «'+command.item+'».'+hint};
      }
      const item=found.item;
      await selectItemContext(user.id,item.id);
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
      await selectItemContext(user.id,id);
      return {handled:true,text:'✅ Добавлено: <b>'+command.name+'</b>\nКатегория: '+category.name+'\nЦена: '+command.price+' ₽\nТеперь работаем с этой позицией.'};
    }

    if(command.intent==='category_add'){
      const found=findNamed(sections,command.name,x=>x.name||x.id);
      if(found.item)return {handled:true,text:'Категория уже существует: '+found.item.name+'.'};
      const section={id:slug(command.name),name:command.name,emoji:'',active:true,order:sections.length};
      sections.push(section);
      await saveMenu(access,user.id,menu,{...config,menu_sections:sections},'assistant_category_add',{category_id:section.id,name:section.name});
      return {handled:true,text:'✅ Категория <b>'+section.name+'</b> добавлена.'};
    }

    if(command.intent==='category_delete'||command.intent==='category_emoji'||command.intent==='category_order'){
      const found=findNamed(sections,command.category,x=>x.name||x.id);
      if(!found.item)return {handled:true,text:'Не нашёл категорию «'+command.category+'».'};
      const section=found.item;
      if(command.intent==='category_delete'){
        const used=menu.filter(x=>String(x.c||x.category||'')===String(section.id));
        if(used.length)return {handled:true,text:'Категория «'+section.name+'» содержит '+used.length+' позиций. Сначала перенесите их в другую категорию или скройте категорию.'};
        const nextSections=sections.filter(x=>String(x.id)!==String(section.id)).map((x,i)=>({...x,order:i}));
        await saveMenu(access,user.id,menu,{...config,menu_sections:nextSections},'assistant_category_delete',{category_id:section.id});
        return {handled:true,text:'✅ Категория «'+section.name+'» удалена.'};
      }
      if(command.intent==='category_emoji'){
        section.emoji=String(command.emoji||'').trim().slice(0,8);
        await saveMenu(access,user.id,menu,{...config,menu_sections:sections},'assistant_category_emoji',{category_id:section.id,emoji:section.emoji});
        return {handled:true,text:'✅ Категория «'+section.name+'»: иконка '+(section.emoji||'убрана')};
      }
      const target=Math.max(1,Math.min(sections.length,Math.floor(Number(command.order)||1)))-1;
      const current=sections.indexOf(section);sections.splice(current,1);sections.splice(target,0,section);sections.forEach((x,i)=>x.order=i);
      await saveMenu(access,user.id,menu,{...config,menu_sections:sections},'assistant_category_order',{category_id:section.id,order:target});
      return {handled:true,text:'✅ Категория «'+section.name+'» теперь №'+(target+1)+'.'};
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

    if(['builder_show','builder_option_add','builder_option_delete','builder_option_price','builder_option_rename','builder_limit','builder_title','builder_subtitle'].includes(command.intent)){
      let builder=D.normalizeBuilderConfig(config.builder||{});
      if(command.intent==='builder_show'){
        const lines=['🧩 Конструктор · '+(config.builder_enabled===true?'включён':'выключен'),'Название: '+builder.title,'Описание: '+builder.subtitle];
        for(const key of ['types','breads','meats','sauces','extras']){
          lines.push('',builderGroupLabel(key)+':');
          lines.push(...((builder[key]||[]).map(o=>'• '+o.name+' · '+Number(o.price||0)+' ₽')||[]));
        }
        lines.push('','Соусы: '+builder.min_sauces+'–'+builder.max_sauces,'Добавки: до '+builder.max_extras);
        return {handled:true,text:lines.join('\n').slice(0,3900)};
      }

      if(command.intent==='builder_title'||command.intent==='builder_subtitle'){
        builder={...builder,[command.intent==='builder_title'?'title':'subtitle']:command.value};
        const saved=await saveBuilder(access,user.id,config,builder,'assistant_'+command.intent,{value:command.value});
        return {handled:true,text:'✅ '+(command.intent==='builder_title'?'Название':'Описание')+' конструктора обновлено: '+(command.value||'')};
      }

      if(command.intent==='builder_limit'){
        builder={...builder,[command.field]:Math.max(0,Math.floor(Number(command.value)||0))};
        const saved=await saveBuilder(access,user.id,config,builder,'assistant_builder_limit',{field:command.field,value:command.value});
        const b=saved.builder;
        return {handled:true,text:'✅ Лимиты конструктора: соусы '+b.min_sauces+'–'+b.max_sauces+', добавки до '+b.max_extras};
      }

      const key=builderGroupKey(command.group);
      if(!key)return {handled:true,text:'Не понял раздел конструктора. Используйте: формат, лаваш, мясо, соус или добавка.'};
      const list=Array.isArray(builder[key])?builder[key].map(x=>({...x})):[];
      if(command.intent==='builder_option_add'){
        const id=slug(command.name)+'_'+Date.now().toString(36).slice(-4);
        list.push({id,name:command.name,price:Math.max(0,Math.min(100000,Math.round(Number(command.price)||0)))});
        builder={...builder,[key]:list};
        const saved=await saveBuilder(access,user.id,config,builder,'assistant_builder_option_add',{group:key,option_id:id,name:command.name,price:command.price});
        return {handled:true,text:'✅ '+builderGroupLabel(key)+': добавлено «'+command.name+'» · '+Number(command.price||0)+' ₽'};
      }
      const found=findNamed(list,command.option,x=>x.name);
      if(!found.item){
        const hint=found.matches.length?'\nВозможно:\n'+found.matches.map(x=>'• '+x.name).join('\n'):'';
        return {handled:true,text:'Не нашёл «'+command.option+'» в разделе '+builderGroupLabel(key)+'.'+hint};
      }
      const option=found.item;
      if(command.intent==='builder_option_delete')builder={...builder,[key]:list.filter(x=>String(x.id)!==String(option.id))};
      if(command.intent==='builder_option_price'){option.price=Math.max(0,Math.min(100000,Math.round(Number(command.price)||0)));builder={...builder,[key]:list}}
      if(command.intent==='builder_option_rename'){option.name=command.name;builder={...builder,[key]:list}}
      const saved=await saveBuilder(access,user.id,config,builder,'assistant_'+command.intent,{group:key,option_id:option.id});
      const label=command.intent==='builder_option_delete'?'удалено':command.intent==='builder_option_price'?'цена '+option.price+' ₽':'переименовано в '+option.name;
      return {handled:true,text:'✅ '+builderGroupLabel(key)+': «'+String(option.name)+'» — '+label+'.'};
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

  async function setItemImage({user,itemQuery,image}){
    const resolved=await resolveAccess(user.id,{intent:'menu_item_show'});
    if(resolved.error)return {handled:true,text:resolved.error};
    const access=resolved.access;
    if(!canUse(access,'menu'))return {handled:true,text:'⛔️ У вас нет права menu для этой точки.'};
    const venue=await loadVenue(access.establishment_id);
    if(!venue)return {handled:true,text:'Точка не найдена.'};
    const menu=Array.isArray(venue.menu)?venue.menu.map(x=>({...x})):[];
    const config=venue.config&&typeof venue.config==='object'?{...venue.config}:{};
    const sections=sectionsFrom(config,menu);
    const editor=await editorContext(user.id);
    let found;
    if(clean(itemQuery))found=findNamed(menu,itemQuery,x=>x.n||x.name);
    else found={item:menu.find(x=>String(x.id)===String(editor.selected_item_id||'')),matches:[]};
    if(!found.item){
      const hint=(found.matches||[]).length?'\nВозможно:\n'+found.matches.map(x=>'• '+String(x.n||x.name)).join('\n'):'';
      return {handled:true,text:clean(itemQuery)?'Не нашёл позицию «'+itemQuery+'».'+hint:'Сначала выберите позицию: «работаем с сырной шаурмой», затем отправьте фото.'};
    }
    found.item.image=String(image||'').slice(0,700000);
    await saveMenu(access,user.id,menu,{...config,menu_sections:sections},'assistant_menu_image',{item_id:found.item.id,has_image:!!found.item.image});
    await selectItemContext(user.id,found.item.id);
    return {handled:true,text:'✅ Фото позиции «'+String(found.item.n||found.item.name)+'» обновлено.'};
  }

  return {handle,setItemImage};
}

module.exports={createVenueCommandBus,parseCommand,helpText,norm,slug,findNamed,venueShortKey,looseWords};
