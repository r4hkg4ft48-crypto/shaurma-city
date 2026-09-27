'use strict';
// Offline, reviewed architectural samples from the owner's direct-upload refs.
// This is not an automatic photo-to-world inference or a runtime photo overlay.
const fs=require('node:fs'),path=require('node:path');
const sharp=require('../backend/node_modules/sharp');
const {rectify}=require('../backend/src/realcity-material');
const input=process.argv[2];
if(!input)throw new Error('Usage: node v2/tools/build-zhulebino-materials.js PHOTO_DIRECTORY [PREVIEW_DIRECTORY]');
const samples=[
 {id:'clinic-ribbed',file:'IMG_7110.jpeg',ref:'10',size:[512,512],pixels:[[1123,540],[1153,528],[1159,636],[1128,648]],repeat_m:[.72,2.8],albedo:[222,219,204]},
 {id:'clinic-glass-a',file:'IMG_7110.jpeg',ref:'10',size:[256,512],pixels:[[703,662],[732,649],[733,703],[705,715]]},
 {id:'clinic-glass-b',file:'IMG_7110.jpeg',ref:'10',size:[256,512],pixels:[[906,599],[952,580],[953,628],[907,647]]},
 {id:'clinic-glass-c',file:'IMG_7110.jpeg',ref:'10',size:[256,512],pixels:[[1026,534],[1078,513],[1083,586],[1029,608]]},
 {id:'clinic-glass-lit',file:'IMG_7096.jpeg',ref:'1',size:[512,256],normalized:[[457/1368,615/1824],[501/1368,616/1824],[501/1368,638/1824],[457/1368,637/1824]]},
 {id:'clinic-spandrel',file:'IMG_7110.jpeg',ref:'10',size:[256,256],pixels:[[890,396],[935,378],[937,431],[892,448]],repeat_m:[1.65,1.15],albedo:[66,77,86]},
 {id:'street-asphalt',file:'IMG_7094.jpeg',ref:'3',size:[512,512],normalized:[[.31,.89],[.51,.89],[.62,.97],[.23,.97]],repeat_m:[3.5,3.5],albedo:[84,88,88]},
 {id:'clinic-ribbed-shade',file:'IMG_7096.jpeg',ref:'1',size:[512,512],normalized:[[.213,.4],[.3,.402],[.297,.45],[.209,.448]],repeat_m:[2.4,2.4],albedo:[222,219,204]}
];
(async()=>{
 const materials=[];
 for(const s of samples){
  const data=fs.readFileSync(path.join(input,s.file)),meta=await sharp(data).metadata();
  const quad=s.normalized||s.pixels.map(([x,y])=>[x/meta.width,y/meta.height]);
  let data_url=await rectify('data:image/jpeg;base64,'+data.toString('base64'),quad,...s.size);
  if(s.albedo){
   // Remove the reference's dusk exposure/white balance, not its surface detail.
   const {data:rgb,info}=await sharp(Buffer.from(data_url.split(',')[1],'base64')).raw().toBuffer({resolveWithObject:true});
   const smooth=await sharp(rgb,{raw:info}).blur(12).raw().toBuffer();
   for(let i=0;i<rgb.length;i++)rgb[i]=Math.max(0,Math.min(255,Math.round(s.albedo[i%3]*Math.max(.85,Math.min(1.15,rgb[i]/Math.max(1,smooth[i]))))));
   data_url='data:image/webp;base64,'+(await sharp(rgb,{raw:info}).webp({quality:90}).toBuffer()).toString('base64');
  }
  // Preserve real local texture/colour variation. Originals and EXIF never ship.
  materials.push({id:s.id,rectified:true,source_asset_id:'owner-photo-'+s.ref,source_quad:quad,data_url,...(s.repeat_m?{repeat_m:s.repeat_m}:{})});
  if(process.argv[3])await sharp(Buffer.from(data_url.split(',')[1],'base64')).png().toFile(path.join(process.argv[3],s.id+'.png'));
 }
 fs.writeFileSync(path.join(__dirname,'../backend/src/realcity-releases/zhulebino-materials.json'),JSON.stringify(materials,null,2)+'\n');
 console.log(JSON.stringify(materials.map(m=>({id:m.id,bytes:m.data_url.length})),null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
