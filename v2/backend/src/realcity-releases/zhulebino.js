'use strict';
// Authored from the ten photographs supplied by the owner on 2026-09-27.
// This is a reviewed, venue-specific release, not a generic photo analyser.
const S=require('../../../frontend/realcity-spatial');
const A=require('../realcity-astra');
const geometry=require('./zhulebino-geometry.json');
const materials=require('./zhulebino-materials.json');
const RELEASE='zhulebino-photos-1-10-r2';
const PREVIOUS_RELEASE='zhulebino-photos-1-10-r1';
const TARGET={marker_id:'3139',establishment_id:'SC-MSK-9342972B1F',venue_id:'b5fe327852468ac7',coordinates:[37.852223461867,55.68545543282221]};
const REFERENCES=[
  ['IMG_7096.jpeg','1','Фасад у метки с синим знаком, цоколь и ограждение'],
  ['IMG_7105.jpeg','2','От угла поликлиники; зелёная кровля, ТЦ и киоск'],
  ['IMG_7094.jpeg','3','Угол: связь фасада со знаком и оконного фасада'],
  ['IMG_7095.jpeg','4','Напротив: поликлиника, жилой дом и Киномакс'],
  ['IMG_7097.jpeg','5','Соседний дом с терракотовой верхней частью'],
  ['IMG_7099.jpeg','6','Дальний ракурс вдоль улицы; взаимное положение домов'],
  ['IMG_7100.jpeg','7','Продолжение панорамы, сквер и метро'],
  ['IMG_7103.jpeg','8','ТЦ Миля, перекрёсток и метро'],
  ['IMG_7104.jpeg','9','Павильон Жулебино, выход 7 и стеклянный фонарь'],
  ['IMG_7110.jpeg','10','Близкий оконный фасад; вход, рифление и пояса']
].map(([file,number,description])=>({id:'owner-photo-'+number,file,number,description,source:'owner_direct_upload',received_at:'2026-09-27'}));
const C={ivory:'#dedbcc',joint:'#b9b9af',charcoal:'#424d56',frame:'#6d7981',glass:'#728997',roof:'#515554',blue:'#2487bb'};
const round=n=>Math.round(n*1000)/1000;
const edges=ring=>S.edges(ring,TARGET.coordinates);
const ref=(...n)=>n.map(i=>'owner-photo-'+i);
function facade(edge,{wall=C.ivory,finish='ribbed',references=[],observed=false}={}){
  return {edge_index:edge.index,edge:edge.coordinates,evidence:observed?'observed':'inferred',reference_ids:references,
    confidence:observed?.88:.3,wall:{color:wall,finish,joint_color:C.joint,module_m:finish==='ribbed'?.13:3.1},modules:[]};
}
function add(f,kind,u,z,w,h,extras={}){
  if(w<.08||h<.06)return;
  f.modules.push({kind,u_m:round(u),z_m:round(z),width_m:Math.floor(w*1000)/1000,height_m:round(h),depth_m:.11,color:C.charcoal,frame_color:C.frame,frame_m:.05,...extras});
}
function window(f,u,z,w,h,extras={}){add(f,'window',u,z,w,h,{color:C.glass,panes:w>1.65?3:2,...extras});}
function clinicFacade(e,base,height,role){
  const front=[0,1,2,3,4,5,20,21].includes(e.index),f=facade(e,{observed:front,references:front?ref(1,3,6,10):ref(3,6)});
  const L=e.length,central=[0,5,17].includes(e.index),side=[2,20].includes(e.index);
  if(role==='podium'){
    add(f,'panel',0,0,L,.42,{color:'#343b40',depth_m:.025});
    if(L>3){
      const count=Math.max(1,Math.floor(L/3.3)),space=L/count,w=Math.min(1.6,space*.54);
      for(let i=0;i<count;i++){
        const u=i*space+(space-w)/2;
        add(f,'panel',u,.5,w,5.95,{color:C.charcoal,depth_m:.026});
        window(f,u,.65,w,2.15);window(f,u,3.8,w,1.9);
      }
    }
    add(f,'cornice',0,3.15,L,.18,{color:C.ivory,depth_m:.19});
    add(f,'cornice',0,height-.18,L,.16,{color:C.ivory,depth_m:.16});
    if(e.index===0){
      f.modules=f.modules.filter(m=>m.kind==='cornice');
      add(f,'panel',0,.3,L,6.3,{color:C.ivory,depth_m:.04});
      add(f,'entrance',L*.34,.16,L*.32,2.5,{color:'#31434b',panes:2,depth_m:.08});
      add(f,'canopy',L*.24,2.8,L*.52,.14,{color:C.ivory,depth_m:1.4});
      add(f,'sign',.22,5.85,L-.44,.29,{text:'ГОРОДСКАЯ ПОЛИКЛИНИКА № 23',text_color:'#536b7b',color:C.ivory,depth_m:.08});
      add(f,'medical-heart',.4,3.75,.83,.75,{color:C.blue,depth_m:.12});
    }
    return f;
  }
  if(L<2)return f;
  const z0=7.65,rows=7,dz=3.03;
  if(central){
    add(f,'panel',.12,base+.02,L-.24,height-base-.14,{color:C.charcoal,depth_m:.026});
    for(let j=0;j<rows;j++)window(f,.23,z0+j*dz,L-.46,1.72,{panes:Math.min(6,Math.round(L/.85)),depth_m:.065});
  }else if(side){
    // The sign elevation has large blank ribbed fields, not an invented grid.
    const u=e.index===2?1.25:Math.max(.4,L-2.15),w=Math.min(1.75,L*.24);
    add(f,'panel',u,base+.08,w,height-base-.72,{color:C.charcoal,depth_m:.023});
    for(let j=0;j<rows;j++)window(f,u,z0+j*dz,w,1.75);
    if(e.index===2)add(f,'medical-heart',L*.65,25.6,2.45,2.05,{color:C.blue,depth_m:.17});
  }else{
    const count=e.index===3?5:e.index===19?5:Math.max(1,Math.floor(L/3.05)),step=L/count,w=Math.min(1.65,step*.55);
    for(let i=0;i<count;i++){
      const u=i*step+(step-w)/2;
      add(f,'panel',u,base+.08,w,height-base-.72,{color:C.charcoal,depth_m:.025});
      for(let j=0;j<rows;j++)window(f,u,z0+j*dz,w,1.75,{color:['#728996','#667d88','#819398'][(i+j)%3]});
    }
  }
  for(const z of [7.21,13.45,19.51,25.57,29.78])if(z>=base&&z+.18<=height)add(f,'cornice',0,z,L,.17,{color:C.ivory,depth_m:.14});
  return f;
}
function clinic(base){
  const es=edges(base.ring),podium={ring:base.ring,height_m:7.2,base_m:0,roof:{color:'#aaa99f',parapet_m:.12},facades:es.map(e=>clinicFacade(e,0,7.2,'podium'))};
  const upper={ring:base.ring,height_m:30.4,base_m:7.2,roof:{color:C.roof,parapet_m:.32},facades:es.map(e=>clinicFacade(e,7.2,30.4,'upper'))};
  // The raised central roof is derived from the recessed map edge; all four
  // corners remain inside the original footprint (checked again by compile).
  const e=es[0],frame=S.frame(TARGET.coordinates),at=(u,d)=>frame.fromLocal([e.a[0]+e.tangent[0]*u-e.normal[0]*d,e.a[1]+e.tangent[1]*u-e.normal[1]*d]);
  const capRing=[at(.15,.08),at(e.length-.15,.08),at(e.length-.15,21),at(.15,21),at(.15,.08)];
  const cap={ring:capRing,height_m:33,base_m:30.4,roof:{color:C.roof,parapet_m:.4},facades:edges(capRing).map(e=>{
    const f=facade(e,{observed:e.index===0,references:e.index===0?ref(1,6,10):ref(3)});
    if(e.length>2.2){add(f,'panel',.3,30.43,e.length-.6,1.72,{color:C.charcoal,depth_m:.02});window(f,.4,30.65,e.length-.8,1.2,{panes:6});}return f;
  })};
  return {building_id:base.id,geometry_key:S.geometryKey(base.ring),height_m:33,roof:{color:C.roof},facades:es.map(e=>facade(e,{observed:e.index===2,references:e.index===2?ref(10):[]})),parts:[podium,upper,cap]};
}
function apartment(base,brown){
  const h=base.height,es=edges(base.ring),street=S.nearestEdge(base.ring,TARGET.coordinates)?.index;
  return {building_id:base.id,geometry_key:S.geometryKey(base.ring),height_m:h,roof:{color:brown?'#a16e53':'#4b695e',parapet_m:.6},facades:es.map(e=>{
    const observed=(-e.a[0]*e.normal[0]-e.a[1]*e.normal[1])>0,f=facade(e,{wall:'#d3d5ce',finish:'panel',observed,references:observed?(brown?ref(5,6):ref(2,4,6)):[]}),L=e.length;
    add(f,'panel',0,0,L,3.6,{color:'#777d7c',depth_m:.018});
    add(f,'panel',0,h-3.2,L,2.9,{color:brown?'#a4785d':'#527160',depth_m:.025});
    if(L<4)return f;
    // Owner photo 5 and the builder's aerial show a largely blind clinic-facing
    // end wall. The long elevation's window grid must not wrap onto that end.
    if(brown&&e.index===0){
      for(let j=0;j<15;j++)for(const u of [1.05,L-2.65])window(f,u,3.85+j*(h-7.1)/15,1.35,1.47,{frame_color:'#dedfd7',color:'#71828b'});
      return f;
    }
    const cols=Math.max(1,Math.floor((L-1)/3)),dx=(L-.8)/cols,rows=15,dz=(h-7.1)/rows;
    for(let j=0;j<rows;j++){
      const z=3.85+j*dz;
      add(f,'panel',.16,z-.05,L-.32,1.72,{color:brown?'#8c8179':'#bcc7bb',depth_m:.023});
      if(!observed)continue;
      for(let i=0;i<cols;i++){
        const w=dx*(i%5===0?.38:.62),u=.4+i*dx+(dx-w)/2;
        window(f,u,z,w,1.47,{frame_color:'#dedfd7',frame_m:.055,color:['#718491','#879793','#637987','#a1aaa6','#626f74'][(i*7+j*11+i*j)%5]});
        if((i+2*j)%17===0)add(f,'vent',u,z-.47,.52,.36,{color:'#b3b2a8',depth_m:.35});
      }
    }
    if(e.index===street){for(let u=1;u+2.2<L;u+=5.4)window(f,u,.5,2.2,2.2,{panes:2,frame_color:'#808b89'});}
    return f;
  })};
}
function mall(base,dark=false){
  const es=edges(base.ring),front=S.nearestEdge(base.ring,TARGET.coordinates).index,h=base.height;
  return {building_id:base.id,geometry_key:S.geometryKey(base.ring),height_m:h,roof:{color:'#8f918a',parapet_m:.42},facades:es.map(e=>{
    const f=facade(e,{wall:dark?'#625f58':'#a2a6a4',finish:'metal',observed:e.index===front||!dark,references:ref(2,4,7,8)}),L=e.length;
    for(let u=.2;u+2.13<L;u+=2.4)window(f,u,.25,2.13,Math.min(3,h-1),{panes:1,frame_color:'#687c77',color:'#8daba9',depth_m:.07});
    for(let z=4;z<h-.3;z+=1.75){
      if(dark)add(f,'panel',.15,z,L-.3,.9,{color:'#56534e',depth_m:.06});
      else for(let u=0;u<L;u+=13.5){const w=Math.min(11.8,L-u);if(w>.1)add(f,'panel',u,z+((Math.floor(u/13.5)%2)*.25),w,.69,{color:'#4f5557',depth_m:.045});}
    }
    if(e.index===front&&L>20){
      add(f,'sign',L*.32,h-1.65,Math.min(14,L*.33),.92,{color:dark?'#625f58':'#a2a6a4',text:dark?'МИЛЯ':'КИНОМАКС',text_color:dark?'#eee8da':'#eb5290',depth_m:.14});
      if(!dark)add(f,'sign',L*.72,h-1.3,5,.65,{color:'#555b5b',text:'O’STIN',text_color:'#f3eee1',depth_m:.15});
    }return f;
  })};
}
function podium(base){
  return {building_id:base.id,geometry_key:S.geometryKey(base.ring),height_m:base.height,roof:{color:'#a5a59c',parapet_m:.15},facades:edges(base.ring).map(e=>{
    const f=facade(e,{wall:'#aeb5b1',finish:'stone',observed:e.length>20,references:ref(2,5,6)});
    for(let u=.4;u+1.8<e.length;u+=3.3)window(f,u,.4,1.8,Math.min(2.5,base.height-1.1),{frame_color:'#d0d2ca'});
    if(e.length>20)add(f,'sign',1,base.height-.65,e.length-2,.42,{color:'#ab6638',text:'ПРОДУКТЫ    ФОТО    КЛЮЧИ    РЕМОНТ ОБУВИ',text_color:'#fff3de'});
    return f;
  })};
}
function metro(base,exit){
  const es=edges(base.ring),front=S.nearestEdge(base.ring,TARGET.coordinates).index;
  return {building_id:base.id,geometry_key:S.geometryKey(base.ring),height_m:4.8,roof:{color:'#555c5b',parapet_m:.1},facades:es.map(e=>{
    const f=facade(e,{wall:'#4e595c',finish:'metal',observed:e.index===front,references:ref(7,8,9)}),L=e.length;
    if(L>2){for(let u=.16;u+1.15<L;u+=1.3)window(f,u,.25,1.1,2.7,{panes:1,frame_color:'#404b4f',color:'#829b9e',depth_m:.06});
      add(f,'panel',0,3.32,L,.25,{color:'#bbc969',depth_m:.05});
      if(L>4)add(f,'sign',.25,2.94,L-.5,.35,{text:'ЖУЛЕБИНО  ·  '+exit,text_color:'#d8e0df',color:'#374448'});
      if(e.index===front)add(f,'metro-m',L/2-.45,3.7,.9,.9,{color:'#c93837',depth_m:.2});
    }return f;
  })};
}
function environment(scene){
  const frame=S.frame(TARGET.coordinates),hero=scene.buildings.find(b=>b.role==='hero'),trees=[],fences=[],lamps=[],greens=[];
  for(const e of edges(hero.ring).filter(e=>[0,2,3,19,20].includes(e.index))){
    for(let u=2;u<e.length-1;u+=8.7){
      const xy=[e.a[0]+u*e.tangent[0]+e.normal[0]*4.8,e.a[1]+u*e.tangent[1]+e.normal[1]*4.8];
      trees.push({coordinates:frame.fromLocal(xy),height_m:e.index===2?11.5:9,radius_m:e.index===2?3.2:e.index===3?1.7:2.4,color:trees.length%3?'#647b4b':'#9d9c53',evidence:'inferred',reference_ids:ref(1,3,10)});
    }
    const at=u=>frame.fromLocal([e.a[0]+u*e.tangent[0]+e.normal[0]*1.8,e.a[1]+u*e.tangent[1]+e.normal[1]*1.8]);
    if(e.index!==0)fences.push({start:at(.2),end:at(e.length-.2),height_m:1.55});
    if(e.index!==0){const p=(u,d)=>frame.fromLocal([e.a[0]+u*e.tangent[0]+e.normal[0]*d,e.a[1]+u*e.tangent[1]+e.normal[1]*d]);greens.push([p(.2,2.3),p(e.length-.2,2.3),p(e.length-.2,7.3),p(.2,7.3),p(.2,2.3)]);}
    if([2,3].includes(e.index))lamps.push({coordinates:frame.fromLocal([e.a[0]+e.length*.5*e.tangent[0]+e.normal[0]*8,e.a[1]+e.length*.5*e.tangent[1]+e.normal[1]*8]),height_m:9,bearing:e.bearing});
  }
  const mallBase=scene.buildings.find(b=>S.geometryKey(b.ring)===S.geometryKey(geometry.scene.buildings[6].ring));
  if(mallBase){
    const e=S.nearestEdge(mallBase.ring,TARGET.coordinates),at=(u,d)=>frame.fromLocal([e.a[0]+e.tangent[0]*u+e.normal[0]*d,e.a[1]+e.tangent[1]*u+e.normal[1]*d]);
    greens.push([at(4,5),at(e.length-4,5),at(e.length-4,17),at(4,17),at(4,5)]);
    for(let u=12;u<e.length-8;u+=18)trees.push({coordinates:at(u,11),height_m:10.5,radius_m:3,color:Math.round(u)%3?'#617648':'#8b9154',evidence:'inferred',reference_ids:ref(4,7,8)});
  }
  const roads=[];
  // Clip existing map lines to the local quarter, retaining their exact bearing.
  for(const road of geometry.roads){
    const pts=road.coordinates.map(frame.toLocal);
    for(let i=1;i<pts.length;i++){
      const a=pts[i-1],b=pts[i],d=[b[0]-a[0],b[1]-a[1]],aa=d[0]**2+d[1]**2,bb=2*(a[0]*d[0]+a[1]*d[1]),cc=a[0]**2+a[1]**2-244**2,disc=bb*bb-4*aa*cc;
      if(!aa||disc<0)continue;
      const low=Math.max(0,(-bb-Math.sqrt(disc))/(2*aa)),high=Math.min(1,(-bb+Math.sqrt(disc))/(2*aa));
      if(high>low)roads.push({...road,coordinates:[frame.fromLocal([a[0]+low*d[0],a[1]+low*d[1]]),frame.fromLocal([a[0]+high*d[0],a[1]+high*d[1]])]});
    }
  }
  return {trees,fences,lamps,roads,greens,placement_note:'Tree, fence, lawn and lamp positions and road widths inferred from photographs and map; not surveyed.'};
}
function matches(row){return String(row.id)===TARGET.marker_id&&row.establishment_id===TARGET.establishment_id&&row.venue_id===TARGET.venue_id&&Math.abs(Number(row.lon)-TARGET.coordinates[0])<1e-7&&Math.abs(Number(row.lat)-TARGET.coordinates[1])<1e-7;}
function build(row){
  if(!matches(row))return null;
  const old=row.realcity_profile||{};
  // Never silently replace a reconstruction saved through the owner's studio.
  if(old.astra&&![RELEASE,PREVIOUS_RELEASE].includes(old.astra.release_id))return null;
  if(old.astra?.release_id===RELEASE&&S.bound(old.astra,row,old.scene))return null;
  const scene=old.scene?.buildings?.length?old.scene:structuredClone(geometry.scene);
  const source=geometry.scene.buildings,lookup=new Map(scene.buildings.map(b=>[S.geometryKey(b.ring),b]));
  const at=i=>{const actual=lookup.get(S.geometryKey(source[i].ring));return actual?{...actual,ring:source[i].ring}:null;};
  if(!at(0))return null; // Changed map geometry needs deliberate re-registration.
  const buildings=[clinic(at(0))];
  // Architectural samples are attached to actual facade surfaces/openings,
  // never to a photo-sized rectangle, sky, foreground car or landscape plane.
  for(const part of buildings[0].parts)for(const f of part.facades){
    f.material_id=f.edge_index===2?'clinic-ribbed-shade':'clinic-ribbed';
    let index=0;
    for(const m of f.modules){
      if(m.kind==='window'){
        m.material_id=['clinic-glass-a','clinic-glass-b','clinic-glass-c'][(f.edge_index+index++)%3];
        if([0,2,20].includes(f.edge_index)&&index%4===1)m.material_id='clinic-glass-lit';
        m.frame_m=.035;m.depth_m=.16;
      }
      if(m.kind==='panel'&&m.color===C.charcoal)m.material_id='clinic-spandrel';
    }
  }
  for(const i of [1,2])if(at(i))buildings.push(podium(at(i)));
  for(const i of [3,4])if(at(i))buildings.push(apartment(at(i),i===3));
  if(at(6))buildings.push(mall(at(6)));if(at(10))buildings.push(mall(at(10),true));
  // Entrance references verified from OSM nodes 2516024431 / 4439 / 4437 / 4427.
  for(const [i,exit] of [[16,'5'],[18,'6'],[23,'7'],[24,'4']])if(at(i))buildings.push(metro(at(i),exit));
  // Edge-local measurements follow the photographed source ring, even if a
  // saved scene later rotates its start vertex or reverses winding.
  for(const b of buildings){
    const actual=scene.buildings.find(x=>String(x.id)===b.building_id),es=edges(actual.ring);
    b.facades=b.facades.map(f=>{
      const same=es.find(e=>JSON.stringify(e.coordinates)===JSON.stringify(f.edge));if(same)return {...f,edge_index:same.index};
      const reverse=es.find(e=>JSON.stringify([...e.coordinates].reverse())===JSON.stringify(f.edge));
      if(!reverse)throw new Error('photo_release_edge_registration');
      return {...f,edge_index:reverse.index,edge:reverse.coordinates,modules:f.modules.map(m=>({...m,u_m:round(reverse.length-m.u_m-m.width_m)}))};
    });
  }
  const workingRow={...row,realcity_profile:{...old,scene},realcity_astra_assets:[...(row.realcity_astra_assets||[]),...REFERENCES]};
  const views=[
    {label:'Вход',center:TARGET.coordinates,bearing:258,pitch:68,zoom:18.55},
    {label:'Сердце',center:TARGET.coordinates,bearing:220,pitch:70,zoom:18.65},
    {label:'Квартал',center:[37.85245,55.68553],bearing:250,pitch:45,zoom:16.7}
  ];
  const astra=A.compile({version:2,target:TARGET,buildings,materials,environment:environment(scene),camera:{bearing:252,pitch:64,zoom:18.15,views},notes:'Фотографии 1–10: реконструкция видимых фасадов и выправленные архитектурные материалы. Тыльные стороны, глубины и положение деревьев оценены; модель не является обмерной съёмкой.'},workingRow);
  astra.release_id=RELEASE;astra.references=REFERENCES;
  astra.external_references=[
    {url:'https://gp-23.ru/novosti/головное-здание-открыто/',source:'Городская поликлиника №23',date:'2024-12-16',use:'Exact address and post-renovation opening; owner photos govern current facade.'},
    {url:'https://promalliance.pro/projects/moya-poliklinika/',source:'ПромАльянс, manufacturer project register',date:'2024',use:'Exact Milya 6 entry: corrugated powder-coated aluminium honeycomb panels; other project images are not treated as this clinic.'},
    {url:'https://adamant-stroy.ru/objects/zdanie-milya/',source:'Адамант-Строй, original builder',date:'2017',use:'Aerials DJI_0674 and DJI_0737: relation of mall, housing podiums, clinic plot and paths. Historical reference, not current clinic appearance.'}
  ];
  astra.coverage.notes='Visible elevations authored from owner photographs. Roof layout and hidden elevations inferred. Context simplified.';
  return {...old,version:Math.max(11,Number(old.version)||0),scene,astra};
}
module.exports={RELEASE,TARGET,REFERENCES,build,matches};
