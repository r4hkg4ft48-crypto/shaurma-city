/* RealCity Photoreal Surfel Renderer.
   Renders dense source-derived colored surfels in the same MapLibre camera.
   Local coordinates are ENU metres anchored to the selected venue. */
(function(root){
  'use strict';
  const VS=`precision highp float;
attribute vec3 a_position;
attribute vec3 a_color;
attribute float a_radius;
uniform mat4 u_matrix;
uniform float u_zoom;
uniform float u_progress;
varying vec3 v_color;
varying float v_alpha;
void main(){
  vec4 clip=u_matrix*vec4(a_position,1.0);
  gl_Position=clip;
  float zoomScale=pow(2.0,(u_zoom-17.0)*0.52);
  gl_PointSize=clamp(a_radius*44.0*zoomScale,1.1,12.0);
  v_color=a_color;
  v_alpha=u_progress;
}`;
  const FS=`precision highp float;
varying vec3 v_color;
varying float v_alpha;
void main(){
  vec2 p=gl_PointCoord*2.0-1.0;
  float d=dot(p,p);
  if(d>1.0)discard;
  float a=(1.0-smoothstep(.58,1.0,d))*v_alpha;
  vec3 c=pow(max(v_color,vec3(0.0)),vec3(2.2));
  c*=.96+.04*(1.0-d);
  gl_FragColor=vec4(pow(c,vec3(1.0/2.2))*a,a);
}`;
  function shader(gl,type,src){const s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)){const e=gl.getShaderInfoLog(s);gl.deleteShader(s);throw new Error(e)}return s;}
  function program(gl){
    const modern=typeof gl.texStorage2D==='function';
    const vs=modern?'#version 300 es\n'+VS.replace(/attribute /g,'in ').replace(/varying /g,'out '):VS;
    const fs=modern?'#version 300 es\n'+FS.replace('precision highp float;','precision highp float;\nout vec4 fragmentColor;').replace(/varying /g,'in ').replace(/gl_FragColor/g,'fragmentColor'):FS;
    const v=shader(gl,gl.VERTEX_SHADER,vs),f=shader(gl,gl.FRAGMENT_SHADER,fs),p=gl.createProgram();
    gl.attachShader(p,v);gl.attachShader(p,f);gl.linkProgram(p);gl.deleteShader(v);gl.deleteShader(f);
    if(!gl.getProgramParameter(p,gl.LINK_STATUS)){const e=gl.getProgramInfoLog(p);gl.deleteProgram(p);throw new Error(e)}return p;
  }
  function localMatrix(m,origin,scale){
    const out=new Float32Array(16);
    for(let i=0;i<4;i++){
      out[i]=m[i]*scale;
      out[4+i]=-m[4+i]*scale;
      out[8+i]=m[8+i]*scale;
      out[12+i]=m[i]*origin[0]+m[4+i]*origin[1]+m[12+i];
    }
    return out;
  }
  function parseRcs(buffer,maxPoints=900000){
    const v=new DataView(buffer);
    if(buffer.byteLength<16||String.fromCharCode(v.getUint8(0),v.getUint8(1),v.getUint8(2),v.getUint8(3))!=='RCS1')throw new Error('realcity_rcs_magic');
    const version=v.getUint16(4,true),stride=v.getUint16(6,true),count=v.getUint32(8,true);
    if(version!==1||stride!==20||count<1||count>5000000||16+count*stride>buffer.byteLength)throw new Error('realcity_rcs_schema');
    const keep=Math.min(count,maxPoints),step=Math.max(1,Math.ceil(count/keep)),actual=Math.ceil(count/step);
    const positions=new Float32Array(actual*3),colors=new Float32Array(actual*3),radii=new Float32Array(actual);
    let j=0;
    for(let i=0;i<count;i+=step){
      const o=16+i*stride;
      positions[j*3]=v.getFloat32(o,true);positions[j*3+1]=v.getFloat32(o+4,true);positions[j*3+2]=v.getFloat32(o+8,true);
      colors[j*3]=v.getUint8(o+12)/255;colors[j*3+1]=v.getUint8(o+13)/255;colors[j*3+2]=v.getUint8(o+14)/255;
      radii[j]=Math.max(.035,Math.min(.75,v.getFloat32(o+16,true)));j++;
    }
    return {positions,colors,radii,count:actual,sourceCount:count};
  }
  async function load({marker,profile,photoreal,layerId='realcity-photoreal-world',reducedMotion=false,onError=()=>{}}){
    try{
      if(!photoreal||photoreal.status!=='ready'||!photoreal.artifacts?.['surfels.rcs']?.url)return null;
      const target=photoreal.origin||[Number(marker.lon),Number(marker.lat),0];
      if(Math.abs(Number(target[0])-Number(marker.lon))>1e-6||Math.abs(Number(target[1])-Number(marker.lat))>1e-6)return null;
      const r=await fetch(photoreal.artifacts['surfels.rcs'].url,{cache:'force-cache'});
      if(!r.ok)throw new Error('realcity_rcs_http_'+r.status);
      const data=parseRcs(await r.arrayBuffer(),innerWidth<600?420000:760000);
      const merc=root.maplibregl?.MercatorCoordinate?.fromLngLat([Number(marker.lon),Number(marker.lat)],0);
      if(!merc)throw new Error('realcity_mercator_unavailable');
      const origin=[merc.x,merc.y],scale=merc.meterInMercatorCoordinateUnits();
      const layer={id:layerId,type:'custom',renderingMode:'3d',ready:true,disposed:false,progress:reducedMotion?1:0,
        stats:{points:data.count,source_points:data.sourceCount,bytes:data.positions.byteLength+data.colors.byteLength+data.radii.byteLength},
        onAdd(map,gl){
          this.map=map;this.gl=gl;
          try{
            this.program=program(gl);
            this.buffers=[gl.createBuffer(),gl.createBuffer(),gl.createBuffer()];
            for(const [idx,array] of [[0,data.positions],[1,data.colors],[2,data.radii]]){gl.bindBuffer(gl.ARRAY_BUFFER,this.buffers[idx]);gl.bufferData(gl.ARRAY_BUFFER,array,gl.STATIC_DRAW);}
            this.aPosition=gl.getAttribLocation(this.program,'a_position');
            this.aColor=gl.getAttribLocation(this.program,'a_color');
            this.aRadius=gl.getAttribLocation(this.program,'a_radius');
            this.uMatrix=gl.getUniformLocation(this.program,'u_matrix');
            this.uZoom=gl.getUniformLocation(this.program,'u_zoom');
            this.uProgress=gl.getUniformLocation(this.program,'u_progress');
          }catch(e){this.ready=false;onError(e)}
        },
        setProgress(v){this.progress=Math.max(0,Math.min(1,Number(v)||0));this.map?.triggerRepaint();},
        render(gl,args){
          if(!this.ready||this.disposed)return;
          const m=args?.defaultProjectionData?.mainMatrix||args?.modelViewProjectionMatrix||(Array.isArray(args)||ArrayBuffer.isView(args)?args:null);if(!m)return;
          gl.useProgram(this.program);
          const bind=(buffer,loc,size)=>{gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,size,gl.FLOAT,false,0,0);};
          bind(this.buffers[0],this.aPosition,3);bind(this.buffers[1],this.aColor,3);bind(this.buffers[2],this.aRadius,1);
          gl.uniformMatrix4fv(this.uMatrix,false,localMatrix(m,origin,scale));
          gl.uniform1f(this.uZoom,this.map.getZoom());gl.uniform1f(this.uProgress,this.progress);
          gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);gl.depthMask(true);gl.disable(gl.CULL_FACE);
          gl.enable(gl.BLEND);gl.blendFunc(gl.ONE,gl.ONE_MINUS_SRC_ALPHA);
          gl.drawArrays(gl.POINTS,0,data.count);
        },
        onRemove(map,gl){this.disposed=true;this.ready=false;for(const b of this.buffers||[])gl.deleteBuffer(b);if(this.program)gl.deleteProgram(this.program);}
      };
      return layer;
    }catch(e){onError(e);return null}
  }
  root.RealCityPhotorealLayer={load,parseRcs,localMatrix};
})(globalThis);
