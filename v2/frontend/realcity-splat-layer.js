/* RealCity photometric splat renderer.
   Renders dense source-colour reconstruction directly in MapLibre's WebGL
   context. No procedural facade geometry, billboard panoramas or detached scene. */
(function(root){
  'use strict';
  const S=root.RealCitySpatial,STRIDE=9;
  const VS=`precision highp float;
attribute vec3 a_position;
attribute vec3 a_color;
attribute float a_radius;
attribute float a_confidence;
attribute float a_semantic;
uniform mat4 u_matrix;
uniform float u_pixels_per_meter;
uniform float u_progress;
uniform float u_zoom;
varying vec3 v_color;
varying float v_confidence;
varying float v_semantic;
void main(){
  float grow=1.0-pow(1.0-clamp(u_progress,0.0,1.0),3.0);
  vec3 p=a_position;
  p.z*=grow;
  gl_Position=u_matrix*vec4(p,1.0);
  float size=max(1.8,a_radius*u_pixels_per_meter*8.0);
  size*=mix(.78,1.0,smoothstep(17.0,19.0,u_zoom));
  gl_PointSize=clamp(size*grow,1.5,16.0);
  v_color=a_color;
  v_confidence=a_confidence;
  v_semantic=a_semantic;
}`;
  const FS=`precision highp float;
varying vec3 v_color;
varying float v_confidence;
varying float v_semantic;
void main(){
  vec2 q=gl_PointCoord*2.0-1.0;
  float d2=dot(q,q);
  if(d2>1.0)discard;
  float gaussian=exp(-d2*2.8);
  float edge=smoothstep(1.0,.58,d2);
  float alpha=clamp((.38+.62*v_confidence)*gaussian*edge,0.0,.98);
  vec3 c=v_color;
  /* Preserve captured radiance. Only a tiny confidence lift prevents holes;
     no synthetic sun/shadow is applied to photographic pixels. */
  c=mix(c,c*1.015,.45*v_confidence);
  gl_FragColor=vec4(c*alpha,alpha);
}`;
  function shader(gl,type,src){const s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)){const e=gl.getShaderInfoLog(s);gl.deleteShader(s);throw new Error(e)}return s}
  function program(gl){
    const modern=typeof gl.texStorage2D==='function';
    const vs=modern?'#version 300 es\n'+VS.replace(/attribute /g,'in ').replace(/varying /g,'out '):VS;
    let fs=FS;if(modern)fs='#version 300 es\n'+FS.replace('precision highp float;','precision highp float;\nout vec4 fragmentColor;').replace(/varying /g,'in ').replace(/gl_FragColor/g,'fragmentColor');
    const v=shader(gl,gl.VERTEX_SHADER,vs),f=shader(gl,gl.FRAGMENT_SHADER,fs),p=gl.createProgram();
    gl.attachShader(p,v);gl.attachShader(p,f);gl.linkProgram(p);gl.deleteShader(v);gl.deleteShader(f);
    if(!gl.getProgramParameter(p,gl.LINK_STATUS)){const e=gl.getProgramInfoLog(p);gl.deleteProgram(p);throw new Error(e)}return p;
  }
  function localMatrix(m,origin,scale){
    const out=new Float32Array(16);
    for(let i=0;i<4;i++){out[i]=m[i]*scale;out[4+i]=-m[4+i]*scale;out[8+i]=m[8+i]*scale;out[12+i]=m[i]*origin[0]+m[4+i]*origin[1]+m[12+i];}
    return out;
  }
  function b64(value){
    const raw=atob(value),out=new Uint8Array(raw.length);
    for(let i=0;i<raw.length;i++)out[i]=raw.charCodeAt(i);return out;
  }
  function decodeChunk(chunk){
    if(chunk?.codec!=='rcsp1-base64'||typeof chunk.data!=='string')throw new Error('realcity_splat_codec');
    const bytes=b64(chunk.data),expected=Number(chunk.point_count)*12;
    if(!Number.isInteger(chunk.point_count)||chunk.point_count<1||bytes.byteLength!==expected)throw new Error('realcity_splat_bytes');
    const mn=chunk.bounds_min,mx=chunk.bounds_max;
    if(!Array.isArray(mn)||!Array.isArray(mx)||mn.length!==3||mx.length!==3)throw new Error('realcity_splat_bounds');
    const mid=mn.map((v,i)=>(Number(v)+Number(mx[i]))*.5),half=mn.map((v,i)=>Math.max(1e-4,(Number(mx[i])-Number(v))*.5));
    const out=new Float32Array(chunk.point_count*STRIDE),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
    for(let i=0;i<chunk.point_count;i++){
      const o=i*12,p=i*STRIDE;
      out[p]=mid[0]+view.getInt16(o,true)/32767*half[0];
      out[p+1]=mid[1]+view.getInt16(o+2,true)/32767*half[1];
      out[p+2]=mid[2]+view.getInt16(o+4,true)/32767*half[2];
      out[p+3]=bytes[o+6]/255;out[p+4]=bytes[o+7]/255;out[p+5]=bytes[o+8]/255;
      out[p+6]=Math.max(.012,bytes[o+9]*.0015);
      out[p+7]=bytes[o+10]/255;out[p+8]=bytes[o+11];
    }
    return out;
  }
  function decode(model){
    const chunks=(model.chunks||[]).slice().sort((a,b)=>(a.lod||0)-(b.lod||0));
    const decoded=chunks.map(c=>({chunk:c,data:decodeChunk(c)})),count=decoded.reduce((n,x)=>n+x.data.length/STRIDE,0);
    const out=new Float32Array(count*STRIDE);let offset=0;
    for(const x of decoded){out.set(x.data,offset);offset+=x.data.length}
    return {vertices:out,count,chunks:chunks.length};
  }
  function create({marker,profile,model,layerId='realcity-photoreal-splats',reducedMotion=false,onError=()=>{}}){
    if(!S?.boundPhotoreal?.(model,marker,profile?.scene))return null;
    let cloud;try{cloud=decode(model)}catch(e){onError(e);return null}
    const frame=S.frame([Number(marker.lon),Number(marker.lat)]),cos=Math.max(.1,Math.cos(Number(marker.lat)*Math.PI/180));
    const layer={id:layerId,type:'custom',renderingMode:'3d',ready:false,disposed:false,progress:reducedMotion?1:0,
      stats:{points:cloud.count,chunks:cloud.chunks,bytes:cloud.vertices.byteLength,representation:model.representation},
      onAdd(map,gl){
        this.map=map;this.gl=gl;
        try{
          this.program=program(gl);this.buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);gl.bufferData(gl.ARRAY_BUFFER,cloud.vertices,gl.STATIC_DRAW);
          this.attributes=[];
          for(const [name,size,offset] of [['a_position',3,0],['a_color',3,3],['a_radius',1,6],['a_confidence',1,7],['a_semantic',1,8]]){
            const loc=gl.getAttribLocation(this.program,name);if(loc<0)continue;this.attributes.push({loc,size,offset});
          }
          this.uniforms={};for(const n of ['u_matrix','u_pixels_per_meter','u_progress','u_zoom'])this.uniforms[n]=gl.getUniformLocation(this.program,n);
          this.ready=true;
        }catch(e){onError(e);this.onRemove(map,gl)}
      },
      setProgress(v){this.progress=Math.max(0,Math.min(1,Number(v)||0));this.map?.triggerRepaint()},
      render(gl,args){
        if(!this.ready||this.disposed)return;
        const m=args?.defaultProjectionData?.mainMatrix||args?.modelViewProjectionMatrix||(Array.isArray(args)||ArrayBuffer.isView(args)?args:null);if(!m)return;
        gl.useProgram(this.program);gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);
        for(const a of this.attributes){gl.enableVertexAttribArray(a.loc);gl.vertexAttribPointer(a.loc,a.size,gl.FLOAT,false,STRIDE*4,a.offset*4)}
        const matrix=localMatrix(m,frame.origin,frame.scale),zoom=this.map.getZoom(),ppm=Math.pow(2,zoom)/(156543.03392*cos);
        gl.uniformMatrix4fv(this.uniforms.u_matrix,false,matrix);gl.uniform1f(this.uniforms.u_pixels_per_meter,ppm);gl.uniform1f(this.uniforms.u_progress,this.progress);gl.uniform1f(this.uniforms.u_zoom,zoom);
        gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);gl.depthMask(true);gl.disable(gl.CULL_FACE);
        gl.enable(gl.BLEND);gl.blendFunc(gl.ONE,gl.ONE_MINUS_SRC_ALPHA);
        gl.drawArrays(gl.POINTS,0,cloud.count);
        for(const a of this.attributes)gl.disableVertexAttribArray(a.loc);
      },
      onRemove(map,gl){this.disposed=true;this.ready=false;if(this.buffer)gl.deleteBuffer(this.buffer);if(this.program)gl.deleteProgram(this.program)}
    };
    return layer;
  }
  root.RealCitySplatLayer={create,decodeChunk,decode,localMatrix};
})(globalThis);
