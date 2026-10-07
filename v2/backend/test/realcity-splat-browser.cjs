'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {chromium}=require('playwright');

test('RealCity RCSP2 Gaussian shader compiles and renders in Chromium WebGL',async()=>{
  const browser=await chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-webgl','--ignore-gpu-blocklist']});
  try{
    const page=await browser.newPage({viewport:{width:512,height:512}});
    await page.setContent('<canvas id="c" width="512" height="512"></canvas>');
    await page.addScriptTag({path:path.resolve(__dirname,'../../frontend/realcity-spatial.js')});
    await page.addScriptTag({path:path.resolve(__dirname,'../../frontend/realcity-splat-layer.js')});
    const result=await page.evaluate(()=>{
      const canvas=document.getElementById('c');
      const gl=canvas.getContext('webgl2',{alpha:true,antialias:true})||canvas.getContext('webgl',{alpha:true,antialias:true});
      if(!gl)return {ok:false,error:'webgl_unavailable'};

      const ring=[[37,55],[37.0001,55],[37.0001,55.0001],[37,55.0001],[37,55]];
      const marker={id:'7',marker_id:'7',establishment_id:'SC-MSK-TEST000001',venue_id:'venue-7',lon:37,lat:55};
      const scene={buildings:[{id:'hero',role:'hero',ring,height:12,base_m:0}]};
      const raw=new Uint8Array(22);
      const v=new DataView(raw.buffer);
      v.setInt16(0,0,true);v.setInt16(0,2,true);v.setInt16(0,4,true);
      raw[6]=180;raw[7]=150;raw[8]=120;
      v.setUint16(9,800,true);v.setUint16(11,350,true);v.setUint16(13,120,true);
      v.setInt8(15,127);v.setInt8(16,0);v.setInt8(17,0);v.setInt8(18,0);
      raw[19]=235;raw[20]=245;raw[21]=0;
      let binary='';for(const b of raw)binary+=String.fromCharCode(b);
      const model={
        schema:1,status:'ready',engine:'realcity-photoreal-v1',representation:'gaussian-splats-v2',
        target:{marker_id:'7',establishment_id:marker.establishment_id,venue_id:marker.venue_id},
        origin:[37,55,0],
        anchor:{building_id:'hero',geometry_key:RealCitySpatial.geometryKey(ring)},
        chunks:[{id:'near',codec:'rcsp2-base64',point_count:1,data:btoa(binary),bounds_min:[-2,-2,0],bounds_max:[2,2,8]}],
        quality:{coverage_radius_m:120}
      };
      const fakeMap={getCanvas:()=>canvas,getZoom:()=>18.5,triggerRepaint:()=>{}};
      const errors=[];
      const layer=RealCitySplatLayer.create({marker,profile:{scene},model,reducedMotion:true,onError:e=>errors.push(String(e?.message||e))});
      if(!layer)return {ok:false,error:'layer_rejected',errors};
      layer.onAdd(fakeMap,gl);
      if(!layer.ready)return {ok:false,error:'layer_not_ready',errors};
      const I=new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
      layer.render(gl,I);
      const err=gl.getError();
      const stats=layer.stats;
      layer.onRemove(fakeMap,gl);
      return {ok:err===gl.NO_ERROR,errorCode:err,errors,stats,webgl2:!!gl.texStorage2D};
    });
    assert.equal(result.ok,true,JSON.stringify(result));
    assert.equal(result.stats.points,1);
    assert.equal(result.stats.representation,'gaussian-splats-v2');
  }finally{
    await browser.close();
  }
});


test('volumetric PHOTO-3D takes over native buildings with exact support volumes',()=>{
  const fs=require('node:fs');
  const src=fs.readFileSync(path.resolve(__dirname,'../../frontend/map.js'),'utf8');
  assert.match(src,/const volumetricPhoto3D=photoreal&&!completePhotogrammetry&&authored\?\.quality\?\.volumetric_reconstruction===true/);
  assert.match(src,/supportIds=new Set/);
  assert.match(src,/volumetricPhoto3D\s*\?\(profile\.scene\?\.buildings\|\|\[\]\)/);
  assert.match(src,/const dimmed=\(completePhotogrammetry\|\|volumetricPhoto3D\)\?covered/);
  assert.match(src,/const context=volumetricPhoto3D/);
  assert.match(src,/neutralSupport/);
  assert.match(src,/realcity-context-extrude','fill-extrusion-opacity',volumetricPhoto3D\?\.54:\.78/);
  assert.match(src,/focus-building-extrude','fill-extrusion-opacity',volumetricPhoto3D\?\.6:\.97/);
  assert.match(src,/setBaseBuildingsDim\(dimmed\.length>0/);
});
