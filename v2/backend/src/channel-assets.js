'use strict';

const sharp=require('sharp');

const W=1080,H=1350;
const esc=s=>String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const wrap=(text,max=25)=>{
  const words=String(text||'').split(/\s+/).filter(Boolean),out=[];let line='';
  for(const w of words){const n=line?line+' '+w:w;if(n.length>max&&line){out.push(line);line=w}else line=n}
  if(line)out.push(line);return out;
};
const txt=(x,y,text,size=34,weight=600,fill='#fff',anchor='start')=>`<text x="${x}" y="${y}" text-anchor="${anchor}" font-family="Arial,Helvetica,sans-serif" font-size="${size}" font-weight="${weight}" fill="${fill}">${esc(text)}</text>`;
const multiline=(x,y,text,size=30,weight=600,fill='#fff',lh=1.15,anchor='start',max=28)=>wrap(text,max).map((l,i)=>txt(x,y+i*size*lh,l,size,weight,fill,anchor)).join('');
const icon=(kind,x,y)=>{
 const c='#ff8618';
 const map={
  pin:`<path d="M${x} ${y-26}c-22 0-40 18-40 40 0 34 40 76 40 76s40-42 40-76c0-22-18-40-40-40zm0 56a16 16 0 1 1 0-32 16 16 0 0 1 0 32z" fill="${c}"/>`,
  menu:`<path d="M${x-30} ${y-20}h10v72h-10zm20 0h10v28h12v-28h10v72h-10V20h-12v32h-10zm62 0h10v72h-10z" fill="${c}" transform="translate(0,-2)"/>`,
  bag:`<path d="M${x-32} ${y}h64l8 62h-80zm16 0v-10a16 16 0 0 1 32 0V0h-10v-10a6 6 0 0 0-12 0V0z" fill="none" stroke="${c}" stroke-width="8" stroke-linejoin="round"/>`,
  chart:`<rect x="${x-34}" y="${y+18}" width="14" height="38" rx="4" fill="${c}"/><rect x="${x-7}" y="${y-2}" width="14" height="58" rx="4" fill="${c}"/><rect x="${x+20}" y="${y-30}" width="14" height="86" rx="4" fill="${c}"/>`,
  gear:`<circle cx="${x}" cy="${y+16}" r="29" fill="none" stroke="${c}" stroke-width="10"/><circle cx="${x}" cy="${y+16}" r="8" fill="${c}"/><path d="M${x} ${y-28}v14M${x} ${y+46}v14M${x-44} ${y+16}h14M${x+30} ${y+16}h14M${x-31} ${y-15}l10 10M${x+21} ${y+37}l10 10M${x+31} ${y-15}l-10 10M${x-21} ${y+37}l-10 10" stroke="${c}" stroke-width="10" stroke-linecap="round"/>`,
  chef:`<path d="M${x-34} ${y+4}c-4-28 28-38 42-18 16-18 48-5 40 22 16 4 22 26 6 38v36h-80V46c-18-8-18-34-8-42z" fill="none" stroke="${c}" stroke-width="8" stroke-linejoin="round"/><path d="M${x-22} ${y+60}h56" stroke="${c}" stroke-width="8"/>`,
  heart:`<path d="M${x} ${y+66}S${x-56} ${y+32} ${x-56} ${y-6}c0-26 34-36 56-8 22-28 56-18 56 8 0 38-56 72-56 72z" fill="${c}"/>`,
  clock:`<circle cx="${x}" cy="${y+15}" r="40" fill="none" stroke="${c}" stroke-width="8"/><path d="M${x} ${y-8}v28l22 14" stroke="${c}" stroke-width="8" stroke-linecap="round"/>`,
  back:`<path d="M${x+32} ${y+16}h-64m0 0 28-28m-28 28 28 28" fill="none" stroke="${c}" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>`,
  star:`<path d="M${x} ${y-30}l13 28 31 4-23 22 6 31-27-15-27 15 6-31-23-22 31-4z" fill="${c}"/>`,
  user:`<circle cx="${x}" cy="${y-4}" r="22" fill="none" stroke="${c}" stroke-width="8"/><path d="M${x-40} ${y+60}c5-34 75-34 80 0" fill="none" stroke="${c}" stroke-width="8" stroke-linecap="round"/>`,
  key:`<circle cx="${x-18}" cy="${y}" r="24" fill="none" stroke="${c}" stroke-width="9"/><path d="M${x+4} ${y+18}l48 48m-16-16 16-16m-32 0 16-16" stroke="${c}" stroke-width="9" stroke-linecap="round"/>`
 };
 return map[kind]||map.pin;
};
const defs=`<defs>
 <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#070a0f"/><stop offset=".55" stop-color="#0d1118"/><stop offset="1" stop-color="#23130b"/></linearGradient>
 <linearGradient id="orange" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#ffb02e"/><stop offset="1" stop-color="#ff6a00"/></linearGradient>
 <linearGradient id="card" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#171d25"/><stop offset="1" stop-color="#11151b"/></linearGradient>
 <filter id="glow"><feGaussianBlur stdDeviation="8" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
 <filter id="soft"><feGaussianBlur stdDeviation="42"/></filter>
</defs>`;
const base=(body)=>`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${defs}<rect width="1080" height="1350" fill="url(#bg)"/><circle cx="930" cy="180" r="230" fill="#ff6a00" opacity=".10" filter="url(#soft)"/><circle cx="120" cy="1180" r="260" fill="#ff8618" opacity=".07" filter="url(#soft)"/><g opacity=".18"><path d="M0 260C260 150 480 350 1080 170" stroke="#ff8618" stroke-width="2" fill="none"/><path d="M0 1120C320 950 720 1190 1080 980" stroke="#ff8618" stroke-width="2" fill="none"/></g>${body}</svg>`;

function logo(y=70){
 return txt(72,y,'Шаур',64,900,'#f8f6f1')+txt(250,y,'мег',64,900,'#ff8618')+`<path d="M352 ${y-52}l14 18 18-12 8 24h-54z" fill="#ff9a1f"/>`;
}
function header(title,subtitle){
 return logo()+multiline(72,178,title,68,900,'#fff',1.0,'start',26)+multiline(72,258,subtitle,30,500,'#b7bec8',1.15,'start',50);
}
function card(x,y,w,h,kind,title,sub){
 return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="30" fill="url(#card)" stroke="#ff8618" stroke-opacity=".75" stroke-width="2"/><rect x="${x+18}" y="${y+20}" width="92" height="92" rx="24" fill="#20170f" stroke="#ff8618" stroke-opacity=".25"/>${icon(kind,x+64,y+52)}${multiline(x+132,y+58,title,29,800,'#fff',1.1,'start',22)}${multiline(x+132,y+110,sub,21,500,'#aeb5c0',1.15,'start',30)}`;
}
function footer(text){
 return `<rect x="110" y="1238" width="860" height="76" rx="30" fill="#18150f" stroke="#ff8618" stroke-width="2"/><circle cx="154" cy="1276" r="17" fill="url(#orange)"/>${txt(190,1288,text,26,700,'#f6a23f')}`;
}
function phone(x=390,y=360,w=300,h=710){
 return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="54" fill="#05070a" stroke="#ff8618" stroke-width="4" filter="url(#glow)"/><rect x="${x+16}" y="${y+20}" width="${w-32}" height="${h-40}" rx="40" fill="#0d1219"/>${txt(x+38,y+62,'Шаурмег',26,900,'#fff')}<rect x="${x+34}" y="${y+98}" width="${w-68}" height="250" rx="26" fill="#101923"/><path d="M${x+50} ${y+180}l210-60M${x+48} ${y+260}l208-90M${x+80} ${y+112}l100 220M${x+188} ${y+110}l-68 225" stroke="#344353" stroke-width="3" opacity=".65"/><circle cx="${x+w/2}" cy="${y+210}" r="72" fill="#ff8618" opacity=".12"/>${icon('pin',x+w/2,y+185)}<rect x="${x+34}" y="${y+370}" width="${w-68}" height="82" rx="18" fill="#171d25"/>${txt(x+52,y+407,'Активный заказ',20,700,'#fff')}${txt(x+52,y+436,'Принят → Готовится → Готово',15,500,'#aeb5c0')}<rect x="${x+34}" y="${y+470}" width="${w-68}" height="144" rx="20" fill="#171d25"/>${txt(x+52,y+510,'Меню точки',20,700,'#fff')}${txt(x+52,y+548,'Фото • категории • цены',15,500,'#aeb5c0')}<rect x="${x+52}" y="${y+568}" width="${w-104}" height="30" rx="15" fill="url(#orange)"/>${txt(x+w/2,y+590,'Открыть меню',15,800,'#111','middle')}`;
}

const assets={
 'start-here':()=>base(header('Одна система для заведения','Карта • меню • заказы • статусы • владелец • кухня')+phone(390,340,300,730)+card(48,390,300,150,'pin','КАРТА','точка и карточка')+card(48,570,300,150,'menu','МЕНЮ','фото, категории, цены')+card(732,390,300,150,'bag','ЗАКАЗЫ','единый поток')+card(732,570,300,150,'chart','СТАТУСЫ','видит гость')+card(48,750,300,150,'gear','ВЛАДЕЛЕЦ','мобильная админка')+card(732,750,300,150,'chef','КУХНЯ','бот заказов')+footer('Подключить заведение просто')),
 'what-is-shaurmeg':()=>base(header('Экосистема заведения','Всё связано одним контекстом точки')+phone(390,350,300,720)+card(48,380,300,150,'pin','КАРТА','видимость и карточка')+card(48,560,300,150,'menu','МЕНЮ','свои фото и цены')+card(732,380,300,150,'bag','ЗАКАЗЫ','без потери контекста')+card(732,560,300,150,'chart','СТАТУСЫ','live-обновления')+card(48,740,300,150,'gear','ВЛАДЕЛЕЦ','управляет сам')+card(732,740,300,150,'chef','КУХНЯ','получает заказ')+footer('Один контур работы для точки')),
 'guest-path':()=>base(header('Путь гостя','От точки на карте до готового заказа')+[ ['01','Точка на карте','нашёл заведение'],['02','Карточка точки','часы • телефон • рейтинг'],['03','Меню','фото • категории • состав'],['04','Корзина','быстрое оформление'],['05','Кухня','заказ приходит в бот'],['06','Готово','статус виден гостю']].map((a,i)=>{const y=350+i*136;return `<circle cx="118" cy="${y+48}" r="36" fill="#1a120b" stroke="#ff8618" stroke-width="3"/>${txt(118,y+58,a[0],22,900,'#ff9a1f','middle')}<rect x="178" y="${y}" width="790" height="100" rx="24" fill="url(#card)" stroke="#ff8618" stroke-opacity=".55"/>${txt(215,y+42,a[1],28,800,'#fff')}${txt(215,y+74,a[2],20,500,'#aeb5c0')}`}).join('')+footer('Гость видит весь путь в одном интерфейсе')),
 'owner-control':()=>base(header('Что получает владелец','Управление точкой без лишней сложности')+phone(390,360,300,700)+card(48,390,300,150,'menu','МЕНЮ','цены • фото • категории')+card(48,570,300,150,'chart','СТАТУСЫ','принят • готовится • готово')+card(48,750,300,150,'pin','КАРТОЧКА','часы • телефон • оформление')+card(732,390,300,150,'key','ДОСТУП','ключ конкретной точки')+card(732,570,300,150,'chef','БОТ ЗАКАЗОВ','приём заказов')+card(732,750,300,150,'chart','ИСТОРИЯ','заказы и аналитика')+footer('Меняйте данные без разработчика')),
 'connect-simple':()=>base(header('Подключение','Пять шагов. Без разработки с нуля.')+[ ['01','Точка на карте','карточка + метка','pin'],['02','Доступ владельца','ключ для точки','key'],['03','Меню и фото','цены и категории','menu'],['04','Бот заказов','приём заказов','bag'],['05','Проверка и запуск','готово к работе','chart']].map((a,i)=>card(78,350+i*164,924,132,a[3],a[0]+'  '+a[1],a[2])).join('')+footer('Ваше заведение → в Шаурмег')),
 'orders':()=>base(header('Заказ без разрывов','Одна связанная цепочка от гостя до кухни')+phone(390,350,300,710)+card(48,390,300,150,'bag','ОФОРМЛЕНИЕ','заказ привязан к точке')+card(48,570,300,150,'chef','КУХНЯ','получает именно свой заказ')+card(732,390,300,150,'chart','СТАТУСЫ','синхронно для гостя')+card(732,570,300,150,'clock','ИСТОРИЯ','позиции • время • сумма')+footer('Контекст заведения сохраняется на всём пути')),
 'individuality':()=>base(header('Не безликая карточка','У каждой точки остаётся своя индивидуальность')+card(78,360,440,170,'pin','КАРТОЧКА','обложка • часы • телефон')+card(562,360,440,170,'menu','МЕНЮ','структура • фото • категории')+card(78,560,440,170,'heart','ИЗБРАННОЕ','любимые блюда гостя')+card(562,560,440,170,'gear','ВИЗУАЛ','цвета • акценты • оформление')+card(78,760,440,170,'chef','КОНСТРУКТОР','свой состав блюда')+card(562,760,440,170,'chart','АКТИВНЫЙ ЗАКАЗ','собственная визуализация')+footer('Общая экосистема ≠ одинаковый дизайн')),
 'realcity':()=>base(header('RealCity','Цифровое окружение конкретной точки')+`<rect x="82" y="350" width="916" height="690" rx="44" fill="#0d141c" stroke="#ff8618" stroke-width="2"/><path d="M120 480L950 410M110 650L970 540M150 870L940 760M260 380L170 1000M470 370L390 1000M690 370L760 1000M880 370L930 980" stroke="#334150" stroke-width="8"/><rect x="390" y="540" width="300" height="220" rx="24" fill="#29170c" stroke="#ff8618" stroke-width="4"/>${txt(540,620,'ВАША ТОЧКА',34,900,'#fff','middle')}${txt(540,662,'фасад • цвета • детали',22,500,'#ff9a1f','middle')}${icon('pin',540,720)}<circle cx="540" cy="736" r="120" fill="#ff8618" opacity=".08"/>`+footer('Место на карте становится узнаваемым')),
 'menu-experience':()=>base(header('Меню — часть впечатления','Не таблица «название + цена», а полноценный выбор')+card(78,370,440,170,'menu','КАРТОЧКИ БЛЮД','крупные фото и описания')+card(562,370,440,170,'heart','ИЗБРАННОЕ','быстрый повтор заказа')+card(78,570,440,170,'chef','КОНСТРУКТОР','варианты и дополнения')+card(562,570,440,170,'back','НАВИГАЦИЯ','понятный возврат по разделам')+card(78,770,440,170,'clock','ИСТОРИЯ','все прошлые заказы')+card(562,770,440,170,'star','КАРТОЧКА ТОЧКИ','часы • рейтинг • телефон')+footer('Удобство складывается из деталей')),
 'comparison':()=>base(header('Обычно vs Шаурмег','Одна система. Один контекст точки.')+`<rect x="60" y="340" width="450" height="790" rx="36" fill="#11161d" stroke="#3a434e"/><rect x="570" y="340" width="450" height="790" rx="36" fill="#18120d" stroke="#ff8618" stroke-width="3"/>${txt(285,405,'ОБЫЧНО',30,900,'#aeb5c0','middle')}${txt(795,405,'ШАУРМЕГ',30,900,'#ff9a1f','middle')}`+[ ['Карта отдельно','Точка в общей карте'],['Меню отдельно','Своё меню точки'],['Заказ в чате','Связанный заказ'],['Статус вручную','Live-статусы'],['Правки через разработчика','Админка владельца'],['Разрозненные сервисы','Единый контур']].map((r,i)=>{const y=455+i*104;return `<rect x="92" y="${y}" width="386" height="78" rx="18" fill="#181d24"/>${multiline(285,y+36,r[0],22,650,'#b9c0ca',1.0,'middle',30)}<path d="M520 ${y+39}h36m-12-12 12 12-12 12" stroke="#ff8618" stroke-width="6" fill="none"/><rect x="602" y="${y}" width="386" height="78" rx="18" fill="#22170f" stroke="#ff8618" stroke-opacity=".4"/>${multiline(795,y+36,r[1],22,750,'#fff',1.0,'middle',30)}`}).join('')+footer('Быстрее запуск • проще управление')),
 'faq':()=>base(header('Коротко о главном','Ответы на вопросы владельца')+[ ['Нужно своё приложение?','Нет. Подключаемся к готовой системе.'],['Можно менять меню?','Да. Через отдельную админку владельца.'],['Заказы смешаются?','Нет. Каждый заказ связан со своей точкой.'],['Можно оформить по-своему?','Да. Контент и визуальные акценты настраиваются.'],['Можно несколько точек?','Да. Доступ и контекст разделяются по заведениям.']].map((r,i)=>`<rect x="80" y="${360+i*160}" width="920" height="128" rx="28" fill="url(#card)" stroke="#ff8618" stroke-opacity=".55"/>${txt(118,405+i*160,r[0],27,800,'#fff')}${multiline(118,445+i*160,r[1],21,500,'#b6bdc7',1.05,'start',65)}`).join('')+footer('Главная идея — простота подключения и управления')),
 'connect-now':()=>base(header('Готовы подключить точку?','Первый шаг занимает меньше минуты')+phone(390,360,300,650)+`<rect x="120" y="1060" width="840" height="120" rx="36" fill="url(#orange)" filter="url(#glow)"/>${txt(540,1137,'ПОДКЛЮЧИТЬ ЗАВЕДЕНИЕ',34,900,'#111','middle')}`+footer('Название • город • количество точек • контакт'))
};

async function render(name){
 const fn=assets[String(name||'').trim()];
 if(!fn)return null;
 return sharp(Buffer.from(fn())).png({compressionLevel:8}).toBuffer();
}
function install(app){
 app.get('/api/v2/channel-assets/:name.png',async(req,res)=>{
   try{
     const buf=await render(req.params.name);
     if(!buf)return res.status(404).end();
     res.setHeader('Content-Type','image/png');
     res.setHeader('Cache-Control','public, max-age=86400, immutable');
     res.send(buf);
   }catch(e){console.error('channel asset',e.message);res.status(500).end()}
 });
}
module.exports={install,render,assets};
