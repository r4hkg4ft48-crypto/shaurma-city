'use strict';

const {VectorTile}=require('@mapbox/vector-tile');
const Pbf=require('pbf');

const PROFILE_VERSION=10;
const OVERPASS_ENDPOINTS=[
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass-api.de/api/interpreter'
];

const DEFAULT_PALETTE={
  wall:'#d3d1cc',
  accent:'#8a7463',
  windows:'#29343d',
  storefront:'#24282b',
  roof:'#b7b4ae',
  ground:'#d9d5cc'
};
const NAMED_COLORS={
  white:'#dedbd4',grey:'#c9cbca',gray:'#c9cbca',silver:'#b7bbbd',beige:'#d7cbb8',
  brown:'#8a6a56',red:'#a9685a',yellow:'#d8bd7b',cream:'#ded2bc',black:'#343537',
  brick:'#a8745d',orange:'#c98b5d',blue:'#788d9e',green:'#7e8d78'
};

function clamp(n,a,b){return Math.max(a,Math.min(b,n))}
function num(v){const n=Number.parseFloat(String(v??'').replace(',','.'));return Number.isFinite(n)?n:null}
function hex2(n){return clamp(Math.round(n),0,255).toString(16).padStart(2,'0')}
function rgbHex(r,g,b){return '#'+hex2(r)+hex2(g)+hex2(b)}
function hexRgb(v){
  const m=String(v||'').trim().match(/^#([0-9a-f]{6})$/i);
  return m?[parseInt(m[1].slice(0,2),16),parseInt(m[1].slice(2,4),16),parseInt(m[1].slice(4,6),16)]:null;
}
function normalizeColor(v){
  if(!v)return null;
  const s=String(v).trim().toLowerCase();
  if(/^#[0-9a-f]{6}$/i.test(s))return s;
  if(/^#[0-9a-f]{3}$/i.test(s))return '#'+s.slice(1).split('').map(x=>x+x).join('');
  return NAMED_COLORS[s]||null;
}
function luminance(r,g,b){return .2126*r+.7152*g+.0722*b}
function hsl(r,g,b){
  r/=255;g/=255;b/=255;
  const max=Math.max(r,g,b),min=Math.min(r,g,b),d=max-min;
  let h=0,s=0,l=(max+min)/2;
  if(d){
    s=l>.5?d/(2-max-min):d/(max+min);
    if(max===r)h=((g-b)/d+(g<b?6:0))/6;
    else if(max===g)h=((b-r)/d+2)/6;
    else h=((r-g)/d+4)/6;
  }
  return {h:h*360,s,l};
}
function colorDistance(a,b){
  const A=hexRgb(a),B=hexRgb(b);if(!A||!B)return 0;
  return Math.hypot(A[0]-B[0],A[1]-B[1],A[2]-B[2]);
}
function shade(hex,delta){
  const c=hexRgb(hex);if(!c)return hex;
  return rgbHex(c[0]+delta,c[1]+delta,c[2]+delta);
}
function mixColors(items,fallback){
  const v=items.map(x=>({rgb:hexRgb(x.color),w:Number(x.weight)||1})).filter(x=>x.rgb);
  if(!v.length)return fallback;
  let r=0,g=0,b=0,w=0;
  for(const x of v){r+=x.rgb[0]*x.w;g+=x.rgb[1]*x.w;b+=x.rgb[2]*x.w;w+=x.w}
  return rgbHex(r/w,g/w,b/w);
}
function uniqColors(colors,limit=8){
  const out=[];
  for(const c of colors){
    const n=normalizeColor(c);if(!n)continue;
    if(out.every(x=>colorDistance(x,n)>28))out.push(n);
    if(out.length>=limit)break;
  }
  return out;
}
function hashString(s){
  let h=2166136261;
  for(const ch of String(s)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)}
  return h>>>0;
}
function weightedNumber(items,key,fallback=0){
  let sum=0,w=0;
  for(const x of items){const n=Number(x.features?.[key]);if(Number.isFinite(n)){const ww=Number(x.weight)||1;sum+=n*ww;w+=ww}}
  return w?sum/w:fallback;
}
async function fetchJson(url,timeout=6000){
  const ac=new AbortController(),timer=setTimeout(()=>ac.abort(),timeout);
  try{
    const r=await fetch(url,{headers:{'User-Agent':'Shaurmeg-RealCity/4.0'},signal:ac.signal});
    if(!r.ok)throw new Error('http_'+r.status);
    return await r.json();
  }finally{clearTimeout(timer)}
}
function haversine(lat1,lon1,lat2,lon2){
  const R=6371000,p1=lat1*Math.PI/180,p2=lat2*Math.PI/180,dp=(lat2-lat1)*Math.PI/180,dl=(lon2-lon1)*Math.PI/180;
  const a=Math.sin(dp/2)**2+Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;
  return 2*R*Math.asin(Math.sqrt(a));
}
function bearing(lat1,lon1,lat2,lon2){
  const p1=lat1*Math.PI/180,p2=lat2*Math.PI/180,dl=(lon2-lon1)*Math.PI/180;
  return (Math.atan2(Math.sin(dl)*Math.cos(p2),Math.cos(p1)*Math.sin(p2)-Math.sin(p1)*Math.cos(p2)*Math.cos(dl))*180/Math.PI+360)%360;
}
function angleDiff(a,b){return Math.abs(((a-b+540)%360)-180)}

function toLocal(lon,lat,oLon,oLat){
  const c=Math.cos(oLat*Math.PI/180);
  return [(lon-oLon)*111320*c,(lat-oLat)*110540];
}
function pointInRing(point,ring){
  let inside=false;
  for(let i=0,j=ring.length-1;i<ring.length;j=i++){
    const xi=ring[i][0],yi=ring[i][1],xj=ring[j][0],yj=ring[j][1];
    const hit=((yi>point[1])!==(yj>point[1]))&&(point[0]<(xj-xi)*(point[1]-yi)/((yj-yi)||1e-12)+xi);
    if(hit)inside=!inside;
  }
  return inside;
}
function pointToRingMeters(point,ring,oLon,oLat){
  if(pointInRing(point,ring))return 0;
  const P=toLocal(point[0],point[1],oLon,oLat);let best=Infinity;
  for(let i=0;i<ring.length-1;i++){
    const A=toLocal(ring[i][0],ring[i][1],oLon,oLat),B=toLocal(ring[i+1][0],ring[i+1][1],oLon,oLat);
    const vx=B[0]-A[0],vy=B[1]-A[1],wx=P[0]-A[0],wy=P[1]-A[1],d=vx*vx+vy*vy,t=d?clamp((wx*vx+wy*vy)/d,0,1):0;
    best=Math.min(best,Math.hypot(P[0]-(A[0]+vx*t),P[1]-(A[1]+vy*t)));
  }
  return best;
}
function pointToLineMeters(point,line,oLon,oLat){
  const P=toLocal(point[0],point[1],oLon,oLat);let best=Infinity;
  for(let i=0;i<line.length-1;i++){
    const A=toLocal(line[i][0],line[i][1],oLon,oLat),B=toLocal(line[i+1][0],line[i+1][1],oLon,oLat);
    const vx=B[0]-A[0],vy=B[1]-A[1],wx=P[0]-A[0],wy=P[1]-A[1],d=vx*vx+vy*vy,t=d?clamp((wx*vx+wy*vy)/d,0,1):0;
    best=Math.min(best,Math.hypot(P[0]-(A[0]+vx*t),P[1]-(A[1]+vy*t)));
  }
  return best;
}
function centroid(ring){
  let x=0,y=0,n=0;
  for(const p of ring){x+=p[0];y+=p[1];n++}
  return n?[x/n,y/n]:[0,0];
}
function parseHeight(tags,id){
  const h=num(tags.height);if(h)return clamp(h,3,150);
  const levels=num(tags['building:levels']);if(levels)return clamp(levels*3.05,3,150);
  return 9+(hashString(id)%7)*3.05;
}
function parseLevels(tags,height){
  return clamp(Math.round(num(tags['building:levels'])||height/3.05),1,40);
}
function materialStyle(tags,levels){
  const material=String(tags['building:material']||tags.material||'').toLowerCase(),building=String(tags.building||'').toLowerCase();
  if(material.includes('glass'))return 'glass_modern';
  if(material.includes('brick'))return levels>=8?'brick_highrise':'brick_midrise';
  if(building.includes('commercial')||building.includes('retail'))return 'lowrise_commercial';
  if(levels>=10)return 'panel_balconies';
  if(levels>=5)return 'mixed_residential';
  return 'panel_simple';
}
function paletteFromTags(tags,index,basePalette){
  const p={...basePalette};
  const wall=normalizeColor(tags['building:colour']||tags['building:color']||tags.colour),roof=normalizeColor(tags['roof:colour']||tags['roof:color']);
  if(wall)p.wall=wall;
  if(roof)p.roof=roof;
  const material=String(tags['building:material']||'').toLowerCase();
  if(material.includes('brick')){p.wall=wall||'#b58f78';p.accent='#765747';p.roof=roof||'#9d8879'}
  if(material.includes('glass')){p.wall='#8b99a4';p.windows='#1f2c35';p.accent='#687986'}
  if(!wall){
    const deltas=[12,-7,5,-14,0];
    p.wall=shade(basePalette.wall,deltas[index%deltas.length]);
  }
  return p;
}
function roundRing(ring){
  return ring.map(p=>[Number(p[0].toFixed(6)),Number(p[1].toFixed(6))]);
}
async function overpassQuery(query,timeout=8000){
  let last=null;
  for(const endpoint of OVERPASS_ENDPOINTS){
    const ac=new AbortController(),timer=setTimeout(()=>ac.abort(),timeout);
    try{
      const r=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8','User-Agent':'Shaurmeg-RealCity/4.1'},body:'data='+encodeURIComponent(query),signal:ac.signal});
      if(!r.ok)throw new Error('overpass_'+r.status);
      const j=await r.json();
      if(!Array.isArray(j.elements))throw new Error('bad_overpass');
      return j.elements;
    }catch(e){last=e}finally{clearTimeout(timer)}
  }
  throw last||new Error('overpass_unavailable');
}
let openFreeMapTileTemplate='',openFreeMapTileTemplateAt=0;
async function getOpenFreeMapTileTemplate(){
  if(openFreeMapTileTemplate&&Date.now()-openFreeMapTileTemplateAt<3600000)return openFreeMapTileTemplate;
  const j=await fetchJson('https://tiles.openfreemap.org/planet',6000);
  const tpl=Array.isArray(j?.tiles)&&j.tiles[0]?String(j.tiles[0]):'';
  if(!tpl)throw new Error('openfreemap_tile_template_missing');
  openFreeMapTileTemplate=tpl;openFreeMapTileTemplateAt=Date.now();return tpl;
}
function mercatorTile(lon,lat,z){
  const n=2**z,x=(lon+180)/360*n;
  const rad=lat*Math.PI/180,y=(1-Math.asinh(Math.tan(rad))/Math.PI)/2*n;
  return {x,y,xi:Math.floor(x),yi:Math.floor(y),fx:x-Math.floor(x),fy:y-Math.floor(y)};
}
function geoOuterRings(g){
  if(!g)return[];
  if(g.type==='Polygon')return Array.isArray(g.coordinates?.[0])?[g.coordinates[0]]:[];
  if(g.type==='MultiPolygon')return (g.coordinates||[]).map(p=>p?.[0]).filter(r=>Array.isArray(r));
  return[];
}
async function fetchVectorBuildings(marker,radius=190){
  const z=14,t=mercatorTile(marker.lon,marker.lat,z),tpl=await getOpenFreeMapTileTemplate();
  const xs=[t.xi],ys=[t.yi];
  const edge=.22;
  if(t.fx<edge)xs.push(t.xi-1);if(t.fx>1-edge)xs.push(t.xi+1);
  if(t.fy<edge)ys.push(t.yi-1);if(t.fy>1-edge)ys.push(t.yi+1);
  const jobs=[];
  for(const x of [...new Set(xs)])for(const y of [...new Set(ys)])jobs.push({x,y,url:tpl.replace('{z}',z).replace('{x}',x).replace('{y}',y)});
  const pseudo=[],seen=new Set(),center=[marker.lon,marker.lat];
  await Promise.all(jobs.map(async job=>{
    try{
      const buf=await fetchBuffer(job.url,6500),tile=new VectorTile(new Pbf(buf)),layer=tile.layers?.building;
      if(!layer)return;
      for(let n=0;n<layer.length;n++){
        const feat=layer.feature(n),gj=feat.toGeoJSON(job.x,job.y,z),props=gj.properties||{};
        if(props.hide_3d===true||props.hide_3d===1)continue;
        let part=0;
        for(const ring0 of geoOuterRings(gj.geometry)){
          const ring=ring0.map(v=>[Number(v[0]),Number(v[1])]).filter(v=>Number.isFinite(v[0])&&Number.isFinite(v[1]));
          if(ring.length<4)continue;
          const first=ring[0],last=ring[ring.length-1];if(first[0]!==last[0]||first[1]!==last[1])ring.push([...first]);
          const d=pointToRingMeters(center,ring,marker.lon,marker.lat);if(d>radius+45)continue;
          const cc=centroid(ring),height=num(props.render_height)||9;
          const sig=cc[0].toFixed(5)+':'+cc[1].toFixed(5)+':'+Math.round(height);
          if(seen.has(sig))continue;seen.add(sig);
          pseudo.push({
            type:'way',id:'ofm-'+z+'-'+job.x+'-'+job.y+'-'+n+'-'+part++,
            tags:{building:'yes',height:String(height),min_height:String(num(props.render_min_height)||0),'building:colour':props.colour||''},
            geometry:ring.map(v=>({lon:v[0],lat:v[1]}))
          });
        }
      }
    }catch{}
  }));
  return pseudo;
}

async function fetchOsmWorld(marker,radius=190){
  const buildingsQ='[out:json][timeout:12];way["building"](around:'+radius+','+marker.lat+','+marker.lon+');out geom tags;';
  const environmentQ='[out:json][timeout:12];('+
    'node["natural"="tree"](around:'+radius+','+marker.lat+','+marker.lon+');'+
    'way["leisure"="park"](around:'+radius+','+marker.lat+','+marker.lon+');'+
    'way["landuse"="grass"](around:'+radius+','+marker.lat+','+marker.lon+');'+
    'way["highway"](around:'+radius+','+marker.lat+','+marker.lon+');'+
  ');out geom tags;';
  const [b,e]=await Promise.allSettled([overpassQuery(buildingsQ,8500),overpassQuery(environmentQ,6500)]);
  let buildings=b.status==='fulfilled'?b.value:[];
  const environment=e.status==='fulfilled'?e.value:[];
  if(!buildings.length)buildings=await fetchVectorBuildings(marker,radius).catch(()=>[]);
  if(!buildings.length&&b.status==='rejected')throw b.reason;
  return [...buildings,...environment];
}
function osmWorld(elements,marker,basePalette){
  const center=[marker.lon,marker.lat],buildings=[],trees=[],greens=[],roads=[];
  const colors=[],roofColors=[],materials={},levels=[];

  for(const e of elements){
    const t=e.tags||{};
    if(e.type==='node'&&t.natural==='tree'&&Number.isFinite(Number(e.lon))&&Number.isFinite(Number(e.lat))){
      trees.push([Number(e.lon),Number(e.lat)]);continue;
    }
    if(!Array.isArray(e.geometry)||e.geometry.length<2)continue;
    const geom=e.geometry.map(p=>[Number(p.lon),Number(p.lat)]).filter(p=>Number.isFinite(p[0])&&Number.isFinite(p[1]));
    if(t.highway){roads.push(geom);continue}
    if(t.leisure==='park'||t.landuse==='grass'){
      if(geom.length>=4)greens.push(geom);continue;
    }
    if(!t.building||geom.length<4)continue;

    const ring=geom.slice();
    const first=ring[0],last=ring[ring.length-1];if(first[0]!==last[0]||first[1]!==last[1])ring.push([...first]);
    const id='osm-'+e.id,height=parseHeight(t,id),lv=parseLevels(t,height),distance=pointToRingMeters(center,ring,marker.lon,marker.lat);
    const c=centroid(ring),material=String(t['building:material']||'').toLowerCase(),wall=normalizeColor(t['building:colour']||t['building:color']||t.colour),roof=normalizeColor(t['roof:colour']||t['roof:color']);
    if(wall)colors.push(wall);if(roof)roofColors.push(roof);if(material)materials[material]=(materials[material]||0)+1;levels.push(lv);
    buildings.push({id,ring,distance,height,levels:lv,tags:t,centroid:c});
  }

  buildings.sort((a,b)=>a.distance-b.distance);
  let hero=buildings[0]||null;
  if(hero&&hero.levels<=2){
    const parent=buildings.find(b=>b.distance<=28&&b.levels>=6&&b.height>=18);
    if(parent)hero=parent;
  }
  if(hero&&hero.distance>35){
    hero=buildings.slice(0,8).sort((a,b)=>(a.distance-a.height*.10)-(b.distance-b.height*.10))[0]||hero;
  }

  const dominantMaterial=Object.entries(materials).sort((a,b)=>b[1]-a[1])[0]?.[0]||'';
  const avgLevels=levels.length?levels.reduce((a,b)=>a+b,0)/levels.length:null;

  return {buildings,hero,trees,greens,roads,colors:uniqColors([...colors,...roofColors],8),dominantMaterial,avgLevels};
}

function classifyStyle(osm,heroFeatures){
  const hero=osm.hero;
  if(hero)return materialStyle(hero.tags,hero.levels);
  const m=String(osm.dominantMaterial||'');
  if(m.includes('glass'))return 'glass_modern';
  if(m.includes('brick'))return (osm.avgLevels||0)>=8?'brick_highrise':'brick_midrise';
  if((osm.avgLevels||0)>=10)return 'panel_balconies';
  if(weightedNumber(heroFeatures,'balcony_score',0)>.28)return 'panel_balconies';
  return (osm.avgLevels||0)>=5?'mixed_residential':'panel_simple';
}
function facadeConfig(style,heroAnalysis,heroBuilding){
  const levels=clamp(Math.round(heroBuilding?.levels||weightedNumber(heroAnalysis,'row_peaks',8)||8),2,24);
  const rowPeaks=weightedNumber(heroAnalysis,'row_peaks',levels);
  const colPeaks=weightedNumber(heroAnalysis,'col_peaks',6);
  const balconyScore=weightedNumber(heroAnalysis,'balcony_score',style.includes('balcon')?.6:.18);
  const bandScore=weightedNumber(heroAnalysis,'vertical_band_score',.28);
  const darkLower=weightedNumber(heroAnalysis,'dark_lower_ratio',.18);
  return {
    levels,
    window_rows:clamp(Math.round(Math.max(levels-1,rowPeaks*.72)),3,22),
    window_columns:clamp(Math.round(colPeaks*.55),3,10),
    window_width_ratio:.54,
    window_height_ratio:.48,
    sill_color:'#c1beb7',
    panel_grid:true,
    panel_line_alpha:.18,
    balconies:balconyScore>.27||style.includes('balcon'),
    balcony_every:balconyScore>.55?1:2,
    balcony_depth_m:balconyScore>.27?.85:.45,
    vertical_bands:bandScore>.2||style.includes('panel'),
    vertical_band_every:bandScore>.55?2:3,
    storefront:darkLower>.10||style.includes('commercial')||levels>=5,
    storefront_height_m:darkLower>.25?3.8:3.35,
    roof_equipment:levels>=5,
    texture_scale:style.includes('brick')?.78:1,
    material:style.includes('brick')?'brick':style.includes('glass')?'glass':'panel'
  };
}

function lcg(seed){
  let s=(seed>>>0)||1;
  return ()=>{s=(Math.imul(1664525,s)+1013904223)>>>0;return s/4294967296};
}
function synthesizeTrees(osm,marker,density){
  const exact=osm.trees.slice(0,80).map(p=>({lon:Number(p[0].toFixed(6)),lat:Number(p[1].toFixed(6)),source:'osm'}));
  const target=clamp(Math.round(density*72),exact.length,62);
  if(exact.length>=target)return exact;
  const rnd=lcg(hashString(marker.venue_id||marker.id||marker.name||'realcity'));
  const out=exact.slice(),center=[marker.lon,marker.lat];
  let attempts=0;
  while(out.length<target&&attempts<900){
    attempts++;
    const a=rnd()*Math.PI*2,rad=(18+rnd()*155)*Math.sqrt(rnd());
    const lat=center[1]+Math.sin(a)*rad/110540;
    const lon=center[0]+Math.cos(a)*rad/(111320*Math.cos(center[1]*Math.PI/180));
    const p=[lon,lat];
    if(osm.buildings.some(b=>pointToRingMeters(p,b.ring,marker.lon,marker.lat)<3.2))continue;
    if(osm.roads.some(r=>pointToLineMeters(p,r,marker.lon,marker.lat)<6.0))continue;
    if(out.some(t=>haversine(lat,lon,t.lat,t.lon)<5.0))continue;
    out.push({lon:Number(lon.toFixed(6)),lat:Number(lat.toFixed(6)),source:'photo-density'});
  }
  return out;
}
function buildScene(osm,marker,heroPalette,environmentPalette,style,facade,treeDensity){
  const chosen=osm.buildings.filter(b=>b.distance<195).slice(0,72);
  const sw=environmentPalette.swatches?.length?environmentPalette.swatches:[environmentPalette.wall,shade(environmentPalette.wall,-10),shade(environmentPalette.wall,10)];
  const buildings=chosen.map((b,index)=>{
    const isHero=osm.hero&&b.id===osm.hero.id;
    let palette=isHero?{...heroPalette}:paletteFromTags(b.tags,index,{...environmentPalette,wall:sw[index%sw.length]||environmentPalette.wall});
    const bStyle=isHero?style:materialStyle(b.tags,b.levels);
    if(!isHero&&sw.length&&!normalizeColor(b.tags['building:colour']||b.tags['building:color']))palette.wall=sw[index%sw.length]||palette.wall;
    return {
      id:b.id,
      ring:roundRing(b.ring),
      height:Number(b.height.toFixed(2)),
      levels:b.levels,
      distance:Number(b.distance.toFixed(1)),
      role:isHero?'hero':index<10?'nearby':'background',
      style:bStyle,
      pattern:isHero?0:1+(index%4),
      palette:{wall:palette.wall,accent:palette.accent,windows:palette.windows,storefront:palette.storefront,roof:palette.roof,swatches:Array.isArray(palette.swatches)?palette.swatches.slice(0,8):[]}
    };
  });
  return {
    radius_m:190,
    hero_building_id:osm.hero?.id||null,
    buildings,
    trees:synthesizeTrees(osm,marker,treeDensity),
    roads:(osm.roads||[]).slice(0,36).map(line=>roundRing(line)),
    greens:(osm.greens||[]).slice(0,20).map(ring=>roundRing(ring))
  };
}

async function analyzeRealCityProfile(marker){
  const safe={...marker,lat:Number(marker.lat),lon:Number(marker.lon)};
  const osmElements=await fetchOsmWorld(safe,190).catch(()=>[]);
  const osmSeed=osmWorld(osmElements,safe,DEFAULT_PALETTE);

  const osmPalette={...DEFAULT_PALETTE};
  if(osmSeed.colors.length)osmPalette.wall=osmSeed.colors[0]||DEFAULT_PALETTE.wall;
  if(String(osmSeed.dominantMaterial).includes('brick')){osmPalette.wall='#b58f78';osmPalette.accent='#765747';osmPalette.roof='#9d8879'}
  if(String(osmSeed.dominantMaterial).includes('glass')){osmPalette.wall='#8997a3';osmPalette.windows='#1f2c35';osmPalette.accent='#667887'}
  osmPalette.swatches=uniqColors([...osmSeed.colors,osmPalette.wall,osmPalette.accent,osmPalette.roof],8);

  const style=classifyStyle(osmSeed,[]);
  const facade=facadeConfig(style,[],osmSeed.hero);
  const treeDensity=clamp((Number(osmSeed.trees?.length||0)/28)+(Number(osmSeed.greens?.length||0)*.04),.08,.62);
  const scene=buildScene(osmSeed,safe,osmPalette,osmPalette,style,facade,treeDensity);
  const quality=osmSeed.buildings.length?'osm':'heuristic';
  const confidence=osmSeed.buildings.length?.61:.38;

  return {
    version:PROFILE_VERSION,
    generated_at:new Date().toISOString(),
    quality,
    confidence,
    building_style:style,
    palette:{
      wall:osmPalette.wall,accent:osmPalette.accent,windows:osmPalette.windows,
      storefront:osmPalette.storefront,roof:osmPalette.roof,ground:osmPalette.ground||DEFAULT_PALETTE.ground
    },
    neighborhood_palette:uniqColors([...(osmPalette.swatches||[]),osmPalette.wall,osmPalette.accent,osmPalette.roof],8),
    facade,
    texture:{hero_data_url:null,source:'procedural_map_geometry'},
    environment:{
      tree_density:Number(treeDensity.toFixed(2)),
      vegetation_ratio:null,
      ground_color:osmPalette.ground||DEFAULT_PALETTE.ground,
      building_count:osmSeed.buildings.length,
      dominant_material:osmSeed.dominantMaterial||null,
      average_levels:osmSeed.avgLevels?Number(osmSeed.avgLevels.toFixed(1)):null
    },
    camera:{zoom:18.35,pitch:61,bearing:-20},
    scene,
    sources:{
      mode:'map_geometry_only',
      photo_reconstruction:false,
      openstreetmap:{building_count:osmSeed.buildings.length,tree_count:osmSeed.trees.length}
    }
  };
}

module.exports={PROFILE_VERSION,analyzeRealCityProfile};
