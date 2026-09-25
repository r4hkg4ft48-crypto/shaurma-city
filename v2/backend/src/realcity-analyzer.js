'use strict';

const sharp=require('sharp');
const {VectorTile}=require('@mapbox/vector-tile');
const Pbf=require('pbf');

const PROFILE_VERSION=9;
const OVERPASS_ENDPOINTS=[
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass-api.de/api/interpreter'
];
const KARTAVIEW_ENDPOINT='https://api.openstreetcam.org/2.0/photo/';

const DEFAULT_PALETTE={
  wall:'#d3d1cc',
  accent:'#8a7463',
  windows:'#29343d',
  storefront:'#24282b',
  roof:'#b7b4ae',
  ground:'#d9d5cc'
};
const LEPYOSHKA_VERIFIED={
  wall:'#d7d5cf',
  accent:'#875f4e',
  windows:'#343c43',
  storefront:'#272727',
  roof:'#aaa9a3',
  ground:'#d8d3c8'
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
function dataUrlBuffer(v){
  const m=String(v||'').match(/^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/s);
  if(!m)return null;
  try{return Buffer.from(m[1],'base64')}catch{return null}
}
function normalizeRef(ref,index){
  if(typeof ref==='string')return {src:ref,role:index===0?'hero_facade':'environment'};
  if(!ref||typeof ref!=='object')return null;
  const src=String(ref.src||ref.image||ref.data||'');
  if(!src.startsWith('data:image/'))return null;
  const allowed=new Set(['hero_facade','street_left','street_right','neighbor','courtyard','environment']);
  return {src,role:allowed.has(ref.role)?ref.role:(index===0?'hero_facade':'environment')};
}

function findPeaks(values,minDistance=5,thresholdFactor=1.22,maxPeaks=18){
  if(!values.length)return [];
  const avg=values.reduce((a,b)=>a+b,0)/values.length;
  const candidates=[];
  for(let i=1;i<values.length-1;i++){
    if(values[i]>values[i-1]&&values[i]>=values[i+1]&&values[i]>avg*thresholdFactor)candidates.push({i,v:values[i]});
  }
  candidates.sort((a,b)=>b.v-a.v);
  const picked=[];
  for(const c of candidates){
    if(picked.every(x=>Math.abs(x.i-c.i)>=minDistance))picked.push(c);
    if(picked.length>=maxPeaks)break;
  }
  return picked.sort((a,b)=>a.i-b.i).map(x=>x.i);
}

async function extractImageFeatures(buf){
  const {data,info}=await sharp(buf,{failOn:'none'})
    .rotate()
    .resize({width:160,height:120,fit:'inside',withoutEnlargement:false})
    .removeAlpha()
    .raw()
    .toBuffer({resolveWithObject:true});

  const w=info.width,h=info.height,ch=info.channels;
  const bins=new Map(),groundBins=new Map();
  const lum=new Float32Array(w*h);
  let vegetation=0,sky=0,darkLower=0,lowerCount=0,facadePixels=0,total=0,rough=0,roughN=0;

  function addBin(map,r,g,b){
    const qr=Math.round(r/20)*20,qg=Math.round(g/20)*20,qb=Math.round(b/20)*20,key=qr+','+qg+','+qb;
    const rec=map.get(key)||{n:0,r:0,g:0,b:0};rec.n++;rec.r+=r;rec.g+=g;rec.b+=b;map.set(key,rec);
  }

  for(let y=0;y<h;y++){
    for(let x=0;x<w;x++){
      const i=(y*w+x)*ch,r=data[i],g=data[i+1],b=data[i+2],L=luminance(r,g,b),hs=hsl(r,g,b);
      lum[y*w+x]=L;total++;
      const isSky=hs.h>185&&hs.h<250&&hs.s>.18&&hs.l>.42;
      const isGreen=hs.h>62&&hs.h<165&&hs.s>.20&&hs.l>.12;
      if(isSky)sky++;
      if(isGreen)vegetation++;
      if(y>h*.70){lowerCount++;if(L<105)darkLower++;if(!isSky&&!isGreen&&L>45&&L<235)addBin(groundBins,r,g,b)}
      if(!isSky&&!isGreen&&L>22&&L<244){addBin(bins,r,g,b);facadePixels++}
      if(x>0){rough+=Math.abs(L-lum[y*w+x-1]);roughN++}
    }
  }

  const rowEdge=new Array(h).fill(0),colEdge=new Array(w).fill(0);
  for(let y=1;y<h;y++){
    for(let x=1;x<w;x++){
      const L=lum[y*w+x];
      rowEdge[y]+=Math.abs(L-lum[(y-1)*w+x]);
      colEdge[x]+=Math.abs(L-lum[y*w+x-1]);
    }
  }
  for(let y=0;y<h;y++)rowEdge[y]/=Math.max(1,w-1);
  for(let x=0;x<w;x++)colEdge[x]/=Math.max(1,h-1);

  const rowPeaks=findPeaks(rowEdge.slice(Math.round(h*.12),Math.round(h*.90)),5,1.26,18).map(v=>v+Math.round(h*.12));
  const colPeaks=findPeaks(colEdge.slice(Math.round(w*.08),Math.round(w*.92)),6,1.24,18).map(v=>v+Math.round(w*.08));
  const rowMean=rowEdge.reduce((a,b)=>a+b,0)/rowEdge.length;
  const colMean=colEdge.reduce((a,b)=>a+b,0)/colEdge.length;

  const colors=[...bins.values()].map(x=>({n:x.n,r:x.r/x.n,g:x.g/x.n,b:x.b/x.n})).sort((a,b)=>b.n-a.n).slice(0,28);
  const enriched=colors.map(x=>({...x,lum:luminance(x.r,x.g,x.b),hs:hsl(x.r,x.g,x.b),hex:rgbHex(x.r,x.g,x.b)}));
  const score=(x,target,satPenalty=.55)=>x.n*(1-Math.min(1,Math.abs(x.lum-target)/175))*(1-Math.min(.72,x.hs.s*satPenalty));
  const wall=enriched.filter(x=>x.lum>100&&x.lum<235).sort((a,b)=>score(b,182)-score(a,182))[0]||enriched[0];
  const windows=enriched.filter(x=>x.lum>24&&x.lum<125).sort((a,b)=>b.n-a.n)[0]||enriched.slice().sort((a,b)=>a.lum-b.lum)[0]||wall;
  const accent=enriched.filter(x=>x.lum>48&&x.lum<210&&wall&&colorDistance(x.hex,wall.hex)>42).sort((a,b)=>(b.n*(.55+b.hs.s))-(a.n*(.55+a.hs.s)))[0]||enriched[1]||wall;
  const roof=enriched.filter(x=>x.lum>72&&x.lum<190&&x.hs.s<.48).sort((a,b)=>b.n-a.n)[0]||accent||wall;
  const storefront=enriched.filter(x=>x.lum>20&&x.lum<105).sort((a,b)=>b.n-a.n)[0]||windows||accent||wall;

  const groundColors=[...groundBins.values()].map(x=>({n:x.n,r:x.r/x.n,g:x.g/x.n,b:x.b/x.n})).sort((a,b)=>b.n-a.n);
  const ground=groundColors[0]?rgbHex(groundColors[0].r,groundColors[0].g,groundColors[0].b):DEFAULT_PALETTE.ground;

  const palette={
    wall:wall?.hex||DEFAULT_PALETTE.wall,
    accent:accent?.hex||DEFAULT_PALETTE.accent,
    windows:windows?.hex||DEFAULT_PALETTE.windows,
    storefront:storefront?.hex||DEFAULT_PALETTE.storefront,
    roof:roof?.hex||DEFAULT_PALETTE.roof,
    ground,
    swatches:uniqColors(enriched.map(x=>x.hex),8)
  };

  return {
    palette,
    vegetation_ratio:Number((vegetation/Math.max(1,total)).toFixed(3)),
    sky_ratio:Number((sky/Math.max(1,total)).toFixed(3)),
    facade_ratio:Number((facadePixels/Math.max(1,total)).toFixed(3)),
    dark_lower_ratio:Number((darkLower/Math.max(1,lowerCount)).toFixed(3)),
    roughness:Number((rough/Math.max(1,roughN)/255).toFixed(3)),
    horizontal_edge_strength:Number(rowMean.toFixed(2)),
    vertical_edge_strength:Number(colMean.toFixed(2)),
    row_peaks:rowPeaks.length,
    col_peaks:colPeaks.length,
    balcony_score:Number(clamp((rowMean/(colMean||1)-.72)/1.4,0,1).toFixed(3)),
    vertical_band_score:Number(clamp((colMean/(rowMean||1)-.65)/1.5,0,1).toFixed(3))
  };
}

function mergePalettes(weighted,fallback=DEFAULT_PALETTE){
  const roles=['wall','accent','windows','storefront','roof','ground'],out={};
  for(const role of roles){
    out[role]=mixColors(weighted.filter(x=>x.palette?.[role]).map(x=>({color:x.palette[role],weight:x.weight})),fallback[role]);
  }
  out.swatches=uniqColors(weighted.flatMap(x=>x.palette?.swatches||[]),8);
  return out;
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
async function fetchBuffer(url,timeout=6000){
  const ac=new AbortController(),timer=setTimeout(()=>ac.abort(),timeout);
  try{
    const r=await fetch(url,{headers:{'User-Agent':'Shaurmeg-RealCity/4.0'},signal:ac.signal});
    if(!r.ok)throw new Error('http_'+r.status);
    const ab=await r.arrayBuffer();
    if(ab.byteLength>6_000_000)throw new Error('image_too_large');
    return Buffer.from(ab);
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

async function analyzeKartaView(marker){
  const url=KARTAVIEW_ENDPOINT+'?lat='+encodeURIComponent(marker.lat)+'&lng='+encodeURIComponent(marker.lon)+'&zoomLevel=18&join=sequence&orderBy=id&orderDirection=desc';
  const j=await fetchJson(url,5500),rows=Array.isArray(j?.result?.data)?j.result.data:[];
  const scored=rows.map(x=>{
    const lat=Number(x.lat),lon=Number(x.lng);if(!Number.isFinite(lat)||!Number.isFinite(lon))return null;
    const d=haversine(marker.lat,marker.lon,lat,lon),target=bearing(lat,lon,marker.lat,marker.lon),head=Number(x.heading),sphere=String(x.projection||'').toUpperCase()==='SPHERE';
    const diff=Number.isFinite(head)?angleDiff(head,target):180;
    return {row:x,d,diff,score:d+(sphere?0:diff*.42)};
  }).filter(Boolean).filter(x=>x.d<220).sort((a,b)=>a.score-b.score);

  const picked=[],seq=new Set();
  for(const x of scored){
    const sid=String(x.row.sequence?.id||x.row.sequenceId||'');
    if(sid&&seq.has(sid)&&picked.length<2)continue;
    if(sid)seq.add(sid);picked.push(x);
    if(picked.length>=4)break;
  }

  const analyses=[],meta=[];
  for(const x of picked){
    const url=x.row.imageThUrl||x.row.imageLthUrl||x.row.fileurlTh||x.row.fileurlLTh;
    if(!url)continue;
    try{
      const features=await extractImageFeatures(await fetchBuffer(url,5500));
      analyses.push({features,palette:features.palette,weight:1.55,role:'street'});
      meta.push({id:String(x.row.id||''),distance_m:Math.round(x.d),heading:Number(x.row.heading)||null,projection:x.row.projection||'',shot_date:x.row.shotDate||'',sequence_id:String(x.row.sequence?.id||'')});
    }catch{}
  }
  return {analyses,meta};
}

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

function averageFeature(items,key,fallback=0){return weightedNumber(items,key,fallback)}
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

async function makeFacadeTexture(buf){
  try{
    const out=await sharp(buf,{failOn:'none'})
      .rotate()
      .resize(128,256,{fit:'cover',position:'attention'})
      .modulate({brightness:1.03,saturation:.88})
      .sharpen({sigma:.65,m1:.8,m2:.35})
      .png({compressionLevel:9,palette:true,quality:82})
      .toBuffer();
    if(out.byteLength>180000)return null;
    return 'data:image/png;base64,'+out.toString('base64');
  }catch{return null}
}

async function analyzeUserReferences(marker){
  const raw=Array.isArray(marker.realcity_reference_images)?marker.realcity_reference_images:[];
  const refs=raw.map(normalizeRef).filter(Boolean).slice(0,8),analyses=[];
  for(let i=0;i<refs.length;i++){
    const ref=refs[i],buf=dataUrlBuffer(ref.src);if(!buf)continue;
    try{
      const features=await extractImageFeatures(buf);
      const heroRole=ref.role==='hero_facade';
      // Reference photos are used only to infer facade colors/structure.
      // Never turn the photograph itself into a map texture.
      analyses.push({role:ref.role,features,palette:features.palette,weight:heroRole?5.2:2.25});
    }catch{}
  }
  return analyses;
}

async function analyzeRealCityProfile(marker){
  const safe={...marker,lat:Number(marker.lat),lon:Number(marker.lon)};
  const userPromise=analyzeUserReferences(safe);
  const streetPromise=analyzeKartaView(safe).catch(()=>({analyses:[],meta:[]}));
  const osmElements=await fetchOsmWorld(safe,190).catch(()=>[]);
  const osmSeed=osmWorld(osmElements,safe,DEFAULT_PALETTE);
  const [user,street]=await Promise.all([userPromise,streetPromise]);

  const heroRefs=user.filter(x=>x.role==='hero_facade');
  const envRefs=user.filter(x=>x.role!=='hero_facade');
  const streetAnalyses=street.analyses||[];

  const osmPalette={...DEFAULT_PALETTE};
  if(osmSeed.colors.length)osmPalette.wall=mixColors(osmSeed.colors.map(color=>({color,weight:1})),DEFAULT_PALETTE.wall);
  if(String(osmSeed.dominantMaterial).includes('brick')){osmPalette.wall='#b58f78';osmPalette.accent='#765747';osmPalette.roof='#9d8879'}
  if(String(osmSeed.dominantMaterial).includes('glass')){osmPalette.wall='#8997a3';osmPalette.windows='#1f2c35';osmPalette.accent='#667887'}
  osmPalette.swatches=uniqColors([...osmSeed.colors,osmPalette.wall,osmPalette.accent,osmPalette.roof],8);

  const heroWeighted=heroRefs.length?[
    ...heroRefs.map(x=>({palette:x.palette,weight:x.weight}))
  ]:[
    ...streetAnalyses.map(x=>({palette:x.palette,weight:1.7})),
    {palette:osmPalette,weight:1}
  ];
  const envWeighted=[
    ...envRefs.map(x=>({palette:x.palette,weight:x.weight})),
    ...heroRefs.map(x=>({palette:x.palette,weight:1.15})),
    ...streetAnalyses.map(x=>({palette:x.palette,weight:1.9})),
    {palette:osmPalette,weight:1.15}
  ];

  let heroPalette=mergePalettes(heroWeighted,DEFAULT_PALETTE);
  let environmentPalette=mergePalettes(envWeighted,DEFAULT_PALETTE);

  const isLepe=String(safe.venue_id||'').toLowerCase()==='lepyoshka';
  const hasDedicatedHero=heroRefs.length>0;
  if(isLepe&&!hasDedicatedHero){
    heroPalette={...LEPYOSHKA_VERIFIED,swatches:[LEPYOSHKA_VERIFIED.wall,LEPYOSHKA_VERIFIED.accent,LEPYOSHKA_VERIFIED.windows,LEPYOSHKA_VERIFIED.roof]};
    environmentPalette={
      ...environmentPalette,
      wall:mixColors([{color:environmentPalette.wall,weight:1},{color:'#d2d0ca',weight:1.5}],'#d2d0ca'),
      accent:mixColors([{color:environmentPalette.accent,weight:1},{color:'#826557',weight:1.2}],'#826557'),
      ground:'#d8d3c8',
      swatches:uniqColors(['#d7d5cf','#c9c7c1','#bdbab3','#a8a39b','#875f4e',...(environmentPalette.swatches||[])],8)
    };
  }

  const style=isLepe&&!hasDedicatedHero?'panel_balconies_storefront':classifyStyle(osmSeed,heroRefs.length?heroRefs:streetAnalyses);
  let facade=facadeConfig(style,heroRefs.length?heroRefs:streetAnalyses,osmSeed.hero);
  if(isLepe&&!hasDedicatedHero){
    facade={...facade,levels:12,window_rows:11,window_columns:6,balconies:true,balcony_every:2,vertical_bands:true,vertical_band_every:3,storefront:true,storefront_height_m:3.6,panel_grid:true,roof_equipment:true,material:'panel'};
  }

  const photoVegetation=averageFeature([...user,...streetAnalyses],'vegetation_ratio',.12);
  const treeDensity=clamp(isLepe&&!user.length?Math.max(.58,photoVegetation*2.1):photoVegetation*2.15,0.08,.82);
  const scene=buildScene(osmSeed,safe,heroPalette,environmentPalette,style,facade,treeDensity);

  const quality=heroRefs.length||isLepe?'photo':streetAnalyses.length?'street':osmSeed.buildings.length?'osm':'heuristic';
  const confidence=heroRefs.length?.95:isLepe?.94:streetAnalyses.length?.82:osmSeed.buildings.length?.61:.38;

  return {
    version:PROFILE_VERSION,
    generated_at:new Date().toISOString(),
    quality,
    confidence,
    building_style:style,
    palette:{
      wall:heroPalette.wall,accent:heroPalette.accent,windows:heroPalette.windows,
      storefront:heroPalette.storefront,roof:heroPalette.roof,ground:heroPalette.ground||environmentPalette.ground||DEFAULT_PALETTE.ground
    },
    neighborhood_palette:uniqColors([...(environmentPalette.swatches||[]),environmentPalette.wall,environmentPalette.accent,environmentPalette.roof],8),
    facade,
    texture:{hero_data_url:null,source:heroRefs.length?'palette_reference':'procedural'},
    environment:{
      tree_density:Number(treeDensity.toFixed(2)),
      vegetation_ratio:Number(photoVegetation.toFixed(3)),
      ground_color:environmentPalette.ground||DEFAULT_PALETTE.ground,
      building_count:osmSeed.buildings.length,
      dominant_material:osmSeed.dominantMaterial||null,
      average_levels:osmSeed.avgLevels?Number(osmSeed.avgLevels.toFixed(1)):null
    },
    camera:{zoom:18.35,pitch:61,bearing:-20},
    scene,
    sources:{
      user_reference_images:user.length,
      hero_reference_images:heroRefs.length,
      verified_project_reference:isLepe&&!hasDedicatedHero,
      kartaview:{photo_count:street.meta.length,photos:street.meta},
      openstreetmap:{building_count:osmSeed.buildings.length,tree_count:osmSeed.trees.length}
    }
  };
}

module.exports={PROFILE_VERSION,analyzeRealCityProfile,extractImageFeatures};
