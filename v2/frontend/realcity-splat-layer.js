/* RealCity anisotropic Gaussian renderer.
   Dense source-colour reconstruction rendered inside MapLibre's WebGL context.
   RCSP2 carries 3D scales + quaternion + opacity for perspective-correct
   elliptical splats. RCSP1 remains readable as a compatibility fallback. */
(function(root){
  'use strict';
  const S=root.RealCitySpatial,STRIDE=16;
  const VS=`precision highp float;
attribute vec3 a_position;
attribute vec3 a_color;
attribute vec3 a_scale;
attribute vec4 a_quat;
attribute float a_opacity;
attribute float a_confidence;
attribute float a_semantic;
uniform mat4 u_matrix;
uniform vec2 u_viewport;
uniform float u_progress;
uniform float u_zoom;
varying vec3 v_color;
varying vec3 v_inv_cov;
varying float v_size;
varying float v_opacity;
varying float v_confidence;
varying float v_semantic;
vec3 qrotate(vec3 v,vec4 q){
  q=normalize(q);
  vec3 u=q.yzw;float s=q.x;
  return 2.0*dot(u,v)*u+(s*s-dot(u,u))*v+2.0*s*cross(u,v);
}
vec2 screenDelta(vec4 c,vec4 p){
  float cw=max(abs(c.w),1e-6),pw=max(abs(p.w),1e-6);
  return ((p.xy/pw)-(c.xy/cw))*u_viewport*.5;
}
void main(){
  float grow=1.0-pow(1.0-clamp(u_progress,0.0,1.0),3.0);
  vec3 pos=a_position;pos.z*=grow;
  vec3 sc=max(a_scale*max(grow,.08),vec3(.001));
  vec4 c=u_matrix*vec4(pos,1.0);
  gl_Position=c;
  vec3 ax=qrotate(vec3(sc.x,0.0,0.0),a_quat);
  vec3 ay=qrotate(vec3(0.0,sc.y,0.0),a_quat);
  vec3 az=qrotate(vec3(0.0,0.0,sc.z),a_quat);
  vec2 vx=screenDelta(c,u_matrix*vec4(pos+ax,1.0));
  vec2 vy=screenDelta(c,u_matrix*vec4(pos+ay,1.0));
  vec2 vz=screenDelta(c,u_matrix*vec4(pos+az,1.0));
  float A=dot(vec3(vx.x,vy.x,vz.x),vec3(vx.x,vy.x,vz.x))+.42;
  float B=vx.x*vx.y+vy.x*vy.y+vz.x*vz.y;
  float D=dot(vec3(vx.y,vy.y,vz.y),vec3(vx.y,vy.y,vz.y))+.42;
  float det=max(A*D-B*B,.0001);
  v_inv_cov=vec3(D/det,-B/det,A/det);
  float root=sqrt(max(0.0,(A-D)*(A-D)+4.0*B*B));
  float lambda=max(.25,.5*(A+D+root));
  float radius=3.15*sqrt(lambda);
  float size=clamp(radius*2.0,1.8,96.0);
  gl_PointSize=size;
  v_size=size;v_color=a_color;v_opacity=a_opacity;v_confidence=a_confidence;v_semantic=a_semantic;
}`;
  const FS=`precision highp float;
varying vec3 v_color;
varying vec3 v_inv_cov;
varying float v_size;
varying float v_opacity;
varying float v_confidence;
varying float v_semantic;
void main(){
  vec2 p=(gl_PointCoord-.5)*v_size;
  float mahal=v_inv_cov.x*p.x*p.x+2.0*v_inv_cov.y*p.x*p.y+v_inv_cov.z*p.y*p.y;
  if(mahal>10.0)discard;
  float gaussian=exp(-.5*mahal);
  float alpha=clamp(gaussian*v_opacity*(.55+.45*v_confidence),0.0,.985);
  if(alpha<.018)discard;
  vec3 c=clamp(v_color,0.0,1.0);
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
  function put(out,p,x,y,z,r,g,b,sx,sy,sz,qw,qx,qy,qz,opacity,confidence,semantic){
    out[p]=x;out[p+1]=y;out[p+2]=z;out[p+3]=r;out[p+4]=g;out[p+5]=b;
    out[p+6]=sx;out[p+7]=sy;out[p+8]=sz;out[p+9]=qw;out[p+10]=qx;out[p+11]=qy;out[p+12]=qz;
    out[p+13]=opacity;out[p+14]=confidence;out[p+15]=semantic;
  }
  function decodeChunk(chunk){
    const codec=chunk?.codec,record=codec==='rcsp2-base64'?22:codec==='rcsp1-base64'?12:0;
    if(!record||typeof chunk.data!=='string')throw new Error('realcity_splat_codec');
    const bytes=b64(chunk.data),expected=Number(chunk.point_count)*record;
    if(!Number.isInteger(chunk.point_count)||chunk.point_count<1||bytes.byteLength!==expected)throw new Error('realcity_splat_bytes');
    const mn=chunk.bounds_min,mx=chunk.bounds_max;
    if(!Array.isArray(mn)||!Array.isArray(mx)||mn.length!==3||mx.length!==3)throw new Error('realcity_splat_bounds');
    const mid=mn.map((v,i)=>(Number(v)+Number(mx[i]))*.5),half=mn.map((v,i)=>Math.max(1e-4,(Number(mx[i])-Number(v))*.5));
    const out=new Float32Array(chunk.point_count*STRIDE),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
    for(let i=0;i<chunk.point_count;i++){
      const o=i*record,p=i*STRIDE;
      const x=mid[0]+view.getInt16(o,true)/32767*half[0],y=mid[1]+view.getInt16(o+2,true)/32767*half[1],z=mid[2]+view.getInt16(o+4,true)/32767*half[2];
      const r=bytes[o+6]/255,g=bytes[o+7]/255,b=bytes[o+8]/255;
      if(codec==='rcsp2-base64'){
        const sx=view.getUint16(o+9,true)/1000,sy=view.getUint16(o+11,true)/1000,sz=view.getUint16(o+13,true)/1000;
        let qw=view.getInt8(o+15)/127,qx=view.getInt8(o+16)/127,qy=view.getInt8(o+17)/127,qz=view.getInt8(o+18)/127;
        const qn=Math.hypot(qw,qx,qy,qz)||1;qw/=qn;qx/=qn;qy/=qn;qz/=qn;
        put(out,p,x,y,z,r,g,b,sx,sy,sz,qw,qx,qy,qz,bytes[o+19]/255,bytes[o+20]/255,bytes[o+21]);
      }else{
        const radius=Math.max(.012,bytes[o+9]*.0015),conf=bytes[o+10]/255;
        put(out,p,x,y,z,r,g,b,radius,radius,radius,1,0,0,0,.35+.65*conf,conf,bytes[o+11]);
      }
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
    const frame=S.frame([Number(marker.lon),Number(marker.lat)]);
    const layer={id:layerId,type:'custom',renderingMode:'3d',ready:false,disposed:false,progress:reducedMotion?1:0,
      stats:{points:cloud.count,chunks:cloud.chunks,bytes:cloud.vertices.byteLength,representation:model.representation},
      onAdd(map,gl){
        this.map=map;this.gl=gl;
        try{
          this.program=program(gl);this.buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);gl.bufferData(gl.ARRAY_BUFFER,cloud.vertices,gl.STATIC_DRAW);
          this.attributes=[];
          for(const [name,size,offset] of [['a_position',3,0],['a_color',3,3],['a_scale',3,6],['a_quat',4,9],['a_opacity',1,13],['a_confidence',1,14],['a_semantic',1,15]]){
            const loc=gl.getAttribLocation(this.program,name);if(loc<0)continue;this.attributes.push({loc,size,offset});
          }
          this.uniforms={};for(const n of ['u_matrix','u_viewport','u_progress','u_zoom'])this.uniforms[n]=gl.getUniformLocation(this.program,n);
          this.ready=true;
        }catch(e){onError(e);this.onRemove(map,gl)}
      },
      setProgress(v){this.progress=Math.max(0,Math.min(1,Number(v)||0));this.map?.triggerRepaint()},
      render(gl,args){
        if(!this.ready||this.disposed)return;
        const m=args?.defaultProjectionData?.mainMatrix||args?.modelViewProjectionMatrix||(Array.isArray(args)||ArrayBuffer.isView(args)?args:null);if(!m)return;
        gl.useProgram(this.program);gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);
        for(const a of this.attributes){gl.enableVertexAttribArray(a.loc);gl.vertexAttribPointer(a.loc,a.size,gl.FLOAT,false,STRIDE*4,a.offset*4)}
        const canvas=this.map.getCanvas(),matrix=localMatrix(m,frame.origin,frame.scale);
        gl.uniformMatrix4fv(this.uniforms.u_matrix,false,matrix);gl.uniform2f(this.uniforms.u_viewport,canvas.width,canvas.height);gl.uniform1f(this.uniforms.u_progress,this.progress);gl.uniform1f(this.uniforms.u_zoom,this.map.getZoom());
        gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);gl.depthMask(false);gl.disable(gl.CULL_FACE);
        gl.enable(gl.BLEND);gl.blendFunc(gl.ONE,gl.ONE_MINUS_SRC_ALPHA);
        gl.drawArrays(gl.POINTS,0,cloud.count);
        gl.depthMask(true);
        for(const a of this.attributes)gl.disableVertexAttribArray(a.loc);
      },
      onRemove(map,gl){this.disposed=true;this.ready=false;if(this.buffer)gl.deleteBuffer(this.buffer);if(this.program)gl.deleteProgram(this.program)}
    };
    return layer;
  }
  root.RealCitySplatLayer={create,decodeChunk,decode,localMatrix};
})(globalThis);
