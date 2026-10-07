'use strict';
// Deterministic photo preparation. Geometry/semantic decisions are explicit in
// the recipe; this module never invents unseen walls or depth from brightness.
const sharp=require('sharp');
const crypto=require('crypto');
const exifr=require('exifr');
const {homography}=require('./realcity-material');
const METHOD='photo-facades-v3';
const fail=(message,status=422)=>{throw Object.assign(new Error(message),{status})};
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const finite=(v,min,max,name,fallback)=>{
 const n=v===undefined?fallback:Number(v);if(!Number.isFinite(n)||n<min||n>max)fail('photo_invalid_'+name);return n;
};
function quad(value){
 const h=homography(value);let sign=0;
 for(let i=0;i<4;i++){
  const a=value[i],b=value[(i+1)%4],c=value[(i+2)%4],cross=(b[0]-a[0])*(c[1]-b[1])-(b[1]-a[1])*(c[0]-b[0]);
  if(Math.abs(cross)<1e-6||(sign&&Math.sign(cross)!==sign))fail('photo_quad_must_be_convex');sign=Math.sign(cross);
 }
 for(const [u,v] of [[0,0],[1,0],[1,1],[0,1]])if(h[6]*u+h[7]*v+1<1e-6)fail('photo_invalid_perspective');
 return h;
}
function masks(value=[]){
 if(!Array.isArray(value)||value.length>16)fail('photo_mask_limit');
 return value.map(p=>{
  if(!Array.isArray(p)||p.length<3||p.length>40||p.some(v=>!Array.isArray(v)||v.length!==2||v.some(n=>!Number.isFinite(n)||n<0||n>1)))fail('photo_invalid_mask');return p;
 });
}
function inside([x,y],p){
 let yes=false;for(let i=0,j=p.length-1;i<p.length;j=i++)if((p[i][1]>y)!==(p[j][1]>y)&&x<(p[j][0]-p[i][0])*(y-p[i][1])/(p[j][1]-p[i][1])+p[i][0])yes=!yes;return yes;
}
async function inspect(buffer){
 if(!Buffer.isBuffer(buffer)||!buffer.length||buffer.length>16*1024*1024)fail('photo_file_limit_16mb');
 let meta,sample,preview,exif={},gps=null;
 try{
  [meta,exif,gps]=await Promise.all([
   sharp(buffer,{limitInputPixels:60000000}).metadata(),
   exifr.parse(buffer,['Make','Model','LensModel','FocalLength','FocalLengthIn35mmFormat','GPSImgDirection','GPSImgDirectionRef','DateTimeOriginal','CreateDate']).catch(()=>({})),
   exifr.gps(buffer).catch(()=>null)
  ]);
  exif=exif||{};gps=gps||null;
  if(!['jpeg','png','webp','heif','avif','tiff'].includes(meta.format)||(meta.pages||1)>1)fail('photo_still_image_required');
  sample=await sharp(buffer,{limitInputPixels:60000000}).rotate().resize(512,512,{fit:'inside',withoutEnlargement:true}).removeAlpha().greyscale().raw().toBuffer({resolveWithObject:true});
  preview=await sharp(buffer,{limitInputPixels:60000000}).rotate().resize(1000,1000,{fit:'inside',withoutEnlargement:true}).webp({quality:82}).toBuffer();
 }catch(e){if(e.status)throw e;fail('photo_decode_failed_use_jpeg_or_png');}
 const {data,info}=sample;let sum=0,squares=0,lap=0,clipped=0;
 for(const v of data){sum+=v;squares+=v*v;if(v<=3||v>=252)clipped++;}
 for(let y=1;y<info.height-1;y++)for(let x=1;x<info.width-1;x++){
  const i=y*info.width+x,l=4*data[i]-data[i-1]-data[i+1]-data[i-info.width]-data[i+info.width];lap+=l*l;
 }
 const swapped=[5,6,7,8].includes(meta.orientation),width=swapped?meta.height:meta.width,height=swapped?meta.width:meta.height;
 const contrast=Math.sqrt(Math.max(0,squares/data.length-(sum/data.length)**2)),warnings=[];
 if(Math.max(width,height)<1600)warnings.push('low_resolution');
 if(contrast<18)warnings.push('low_contrast');
 if(clipped/data.length>.2)warnings.push('clipped_exposure');
 const sharpness=lap/Math.max(1,(info.width-2)*(info.height-2));
 if(sharpness<35)warnings.push('check_focus');
 const latitude=Number(gps?.latitude),longitude=Number(gps?.longitude),heading=Number(exif.GPSImgDirection),focal=Number(exif.FocalLength),focal35=Number(exif.FocalLengthIn35mmFormat);
 const captured=exif.DateTimeOriginal||exif.CreateDate||null;
 return {sha256:hash(buffer),mime:{jpeg:'image/jpeg',png:'image/png',webp:'image/webp',heif:'image/heic',avif:'image/avif',tiff:'image/tiff'}[meta.format],preview:'data:image/webp;base64,'+preview.toString('base64'),metadata:{
  width,height,bytes:buffer.length,format:meta.format,orientation:meta.orientation||1,has_exif:!!meta.exif,
  sharpness:Math.round(sharpness),contrast:Math.round(contrast),clipped_fraction:Number((clipped/data.length).toFixed(3)),warnings,method:METHOD,
  camera_make:String(exif.Make||'').slice(0,80),camera_model:String(exif.Model||'').slice(0,100),lens_model:String(exif.LensModel||'').slice(0,120),
  focal_length_mm:Number.isFinite(focal)?Number(focal.toFixed(3)):null,focal_length_35mm:Number.isFinite(focal35)?Number(focal35.toFixed(2)):null,
  gps:Number.isFinite(latitude)&&Number.isFinite(longitude)?{lat:latitude,lon:longitude}:null,
  heading_deg:Number.isFinite(heading)?((heading%360)+360)%360:null,
  captured_at:captured instanceof Date?captured.toISOString():(captured?String(captured).slice(0,60):null),
  quality_note:'Screening metrics at 512px; reconstruction uses the stored original. GPS/camera EXIF is retained when present.'
 }};
}
async function buildMaterial(spec,readSource,cache){
 if(!spec||!/^[a-z0-9_-]{1,60}$/i.test(spec.id))fail('photo_material_id');
 const widthM=finite(spec.width_m,.1,200,'width_m'),heightM=finite(spec.height_m,.1,160,'height_m');
 const ppm=finite(spec.pixels_per_m,10,200,'pixels_per_m',60),sharpness=finite(spec.sharpen,0,1,'sharpen',.25);
 const views=spec.views||[{source_asset_id:spec.source_asset_id,source_quad:spec.source_quad}];
 if(!Array.isArray(views)||!views.length||views.length>4)fail('photo_view_limit');
 const sources=[];
 for(const view of views){
  const matrix=quad(view.source_quad),exclude=masks(view.exclude),ev=finite(view.exposure_ev,-1.5,1.5,'exposure',0);
  const whiteBalance=view.white_balance||[1,1,1];
  if(!Array.isArray(whiteBalance)||whiteBalance.length!==3)fail('photo_white_balance');whiteBalance.forEach(v=>finite(v,.7,1.4,'white_balance'));
  const source=await readSource(String(view.source_asset_id));if(!source)fail('photo_source_not_found');
  sources.push({view,matrix,exclude,ev,whiteBalance,buffer:source,sha256:hash(source)});
 }
 const fingerprint=hash(JSON.stringify({method:METHOD,spec,sources:sources.map(s=>s.sha256)}));
 if(cache?.build_key===fingerprint)return {...cache,cache_hit:true};
 // Preserve aspect ratio and source-supported detail. Never upscale a weak
 // source to claim extra accuracy. More detail requires a closer photograph.
 let width=Math.max(32,Math.round(widthM*ppm)),height=Math.max(32,Math.round(heightM*ppm));
 const scale=Math.min(1,2048/Math.max(width,height));width=Math.max(32,Math.round(width*scale));height=Math.max(32,Math.round(height*scale));
 let nativeWidth=0,nativeHeight=0;
 for(const s of sources){
  const decoded=await sharp(s.buffer,{limitInputPixels:60000000}).rotate().removeAlpha().toColourspace('srgb').resize(4096,4096,{fit:'inside',withoutEnlargement:true}).raw().toBuffer({resolveWithObject:true});
  s.data=decoded.data;s.info=decoded.info;delete s.buffer;
  const p=s.view.source_quad.map(([x,y])=>[x*(s.info.width-1),y*(s.info.height-1)]),dist=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
  nativeWidth=Math.max(nativeWidth,Math.min(dist(p[0],p[1]),dist(p[3],p[2])));
  nativeHeight=Math.max(nativeHeight,Math.min(dist(p[0],p[3]),dist(p[1],p[2])));
 }
 const nativeScale=Math.min(1,nativeWidth/width,nativeHeight/height);
 width=Math.max(32,Math.floor(width*nativeScale));height=Math.max(32,Math.floor(height*nativeScale));
 const result=Buffer.alloc(width*height*4),hist=sources.map(()=>0);let missing=0;
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const u=x/(width-1),v=y/(height-1);let chosen=false;
  // Priority replacement, not averaging: averaging differently aligned views
  // creates ghosted frames. Masks are in the ORIENTED source photo coordinates.
  for(let j=0;j<sources.length;j++){
   const s=sources[j],m=s.matrix,d=m[6]*u+m[7]*v+1,sx=(m[0]*u+m[1]*v+m[2])/d,sy=(m[3]*u+m[4]*v+m[5])/d;
   if(s.exclude.some(p=>inside([sx,sy],p)))continue;
   const px=Math.max(0,Math.min(s.info.width-1,sx*(s.info.width-1))),py=Math.max(0,Math.min(s.info.height-1,sy*(s.info.height-1))),x0=Math.floor(px),y0=Math.floor(py),x1=Math.min(x0+1,s.info.width-1),y1=Math.min(y0+1,s.info.height-1),dx=px-x0,dy=py-y0,i=(y*width+x)*4;
   for(let c=0;c<3;c++){
    const value=(s.data[(y0*s.info.width+x0)*3+c]*(1-dx)+s.data[(y0*s.info.width+x1)*3+c]*dx)*(1-dy)+(s.data[(y1*s.info.width+x0)*3+c]*(1-dx)+s.data[(y1*s.info.width+x1)*3+c]*dx)*dy;
    result[i+c]=Math.round(Math.min(255,255*Math.pow(Math.pow(value/255,2.2)*2**s.ev*s.whiteBalance[c],1/2.2)));
   }
   result[i+3]=255;hist[j]++;chosen=true;break;
  }
  if(!chosen)missing++;
 }
 let pipeline=sharp(result,{raw:{width,height,channels:4}});
 if(sharpness)pipeline=pipeline.sharpen({sigma:.5+sharpness*.5,m1:sharpness,m2:sharpness*2});
 const encoded=await pipeline.webp({quality:92,alphaQuality:100,effort:4}).toBuffer();
 return {id:spec.id,mode:'facade',rectified:true,source_asset_id:sources[0].view.source_asset_id,source_quad:sources[0].view.source_quad,source_asset_ids:sources.map(s=>s.view.source_asset_id),data_url:'data:image/webp;base64,'+encoded.toString('base64'),width,height,build_key:fingerprint,
  roughness:finite(spec.roughness,.04,1,'roughness',.85),metalness:finite(spec.metalness,0,1,'metalness',0),lighting_mix:finite(spec.lighting_mix,0,1,'lighting_mix',.35),
  quality:{source_sha256:sources.map(s=>s.sha256),pixels_per_m:Number(Math.min(width/widthM,height/heightM).toFixed(2)),missing_fraction:Number((missing/(width*height)).toFixed(4)),source_pixels:hist,warnings:[...(nativeScale<.8?['source_resolution_limited']:[]),...(missing?['occluded_pixels_unfilled']:[])],depth:'explicit_geometry_only',illumination:'photo_contains_capture_lighting'}};
}
const instructions={
 method:METHOD,
 steps:['Read location notes and all reference metadata before matching any surface.','Match repeated landmarks across overlapping views. GPS is camera position, not wall position.','Use the exact exported geometry_key and edge endpoints. Nearest marker edge is only a hint.','Separate every planar surface; no panorama projection or guessed homography across balconies.','Choose source_quad in oriented photo pixels normalized to [0,1], ordered TL TR BR BL as seen from outside.','Set surface.flip_u when needed so texture direction matches increasing edge u; never mirror silently.','Preserve each facade identity with non-repeating photo materials. Mask people, cars, foliage and occlusions; use a registered alternate view or leave a documented hole.','Declare windows and recess depth from observations/measurements. Do not infer metric depth or normal maps from image brightness.','Keep uncertain dimensions labeled inferred. Never invent an unseen facade and call it observed.','Keep color/exposure changes conservative. Photographs are not measured albedo; lighting_mix controls additional renderer lighting.','Render and compare matching front/oblique views, window corners, entrance, roofline and neighboring geometry before approval.'],
 quality_gate:['Exact marker/establishment/venue and geometry revision.','Valid convex quads, surface bounds, no unconfirmed side assignments.','Original hashes and source provenance retained.','Report native texel density and unfilled occlusions; no hallucinated super-resolution.','Review preview on the map before publishing.'],
 automation:'Upload automatically preserves originals and measures image quality. Semantic side matching is an Astra task. No vision model runs implicitly or without configured access.',
 recipe_schema:{version:3,expected_revision:'geometry.revision',output:'Astra output v2 with facade.surfaces[]',materials:[{id:'front',width_m:20,height_m:12,pixels_per_m:60,views:[{source_asset_id:'id',source_quad:[[0,0],[1,0],[1,1],[0,1]],exclude:[],exposure_ev:0,white_balance:[1,1,1]}],roughness:.85,metalness:0,lighting_mix:.35,sharpen:.25}]}
};
module.exports={METHOD,hash,finite,quad,inspect,buildMaterial,instructions};
