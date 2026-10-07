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
const crypto=require('crypto');
const sharp=require('sharp');
const S=require('../../frontend/realcity-spatial');

const ENGINE='open-world-v1';
const KARTAVIEW_API='https://api.openstreetcam.org';
const MAX_IMAGE_BYTES=7*1024*1024;
const MAX_TEXTURES=6;
const STREET_SOURCES=new Set(['panoramax','kartaview','mapillary']);
const SOURCE_WEIGHT={panoramax:1,kartaview:.92,mapillary:.96,wikimedia:.58};
const ALLOWED_LICENSE_HINTS=['CC BY-SA 4.0','CC-BY-SA-4.0','CC BY-SA','CC BY 4.0','CC-BY-4.0','CC BY 3.0','CC-BY-3.0','Public domain','PD','Licence Ouverte 2.0','etalab-2.0','ODbL'];

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
function licenseUrlFor(value){const v=String(value||'').toLowerCase();if(v.includes('cc by-sa')||v.includes('cc-by-sa'))return 'https://creativecommons.org/licenses/by-sa/4.0/';if(v.includes('licence ouverte')||v.includes('etalab'))return 'https://www.etalab.gouv.fr/licence-ouverte-open-licence/';if(v.includes('odbl'))return 'https://opendatacommons.org/licenses/odbl/1-0/';return null}
function canPersistAdaptation(candidate){
  if(candidate.source==='kartaview')return true;
  if(!['panoramax','wikimedia'].includes(candidate.source))return false;
  const license=String(candidate.license||'').toLowerCase();
  return ALLOWED_LICENSE_HINTS.some(x=>license.includes(x.toLowerCase()));
}

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
async function fetchJson(url,{method='GET',body=null,form=null,timeout=5000,headers={}}={}){
  const safe=safeUrl(url);if(!safe)throw new Error('unsafe_open_world_url');
  const ac=new AbortController(),timer=setTimeout(()=>ac.abort(),timeout);
  const payload=form?new URLSearchParams(form):body?JSON.stringify(body):undefined;
  const contentType=form?'application/x-www-form-urlencoded;charset=UTF-8':body?'application/json':null;
  try{
    const r=await fetch(safe,{method,headers:{'Accept':'application/json','User-Agent':'Shaurmeg-RealCity-OpenWorld/1.0',...(contentType?{'Content-Type':contentType}:{}),...headers},body:payload,signal:ac.signal,redirect:'follow'});
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

async function fetchCandidateImage(candidate,timeout=6500){
  let last=null;
  const urls=[candidate?.image_url,candidate?.fallback_image_url].filter((u,i,a)=>u&&a.indexOf(u)===i);
  for(const url of urls){
    try{return await fetchImage(url,timeout)}
    catch(e){last=e}
  }
  throw last||new Error('open_world_image_missing');
}

function candidateBase(source,id,coords,imageUrl,pageUrl,extra={}){
  if(!Array.isArray(coords)||coords.length<2||!finite(coords[0])||!finite(coords[1]))return null;
  const image=safeUrl(imageUrl),page=safeUrl(pageUrl),fallbackImage=safeUrl(extra.fallback_image_url);
  if(!image)return null;
  return {
    source,id:clean(id,120),coordinates:[Number(coords[0]),Number(coords[1])],
    image_url:image,fallback_image_url:fallbackImage&&fallbackImage!==image?fallbackImage:null,page_url:page||null,heading:finite(extra.heading)?((Number(extra.heading)%360)+360)%360:null,
    captured_at:extra.captured_at||null,license:clean(extra.license,100)||null,license_url:safeUrl(extra.license_url)||licenseUrlFor(extra.license),
    attribution:clean(extra.attribution,300)||source,sequence_id:clean(extra.sequence_id,120)||null,
    panoramic:extra.panoramic===true,fov:finite(extra.fov)?clamp(Number(extra.fov),25,360):(extra.panoramic===true?360:78)
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
  const box=bbox(marker,520),out=[],seen=new Set();
  await Promise.allSettled([...new Set(roots)].map(async root=>{
    let cfg={};try{cfg=await fetchJson(root+'/configuration',{timeout:3500})}catch{}
    let j;
    const query=root+'/search?bbox='+box.join(',')+'&limit=160';
    try{j=await fetchJson(query,{timeout:5000})}
    catch{j=await fetchJson(root+'/search',{method:'POST',body:{bbox:box,limit:160},timeout:5000})}
    for(const item of j?.features||[]){
      const id=String(item.id||'');if(!id||seen.has(id))continue;
      const p=item.properties||{},coords=item.geometry?.type==='Point'?item.geometry.coordinates:null,url=firstImageAsset(item);
      const fov=Number(p['pers:interior_orientation']?.field_of_view)||Number(p.field_of_view)||78;
      const itemLicense=clean(p.license||'',100)||licenseFromConfig(cfg);
      if(p.license&&!/cc[-\s]?by|licen[cs]e ouverte|etalab|odbl|public domain/i.test(String(p.license)))continue;
      const page=(item.links||[]).find(l=>['alternate','self'].includes(String(l.rel||''))&&safeUrl(l.href))?.href||root+'/pictures/'+encodeURIComponent(id);
      const c=candidateBase('panoramax',id,coords,url,page,{
        heading:p['view:azimuth']??p['exif:GPSImgDirection']??p.compass_angle??p.heading,
        captured_at:p.datetime||p.datetimetz||null,license:itemLicense,license_url:licenseUrlFor(itemLicense),
        attribution:producer(item)?'Panoramax · '+producer(item):'Panoramax contributors',
        sequence_id:item.collection||p.collection,panoramic:fov>=300,fov
      });
      if(c){seen.add(id);out.push(c)}
    }
  }));
  return out;
}

function deepObjects(value,out=[]){
  if(!value||typeof value!=='object')return out;
  if(Array.isArray(value)){for(const v of value)deepObjects(v,out);return out}
  out.push(value);for(const v of Object.values(value))if(v&&typeof v==='object')deepObjects(v,out);return out;
}
function kartaImage(row){
  for(const k of ['fileurlProc','fileurlLTh','procUrl','imageProcUrl','thumbUrl','thumbnailUrl','image_url','url','lth_name','name','fileName','filepath','path']){
    const raw=String(row?.[k]||'').trim();if(!raw)continue;
    const direct=safeUrl(raw);if(direct)return direct;
    if(/^http:\/\//i.test(raw)){const https=safeUrl(raw.replace(/^http:/i,'https:'));if(https)return https}
    if(!/^[a-z]+:/i.test(raw)){const joined=safeUrl(KARTAVIEW_API+'/'+raw.replace(/^\/+/,''));if(joined)return joined}
  }
  return null;
}
async function collectKartaView(marker){
  let j;
  try{
    j=await fetchJson(KARTAVIEW_API+'/1.0/list/nearby-photos/',{
      method:'POST',form:{lat:String(marker.lat),lng:String(marker.lon),radius:'520',ipp:'300',page:'1'},timeout:6000
    });
  }catch{return[]}
  const apiCode=Number(j?.status?.apiCode);if(apiCode&&apiCode!==600)return[];
  const out=[],seen=new Set();
  for(const row of deepObjects(j)){
    const coords=[num(row.lng??row.lon??row.longitude),num(row.lat??row.latitude)],image=kartaImage(row);
    if(!finite(coords[0])||!finite(coords[1])||!image)continue;
    const id=row.id??row.photoId??row.photo_id??((row.sequenceId??row.sequence_id)+'-'+(row.sequenceIndex??row.sequence_index));
    const key=String(id||image);if(seen.has(key))continue;seen.add(key);
    const fov=Number(row.fieldOfView??row.fov??row.hFoV)||78;
    const c=candidateBase('kartaview',key,coords,image,'https://kartaview.org/map/@'+coords[1]+','+coords[0]+',18z',{
      heading:row.heading??row.compass??row.cameraHeading??row.direction,
      captured_at:row.date_added??row.dateAdded??row.createdAt??row.timestamp??null,
      license:'CC BY-SA 4.0',license_url:'https://creativecommons.org/licenses/by-sa/4.0/',attribution:'© Grab and KartaView Contributors',
      sequence_id:row.sequenceId??row.sequence_id,panoramic:fov>=300,fov
    });if(c)out.push(c);
    if(out.length>=160)break;
  }
  return out;
}

async function collectMapillary(marker){
  const token=String(config.MAPILLARY_ACCESS_TOKEN||'').trim();if(!token)return[];
  const box=bbox(marker,420);
  const u=new URL('https://graph.mapillary.com/images');
  u.searchParams.set('bbox',box.join(','));u.searchParams.set('limit','200');
  u.searchParams.set('fields','id,computed_geometry,thumb_2048_url,thumb_1024_url,captured_at,compass_angle,creator,is_pano');
  let j;try{j=await fetchJson(u.toString(),{timeout:5500,headers:{Authorization:'OAuth '+token}})}catch{return[]}
  const out=[];
  for(const row of j?.data||[]){
    const coords=row.computed_geometry?.coordinates,author=clean(row.creator?.username||row.creator?.name||'',100);
    const c=candidateBase('mapillary',row.id,coords,row.thumb_2048_url||row.thumb_1024_url,'https://www.mapillary.com/app/?pKey='+encodeURIComponent(row.id),{
      heading:row.compass_angle,captured_at:row.captured_at?new Date(Number(row.captured_at)).toISOString():null,
      license:'CC BY-SA (Mapillary imagery; Developer Terms also apply)',license_url:'https://www.mapillary.com/terms',
      attribution:author?'© Mapillary · '+author:'© Mapillary',panoramic:row.is_pano===true,fov:row.is_pano===true?360:78
    });if(c)out.push(c);
  }
  return out;
}

async function collectWikimedia(marker){
  const u=new URL('https://commons.wikimedia.org/w/api.php');
  const params={action:'query',format:'json',origin:'*',generator:'geosearch',ggsprimary:'all',ggsnamespace:'6',ggsradius:'650',ggscoord:marker.lat+'|'+marker.lon,ggslimit:'120',prop:'imageinfo|coordinates',iiprop:'url|extmetadata',iiurlwidth:'1600'};
  for(const [k,v] of Object.entries(params))u.searchParams.set(k,String(v));
  let j;try{j=await fetchJson(u.toString(),{timeout:5500})}catch{return[]}
  const out=[];
  for(const page of Object.values(j?.query?.pages||{})){
    const info=page.imageinfo?.[0]||{},meta=info.extmetadata||{},c0=page.coordinates?.[0];
    if(!c0)continue;
    const author=clean(meta.Artist?.value||meta.Credit?.value||'',140),lic=clean(meta.LicenseShortName?.value||meta.License?.value||'',100);
    if(lic&&!/CC|public domain|PD/i.test(lic))continue;
    const c=candidateBase('wikimedia',page.pageid,[c0.lon,c0.lat],info.thumburl||info.url,info.descriptionurl,{
      fallback_image_url:info.url||null,
      captured_at:meta.DateTimeOriginal?.value||meta.DateTime?.value||null,license:lic||'Wikimedia Commons',license_url:meta.LicenseUrl?.value||licenseUrlFor(lic),
      attribution:author?'Wikimedia Commons · '+author:'Wikimedia Commons contributors'
    });if(c)out.push(c);
  }
  return out;
}

function wikimediaReferenceApiUrl(refs=[]){
  const ids=[...new Set((refs||[]).filter(r=>String(r?.source||'')==='wikimedia').map(r=>String(r?.source_id||'').trim()).filter(x=>/^\d+$/.test(x)))];
  if(!ids.length)return null;
  const u=new URL('https://commons.wikimedia.org/w/api.php');
  const params={action:'query',format:'json',origin:'*',pageids:ids.slice(0,50).join('|'),prop:'imageinfo|coordinates',iiprop:'url|extmetadata',iiurlwidth:'1600'};
  for(const [k,v] of Object.entries(params))u.searchParams.set(k,String(v));
  return u.toString();
}
async function resolveReferences(refs=[]){
  const out=[],wm=(refs||[]).filter(r=>String(r?.source||'')==='wikimedia'),url=wikimediaReferenceApiUrl(wm);
  if(url){
    try{
      const j=await fetchJson(url,{timeout:5500});
      const byId=new Map(wm.map(r=>[String(r.source_id),r]));
      for(const page of Object.values(j?.query?.pages||{})){
        const ref=byId.get(String(page.pageid));if(!ref)continue;
        const info=page.imageinfo?.[0]||{},meta=info.extmetadata||{},c0=page.coordinates?.[0];
        const coords=c0?[Number(c0.lon),Number(c0.lat)]:ref.coordinates;
        const lic=clean(meta.LicenseShortName?.value||meta.License?.value||ref.license||'',100);
        if(lic&&!/CC|public domain|PD/i.test(lic))continue;
        const author=clean(meta.Artist?.value||meta.Credit?.value||ref.attribution||'',140);
        const candidate=candidateBase('wikimedia',page.pageid,coords,info.thumburl||info.url,info.descriptionurl||ref.page_url,{
          fallback_image_url:info.url||null,
          heading:ref.heading,captured_at:meta.DateTimeOriginal?.value||meta.DateTime?.value||ref.captured_at||null,
          license:lic||ref.license||'Wikimedia Commons',license_url:meta.LicenseUrl?.value||ref.license_url||licenseUrlFor(lic),
          attribution:author?'Wikimedia Commons · '+author:(ref.attribution||'Wikimedia Commons contributors'),
          panoramic:false,fov:78
        });
        if(candidate&&canPersistAdaptation(candidate))out.push({...candidate,persisted_reference:true,persisted_match:ref.match||null});
      }
    }catch{}
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
  const valid=used/(w*h*.78),likelihood=clamp(valid*.35+structure*.5+.15,0,1);
  return {
    width:w,height:h,wall,accent,windows:mean<130?'#2b353b':'#36434a',material,
    row_peaks:clamp(rp.length,2,24),col_peaks:clamp(cp.length,2,16),
    storefront_score:Number(storefront.toFixed(3)),balcony_score:Number(balcony.toFixed(3)),
    texture_variance:Number(variance.toFixed(3)),edge_density:Number(edge.toFixed(3)),
    facade_likelihood:Number(likelihood.toFixed(3))
  };
}

async function buildFacadeMaterial(buffer,candidate,assignment,referenceId){
  if(config.REALCITY_OPEN_WORLD_TEXTURES===false||!canPersistAdaptation(candidate))return null;
  const maxHeading=candidate.heading===null?28:34;
  if(assignment.heading_error>maxHeading||assignment.distance<3||assignment.distance>70)return null;
  const base=await sharp(buffer,{limitInputPixels:32000000}).rotate().jpeg({quality:92}).toBuffer();
  const meta=await sharp(base).metadata(),w=Number(meta.width),h=Number(meta.height);if(!w||!h||w<256||h<160)return null;
  const a=assignment.edge.coordinates?.[0],b=assignment.edge.coordinates?.[1];if(!a||!b)return null;
  const mid=[(a[0]+b[0])/2,(a[1]+b[1])/2],target=bearing(candidate.coordinates,mid);
  const heading=candidate.heading===null?target:candidate.heading,delta=((target-heading+540)%360)-180,fov=candidate.panoramic?360:(Number(candidate.fov)||78);
  let center=.5+delta/fov;if(candidate.panoramic)center=((center%1)+1)%1;else center=clamp(center,.08,.92);
  const angular=2*Math.atan((assignment.edge.length/2)/Math.max(2,assignment.distance))*180/Math.PI;
  const ratio=clamp(angular/fov*1.65,candidate.panoramic?.1:.22,candidate.panoramic?.42:.78);
  const cropW=clamp(Math.round(w*ratio),Math.min(w,260),w),cropH=clamp(Math.round(h*(candidate.panoramic?.62:.82)),Math.min(h,220),h);
  const top=clamp(Math.round(h*(candidate.panoramic?.19:.07)),0,h-cropH);
  let source;
  if(candidate.panoramic){
    const doubled=await sharp({create:{width:w*2,height:h,channels:3,background:'#000'}}).composite([{input:base,left:0,top:0},{input:base,left:w,top:0}]).jpeg({quality:91}).toBuffer();
    const left=((Math.round(center*w-cropW/2)%w)+w)%w;source=sharp(doubled).extract({left,top,width:cropW,height:cropH});
  }else{
    const left=clamp(Math.round(center*w-cropW/2),0,w-cropW);source=sharp(base).extract({left,top,width:cropW,height:cropH});
  }
  const facadeHeight=Math.max(3,Number(assignment.building.height)||9)-Math.max(0,Number(assignment.building.base_m)||0);
  const outW=640,outH=clamp(Math.round(outW*facadeHeight/Math.max(3,assignment.edge.length)),300,960);
  const data=await source.resize({width:outW,height:outH,fit:'fill'}).sharpen(.38).webp({quality:74,effort:4}).toBuffer();
  const id='ow_'+crypto.createHash('sha1').update(referenceId+':'+assignment.building.id+':'+assignment.edge.index).digest('hex').slice(0,14);
  return {id,mode:'facade',data_url:'data:image/webp;base64,'+data.toString('base64'),width:outW,height:outH,roughness:.9,metalness:0,lighting_mix:.18,source_asset_ids:[referenceId],license:candidate.license,license_url:candidate.license_url,attribution:candidate.attribution,adapted:true,changes:'cropped to matched facade view, resized, sharpened and encoded as WebP'};
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
  const buildings=[],refUsed=new Set(),materialMap=new Map();let observedEdges=0,totalEdges=0;
  for(const b of selected){
    const edges=S.edges(b.ring,point),facades=[];
    for(const e of edges){
      totalEdges++;const obs=bestObservation(observations,b.id,e.index);if(obs){observedEdges++;refUsed.add(obs.reference_id)}
      const parts=modulesForFacade(b,e,obs,e.index);if(obs?.material_id)parts.modules=[];
      if(obs?.material)materialMap.set(obs.material.id,obs.material);
      facades.push({
        edge_index:e.index,edge:e.coordinates,evidence:obs?'observed':'inferred',
        reference_ids:obs?[obs.reference_id]:[],wall:parts.wall,material_id:obs?.material_id||null,surfaces:[],modules:parts.modules
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
    generated_at:new Date().toISOString(),buildings,materials:[...materialMap.values()],
    camera:{bearing:camBearing,pitch:64,zoom:18.55,views:[
      {label:'Фасад',bearing:camBearing,pitch:64,zoom:18.65},
      {label:'Слева',bearing:(camBearing-38+360)%360,pitch:62,zoom:18.45},
      {label:'Справа',bearing:(camBearing+38)%360,pitch:62,zoom:18.45}
    ]},
    environment:{trees,fences:[],lamps:[],roads,greens:(scene.greens||[]).slice(0,30),placement_note:'Open-world environment constrained to map/OSM geometry.'},
    references:refs,coverage:{observed_edges:observedEdges,total_edges:totalEdges,observed_buildings:observedBuildings,buildings:buildings.length,ratio:Number(ratio.toFixed(3))},
    reconstruction:{mode:materialMap.size?'open_imagery_textured_facades':observedEdges?'open_imagery_semantic_facades':'constrained_generated_facades',photogrammetry:'worker_not_configured',raw_images_persisted:false,derived_textures:materialMap.size}
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
    id:c.source+':'+c.id,source:c.source,source_id:c.id,page_url:c.page_url,license:c.license,license_url:c.license_url,attribution:c.attribution,
    captured_at:c.captured_at,coordinates:c.coordinates,heading:c.heading,sequence_id:c.sequence_id,
    derived:{facade_likelihood:analysis.facade_likelihood,material:analysis.material,wall:analysis.wall,edge_density:analysis.edge_density},
    match:{building_id:String(assignment.building.id),edge_index:assignment.edge.index,distance_m:Number(assignment.distance.toFixed(1)),heading_error_deg:Number(assignment.heading_error.toFixed(1)),quality:Number(assignment.quality.toFixed(3))}
  };
}
async function reconstruct(marker,scene){
  if(config.REALCITY_OPEN_WORLD_ENABLED===false||!Array.isArray(scene?.buildings)||!scene.buildings.length)return null;
  const max=clamp(Number(config.REALCITY_OPEN_WORLD_MAX_IMAGES)||10,2,18),candidates=diversify(await collectCandidates(marker),marker,max);
  const observations=[],references=[];let textureBudget=MAX_TEXTURES;
  const jobs=candidates.map(c=>imageSlot(async()=>{
    try{
      const buffer=await fetchCandidateImage(c),analysis=await analyzeImage(buffer);
      const min=c.source==='wikimedia'?.38:.16;if(analysis.facade_likelihood<min)return;
      const assignment=nearestAssignment(c,analysis,scene);if(!assignment||assignment.quality<.08)return;
      const ref=referenceOf(c,analysis,assignment);references.push(ref);
      let material=null;
      const textureThreshold=c.source==='wikimedia'?.18:.13;
      if(textureBudget>0&&assignment.quality>=textureThreshold&&canPersistAdaptation(c)){textureBudget--;try{material=await buildFacadeMaterial(buffer,c,assignment,ref.id)}catch{}}
      observations.push({reference_id:ref.id,building_id:String(assignment.building.id),edge_index:assignment.edge.index,quality:assignment.quality,analysis,material_id:material?.id||null,material});
    }catch{}
  }));
  await Promise.allSettled(jobs);
  const model=compileModel(marker,scene,observations,references);if(!model)return null;
  const observed=model.coverage.observed_edges,quality=observed>=5?'open-observed':observed?'open-partial':'generated-constrained';
  const confidence=Number(clamp(.48+model.coverage.ratio*.34+(model.coverage.observed_buildings>1?.08:0),.45,.9).toFixed(2));
  return {
    model,quality,confidence,
    report:{engine:ENGINE,candidates:candidates.length,images_analyzed:observations.length,references_persisted:references.length,derived_textures:model.materials.length,raw_images_persisted:false,sources:[...new Set(candidates.map(c=>c.source))],mapillary_configured:!!config.MAPILLARY_ACCESS_TOKEN}
  };
}

module.exports={
  ENGINE,reconstruct,collectCandidates,resolveReferences,analyzeImage,nearestAssignment,compileModel,buildFacadeMaterial,
  _internals:{bbox,bearing,haversine,diversify,modulesForFacade,licenseFromConfig,canPersistAdaptation,candidateBase,fetchCandidateImage,wikimediaReferenceApiUrl}
};
