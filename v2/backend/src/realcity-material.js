'use strict';
const sharp=require('sharp');
// Square-to-quadrilateral projective transform; inputs are TL,TR,BR,BL in
// normalized source-photo coordinates. Used only by the Astra material pipeline.
function homography(q){
 if(!Array.isArray(q)||q.length!==4||q.some(p=>!Array.isArray(p)||p.length!==2||p.some(v=>!Number.isFinite(v)||v<0||v>1)))throw new Error('invalid_quad');
 const [[x0,y0],[x1,y1],[x2,y2],[x3,y3]]=q;
 const dx1=x1-x2,dx2=x3-x2,dx3=x0-x1+x2-x3,dy1=y1-y2,dy2=y3-y2,dy3=y0-y1+y2-y3;
 const det=dx1*dy2-dx2*dy1;if(Math.abs(det)<1e-8)throw new Error('degenerate_quad');
 const g=(dx3*dy2-dx2*dy3)/det,h=(dx1*dy3-dx3*dy1)/det;
 return [x1-x0+g*x1,x3-x0+h*x3,x0,y1-y0+g*y1,y3-y0+h*y3,y0,g,h,1];
}
async function rectify(dataUrl,quad,width=512,height=512){
 if(!/^data:image\/(png|jpeg|webp);base64,/i.test(dataUrl||''))throw new Error('embedded_raster_required');
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<32||height<32||width>1024||height>1024)throw new Error('material_size');
 const matrix=homography(quad),decoded=await sharp(Buffer.from(dataUrl.split(',')[1],'base64'),{limitInputPixels:40000000}).rotate().removeAlpha().toColourspace('srgb').raw().toBuffer({resolveWithObject:true});
 const {data,info}=decoded,result=Buffer.alloc(width*height*3);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const u=x/(width-1),v=y/(height-1),den=matrix[6]*u+matrix[7]*v+1;
  if(Math.abs(den)<1e-8)throw new Error('invalid_perspective');
  const sx=Math.max(0,Math.min(info.width-1,(matrix[0]*u+matrix[1]*v+matrix[2])/den*(info.width-1))),sy=Math.max(0,Math.min(info.height-1,(matrix[3]*u+matrix[4]*v+matrix[5])/den*(info.height-1)));
  const x0=Math.floor(sx),y0=Math.floor(sy),x1=Math.min(x0+1,info.width-1),y1=Math.min(y0+1,info.height-1),dx=sx-x0,dy=sy-y0;
  for(let c=0;c<3;c++)result[(y*width+x)*3+c]=Math.round((data[(y0*info.width+x0)*3+c]*(1-dx)+data[(y0*info.width+x1)*3+c]*dx)*(1-dy)+(data[(y1*info.width+x0)*3+c]*(1-dx)+data[(y1*info.width+x1)*3+c]*dx)*dy);
 }
 return 'data:image/webp;base64,'+(await sharp(result,{raw:{width,height,channels:3}}).webp({quality:87}).toBuffer()).toString('base64');
}
module.exports={homography,rectify};
