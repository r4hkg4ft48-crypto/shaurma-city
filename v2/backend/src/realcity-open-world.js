'use strict';

/*
 * RealCity Open World v1
 *
 * Builds an authored, map-anchored facade model from public/open street imagery
 * without persisting or re-serving the source photographs. Images are fetched
 * transiently and reduced to factual/semantic observations (palette, facade
 * rhythm, material cues and storefront/balcony likelihood). The final model is
 * constrained to the exact OpenFreeMap/OSM building footprints in scene.
 *
 * Heavy SfM/VGGT/COLMAP is intentionally a separate worker seam. This module is
 * safe for the existing Render API: bounded HTTP, bounded image bytes, bounded
 * image count and deterministic geometry generation.
 */
const config=require('./config');
const S=require('../../frontend/realcity-spatial');

const ENGINE='open-world-v1';
const MAX_IMAGE_BYTES=7*1024*1024;
const STREET_SOURCES=new Set(['panoramax','kartaview','mapillary']);
const SOURCE_WEIGHT={panoramax:1,kartaview:.92,mapillary:.96,wikimedia:.58};
const ALLOWED_LICENSE_HINTS=['CC BY-SA 4.0','CC-BY-SA-4.0','CC BY-SA','Licence Ouverte 2.0','etalab-2.0','ODbL'];

const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const finite=v=>Number.isFinite(Number(v));
const num=(v,d=null)=>finite(v)?Number(v):d;
const clean=(v,n=240)=>String(v??'').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim().slice(0,n);
const angleDiff=(a,b)=>Math.abs(((Number(a)-Number(b)+540)%360)-180);
const hex=n=>clamp(Math.round(n),0,255).toString(16).padStart(2,'0');
const rgbHex=(r,g,b)=>'#'+hex(r)+hex(g)+hex(b);
const hexRgb=v=>{const m=String(v||'').match(/^#([0-9a-f]{6})$/i);return m?[parseInt(m[1].slice(0,2),16),parseInt(m[1].slice(2,4),16),parseInt(m[1].slice(4,6),16)]:null};
const shade=(v,d)=>{const c=hexRgb(v);return c?rgbHex(c[0]+d,c[1]+d,c[2]+d):v};
const sourceWeight=s=>SOURCE_WEIGHT[s]||.5;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

function bbox(marker,radius=210){
  const lat=Number(marker.lat),lon=Number(marker.lon),dy=radius/110540,dx=radius/(111320*Math.max(.2,Math.cos(lat*Math.PI/180)));
  return [lon-dx,lat-dy,lon+dx,lat+dy];
}
function haversine(a,b){
  const R=6371008.8,p1=a[1]*Math.PI/180,p2=b[1]*Math.PI/180,dp=(b[1]-a[1])*Math.PI/180,dl=(b[0]-a[0])*Math.PI/180;
  const q=Math.sin(dp/2)**2+Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;
  return 2*R*Math.asin(Math.sqrt(q));
}
function bearing(a,b){
  const p1=a[1]*Math.PI/180,p2=b[1]*Math.PI/180,dl=(b[0]-a[0])*Math.PI/180;
  return (Math.atan2(Math.sin(dl)*Math.cos(p2),Math.cos(p1)*Math.sin(p2)-Math.sin(p1)*Math.cos(p2)*Math.cos(dl))*180/Math.PI+360)%360;
}
function centroid(ring){
  const r=S.ring(ring).slice(0,-1);if(!r.length)return null;
  let x=0,y=0;for(const p of r){x+=p[0];y+=p[1]}return [x/r.length,y/r.length];
}
function safeUrl(value){
  try{
    const u=new URL(String(value||''));
    if(u.protocol!=='https:')return null;
    const h=u.hostname.toLowerCase();
    if(h==='localhost'||h.endsWith('.local')||h==='0.0.0.0'||h==='127.0.0.1'||h==='::1')return null;
    if(/^(10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h))return null;
    return u.toString();
  }catch{return null}
}
async function fetchJson(url,{method='GET',body=null,timeout=5000,headers={}}={}){
  const safe=safeUrl(url);if(!safe)throw new Error('unsafe_open_world_url');
  const ac=new AbortController(),timer=setTimeout(()=>ac.abort(),timeout);
  try{
    const r=await fetch(safe,{method,headers:{'Accept':'application/json','User-Agent':'Shaurmeg-RealCity-OpenWorld/1.0',...headers},body:body?JSON.stringify(body):undefined,signal:ac.signal,redirect:'follow'});
    if(!r.ok)throw new Error('http_'+r.status);
    return await r.json();
  }finally{clearTimeout(timer)}
}
async function fetchImage(url,timeout=5500){
  const safe=safeUrl(url);if(!safe)throw new Error('unsafe_open_world_image');
  const ac=new AbortController(),timer=setTimeout(()=>ac.abort(),timeout);
  try{
    const r=await fetch(safe,{headers:{'Accept':'image/avif,image/webp,image/jpeg,image/png;q=.9,*/*;q=.2','User-Agent':'Shaurmeg-RealCity-OpenWorld/1.0'},signal:ac.signal,redirect:'follow'});
    if(!r.ok)throw new Error('image_http_'+r.status);
    const type=String(r.headers.get('content-type')||'').toLowerCase();
    if(!type.startsWith('image/'))throw new Error('open_world_not_image');
    const declared=Number(r.headers.get('content-length')||0);if(declared>MAX_IMAGE_BYTES)throw new Error('open_world_image_too_large');
    const buf=Buffer.from(await r.arrayBuffer());if(buf.length>MAX_IMAGE_BYTES)throw new Error('open_world_image_too_large');
    return buf;
  }finally{clearTimeout(timer)}
}

function candidateBase(source,id,coords,imageUrl,pageUrl,extra={}){
  if(!Array.isArray(coords)||coords.length<2||!finite(coords[0])||!finite(coords[1]))return null;
  const image=safeUrl(imageUrl),page=safeUrl(pageUrl);
  if(!image)return null;
  return {
    source,id:clean(id,120),coordinates:[Number(coords[0]),Number(coords[1])],
    image_url:image,page_url:page||null,heading:finite(extra.heading)?((Number(extra.heading)%360)+360)%360:null,
    captured_at:extra.captured_at||null,license:clean(extra.license,100)||null,
    attribution:clean(extra.attribution,300)||source,sequence_id:clean(extra.sequence_id,120)||null,
    panoramic:extra.panoramic===true
  };
}
function firstImageAsset(item){
  const assets=item?.assets&&typeof item.assets==='object'?Object.entries(item.assets):[];
  const ranked=assets.map(([key,a])=>({key,a,score:/thumb|preview|sd|medium|visual/i.test(key)?3:/hd|image/i.test(key)?2:1}))
    .filter(x=>x.a&&safeUrl(x.a.href)&&(!x.a.type||String(x.a.type).startsWith('image/'))).sort((a,b)=>b.score-a.score);
  if(ranked[0])return ranked[0].a.href;
  const links=Array.isArray(item?.links)?item.links:[];
  return links.find(l=>/thumbnail|preview/i.test(l.rel||'')&&safeUrl(l.href))?.href||null;
}
function producer(item){
  const p=item?.properties||{},v=p['geovisio:producer']||p.producer||item?.providers?.[0]?.name||item?.providers?.[0]?.description;
  if(typeof v==='string')return clean(v,120);
  if(v&&typeof v==='object')return clean(v.name||v.id||v.username,120);
  return '';
}
function licenseFromConfig(j){
  const vals=[
    j?.license,j?.licence,j?.picture_license,j?.pictures_license,j?.['picture-license'],
    j?.configuration?.license,j?.configuration?.picture_license
  ].filter(Boolean).map(String);
  const known=vals.find(v=>ALLOWED_LICENSE_HINTS.some(x=>v.toLowerCase().includes(x.toLowerCase())));
  return clean(known||vals[0]||'Panoramax open-instance license',100);
}

async function collectPanoramax(marker){
  const roots=[config.PANORAMAX_API_URL,'https://api.panoramax.xyz/api','https://panoramax.ign.fr/api'].filter(Boolean).map(x=>String(x).replace(/\/+$/,''));
  const box=bbox(marker,220),out=[],seen=new Set();
  await Promise.allSettled([...new Set(roots)].map(async root=>{
    let cfg={};try{cfg=await fetchJson(root+'/configuration',{timeout:3500})}catch{}
    let j;
    const query=root+'/search?bbox='+box.join(',')+'&limit=36';
    try{j=await fetchJson(query,{timeout:5000})}
    catch{j=await fetchJson(root+'/search',{method:'POST',body:{bbox:box,limit:36},timeout:5000})}
    for(const item of j?.features||[]){
      const id=String(item.id||'');if(!id||seen.has(id))continue;
      const p=item.properties||{},coords=item.geometry?.type==='Point'?item.geometry.coordinates:null,url=firstImageAsset(item);
      const page=(item.links||[]).find(l=>['alternate','self'].includes(l.rel)&&safeUrl(l.href))?.href;
      const c=candidateBase('panoramax',id,coords,url,page,{
        heading:p['view:azimuth']??p['exif:GPSImgDirection']??p.compass_angle??p.heading,
        captured_at:p.datetime||p.datetimetz||null,license:licenseFromConfig(cfg),
        attribution:producer(item)?'Panoramax · '+producer(item):'Panoramax contributors',
        sequence_id:item.collection||p.collection,pano:!!p['pers:interior_orientation']
      });
      if(c){seen.add(id);out.push(c)}
    }
  }));
  return out;
}

function arrayFromKarta(j){
  if(Array.isArray(j))return j;
  for(const v of [j?.result?.data,j?.result?.photos,j?.result,j?.data,j?.photos])if(Array.isArray(v))return v;
  return [];
}
function kartaImage(row){
  for(const k of ['fileurlProc','fileurlLTh','procUrl','imageProcUrl','thumbUrl','thumbnailUrl','image_url','url']){
    const v=safeUrl(row?.[k]);if(v)return v;
  }
  return null;
}
async function collectKartaView(marker){
  const u=new URL('https://api.openstreetcam.org/2.0/photo/');
  u.searchParams.set('lat',String(marker.lat));u.searchParams.set('lng',String(marker.lon));u.searchParams.set('zoomLevel','17');
  u.searchParams.set('join','1');u.searchParams.set('orderBy','date_added');u.searchParams.set('orderDirection','desc');
  let j;try{j=await fetchJson(u.toString(),{timeout:5500})}catch{return[]}
  const out=[];
  for(const row of arrayFromKarta(j).slice(0,48)){
    const coords=[num(row.lng??row.lon??row.longitude),num(row.lat??row.latitude)],id=row.id??row.photoId??row.sequenceId+'-'+row.sequenceIndex;
    const c=candidateBase('kartaview',id,coords,kartaImage(row),'https://kartaview.org/map/@'+coords[1]+','+coords[0]+',18z',{
      heading:row.heading??row.compass??row.cameraHeading??row.direction,
      captured_at:row.date_added??row.dateAdded??row.createdAt??null,
      license:'CC BY-SA 4.0',attribution:'© Grab and KartaView Contributors',
      sequence_id:row.sequenceId??row.sequence_id
    });if(c)out.push(c);
  }
  return out;
}

async function collectMapillary(marker){
  const token=String(config.MAPILLARY_ACCESS_TOKEN||'').trim();if(!token)return[];
  const box=bbox(marker,48);
  const u=new URL('https://graph.mapillary.com/images');
  u.searchParams.set('bbox',box.join(','));u.searchParams.set('limit','60');
  u.searchParams.set('fields','id,computed_geometry,thumb_1024_url,captured_at,compass_angle,creator,is_pano');
  let j;try{j=await fetchJson(u.toString(),{timeout:5500,headers:{Authorization:'OAuth '+token}})}catch{return[]}
  const out=[];
  for(const row of j?.data||[]){
    const coords=row.computed_geometry?.coordinates,author=clean(row.creator?.username||row.creator?.name||'',100);
    const c=candidateBase('mapillary',row.id,coords,row.thumb_1024_url,'https://www.mapillary.com/app/?pKey='+encodeURIComponent(row.id),{
      heading:row.compass_angle,captured_at:row.captured_at?new Date(Number(row.captured_at)).toISOString():null,
      license:'CC BY-SA (Mapillary imagery; Developer Terms also apply)',
      attribution:author?'© Mapillary · '+author:'© Mapillary',panoramic:row.is_pano===true
    });if(c)out.push(c);
  }
  return out;
}

async function collectWikimedia(marker){
  const u=new URL('https://commons.wikimedia.org/w/api.php');
  const params={action:'query',format:'json',origin:'*',generator:'geosearch',ggsprimary:'all',ggsnamespace:'6',ggsradius:'220',ggscoord:marker.lat+'|'+marker.lon,ggslimit:'24',prop:'imageinfo|coordinates',iiprop:'url|extmetadata',iiurlwidth:'1024'};
  for(const [k,v] of Object.entries(params))u.searchParams.set(k,String(v));
  let j;try{j=await fetchJson(u.toString(),{timeout:5500})}catch{return[]}
  const out=[];
  for(const page of Object.values(j?.query?.pages||{})){
    const info=page.imageinfo?.[0]||{},meta=info.extmetadata||{},c0=page.coordinates?.[0];
    if(!c0)continue;
    const author=clean(meta.Artist?.value||meta.Credit?.value||'',140),lic=clean(meta.LicenseShortName?.value||meta.License?.value||'',100);
    if(lic&&!/CC|public domain|PD/i.test(lic))continue;
    const c=candidateBase('wikimedia',page.pageid,[c0.lon,c0.lat],info.thumburl||info.url,info.descriptionurl,{
      captured_at:meta.DateTimeOriginal?.value||meta.DateTime?.value||null,license:lic||'Wikimedia Commons',
      attribution:author?'Wikimedia Commons · '+author:'Wikimedia Commons contributors'
    });if(c)out.push(c);
  }
  return out;
}

function candidateScore(c,marker){
  const d=haversine(c.coordinates,[Number(marker.lon),Number(marker.lat)]);
  const street=STREET_SOURCES.has(c.source)?1:0;
  return sourceWeight(c.source)*100 + street*15 + (c.heading!==null?9:0) + (c.panoramic?4:0) - Math.min(60,d*.16);
}
function diversify(candidates,marker,max){
  const sorted=[...candidates].sort((a,b)=>candidateScore(b,marker)-candidateScore(a,marker));
  const out=[],ids=new Set(),bins=new Set(),perSource={};
  for(const c of sorted){
    const key=c.source+':'+c.id;if(ids.has(key))continue;
    const dir=bearing([Number(marker.lon),Number(marker.lat)],c.coordinates),bin=Math.floor(((dir+22.5)%360)/45);
    const limit=c.source==='wikimedia'?2:Math.max(3,Math.ceil(max*.65));
    if((perSource[c.source]||0)>=limit&&out.length>=Math.ceil(max*.6))continue;
    if(bins.has(bin)&&out.length>=Math.ceil(max*.55)&&c.source==='wikimedia')continue;
    ids.add(key);bins.add(bin);perSource[c.source]=(perSource[c.source]||0)+1;out.push(c);
    if(out.length>=max)break;
  }
  return out;
}

function peaks(values,minGap=10){
  if(!values.length)return[];
  const mean=values.reduce((a,b)=>a+b,0)/values.length,variance=values.reduce((s,v)=>s+(v-mean)**2,0)/values.length,sd=Math.sqrt(variance);
  const raw=[];for(let i=2;i<values.length-2;i++)if(values[i]>mean+sd*.65&&values[i]>=values[i-1]&&values[i]>=values[i+1])raw.push(i);
  const out=[];for(const i of raw.sort((a,b)=>values[b]-values[a]))if(out.every(x=>Math.abs(x-i)>=minGap))out.push(i);
  return out.sort((a,b)=>a-b);
}
function mixColors(list,fallback){
  const vals=list.map(x=>({c:hexRgb(x.color),w:Number(x.weight)||1})).filter(x=>x.c);if(!vals.length)return fallback;
  let r=0,g=0,b=0,w=0;for(const x of vals){r+=x.c[0]*x.w;g+=x.c[1]*x.w;b+=x.c[2]*x.w;w+=x.w}return rgbHex(r/w,g/w,b/w);
}

async function analyzeImage(buffer){
  const sharp=require('sharp');
  const {data,info}=await sharp(buffer,{limitInputPixels:32000000}).rotate().resize({width:384,height:288,fit:'inside',withoutEnlargement:true}).removeAlpha().raw().toBuffer({resolveWithObject:true});
  const w=info.width,h=info.height,ch=info.channels;if(w<64||h<48||ch<3)throw new Error('open_world_image_too_small');
  const lum=new Float32Array(w*h),cols=new Float32Array(w),rows=new Float32Array(h),hist=new Map();
  let used=0,dark=0,lowerDark=0,lowerN=0,rg=0,gb=0,variance=0,mean=0;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const i=(y*w+x)*ch,r=data[i],g=data[i+1],b=data[i+2],l=.2126*r+.7152*g+.0722*b;lum[y*w+x]=l;
    if(x<Math.max(5,w*.05)||x>w*.95||y<h*.12||y>h*.96)continue;
    const sky=y<h*.58&&b>r*1.08&&b>g*1.04&&b>105,veg=g>r*1.14&&g>b*1.08&&g>70;
    if(sky||veg||l<24||l>246)continue;
    used++;mean+=l;rg+=r-g;gb+=g-b;if(l<68)dark++;
    if(y>h*.68){lowerN++;if(l<78)lowerDark++}
    const key=((r>>4)<<8)|((g>>4)<<4)|(b>>4);const v=hist.get(key)||{n:0,r:0,g:0,b:0};v.n++;v.r+=r;v.g+=g;v.b+=b;hist.set(key,v);
  }
  if(!used)throw new Error('open_world_image_no_signal');
  mean/=used;
  let edgeSum=0;
  for(let y=1;y<h;y++)for(let x=1;x<w;x++){
    const i=y*w+x,gx=Math.abs(lum[i]-lum[i-1]),gy=Math.abs(lum[i]-lum[i-w]);cols[x]+=gx;rows[y]+=gy;edgeSum+=gx+gy;
  }
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const d=lum[y*w+x]-mean;variance+=d*d}
  variance=Math.sqrt(variance/(w*h))/255;
  const cp=peaks([...cols],Math.max(8,Math.round(w*.055))),rp=peaks([...rows],Math.max(7,Math.round(h*.045)));
  const top=[...hist.values()].sort((a,b)=>b.n-a.n).slice(0,7),dominant=top[0]||{n:1,r:190,g:190,b:185};
  const wall=rgbHex(dominant.r/dominant.n,dominant.g/dominant.n,dominant.b/dominant.n);
  const accent=top[1]?rgbHex(top[1].r/top[1].n,top[1].g/top[1].n,top[1].b/top[1].n):shade(wall,-22);
  const avgRG=rg/used,avgGB=gb/used,edge=edgeSum/(w*h*255),cool=avgGB<0&&avgRG<8;
  let material='stucco';
  if(cool&&mean<175&&dark/used>.12)material='glass';
  else if(avgRG>13&&avgGB>8&&edge>.11)material='brick';
  else if(edge>.14&&cp.length>=3)material='panel';
  else if(variance>.22)material='stone';
  const storefront=lowerN?lowerDark/lowerN:0,balcony=clamp((rows.slice(Math.round(h*.22),Math.round(h*.7)).reduce((a,b)=>a+b,0)/(edgeSum||1))*1.8,0,1);
  const structure=clamp((cp.length/7+rp.length/10)*.45+Math.min(1,edge/.16)*.35,0,1);
  const valid=used/(w*h*.78),likelihood=clamp(valid*.35+structure*.5+(STREET_SOURCES?0:.0)+.15,0,1);
  return {
    width:w,height:h,wall,accent,windows:mean<130?'#2b353b':'#36434a',material,
    row_peaks:clamp(rp.length,2,24),col_peaks:clamp(cp.length,2,16),
    storefront_score:Number(storefront.toFixed(3)),balcony_score:Number(balcony.toFixed(3)),
    texture_variance:Number(variance.toFixed(3)),edge_density:Number(edge.toFixed(3)),
    facade_likelihood:Number(likelihood.toFixed(3))
  };
}

function nearestAssignment(candidate,analysis,scene){
  let best=null;
  for(const b of scene.buildings||[]){
    const c=centroid(b.ring);if(!c)continue;
    const nearest=S.nearestEdge(b.ring,candidate.coordinates);if(!nearest||nearest.distance>75)continue;
    const look=bearing(candidate.coordinates,c),headingPenalty=candidate.heading===null?18:angleDiff(candidate.heading,look);
    if(candidate.heading!==null&&headingPenalty>105)continue;
    const roleBonus=b.role==='hero'?7:b.role==='nearby'?3:0;
    const score=nearest.distance+headingPenalty*.32-roleBonus;
    if(!best||score<best.score)best={building:b,edge:nearest,score,distance:nearest.distance,heading_error:headingPenalty};
  }
  if(!best)return null;
  const distanceQuality=clamp(1-best.distance/80,.15,1),headingQuality=candidate.heading===null?.62:clamp(1-best.heading_error/110,.12,1);
  const quality=clamp(analysis.facade_likelihood*distanceQuality*headingQuality*sourceWeight(candidate.source),0,1);
  return {...best,quality};
}

function modulesForFacade(building,edge,obs,edgeIndex){
  const height=Math.max(3,Number(building.height)||9),base=Math.max(0,Number(building.base_m)||0),levels=clamp(Math.round(Number(building.levels)||height/3.05),1,40);
  const available=Math.max(2,height-base),floorH=available/levels,analysis=obs?.analysis||{};
  const style=analysis.material||String(building.style||'panel_simple').split('_')[0]||'panel';
  const wall=obs?analysis.wall:(building.palette?.wall||'#c6c2b8'),windows=analysis.windows||building.palette?.windows||'#344249';
  const finish=style==='brick'?'brick':style==='glass'?'metal':style==='stone'?'stone':'panel';
  const frame=finish==='brick'?'#d0c1b4':'#c7c9c4',mods=[],len=edge.length;
  const cols=clamp(Math.round(obs?.analysis?.col_peaks||len/3.2),1,Math.min(18,Math.max(1,Math.floor(len/1.6))));
  const spacing=len/(cols+1),ww=clamp(spacing*.48,.62,1.55),wh=clamp(floorH*.48,.86,1.65);
  const storefront=(analysis.storefront_score||0)>.23||building.role==='hero';
  if(storefront&&len>4.5){
    const entranceW=clamp(len*.11,.95,1.55),entranceU=clamp(len*.52-entranceW/2,.25,len-entranceW-.25),groundH=Math.min(3.25,available*.85);
    mods.push({kind:'entrance',u_m:entranceU,z_m:base,width_m:entranceW,height_m:groundH,depth_m:.13,lod:0,frame_m:.075,panes:1,color:windows,frame_color:'#595e5f'});
    const left=Math.max(.4,entranceU-.35),right=Math.max(.4,len-entranceU-entranceW-.35);
    if(left>1.4)mods.push({kind:'storefront',u_m:.25,z_m:base+.22,width_m:left-.25,height_m:Math.max(1.8,groundH-.42),depth_m:.09,lod:building.role==='hero'?0:1,frame_m:.07,panes:Math.max(1,Math.round(left/1.8)),color:windows,frame_color:'#555b5c'});
    if(right>1.4)mods.push({kind:'storefront',u_m:entranceU+entranceW+.35,z_m:base+.22,width_m:right-.25,height_m:Math.max(1.8,groundH-.42),depth_m:.09,lod:building.role==='hero'?0:1,frame_m:.07,panes:Math.max(1,Math.round(right/1.8)),color:windows,frame_color:'#555b5c'});
  }
  const startFloor=storefront?1:0,maxRows=building.role==='hero'?Math.min(levels,18):building.role==='nearby'?Math.min(levels,13):Math.min(levels,9);
  for(let row=startFloor;row<maxRows;row++){
    const z=base+row*floorH+(floorH-wh)*.5;
    for(let col=0;col<cols;col++){
      const u=spacing*(col+1)-ww/2;if(u<.12||u+ww>len-.12)continue;
      const balcony=(analysis.balcony_score||0)>.45&&row>0&&((col+row+edgeIndex)%3===0);
      if(balcony){
        mods.push({kind:'balcony',u_m:Math.max(.05,u-.12),z_m:Math.max(base,z-.12),width_m:Math.min(len-u+.12,ww+.24),height_m:Math.min(1.25,wh*.82),depth_m:.62,lod:building.role==='hero'?0:1,frame_m:.055,panes:2,glazed:(analysis.balcony_score||0)>.68,color:windows,frame_color:'#777c7c'});
      }else{
        mods.push({kind:'window',u_m:u,z_m:z,width_m:ww,height_m:wh,depth_m:.11,lod:building.role==='hero'?0:1,frame_m:.07,panes:ww>1.2?2:1,color:windows,frame_color:frame});
      }
      if(mods.length>420)break;
    }
    if(mods.length>420)break;
  }
  return {wall:{color:wall,finish,module_m:finish==='brick'?.24:finish==='panel'?3.05:.65,joint_color:shade(wall,-18)},modules:mods};
}
function bestObservation(list,buildingId,edgeIndex){
  return list.filter(o=>o.building_id===String(buildingId)&&o.edge_index===edgeIndex).sort((a,b)=>b.quality-a.quality)[0]||null;
}
function compileModel(marker,scene,observations,references){
  const point=[Number(marker.lon),Number(marker.lat)],selected=(scene.buildings||[]).filter(b=>b.role==='hero'||b.role==='nearby'||Number(b.distance)<115).slice(0,22);
  if(!selected.length)return null;
  const buildings=[],refUsed=new Set();let observedEdges=0,totalEdges=0;
  for(const b of selected){
    const edges=S.edges(b.ring,point),facades=[];
    for(const e of edges){
      totalEdges++;const obs=bestObservation(observations,b.id,e.index);if(obs){observedEdges++;refUsed.add(obs.reference_id)}
      const parts=modulesForFacade(b,e,obs,e.index);
      facades.push({
        edge_index:e.index,edge:e.coordinates,evidence:obs?'observed':'inferred',
        reference_ids:obs?[obs.reference_id]:[],wall:parts.wall,material_id:null,surfaces:[],modules:parts.modules
      });
    }
    const observed=observations.filter(o=>o.building_id===String(b.id));
    const roof=observed.length?mixColors(observed.map(o=>({color:o.analysis.accent,weight:o.quality})),b.palette?.roof||'#aaa8a0'):(b.palette?.roof||'#aaa8a0');
    buildings.push({building_id:String(b.id),geometry_key:S.geometryKey(b.ring),height_m:Number(b.height)||9,base_m:Number(b.base_m)||0,role:b.role,roof:{color:roof,parapet_m:b.role==='hero'?.28:.12},facades});
  }
  const hero=selected.find(b=>String(b.id)===String(scene.hero_building_id))||selected[0],front=S.nearestEdge(hero.ring,point),camBearing=front?(front.bearing+180)%360:-20;
  const refs=references.filter(r=>refUsed.has(r.id)).map(r=>({...r}));
  const observedBuildings=new Set(observations.filter(o=>o.quality>=.12).map(o=>o.building_id)).size;
  const ratio=totalEdges?observedEdges/totalEdges:0;
  const trees=(scene.trees||[]).slice(0,72).map((t,i)=>({coordinates:[Number(t.lon),Number(t.lat)],height_m:5.8+(i%5)*.7,radius_m:2.1+(i%4)*.35,color:['#617f58','#567652','#6c875e'][i%3],evidence:t.source==='osm'?'observed':'inferred',reference_ids:[]}));
  const roads=(scene.roads||[]).slice(0,42).map((coordinates,i)=>({coordinates,class:i<4?'minor':'service'}));
  return {
    version:2,status:'ready',engine:ENGINE,target:{marker_id:String(marker.id),establishment_id:marker.establishment_id,venue_id:marker.venue_id,coordinates:point},
    generated_at:new Date().toISOString(),buildings,materials:[],
    camera:{bearing:camBearing,pitch:64,zoom:18.55,views:[
      {label:'Фасад',bearing:camBearing,pitch:64,zoom:18.65},
      {label:'Слева',bearing:(camBearing-38+360)%360,pitch:62,zoom:18.45},
      {label:'Справа',bearing:(camBearing+38)%360,pitch:62,zoom:18.45}
    ]},
    environment:{trees,fences:[],lamps:[],roads,greens:(scene.greens||[]).slice(0,30),placement_note:'Open-world environment constrained to map/OSM geometry.'},
    references:refs,coverage:{observed_edges:observedEdges,total_edges:totalEdges,observed_buildings:observedBuildings,buildings:buildings.length,ratio:Number(ratio.toFixed(3))},
    reconstruction:{mode:observedEdges?'open_imagery_semantic_facades':'constrained_generated_facades',photogrammetry:'worker_not_configured',raw_images_persisted:false}
  };
}

let activeImages=0;const waiters=[];
async function imageSlot(fn){
  while(activeImages>=4)await new Promise(r=>waiters.push(r));activeImages++;
  try{return await fn()}finally{activeImages--;waiters.shift()?.()}
}
async function collectCandidates(marker){
  const tasks=[collectPanoramax(marker),collectKartaView(marker),collectWikimedia(marker),collectMapillary(marker)];
  const done=await Promise.allSettled(tasks),all=[];for(const r of done)if(r.status==='fulfilled')all.push(...r.value);
  return all;
}
function referenceOf(c,analysis,assignment){
  return {
    id:c.source+':'+c.id,source:c.source,source_id:c.id,page_url:c.page_url,license:c.license,attribution:c.attribution,
    captured_at:c.captured_at,coordinates:c.coordinates,heading:c.heading,sequence_id:c.sequence_id,
    derived:{facade_likelihood:analysis.facade_likelihood,material:analysis.material,wall:analysis.wall,edge_density:analysis.edge_density},
    match:{building_id:String(assignment.building.id),edge_index:assignment.edge.index,distance_m:Number(assignment.distance.toFixed(1)),heading_error_deg:Number(assignment.heading_error.toFixed(1)),quality:Number(assignment.quality.toFixed(3))}
  };
}
async function reconstruct(marker,scene){
  if(config.REALCITY_OPEN_WORLD_ENABLED===false||!Array.isArray(scene?.buildings)||!scene.buildings.length)return null;
  const max=clamp(Number(config.REALCITY_OPEN_WORLD_MAX_IMAGES)||10,2,18),candidates=diversify(await collectCandidates(marker),marker,max);
  const observations=[],references=[];
  const jobs=candidates.map(c=>imageSlot(async()=>{
    try{
      const buffer=await fetchImage(c.image_url),analysis=await analyzeImage(buffer);
      const min=c.source==='wikimedia'?.38:.16;if(analysis.facade_likelihood<min)return;
      const assignment=nearestAssignment(c,analysis,scene);if(!assignment||assignment.quality<.08)return;
      const ref=referenceOf(c,analysis,assignment);references.push(ref);
      observations.push({reference_id:ref.id,building_id:String(assignment.building.id),edge_index:assignment.edge.index,quality:assignment.quality,analysis});
    }catch{}
  }));
  await Promise.allSettled(jobs);
  const model=compileModel(marker,scene,observations,references);if(!model)return null;
  const observed=model.coverage.observed_edges,quality=observed>=5?'open-observed':observed?'open-partial':'generated-constrained';
  const confidence=Number(clamp(.48+model.coverage.ratio*.34+(model.coverage.observed_buildings>1?.08:0),.45,.9).toFixed(2));
  return {
    model,quality,confidence,
    report:{engine:ENGINE,candidates:candidates.length,images_analyzed:observations.length,references_persisted:references.length,raw_images_persisted:false,sources:[...new Set(candidates.map(c=>c.source))],mapillary_configured:!!config.MAPILLARY_ACCESS_TOKEN}
  };
}

module.exports={
  ENGINE,reconstruct,collectCandidates,analyzeImage,nearestAssignment,compileModel,
  _internals:{bbox,bearing,haversine,diversify,modulesForFacade,licenseFromConfig}
};
