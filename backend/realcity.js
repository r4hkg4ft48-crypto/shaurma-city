'use strict';

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const cache = new Map();
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter'
];

const PALETTES = [
  { wall:'#d8d4cc', accent:'#8a6a56', windows:'#2c3742', storefront:'#24272a', roof:'#bab5ab' },
  { wall:'#d5d7d6', accent:'#6e7475', windows:'#27313a', storefront:'#20252a', roof:'#b8bbb9' },
  { wall:'#d7d0c5', accent:'#7a6354', windows:'#26313a', storefront:'#2d2925', roof:'#b9b0a5' },
  { wall:'#cfd3d6', accent:'#78828c', windows:'#29343d', storefront:'#20262d', roof:'#aeb5ba' },
  { wall:'#dedbd4', accent:'#9a8166', windows:'#28333e', storefront:'#2b2a29', roof:'#c4bfb5' }
];

const LEPYOSHKA = {
  wall:'#d5d5d1',
  accent:'#735845',
  windows:'#28343e',
  storefront:'#202429',
  roof:'#b9b9b4'
};

function clamp(n,min,max){ return Math.max(min,Math.min(max,n)); }
function num(v){ const n=Number.parseFloat(String(v ?? '').replace(',','.')); return Number.isFinite(n)?n:null; }
function hashString(s){ let h=2166136261; for(const ch of String(s)){ h^=ch.charCodeAt(0); h=Math.imul(h,16777619); } return h>>>0; }
function colorFromTag(v){
  if(!v) return null;
  const s=String(v).trim().toLowerCase();
  if(/^#[0-9a-f]{6}$/i.test(s)) return s;
  const names={white:'#dedbd4',grey:'#cfd3d4',gray:'#cfd3d4',beige:'#d9d0c2',brown:'#8a6b56',red:'#a7685a',yellow:'#d6c08b',cream:'#ddd2bd'};
  return names[s]||null;
}
function parseHeight(tags,id){
  const direct=num(tags.height);
  if(direct) return clamp(direct,3,120);
  const levels=num(tags['building:levels']);
  if(levels) return clamp(levels*3.05,3,120);
  return 9 + (hashString(id)%8)*3.05;
}
function floorCount(height,tags){
  const levels=num(tags['building:levels']);
  return clamp(Math.round(levels || height/3.05),1,35);
}
function toLocal(lon,lat,originLon,originLat){
  const c=Math.cos(originLat*Math.PI/180);
  return [(lon-originLon)*111320*c,(lat-originLat)*110540];
}
function fromLocal(x,y,originLon,originLat){
  const c=Math.cos(originLat*Math.PI/180);
  return [originLon+x/(111320*c),originLat+y/110540];
}
function centroid(ring){
  let x=0,y=0,n=0;
  for(const p of ring){ if(Array.isArray(p)&&p.length>=2){ x+=p[0];y+=p[1];n++; } }
  return n?[x/n,y/n]:[0,0];
}
function distMeters(a,b,originLat){
  const c=Math.cos(originLat*Math.PI/180),dx=(a[0]-b[0])*111320*c,dy=(a[1]-b[1])*110540;
  return Math.hypot(dx,dy);
}
function pointInRing(point,ring){
  let inside=false;
  for(let i=0,j=ring.length-1;i<ring.length;j=i++){
    const xi=ring[i][0],yi=ring[i][1],xj=ring[j][0],yj=ring[j][1];
    const crosses=((yi>point[1])!==(yj>point[1]))&&(point[0]<(xj-xi)*(point[1]-yi)/((yj-yi)||1e-12)+xi);
    if(crosses)inside=!inside;
  }
  return inside;
}
function pointToRingMeters(point,ring,originLon,originLat){
  if(pointInRing(point,ring))return 0;
  const P=toLocal(point[0],point[1],originLon,originLat);
  let best=Infinity;
  for(let i=0;i<ring.length-1;i++){
    const A=toLocal(ring[i][0],ring[i][1],originLon,originLat),B=toLocal(ring[i+1][0],ring[i+1][1],originLon,originLat);
    const vx=B[0]-A[0],vy=B[1]-A[1],wx=P[0]-A[0],wy=P[1]-A[1],d=vx*vx+vy*vy;
    const t=d?clamp((wx*vx+wy*vy)/d,0,1):0,dx=P[0]-(A[0]+vx*t),dy=P[1]-(A[1]+vy*t);
    best=Math.min(best,Math.hypot(dx,dy));
  }
  return best;
}
function edgeRect(a,b,depth,originLon,originLat,start=0,end=1){
  const A=toLocal(a[0],a[1],originLon,originLat),B=toLocal(b[0],b[1],originLon,originLat);
  const dx=B[0]-A[0],dy=B[1]-A[1],len=Math.hypot(dx,dy); if(len<0.6) return null;
  const ux=dx/len,uy=dy/len,nx=-uy,ny=ux;
  const p0=[A[0]+dx*start,A[1]+dy*start],p1=[A[0]+dx*end,A[1]+dy*end],d=depth/2;
  const pts=[
    [p0[0]+nx*d,p0[1]+ny*d],[p1[0]+nx*d,p1[1]+ny*d],
    [p1[0]-nx*d,p1[1]-ny*d],[p0[0]-nx*d,p0[1]-ny*d],[p0[0]+nx*d,p0[1]+ny*d]
  ];
  return pts.map(p=>fromLocal(p[0],p[1],originLon,originLat));
}
function paletteFor(venueId,tags,id){
  const base={...PALETTES[hashString(id)%PALETTES.length]};
  const tagged=colorFromTag(tags['building:colour']||tags['building:color']);
  if(tagged) base.wall=tagged;
  const mat=String(tags['building:material']||'').toLowerCase();
  if(mat.includes('brick')){ base.wall='#b58f78'; base.accent='#775947'; base.roof='#9c8879'; }
  if(mat.includes('glass')){ base.wall='#8997a3'; base.windows='#1f2c35'; base.accent='#667887'; }
  return base;
}
async function fetchOverpass(lat,lon,radius){
  const q=`[out:json][timeout:12];way["building"](around:${Math.round(radius)},${lat},${lon});out geom tags;`;
  let lastErr=null;
  for(const endpoint of OVERPASS_ENDPOINTS){
    const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),8500);
    try{
      const r=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8','User-Agent':'Shaurmeg-RealCity/1.0'},body:'data='+encodeURIComponent(q),signal:controller.signal});
      if(!r.ok) throw new Error('overpass_'+r.status);
      const j=await r.json();
      if(!j||!Array.isArray(j.elements)) throw new Error('bad_overpass');
      return j.elements;
    }catch(e){ lastErr=e; }finally{ clearTimeout(timer); }
  }
  throw lastErr||new Error('overpass_unavailable');
}
function makeScene(elements,{lat,lon,venueId,radius}){
  const center=[lon,lat],buildings=[];
  for(const el of elements){
    if(el.type!=='way'||!Array.isArray(el.geometry)||el.geometry.length<4) continue;
    const ring=el.geometry.map(p=>[Number(p.lon),Number(p.lat)]).filter(p=>Number.isFinite(p[0])&&Number.isFinite(p[1]));
    if(ring.length<4) continue;
    const first=ring[0],last=ring[ring.length-1]; if(first[0]!==last[0]||first[1]!==last[1]) ring.push([...first]);
    const tags=el.tags||{},id='osm-'+el.id,c=centroid(ring),centroidDistance=distMeters(c,center,lat),distance=pointToRingMeters(center,ring,lon,lat),contains=distance===0,height=parseHeight(tags,id),floors=floorCount(height,tags),palette=paletteFor(venueId,tags,id);
    buildings.push({id,ring,tags,c,distance,centroidDistance,contains,height,floors,palette});
  }
  buildings.sort((a,b)=>a.distance-b.distance);
  const limited=buildings.slice(0,90);
  const hero=limited[0]||null;
  if(hero&&String(venueId||'').toLowerCase()==='lepyoshka')hero.palette={...LEPYOSHKA};
  const buildingFeatures=limited.map((b,i)=>({type:'Feature',id:i+1,properties:{id:b.id,height:b.height,base:0,facade:b.palette.wall,roof:b.palette.roof,distance:Math.round(b.distance),hero:b===hero?1:0},geometry:{type:'Polygon',coordinates:[b.ring]}}));
  const detailFeatures=[];
  const detailed=limited.filter((b,i)=>i<6&&b.distance<95);
  for(const b of detailed){
    const isHero=b===hero;
    if(isHero){
      detailFeatures.push({type:'Feature',properties:{base:.15,height:Math.min(3.25,b.height),color:b.palette.storefront,kind:'storefront'},geometry:{type:'Polygon',coordinates:[b.ring]}});
    }
    const maxFloors=Math.min(b.floors,14);
    for(let f=1;f<maxFloors;f++){
      const base=f*3.05+1.0,height=Math.min(base+1.25,b.height-.25); if(height<=base) continue;
      for(let e=0;e<b.ring.length-1;e++){
        const a=b.ring[e],z=b.ring[e+1],A=toLocal(a[0],a[1],lon,lat),Z=toLocal(z[0],z[1],lon,lat),edgeLen=Math.hypot(Z[0]-A[0],Z[1]-A[1]);
        if(edgeLen<3) continue;
        const count=Math.min(18,Math.max(1,Math.floor(edgeLen/5.4)));
        for(let w=0;w<count;w++){
          const pad=.18,seg=1/count,s=w*seg+seg*pad,t=(w+1)*seg-seg*pad;
          const rect=edgeRect(a,z,isHero?.52:.42,lon,lat,s,t); if(!rect) continue;
          detailFeatures.push({type:'Feature',properties:{base,height,color:b.palette.windows,kind:'window'},geometry:{type:'Polygon',coordinates:[rect]}});
        }
      }
    }
    if(isHero){
      for(let e=0;e<b.ring.length-1;e+=2){
        const rect=edgeRect(b.ring[e],b.ring[e+1],.7,lon,lat,.06,.14); if(!rect) continue;
        detailFeatures.push({type:'Feature',properties:{base:.3,height:Math.max(3,b.height-.25),color:b.palette.accent,kind:'accent'},geometry:{type:'Polygon',coordinates:[rect]}});
      }
    }
  }
  return {
    ok:true,source:'OpenStreetMap / Overpass',center:{lat,lon},radius,venue_id:venueId||'',hero_building_id:hero?.id||null,
    buildings:{type:'FeatureCollection',features:buildingFeatures},
    details:{type:'FeatureCollection',features:detailFeatures},
    stats:{buildings:buildingFeatures.length,details:detailFeatures.length,detailed:detailed.length}
  };
}

module.exports=function installRealCity(app){
  app.get('/api/shaurmeg/realcity',async(req,res)=>{
    const lat=Number(req.query.lat),lon=Number(req.query.lon),radius=clamp(Number(req.query.radius)||180,80,260),venueId=String(req.query.venue_id||'').slice(0,64);
    if(!Number.isFinite(lat)||!Number.isFinite(lon)||lat<-90||lat>90||lon<-180||lon>180) return res.status(400).json({error:'bad_coordinates'});
    const key=[lat.toFixed(4),lon.toFixed(4),Math.round(radius/20)*20,venueId].join(':');
    const hit=cache.get(key); if(hit&&Date.now()-hit.at<CACHE_TTL_MS) return res.json({...hit.data,cached:true});
    try{
      const elements=await fetchOverpass(lat,lon,radius),data=makeScene(elements,{lat,lon,venueId,radius});
      cache.set(key,{at:Date.now(),data});
      res.setHeader('Cache-Control','public, max-age=600, stale-while-revalidate=21600');
      res.json(data);
    }catch(e){
      console.error('realcity:',e.message);
      res.status(503).json({error:'realcity_source_unavailable',fallback:'map_buildings',message:e.message});
    }
  });
};
