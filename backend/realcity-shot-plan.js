'use strict';
// Shared slot taxonomy for the Astra RealCity 30-photo intake.
// Labels are observations to collect, NOT inferred camera pose or surveyed geometry.
(function(root,factory){
 const plan=factory();
 if(typeof module==='object'&&module.exports)module.exports=plan;
 if(root)root.RealCityShotPlan=plan;
})(typeof window!=='undefined'?window:null,function(){
 const groups=[
  {id:'hero',name:'01 · Главное здание',hint:'12 снимков · фасады, углы, вход, крыша'},
  {id:'neighbors',name:'02 · Здания рядом',hint:'6 снимков · соседи слева, справа и напротив'},
  {id:'street',name:'03 · Пространство вокруг',hint:'6 снимков · обзор квартала от заведения'},
  {id:'environment',name:'04 · Детали улицы',hint:'6 снимков · дороги, зелень и ориентиры'}
 ];
 // id,group,title,subject,position,focus,category,subtype,angle,related ids
 const items=[
 ['RC01','hero','Фасад прямо','hero_front','Напротив центра главного фасада','Всё здание целиком, от земли до крыши','main_building','main_facade','front','RC02 RC03 RC09 RC11'],
 ['RC02','hero','Левый угол фасада','hero_front','Перед зданием, немного слева','Главный фасад вместе с левым углом','main_building','main_facade','left','RC01 RC04 RC05'],
 ['RC03','hero','Правый угол фасада','hero_front','Перед зданием, немного справа','Главный фасад вместе с правым углом','main_building','main_facade','right','RC01 RC06 RC07'],
 ['RC04','hero','Левая стена прямо','hero_left','С левой стороны здания','Вся левая стена и число этажей','main_building','left_facade','left','RC02 RC05'],
 ['RC05','hero','Левая стена наискосок','hero_left','Слева по диагонали','Связь левой стены с передним и задним углами','main_building','left_facade','left','RC02 RC04 RC08'],
 ['RC06','hero','Правая стена прямо','hero_right','С правой стороны здания','Вся правая стена и число этажей','main_building','right_facade','right','RC03 RC07'],
 ['RC07','hero','Правая стена наискосок','hero_right','Справа по диагонали','Связь правой стены с передним и задним углами','main_building','right_facade','right','RC03 RC06 RC08'],
 ['RC08','hero','Задняя часть здания','hero_rear','Позади основного здания','Задний фасад, углы, входы со двора','main_building','rear_facade','rear','RC05 RC07 RC12'],
 ['RC09','hero','Главный вход крупно','hero_entrance','Перед входом, в нескольких шагах','Двери, ступени, навес, номера и указатели','main_building','entrance','front','RC01 RC10 RC11'],
 ['RC10','hero','Вывеска и фирменные детали','hero_entrance','Перед вывеской','Точная надпись, логотип, цвет и крепления','main_building','signage','detail','RC01 RC09'],
 ['RC11','hero','Витрины и первый этаж','hero_front','Перед первым этажом','Витрины, отделка, окна и линия тротуара','main_building','storefront','front','RC01 RC09 RC25'],
 ['RC12','hero','Верхние этажи и крыша','hero_roof','С расстояния, чтобы был виден верх','Форма крыши, карниз, окна и балконы сверху','main_building','roof','up','RC01 RC08'],
 ['RC13','neighbors','Дом слева','neighbor_left','От входа смотреть влево','Соседнее здание слева целиком','neighbor_building','front','front','RC14 RC20'],
 ['RC14','neighbors','Левый сосед с другого ракурса','neighbor_left','Сместиться вдоль улицы влево','Угол и боковые стены левого соседа','neighbor_building','left','left','RC13 RC20'],
 ['RC15','neighbors','Дом справа','neighbor_right','От входа смотреть вправо','Соседнее здание справа целиком','neighbor_building','front','front','RC16 RC21'],
 ['RC16','neighbors','Правый сосед с другого ракурса','neighbor_right','Сместиться вдоль улицы вправо','Угол и боковые стены правого соседа','neighbor_building','right','right','RC15 RC21'],
 ['RC17','neighbors','Здание напротив','neighbor_opposite','Перед входом смотреть через улицу','Здание напротив, этажи и первый ярус','neighbor_building','front','front','RC18 RC22'],
 ['RC18','neighbors','Напротив с другого ракурса','neighbor_opposite','Сместиться вдоль противоположной стороны','Угол здания напротив и соседние объекты','neighbor_building','right','right','RC17 RC22'],
 ['RC19','street','Пространство перед входом','street_front','Стоя прямо у входа смотреть вперёд','Тротуар, дорога, дома и объекты перед заведением','panorama','front_panorama','front','RC01 RC25 RC26'],
 ['RC20','street','Улица налево','street_left','У входа повернуться налево','Непрерывный вид улицы в левую сторону','panorama','street_left','left','RC13 RC14 RC28'],
 ['RC21','street','Улица направо','street_right','У входа повернуться направо','Непрерывный вид улицы в правую сторону','panorama','street_right','right','RC15 RC16 RC29'],
 ['RC22','street','Панорама напротив','street_opposite','Развернуться от входа в сторону противоположных зданий','Пространство через дорогу с привязкой к соседям','panorama','opposite','rear','RC17 RC18 RC19'],
 ['RC23','street','Перекрёсток и продолжение','street_intersection','От места, где виден ближайший перекрёсток','Пересечение улиц, разметка и перспективные линии','panorama','intersection','panorama','RC20 RC21 RC26'],
 ['RC24','street','Двор и проходы','street_courtyard','Во дворе или у прохода позади здания','Проходы, дорожки, двор, здания в глубине','panorama','courtyard','rear','RC08 RC27'],
 ['RC25','environment','Тротуар у заведения','ground_sidewalk','Перед входом смотреть вдоль тротуара','Покрытие, бордюр, ступени, перепады высоты','road_ground','sidewalk','down','RC11 RC19 RC26'],
 ['RC26','environment','Проезжая часть','ground_road','У дороги напротив заведения','Асфальт, полосы, разметка и бордюр','road_ground','road','down','RC19 RC23 RC25'],
 ['RC27','environment','Парковка и въезды','ground_parking','У ближайших парковочных мест','Места машин, въезды и дорожное покрытие','road_ground','parking','front','RC24 RC26'],
 ['RC28','environment','Деревья и газон слева','green_left','Слева от входа вдоль улицы','Расположение деревьев, кустов и газонов','vegetation','trees','left','RC20 RC29'],
 ['RC29','environment','Зелень справа','green_right','Справа от входа вдоль улицы','Расположение деревьев, кустов и газонов','vegetation','trees','right','RC21 RC28'],
 ['RC30','environment','Уличные ориентиры','street_landmarks','Возле заведения и на пересечениях','Фонари, знаки, ограды, остановки и другие приметы','street_object','detail','detail','RC19 RC23 RC25']
 ];
 const slots=items.map(([id,group,title,subject,position,focus,category,subtype,angle,links])=>Object.freeze({id,group,title,subject,position,focus,category,subtype,angle,links:links.split(' ')}));
 const byId=new Map(slots.map(s=>[s.id,s]));
 function get(id){return byId.get(String(id||''))||null}
 function describe(assets){
  const selected=new Map(),duplicates=[];
  for(const a of Array.isArray(assets)?assets:[]){
   const s=get(a.shot_id);if(!s)continue;
   if(selected.has(s.id))duplicates.push(s.id);else selected.set(s.id,a);
  }
  const connected=slots.flatMap(s=>s.links.filter(t=>s.id<t&&selected.has(s.id)&&selected.has(t)).map(t=>({from:s.id,to:t,subject:s.subject,relation:'complementary_observation'})));
  const observations=slots.map(s=>({...s,asset_id:selected.get(s.id)?.id||null,captured:!!selected.get(s.id),linked_assets:s.links.filter(x=>selected.has(x)).map(x=>({shot_id:x,asset_id:selected.get(x).id}))}));
  return {version:1,method:'guided_30_photo_observations',expected:30,filled:selected.size,missing:slots.filter(s=>!selected.has(s.id)).map(s=>s.id),duplicate_slots:duplicates,slots:observations,links:connected,geometry_verified:false,note:'Role and viewing direction are user assigned. Camera pose, visible wall and map edge require verification; never infer missing geometry from these labels.'};
 }
 return Object.freeze({groups,slots,get,describe});
});
