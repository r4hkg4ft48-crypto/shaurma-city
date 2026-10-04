/* RealCity facade renderer. Uses MapLibre's canvas, GL context, depth and camera.
   No detached viewer, photo planes inside buildings, or frame loop while idle. */
(function(root){
  'use strict';
  const S=root.RealCitySpatial;
  const STRIDE=14;
  const VS=`precision highp float;
attribute vec3 a_position; attribute vec3 a_normal; attribute vec3 a_color;
attribute vec2 a_uv; attribute float a_texture; attribute float a_detail; attribute float a_order;
uniform mat4 u_matrix; uniform float u_progress; uniform float u_zoom;
varying vec3 v_color; varying vec2 v_uv; varying float v_texture; varying float v_visible;
varying vec3 v_world; varying vec3 v_normal;
void main(){
 float t=clamp((u_progress-a_order*.13)/.87,0.,1.); float e=1.-pow(1.-t,3.);
 vec3 p=a_position; p.z*=e;
 v_color=a_color; v_uv=a_uv; v_texture=a_texture; v_world=p; v_normal=a_normal;
 v_visible=a_detail<.5?1.:smoothstep(15.9,16.8,u_zoom);
 gl_Position=u_matrix*vec4(p,1.);
}`;
  const FS=`#extension GL_OES_standard_derivatives : enable
precision highp float;
uniform sampler2D u_atlas; uniform highp sampler2D u_shadow; uniform vec3 u_camera;
uniform sampler2D u_photos; uniform vec4 u_photo_params[12];
uniform mat4 u_light; uniform float u_shadow_ready; uniform float u_ground_radius;
varying vec3 v_color; varying vec2 v_uv; varying float v_texture; varying float v_visible;
varying vec3 v_world; varying vec3 v_normal;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
vec3 sky(vec3 r){float h=smoothstep(-.15,.8,r.z);vec3 c=mix(vec3(.63,.68,.7),vec3(.27,.45,.65),h);float cloud=smoothstep(.54,.8,noise(r.xy*5.+r.z));return mix(c,vec3(.78,.8,.79),cloud*.45);}
float visibility(vec3 p,vec3 normal){
 vec3 q=(u_light*vec4(p,1.)).xyz*.5+.5;
 if(u_shadow_ready<.5||q.x<.005||q.x>.995||q.y<.005||q.y>.995||q.z<0.||q.z>1.)return 1.;
 vec3 light=normalize(vec3(.6,.35,.85)),right=normalize(vec3(-light.y,light.x,0.)),up=cross(light,right);
 float ndl=dot(normal,light);if(ndl<.05)return 1.;
 // Compare each texel against the receiver's plane at its actual centre.
 // A fixed bias makes sloping walls/roofs shadow themselves in repeating bands.
 vec2 slope=vec2(dot(normal,right),dot(normal,up))*(220./340.)/ndl;
 float lit=0.,bias=.00045;
 for(int x=-1;x<=1;x++)for(int y=-1;y<=1;y++){
  vec2 sampleUV=(floor(q.xy*1024.)+vec2(.5)+vec2(float(x),float(y)))/1024.;
  float d=dot(texture2D(u_shadow,sampleUV),vec4(1.,1./255.,1./65025.,1./16581375.));
  lit+=q.z+dot(slope,sampleUV-q.xy)-bias<=d?1.:0.;
 }
 return lit/9.;
}
void main(){
 if(v_visible<.02)discard;
 float kind=floor(v_texture+.1);vec2 uv=v_uv;
 if((kind==8.||kind==19.)&&length(v_world.xy)>u_ground_radius)discard;
 if(kind>=10.&&kind<=17.){float slot=kind-10.;uv=vec2(mod(slot,4.),floor(slot/4.))*.25+vec2(.001)+abs(fract(v_uv*.5)*2.-1.)*.248;}
 bool photo=(kind>=20.&&kind<32.)||(kind>=40.&&kind<52.);
 vec4 params=vec4(.85,0.,.35,0.);
 float photoIndex=kind>=40.?kind-40.:kind-20.;
 for(int i=0;i<12;i++){if(abs(float(i)-photoIndex)<.1)params=u_photo_params[i];}
 vec4 texel=photo?texture2D(u_photos,uv):texture2D(u_atlas,uv);
 bool textured=photo||kind==1.||kind==4.||kind==9.||(kind>=10.&&kind<=17.);
 vec3 c=textured?texel.rgb*v_color:v_color;
 float a=kind==5.?v_uv.x:(textured?texel.a:1.);
 if(kind==4.){if(a<.3)discard;a=smoothstep(.3,.75,a);}
 if(a<.005)discard;
 if(kind==5.){gl_FragColor=vec4(c*a,a);return;}
 vec3 n=normalize(v_normal),view=normalize(u_camera-v_world),sun=normalize(vec3(.6,.35,.85));
 if(kind==2.||kind==10.||kind==17.){
  float frequency=kind==10.?5.5:kind==17.?18.:1.;
  float phase=v_uv.x*frequency*6.283185;
  float aa=1.-smoothstep(.2,.65,fwidth(v_uv.x)*frequency);
  vec3 tangent=normalize(vec3(-n.y,n.x,.0001));n=normalize(n+tangent*cos(phase)*.2*aa);
 }
 float grain=mix(noise(v_world.xy*32.+v_world.z*19.),.5,smoothstep(.25,1.,length(fwidth(v_world.xy))*32.));
 if(kind==6.||kind==7.||kind==8.||kind==19.){
  c*=.88+.14*grain+.07*noise(v_world.xy*.53);
  if(kind==6.)c*=.94+.06*smoothstep(.01,.035,min(fract(v_world.x*.8),fract(v_world.y*.25)));
 }
 bool glass=kind==3.||kind==9.||(photo&&kind>=40.);
 float ndl=max(0.,dot(n,sun)),ndv=max(.01,abs(dot(n,view)));
 vec3 linear=pow(max(c,vec3(0.)),vec3(2.2));
 vec3 hemi=mix(vec3(.27,.29,.25),vec3(.54,.61,.72),n.z*.5+.5);
 float sunlit=visibility(v_world,normalize(v_normal));
 vec3 lit=linear*(hemi+vec3(.7,.66,.57)*ndl*sunlit);
 lit*=.8+.2*smoothstep(0.,1.1,v_world.z);
 // Capture lighting is already in an ordinary photograph. Apply controlled
 // relighting rather than baking a second strong shadow into every facade.
 if(photo){
  lit=mix(linear,lit,params.z);
  vec3 halfVector=normalize(view+sun);float nh=max(0.,dot(n,halfVector));
  float roughness=max(.08,params.x),a2=pow(roughness,4.);
  float distribution=a2/(3.14159*pow(nh*nh*(a2-1.)+1.,2.));
  vec3 f0=mix(vec3(.04),linear,params.y);
  lit+=f0*min(.5,distribution*.015)*ndl*sunlit*params.z;
 }
 if(glass){
  float fresnel=.04+.96*pow(1.-ndv,5.);
  vec3 reflected=pow(sky(reflect(-view,n)),vec3(2.2));
  lit=mix(lit,reflected,clamp(.14+fresnel*.75,0.,.85));
  vec3 halfVector=normalize(view+sun);float nh=max(0.,dot(n,halfVector));
  float roughness=photo?params.x:.18,a2=pow(roughness,4.);float d=a2/(3.14159*pow(nh*nh*(a2-1.)+1.,2.));
  lit+=vec3(1.,.94,.82)*min(.24,d*.002)*ndl*sunlit;
 }
 if(kind==4.)lit=linear*(.38+.62*abs(dot(n,sun))*sunlit);
 gl_FragColor=vec4(pow(max(lit,vec3(0.)),vec3(1./2.2))*a,a);
}`;
  function rgb(hex){const x=/^#[0-9a-f]{6}$/i.test(hex||'')?hex:'#c9c8c2';return [1,3,5].map(i=>parseInt(x.slice(i,i+2),16)/255);}
  function shader(gl,type,src){const s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)){const e=gl.getShaderInfoLog(s);gl.deleteShader(s);throw new Error(e)}return s;}
  function program(gl){
    const modern=typeof gl.texStorage2D==='function';
    const vertex=modern?'#version 300 es\n'+VS.replace(/attribute /g,'in ').replace(/varying /g,'out '):VS;
    let fragment=FS;
    if(modern)fragment='#version 300 es\n'+FS.replace('#extension GL_OES_standard_derivatives : enable\n','').replace('precision highp float;','precision highp float;\nout vec4 fragmentColor;').replace(/varying /g,'in ').replace(/texture2D\(/g,'texture(').replace(/gl_FragColor/g,'fragmentColor');
    else if(!gl.getExtension('OES_standard_derivatives'))fragment=FS.replace('#extension GL_OES_standard_derivatives : enable\n','').replace(/fwidth\(v_uv.x\)/g,'1.').replace(/fwidth\(v_world.xy\)/g,'vec2(1.)');
    const v=shader(gl,gl.VERTEX_SHADER,vertex),f=shader(gl,gl.FRAGMENT_SHADER,fragment),p=gl.createProgram();gl.attachShader(p,v);gl.attachShader(p,f);gl.linkProgram(p);gl.deleteShader(v);gl.deleteShader(f);if(!gl.getProgramParameter(p,gl.LINK_STATUS)){const e=gl.getProgramInfoLog(p);gl.deleteProgram(p);throw new Error(e)}return p;
  }
  function shadowProgram(gl){
    let vs=`precision highp float;attribute vec3 a_position;attribute vec2 a_uv;attribute float a_texture;uniform mat4 u_light;varying vec2 v_uv;varying float v_kind;void main(){v_uv=a_uv;v_kind=a_texture;gl_Position=u_light*vec4(a_position,1.);}`;
    let fs=`precision highp float;uniform sampler2D u_atlas;uniform sampler2D u_photos;varying vec2 v_uv;varying float v_kind;void main(){if(v_kind>4.5&&v_kind<5.5)discard;if(v_kind>3.5&&v_kind<4.5&&texture2D(u_atlas,v_uv).a<.48)discard;if(v_kind>=20.&&texture2D(u_photos,v_uv).a<.1)discard;vec4 c=fract(gl_FragCoord.z*vec4(1.,255.,65025.,16581375.));c-=c.yzww*vec4(1./255.,1./255.,1./255.,0.);gl_FragColor=c;}`;
    if(typeof gl.texStorage2D==='function'){
      vs='#version 300 es\n'+vs.replace(/attribute /g,'in ').replace(/varying /g,'out ');
      fs='#version 300 es\n'+fs.replace('precision highp float;','precision highp float;out vec4 shadowDepth;').replace(/varying /g,'in ').replace(/texture2D\(/g,'texture(').replace('gl_FragColor','shadowDepth');
    }
    const v=shader(gl,gl.VERTEX_SHADER,vs),f=shader(gl,gl.FRAGMENT_SHADER,fs),p=gl.createProgram();gl.attachShader(p,v);gl.attachShader(p,f);gl.linkProgram(p);gl.deleteShader(v);gl.deleteShader(f);
    if(!gl.getProgramParameter(p,gl.LINK_STATUS)){const e=gl.getProgramInfoLog(p);gl.deleteProgram(p);throw new Error(e)}return p;
  }
  function lightMatrix(){
    const l=[.6,.35,.85],len=Math.hypot(...l),z=l.map(x=>x/len),x=[-z[1],z[0],0],xl=Math.hypot(...x);for(let i=0;i<3;i++)x[i]/=xl;
    const y=[z[1]*x[2]-z[2]*x[1],z[2]*x[0]-z[0]*x[2],z[0]*x[1]-z[1]*x[0]],m=new Float32Array(16);
    for(let i=0;i<3;i++){m[i*4]=x[i]/220;m[i*4+1]=y[i]/220;m[i*4+2]=-z[i]/340;}
    m[13]=-y[2]*20/220;m[14]=z[2]*20/340;m[15]=1;return m;
  }
  function localMatrix(m,origin,scale){
    const out=new Float32Array(16);
    for(let i=0;i<4;i++){out[i]=m[i]*scale;out[4+i]=-m[4+i]*scale;out[8+i]=m[8+i]*scale;out[12+i]=m[i]*origin[0]+m[4+i]*origin[1]+m[12+i];}
    return out;
  }
  function cameraFromMatrix(m){
    // Perspective centre solves clip x=y=w=0, without private map internals.
    const rows=[0,1,3].map(i=>[m[i],m[i+4],m[i+8],-m[i+12]]);
    for(let k=0;k<3;k++){
      let pivot=k;for(let j=k+1;j<3;j++)if(Math.abs(rows[j][k])>Math.abs(rows[pivot][k]))pivot=j;
      [rows[k],rows[pivot]]=[rows[pivot],rows[k]];
      if(Math.abs(rows[k][k])<1e-10)return [0,-120,90];
      const d=rows[k][k];for(let j=k;j<4;j++)rows[k][j]/=d;
      for(let i=0;i<3;i++)if(i!==k){const f=rows[i][k];for(let j=k;j<4;j++)rows[i][j]-=f*rows[k][j];}
    }
    return rows.map(r=>r[3]);
  }
  function makeAtlas(astra){
    const canvas=document.createElement('canvas');canvas.width=2048;canvas.height=2048;
    const ctx=canvas.getContext('2d');ctx.fillStyle='#ffffff';ctx.fillRect(0,0,2048,2048);
    const slots=new Map(),jobs=[];let materialSlot=0,signSlot=0;
    const reserve=(id,material=false)=>{if(slots.has(id))return slots.get(id);if(material?materialSlot>=8:signSlot>=32)return null;const slot=material?materialSlot++:signSlot++,cell=material?512:256,columns=2048/cell,x=slot%columns*cell,y=Math.floor(slot/columns)*cell+(material?0:1024);const r={x,y,cell,u0:(x+2)/2048,v0:(y+2)/2048,u1:(x+cell-2)/2048,v1:(y+cell-2)/2048};slots.set(id,r);return r;};
    for(const [index,m] of (astra.materials||[]).entries()){
      if(m.mode==='facade')continue;
      const r=reserve(m.id,true);if(!r)continue;
      r.repeat=m.repeat_m;r.repeatTexture=10+materialSlot-1;
      jobs.push(new Promise(resolve=>{const img=new Image();img.onload=()=>{ctx.drawImage(img,r.x+2,r.y+2,r.cell-4,r.cell-4);resolve()};img.onerror=resolve;img.src=m.data_url}));
    }
    for(const parent of astra.buildings)for(const b of parent.parts||[parent])for(const f of b.facades)for(const m of f.modules){
      if(m.kind!=='sign'||!m.text)continue;
      const id='sign:'+m.text+':'+m.color+':'+m.text_color,r=reserve(id);if(!r)continue;
      ctx.fillStyle=m.color;ctx.fillRect(r.x,r.y,r.cell,r.cell);ctx.fillStyle=m.text_color;
      ctx.textAlign='center';ctx.textBaseline='middle';ctx.font='600 42px Arial,sans-serif';
      const fontH=148;
      // Text is flattened into an atlas once, never a camera-facing billboard.
      ctx.font='600 '+fontH+'px Arial,sans-serif';ctx.fillText(m.text,r.x+128,r.y+128,238);
    }
    // Irregular small leaf clusters on world-oriented twig cards. This atlas
    // is generated once, not a camera-facing photograph or solid polygon blob.
    const leaf=reserve('foliage');
    if(leaf){
      ctx.clearRect(leaf.x,leaf.y,leaf.cell,leaf.cell);let seed=1937;
      const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
      for(let twig=0;twig<7;twig++){
        const a=rand()*Math.PI*2,tx=128+Math.cos(a)*(35+rand()*60),ty=128+Math.sin(a)*(35+rand()*60);
        ctx.strokeStyle='#777761';ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(leaf.x+128,leaf.y+128);ctx.lineTo(leaf.x+tx,leaf.y+ty);ctx.stroke();
        for(let i=0;i<26;i++){
          const t=rand(),x=128+(tx-128)*t+(rand()-.5)*62,y=128+(ty-128)*t+(rand()-.5)*56;
          const light=145+Math.floor(rand()*100);ctx.fillStyle='rgb('+light+','+light+','+Math.floor(light*.82)+')';
          ctx.beginPath();ctx.ellipse(leaf.x+x,leaf.y+y,3+rand()*5,1.7+rand()*3,rand()*Math.PI,0,Math.PI*2);ctx.fill();
        }
      }
    }
    const photos=makePhotoAtlas(astra);
    for(const [id,slot] of photos.slots)slots.set(id,slot);
    return {canvas,slots,photos,ready:Promise.all([...jobs,photos.ready])};
  }
  function makePhotoAtlas(astra){
    const materials=(astra.materials||[]).filter(m=>m.mode==='facade'),canvas=document.createElement('canvas');
    const size=materials.length?4096:1;canvas.width=canvas.height=size;
    const slots=new Map(),params=new Float32Array(48),ctx=canvas.getContext('2d');
    let placement=[],scale=1;
    for(let attempt=0;attempt<12;attempt++){
      let x=0,y=0,row=0;placement=[];
      for(const [index,m] of materials.entries()){
        const w=Math.max(32,Math.floor(m.width*scale)),h=Math.max(32,Math.floor(m.height*scale));
        if(x+w+32>size){x=0;y+=row;row=0;}
        placement.push({m,index,x:x+16,y:y+16,w,h});x+=w+32;row=Math.max(row,h+32);
      }
      if(!placement.length||placement.every(p=>p.y+p.h+16<=size))break;
      scale*=.8;
    }
    const jobs=placement.map(({m,index,x,y,w,h})=>{
      slots.set(m.id,{u0:(x+.5)/size,v0:(y+.5)/size,u1:(x+w-.5)/size,v1:(y+h-.5)/size,texture:20+index,oriented:true});
      params.set([m.roughness??.85,m.metalness??0,m.lighting_mix??.35,0],index*4);
      return new Promise(resolve=>{const img=new Image();img.onload=()=>{
        ctx.drawImage(img,x,y,w,h);
        // 16px gutters prevent neighboring facades leaking into oblique mipmaps.
        ctx.drawImage(img,0,0,1,img.height,x-16,y,16,h);ctx.drawImage(img,img.width-1,0,1,img.height,x+w,y,16,h);
        ctx.drawImage(canvas,x-16,y,w+32,1,x-16,y-16,w+32,16);ctx.drawImage(canvas,x-16,y+h-1,w+32,1,x-16,y+h,w+32,16);
        resolve();};img.onerror=()=>resolve();img.src=m.data_url;});
    });
    return {canvas,slots,params,scale,ready:Promise.all(jobs)};
  }
  function subtractRectangles(rect,holes){
    let parts=[rect];
    for(const h of holes){
      const next=[];
      for(const p of parts){
        const x0=Math.max(p[0],h[0]),y0=Math.max(p[1],h[1]),x1=Math.min(p[0]+p[2],h[0]+h[2]),y1=Math.min(p[1]+p[3],h[1]+h[3]);
        if(x1<=x0||y1<=y0){next.push(p);continue;}
        if(y0>p[1])next.push([p[0],p[1],p[2],y0-p[1]]);
        if(y1<p[1]+p[3])next.push([p[0],y1,p[2],p[1]+p[3]-y1]);
        if(x0>p[0])next.push([p[0],y0,x0-p[0],y1-y0]);
        if(x1<p[0]+p[2])next.push([x1,y0,p[0]+p[2]-x1,y1-y0]);
      }parts=next;
    }return parts;
  }
  function buildMesh(marker,scene,astra,atlas,{compact=false}={}){
    const coordinateFrame=S.frame([Number(marker.lon),Number(marker.lat)]),lodCounts=[0,0];
    const budget=180000*3*STRIDE;
    let out=new Float32Array(4096*3*STRIDE),used=0;
    const addTri=(a,b,c,n,col,uv,tex=0,lod=0,order=0)=>{
      if(used+3*STRIDE>budget)throw new Error('astra_geometry_budget');
      if(used+3*STRIDE>out.length){const larger=new Float32Array(Math.min(budget,out.length*2));larger.set(out);out=larger;}
      for(let i=0;i<3;i++){
        const p=[a,b,c][i];out.set(p,used);out.set(n,used+3);out.set(col,used+6);out.set(uv[i],used+9);
        out[used+11]=tex;out[used+12]=lod;out[used+13]=order;used+=STRIDE;
      }
      lodCounts[lod?1:0]++;
    };
    const quad=(p,n,col,slot,lod=0,order=0)=>{
      const r=slot||{u0:0,v0:0,u1:0,v1:0},uv=[[r.u0,r.v1],[r.u1,r.v1],[r.u1,r.v0],[r.u0,r.v0]];
      addTri(p[0],p[1],p[2],n,col,[uv[0],uv[1],uv[2]],slot?(slot.texture||1):0,lod,order);
      addTri(p[0],p[2],p[3],n,col,[uv[0],uv[2],uv[3]],slot?(slot.texture||1):0,lod,order);
    };
    const material=(id,w,h,glass=false)=>{
      const r=atlas.slots.get(id);if(!r)return null;
      if(glass)return {...r,texture:r.texture>=20?r.texture+20:9};
      return r.repeat?{u0:0,u1:w/r.repeat[0],v0:0,v1:h/r.repeat[1],texture:r.repeatTexture}:r;
    };
    if(astra.materials?.length&&astra.environment?.roads?.length){
      // The same local quarter ground, now receiving the same light/shadow map
      // as its facades. No detached landscape or changed building coordinates.
      const radius=Math.min(280,Math.max(100,Number(scene.radius_m)||244));
      for(let i=0;i<96;i++){
        const a=i*Math.PI/48,b=(i+1)*Math.PI/48;
        addTri([0,0,.008],[Math.cos(a)*radius,Math.sin(a)*radius,.008],[Math.cos(b)*radius,Math.sin(b)*radius,.008],[0,0,1],rgb('#a6a69b'),[[0,0],[0,0],[0,0]],19,0,0);
      }
    }
    const shells=astra.buildings.flatMap(b=>(b.parts||[b]).map(p=>({...p,parent_id:b.building_id})));
    for(const [bi,b] of shells.entries()){
      const parent=scene.buildings.find(x=>String(x.id)===b.parent_id),base=b.ring?{...parent,ring:b.ring}:parent,edges=S.edges(base.ring,[Number(marker.lon),Number(marker.lat)]),order=b.role==='hero'?0:Math.min(1,bi/10),height=b.height_m;
      for(const edge of edges){
        if(edge.length<.2)continue;
        const f=b.facades.find(x=>x.edge_index===edge.index),n=[...edge.normal,0],t=[...edge.tangent,0];
        const point=(u,z,d=0)=>[edge.a[0]+edge.tangent[0]*u+edge.normal[0]*(d+.035),edge.a[1]+edge.tangent[1]*u+edge.normal[1]*(d+.035),z];
        const plane=(u,z,w,h,d,col,slot,lod=0)=>{
          // Photo crops and lettering read left-to-right from outside, even
          // when OSM stores a clockwise polygon. Module u still follows edge.
          const uv=slot&&!slot.oriented&&edge.normal[0]*edge.tangent[1]-edge.normal[1]*edge.tangent[0]<0?{...slot,u0:slot.u1,u1:slot.u0}:slot;
          quad([point(u,z,d),point(u+w,z,d),point(u+w,z+h,d),point(u,z+h,d)],n,rgb(col),uv,lod,order);
        };
        const box=(u,z,w,h,d,col,lod=0)=>{
          plane(u,z,w,h,d,col,null,lod);const c=rgb(col);
          quad([point(u,z,0),point(u,z,d),point(u,z+h,d),point(u,z+h,0)],t.map(v=>-v),c,null,lod,order);
          quad([point(u+w,z,d),point(u+w,z,0),point(u+w,z+h,0),point(u+w,z+h,d)],t,c,null,lod,order);
          quad([point(u,z+h,d),point(u+w,z+h,d),point(u+w,z+h,0),point(u,z+h,0)],[0,0,1],c,null,lod,order);
          quad([point(u,z,0),point(u+w,z,0),point(u+w,z,d),point(u,z,d)],[0,0,-1],c,null,lod,order);
        };
        const facadeTexture=material(f?.material_id,edge.length,height-b.base_m),ribbed=f?.wall?.finish==='ribbed';
        const surfaces=f?.surfaces||[];
        if(!surfaces.length)plane(0,b.base_m,edge.length,height-b.base_m,0,facadeTexture?'#ffffff':f?.wall?.color||base.palette?.wall,facadeTexture||(ribbed?{u0:0,u1:edge.length/f.wall.module_m,v0:1,v1:0,texture:2}:null));
        else{
          for(const p of subtractRectangles([0,b.base_m,edge.length,height-b.base_m],surfaces.map(s=>[s.u_m,s.z_m,s.width_m,s.height_m])))plane(...p,0,f.wall.color,null);
          for(const s of surfaces){
            const slot=atlas.slots.get(s.material_id),w=s.width_m,h=s.height_m,d=s.depth_m,openings=s.openings||[];
            if(!slot){plane(s.u_m,s.z_m,w,h,d,f.wall.color,null);continue;}
            const patch=(x,z,pw,ph,depth,glass=false)=>{
              const u=q=>slot.u0+(slot.u1-slot.u0)*(s.flip_u?1-q:q),v=q=>slot.v1-(slot.v1-slot.v0)*q;
              plane(s.u_m+x,s.z_m+z,pw,ph,depth-.002,f.wall.color,null);
              plane(s.u_m+x,s.z_m+z,pw,ph,depth,'#ffffff',{...slot,u0:u(x/w),u1:u((x+pw)/w),v0:v((z+ph)/h),v1:v(z/h),texture:slot.texture+(glass?20:0),oriented:true});
            };
            for(const p of subtractRectangles([0,0,w,h],openings.map(o=>[o.u_m,o.z_m,o.width_m,o.height_m])))patch(...p,d);
            for(const o of openings){
              patch(o.u_m,o.z_m,o.width_m,o.height_m,d-o.depth_m,o.glass);
              const u=s.u_m+o.u_m,z=s.z_m+o.z_m,ow=o.width_m,oh=o.height_m,c=rgb(o.reveal_color),back=d-o.depth_m;
              quad([point(u,z,d),point(u,z,back),point(u,z+oh,back),point(u,z+oh,d)],t,c,null,0,order);
              quad([point(u+ow,z,back),point(u+ow,z,d),point(u+ow,z+oh,d),point(u+ow,z+oh,back)],t.map(v=>-v),c,null,0,order);
              quad([point(u,z,d),point(u+ow,z,d),point(u+ow,z,back),point(u,z,back)],[0,0,1],c,null,0,order);
              quad([point(u,z+oh,back),point(u+ow,z+oh,back),point(u+ow,z+oh,d),point(u,z+oh,d)],[0,0,-1],c,null,0,order);
            }
          }
        }
        if(f){
          // Joints describe a measured material; they do not invent openings.
          if(!surfaces.length&&['panel','metal','stone','brick'].includes(f.wall.finish)){
            const step=f.wall.module_m,joint=f.wall.finish==='brick'?.008:.018,max=Math.min(100,Math.floor(edge.length/step));
            for(let i=1;i<=max;i++)plane(i*step,b.base_m,joint,height-b.base_m,.004,f.wall.joint_color,null,1);
            const dz=f.wall.finish==='brick'?.09:3;
            for(let z=b.base_m+dz;z<height&&z<130;z+=dz)plane(0,z,edge.length,joint,.006,f.wall.joint_color,null,1);
          }
          for(const m of f.modules){
            const u=m.u_m,z=m.z_m,w=m.width_m,h=m.height_m,d=m.depth_m,lod=m.lod,fw=Math.min(m.frame_m,w/4,h/4);
            if(m.kind==='window'||m.kind==='entrance'||m.kind==='storefront'){
              if(m.kind==='window'&&(compact||b.role!=='hero')){
                // Mid-distance LOD keeps the measured opening positions and
                // colors, but replaces sub-pixel frame side faces with planes.
                plane(u,z,w,h,d,m.frame_color,null,lod);
                plane(u+fw,z+fw,w-2*fw,h-2*fw,d+.003,m.material_id?'#ffffff':m.color,material(m.material_id,w,h,true)||{u0:0,u1:1,v0:1,v1:0,texture:3},lod);
                for(let pane=1;pane<m.panes;pane++)plane(u+w*pane/m.panes-fw/2,z,fw,h,d+.006,m.frame_color,null,lod);
                continue;
              }
              // Dark reveal, projecting frame, recessed glazing and actual sill.
              plane(u,z,w,h,Math.max(.032,d*.38),'#222a2e',null,lod);
              plane(u+fw,z+fw,w-2*fw,h-2*fw,Math.max(.036,d*.55),m.material_id?'#ffffff':m.color,material(m.material_id,w,h,true)||{u0:0,u1:1,v0:1,v1:0,texture:3},lod);
              box(u,z,fw,h,d,m.frame_color,lod);box(u+w-fw,z,fw,h,d,m.frame_color,lod);
              box(u,z,w,fw,d,m.frame_color,lod);box(u,z+h-fw,w,fw,d,m.frame_color,lod);
              for(let pane=1;pane<m.panes;pane++)box(u+w*pane/m.panes-fw/2,z,fw,h,d,m.frame_color,lod);
              if(m.kind==='window')box(u,z+h*.76,w,fw*.7,d,m.frame_color,lod);
              if(m.kind==='window')box(u-.04,z-.04,w+.08,.07,d+.07,m.frame_color,lod);
              if(m.kind==='entrance'){box(u+w*.75,z+h*.42,.035,.24,d+.04,'#a5afb2',0);box(u,z-.1,w,.1,.4,'#898b89',0);}
            }else if(m.kind==='balcony'){
              box(u,z,w,.14,d,m.frame_color,0);
              plane(u,z+.14,w,h-.14,d,m.material_id?'#ffffff':m.color,atlas.slots.get(m.material_id));
              box(u,z+.14,.055,h-.14,d,m.frame_color,0);box(u+w-.055,z+.14,.055,h-.14,d,m.frame_color,0);
              if(m.glazed){box(u,z+h-.08,w,.08,d,m.frame_color,0);for(let i=1;i<m.panes;i++)box(u+w*i/m.panes,z,.035,h,d,m.frame_color,0);}
              else{box(u,z+h-.06,w,.06,d,m.frame_color,0);}
            }else if(m.kind==='medical-heart'||m.kind==='metro-m'){
              // Raised vector outline traced from the supplied clinic reference.
              // This is facade geometry, not a rectangular photo or billboard.
              const heart=[[.5,.02],[.18,.24],[.05,.45],[.02,.66],[.12,.88],[.3,.96],[.5,.8],[.7,.96],[.88,.88],[.98,.66],[.95,.45],[.82,.24],[.5,.02]];
              const monogram=[[.31,.23],[.31,.75],[.5,.58],[.69,.75],[.69,.23]];
              const lines=m.kind==='medical-heart'?[heart,monogram]:[[[.03,.04],[.24,.94],[.5,.33],[.76,.94],[.97,.04]]];
              for(const line of lines)for(let i=1;i<line.length;i++){
                const a=[u+line[i-1][0]*w,z+line[i-1][1]*h],c=[u+line[i][0]*w,z+line[i][1]*h],dx=c[0]-a[0],dz=c[1]-a[1],len=Math.hypot(dx,dz),th=Math.min(w,h)*.035;
                const ox=-dz/len*th,oz=dx/len*th;
                quad([point(a[0]+ox,a[1]+oz,d),point(c[0]+ox,c[1]+oz,d),point(c[0]-ox,c[1]-oz,d),point(a[0]-ox,a[1]-oz,d)],n,rgb(m.color),null,0,order);
              }
            }else if(m.kind==='sign'){
              box(u,z,w,h,d,m.color);const key='sign:'+m.text+':'+m.color+':'+m.text_color;
              plane(u,z,w,h,d+.006,'#ffffff',atlas.slots.get(key)||atlas.slots.get(m.material_id));
            }else if(m.kind==='canopy'){
              box(u,z,w,h,d,m.color);
            }else{
              box(u,z,w,h,Math.max(.02,d),m.color,lod);
              if(m.material_id)plane(u,z,w,h,Math.max(.02,d)+.001,'#ffffff',material(m.material_id,w,h),lod);
            }
          }
        }
        if(b.roof.parapet_m)box(0,height-b.roof.parapet_m,edge.length,b.roof.parapet_m,.055,b.roof.color,0);
      }
      const roof=S.ring(base.ring).slice(0,-1).map(coordinateFrame.toLocal),idx=root.earcut(roof.flat()),col=rgb(b.roof.color);
      for(let j=0;j<idx.length;j+=3)addTri([...roof[idx[j]],height+.035],[...roof[idx[j+1]],height+.035],[...roof[idx[j+2]],height+.035],[0,0,1],col,[[0,0],[0,0],[0,0]],6,0,order);
    }
    const beam=(a,b,width,col)=>{
      const d=b.map((v,i)=>v-a[i]),length=Math.hypot(...d);if(length<.01)return;
      const t=d.map(v=>v/length),raw=Math.abs(t[2])>.95?[1,0,0]:[-t[1],t[0],0],rl=Math.hypot(...raw),n=raw.map(v=>v/rl),k=[t[1]*n[2]-t[2]*n[1],t[2]*n[0]-t[0]*n[2],t[0]*n[1]-t[1]*n[0]];
      const corner=(p,s,q)=>p.map((v,i)=>v+width*.5*(n[i]*s+k[i]*q));
      const color=rgb(col);
      for(const [s,q,s2,q2] of [[-1,-1,1,-1],[1,-1,1,1],[1,1,-1,1],[-1,1,-1,-1]])quad([corner(a,s,q),corner(b,s,q),corner(b,s2,q2),corner(a,s2,q2)],n.map((v,i)=>v*(s+s2)/2+k[i]*(q+q2)/2),color,null,0,.3);
    };
    for(const fence of astra.environment?.fences||[]){
      const a=coordinateFrame.toLocal(fence.start),b=coordinateFrame.toLocal(fence.end),h=fence.height_m,len=Math.hypot(b[0]-a[0],b[1]-a[1]);
      for(const z of [.25,h-.08])beam([...a,z],[...b,z],.06,'#424f54');
      const count=Math.ceil(len/.2);for(let i=0;i<=count;i++){
        const p=[a[0]+(b[0]-a[0])*i/count,a[1]+(b[1]-a[1])*i/count];beam([...p,.12],[...p,h],i%12===0?.09:.045,'#536168');
      }
    }
    for(const lamp of astra.environment?.lamps||[]){
      const p=coordinateFrame.toLocal(lamp.coordinates),h=lamp.height_m,a=lamp.bearing*Math.PI/180,q=[p[0]+Math.sin(a)*1.8,p[1]+Math.cos(a)*1.8,h-.3];
      beam([...p,0],[...p,h-1],.11,'#889395');beam([...p,h-1],q,.085,'#7c888b');
      beam(q,[q[0]+Math.sin(a)*.65,q[1]+Math.cos(a)*.65,q[2]],.24,'#46545b');
    }
    for(const road of astra.environment?.roads||[]){
      const line=road.coordinates.map(coordinateFrame.toLocal),path=road.class==='path',w=path?2.1:road.class==='service'?4.4:road.class==='minor'?6.5:8;
      const strip=(a,b,width,z,color,asphalt=false)=>{const dx=b[0]-a[0],dy=b[1]-a[1],len=Math.hypot(dx,dy);if(len<.1)return;const n=[-dy/len*width/2,dx/len*width/2],slot=asphalt?material('street-asphalt',len,width):null;quad([[a[0]+n[0],a[1]+n[1],z],[b[0]+n[0],b[1]+n[1],z],[b[0]-n[0],b[1]-n[1],z],[a[0]-n[0],a[1]-n[1],z]],[0,0,1],rgb(slot?'#ffffff':color),slot||{u0:0,u1:1,v0:0,v1:1,texture:7},0,0);};
      for(let i=1;i<line.length;i++){
        const a=line[i-1],b=line[i];strip(a,b,w+.4,.018,'#aaa99f');strip(a,b,w,.025,path?'#a5a49a':'#555b5d',!path);
        if(!path&&!['service','minor'].includes(road.class)){
          const len=Math.hypot(b[0]-a[0],b[1]-a[1]);
          for(let u=0;u+2<len;u+=7){const at=t=>[a[0]+(b[0]-a[0])*t/len,a[1]+(b[1]-a[1])*t/len];strip(at(u),at(u+2),.11,.032,'#dbdacd');}
        }
      }
    }
    for(const ring of [...(astra.materials?.length?scene.greens||[]:[]),...(astra.environment?.greens||[])]){
      const p=S.ring(ring).slice(0,-1).map(coordinateFrame.toLocal),idx=root.earcut(p.flat());
      for(let j=0;j<idx.length;j+=3)addTri([...p[idx[j]],.045],[...p[idx[j+1]],.045],[...p[idx[j+2]],.045],[0,0,1],rgb('#687451'),[[0,0],[0,0],[0,0]],8,0,0);
    }
    if(astra.environment&&!astra.materials?.length){
      // Ground contact and soft directional shadows, in metres, using the same
      // sunlight vector as facade lighting. No separate render target or loop.
      const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
      for(const b of astra.buildings){
        const base=scene.buildings.find(x=>String(x.id)===b.building_id),p=S.ring(base.ring).slice(0,-1).map(coordinateFrame.toLocal);
        const pts=[...p,...p.map(v=>[v[0]-b.height_m*.6,v[1]-b.height_m*.35])].sort((a,b)=>a[0]-b[0]||a[1]-b[1]),lo=[],hi=[];
        for(const q of pts){while(lo.length>1&&cross(lo.at(-2),lo.at(-1),q)<=0)lo.pop();lo.push(q);}
        for(const q of [...pts].reverse()){while(hi.length>1&&cross(hi.at(-2),hi.at(-1),q)<=0)hi.pop();hi.push(q);}
        const hull=[...lo.slice(0,-1),...hi.slice(0,-1)],center=hull.reduce((s,v)=>[s[0]+v[0]/hull.length,s[1]+v[1]/hull.length],[0,0]),dark=rgb('#263332'),z=.042;
        const out=hull.map(p=>{const d=Math.hypot(p[0]-center[0],p[1]-center[1]);return [p[0]+(p[0]-center[0])/d*.9,p[1]+(p[1]-center[1])/d*.9,z];});
        for(let i=0;i<hull.length;i++){
          const j=(i+1)%hull.length,a=[...hull[i],z],b=[...hull[j],z];
          addTri([...center,z],a,b,[0,0,1],dark,[[.17,0],[.17,0],[.17,0]],5,0,0);
          addTri(a,out[i],out[j],[0,0,1],dark,[[.17,0],[0,0],[0,0]],5,0,0);
          addTri(a,out[j],b,[0,0,1],dark,[[.17,0],[0,0],[.17,0]],5,0,0);
        }
      }
    }
    // Tree positions and street details belong to the same world coordinate frame.
    // They are authored from references; no random point placement on roads.
    for(const [treeIndex,tree] of (astra.environment?.trees||[]).entries()){
      const p=coordinateFrame.toLocal(tree.coordinates),h=tree.height_m,r=tree.radius_m;
      const bark=rgb('#6a6659'),leaf=rgb(tree.color||'#6b7e43');
      for(let i=0;i<7;i++){
        const a=i/7*Math.PI*2,b=(i+1)/7*Math.PI*2;
        quad([[p[0]+.13*Math.cos(a),p[1]+.13*Math.sin(a),0],[p[0]+.13*Math.cos(b),p[1]+.13*Math.sin(b),0],[p[0]+.09*Math.cos(b),p[1]+.09*Math.sin(b),h*.62],[p[0]+.09*Math.cos(a),p[1]+.09*Math.sin(a),h*.62]],[Math.cos(a),Math.sin(a),.1],bark,null,0,.5);
      }
      let seed=1937+treeIndex*7919;const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
      for(let branch=0;branch<9;branch++){
        const a=branch*2.399+treeIndex,z=h*(.36+rand()*.22),tip=[p[0]+Math.cos(a)*r*.76,p[1]+Math.sin(a)*r*.76,h*(.64+rand()*.16)];
        beam([...p,z],tip,.05+rand()*.055,'#6b6655');
      }
      const slot=atlas.slots.get('foliage')||{u0:0,u1:0,v0:0,v1:0};
      for(let i=0;i<(compact?160:270);i++){
        const a=rand()*Math.PI*2,cz=rand()*2-1,rad=Math.cbrt(rand()),xy=Math.sqrt(1-cz*cz)*rad;
        const centre=[p[0]+Math.cos(a)*xy*r,p[1]+Math.sin(a)*xy*r,h-r*1.08+cz*rad*r*1.12],size=r*(.3+rand()*.19);
        const az=rand()*Math.PI*2,tilt=(rand()-.5)*1.5,t=[Math.cos(az),Math.sin(az),0],up=[-Math.sin(az)*Math.sin(tilt),Math.cos(az)*Math.sin(tilt),Math.cos(tilt)];
        const at=(x,y)=>centre.map((v,j)=>v+size*(t[j]*x+up[j]*y));
        const n=[t[1]*up[2],-t[0]*up[2],t[0]*up[1]-t[1]*up[0]];
        quad([at(-1,-1),at(1,-1),at(1,1),at(-1,1)],n,leaf.map(c=>c*(.83+rad*.25)),{...slot,texture:4},0,.5);
      }
    }
    return {vertices:out.slice(0,used),...coordinateFrame,triangles:lodCounts.reduce((a,b)=>a+b,0)};
  }
  function create({marker,profile,reducedMotion=false,onError=()=>{}}){
    if(!S?.bound(profile?.astra,marker,profile?.scene)||!root.earcut)return null;
    const astra=profile.astra,atlas=makeAtlas(astra);
    let mesh;
    try{mesh=buildMesh(marker,profile.scene,astra,atlas)}catch(e){
      if(e.message!=='astra_geometry_budget'){onError(e);return null;}
      try{mesh=buildMesh(marker,profile.scene,astra,atlas,{compact:true})}catch(error){onError(error);return null;}
    }
    const pickFaces=astra.buildings.flatMap(parent=>(parent.parts||[parent]).flatMap(b=>{
      const base=profile.scene.buildings.find(x=>String(x.id)===parent.building_id);
      return S.edges(b.ring||base.ring,[Number(marker.lon),Number(marker.lat)]).map(e=>({building_id:parent.building_id,edge_index:e.index,role:b.role,evidence:b.facades.find(f=>f.edge_index===e.index)?.evidence||'inferred',vertices:[[...e.a,b.base_m],[...e.b,b.base_m],[...e.b,b.height_m],[...e.a,b.height_m]]}));
    }));
    if(mesh.triangles>180000){onError(new Error('astra_geometry_budget'));return null;}
    const layer={id:'realcity-astra-facades',type:'custom',renderingMode:'3d',ready:false,disposed:false,progress:reducedMotion?1:0,
      stats:{buildings:astra.buildings.length,triangles:mesh.triangles,bytes:mesh.vertices.byteLength,photo_atlas_scale:atlas.photos.scale,photo_materials:atlas.photos.slots.size},
      onAdd(map,gl){
        this.map=map;this.gl=gl;
        if(!this.contextLost){
          this.contextLost=()=>{this.ready=false;};
          this.contextRestored=()=>{if(!this.disposed){this.onAdd(map,gl);map.triggerRepaint();}};
          map.getCanvas().addEventListener('webglcontextlost',this.contextLost);
          map.getCanvas().addEventListener('webglcontextrestored',this.contextRestored);
        }
        try{
          this.program=program(gl);this.buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);gl.bufferData(gl.ARRAY_BUFFER,mesh.vertices,gl.STATIC_DRAW);
          this.vao=gl.createVertexArray?.();if(this.vao)gl.bindVertexArray(this.vao);
          this.attributes=[];
          for(const [name,size,offset] of [['a_position',3,0],['a_normal',3,3],['a_color',3,6],['a_uv',2,9],['a_texture',1,11],['a_detail',1,12],['a_order',1,13]]){
            const loc=gl.getAttribLocation(this.program,name);if(loc<0)continue;
            this.attributes.push({loc,size,offset});gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,size,gl.FLOAT,false,STRIDE*4,offset*4);
          }
          if(this.vao)gl.bindVertexArray(null);
          this.uniforms={};for(const n of ['u_matrix','u_progress','u_zoom','u_atlas','u_camera','u_shadow','u_light','u_shadow_ready','u_ground_radius','u_photos','u_photo_params[0]'])this.uniforms[n]=gl.getUniformLocation(this.program,n);
          this.texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,this.texture);
          gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
          if(typeof gl.texStorage2D==='function')gl.texParameterf(gl.TEXTURE_2D,gl.TEXTURE_MAX_LOD,4);
          gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
          this.photoTexture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,this.photoTexture);
          gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
          if(typeof gl.texStorage2D==='function')gl.texParameterf(gl.TEXTURE_2D,gl.TEXTURE_MAX_LOD,4);
          const anisotropy=gl.getExtension('EXT_texture_filter_anisotropic');
          if(anisotropy)gl.texParameterf(gl.TEXTURE_2D,anisotropy.TEXTURE_MAX_ANISOTROPY_EXT,Math.min(8,gl.getParameter(anisotropy.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
          this.uploadAtlas();this.ready=true;this.light=lightMatrix();
          if(astra.materials?.length)this.setupShadow();
          atlas.ready.then(()=>{if(!this.disposed){this.uploadAtlas();map.triggerRepaint()}});
        }catch(e){this.onRemove(map,gl);onError(e);}
      },
      uploadAtlas(){
        const gl=this.gl;gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,false);
        for(const [texture,original] of [[this.texture,atlas.canvas],[this.photoTexture,atlas.photos.canvas]]){
          let canvas=original;const max=gl.getParameter(gl.MAX_TEXTURE_SIZE);
          if(canvas.width>max){canvas=document.createElement('canvas');canvas.width=canvas.height=Math.min(2048,max);canvas.getContext('2d').drawImage(original,0,0,canvas.width,canvas.height);}
          gl.bindTexture(gl.TEXTURE_2D,texture);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,canvas);gl.generateMipmap(gl.TEXTURE_2D);
        }this.shadowDrawn=false;
      },
      setupShadow(){
        const gl=this.gl,framebuffer=gl.getParameter(gl.FRAMEBUFFER_BINDING),renderbuffer=gl.getParameter(gl.RENDERBUFFER_BINDING);
        try{
          this.shadowProgram=shadowProgram(gl);this.shadowFramebuffer=gl.createFramebuffer();this.shadowTexture=gl.createTexture();this.shadowDepth=gl.createRenderbuffer();
          gl.bindTexture(gl.TEXTURE_2D,this.shadowTexture);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1024,1024,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
          gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
          gl.bindRenderbuffer(gl.RENDERBUFFER,this.shadowDepth);gl.renderbufferStorage(gl.RENDERBUFFER,gl.DEPTH_COMPONENT16,1024,1024);
          gl.bindFramebuffer(gl.FRAMEBUFFER,this.shadowFramebuffer);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,this.shadowTexture,0);gl.framebufferRenderbuffer(gl.FRAMEBUFFER,gl.DEPTH_ATTACHMENT,gl.RENDERBUFFER,this.shadowDepth);
          this.shadowSupported=gl.checkFramebufferStatus(gl.FRAMEBUFFER)===gl.FRAMEBUFFER_COMPLETE;this.shadowDrawn=false;
        }catch(error){this.shadowSupported=false;console.warn('RealCity shadow fallback',error.message)}
        finally{gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer);gl.bindRenderbuffer(gl.RENDERBUFFER,renderbuffer);}
      },
      drawShadow(){
        if(!this.shadowSupported||this.shadowDrawn)return;
        const gl=this.gl,framebuffer=gl.getParameter(gl.FRAMEBUFFER_BINDING),viewport=gl.getParameter(gl.VIEWPORT),clear=gl.getParameter(gl.COLOR_CLEAR_VALUE),scissor=gl.isEnabled(gl.SCISSOR_TEST),dither=gl.isEnabled(gl.DITHER),depthRange=gl.getParameter(gl.DEPTH_RANGE),clearDepth=gl.getParameter(gl.DEPTH_CLEAR_VALUE);
        try{
          if(this.vao)gl.bindVertexArray(null);
          // Packed depth is numeric data: framebuffer dithering corrupts its
          // high byte and produces false striped shadows on every surface.
          gl.bindFramebuffer(gl.FRAMEBUFFER,this.shadowFramebuffer);gl.viewport(0,0,1024,1024);gl.disable(gl.SCISSOR_TEST);gl.disable(gl.DITHER);gl.disable(gl.BLEND);gl.disable(gl.CULL_FACE);gl.enable(gl.DEPTH_TEST);gl.depthMask(true);gl.depthFunc(gl.LEQUAL);gl.depthRange(0,1);gl.clearDepth(1);gl.colorMask(true,true,true,true);gl.clearColor(1,1,1,1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
          gl.useProgram(this.shadowProgram);gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);
          const locations=[];
          for(const [name,size,offset] of [['a_position',3,0],['a_uv',2,9],['a_texture',1,11]]){const loc=gl.getAttribLocation(this.shadowProgram,name);if(loc>=0){locations.push(loc);gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,size,gl.FLOAT,false,STRIDE*4,offset*4);}}
          gl.uniformMatrix4fv(gl.getUniformLocation(this.shadowProgram,'u_light'),false,this.light);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,this.texture);gl.uniform1i(gl.getUniformLocation(this.shadowProgram,'u_atlas'),0);
          gl.activeTexture(gl.TEXTURE2);gl.bindTexture(gl.TEXTURE_2D,this.photoTexture);gl.uniform1i(gl.getUniformLocation(this.shadowProgram,'u_photos'),2);
          gl.drawArrays(gl.TRIANGLES,0,mesh.vertices.length/STRIDE);for(const loc of locations)gl.disableVertexAttribArray(loc);this.shadowDrawn=true;
        }finally{gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer);gl.viewport(...viewport);gl.clearColor(...clear);gl.depthRange(...depthRange);gl.clearDepth(clearDepth);if(scissor)gl.enable(gl.SCISSOR_TEST);if(dither)gl.enable(gl.DITHER);}
      },
      setProgress(v){this.progress=Math.max(0,Math.min(1,v));this.map?.triggerRepaint();},
      pick(point){
        if(!this.lastMatrix||this.progress<1)return null;
        const m=this.lastMatrix,w=this.map.getCanvas().clientWidth,h=this.map.getCanvas().clientHeight;
        const projected=v=>{const [x,y,z]=v,d=m[3]*x+m[7]*y+m[11]*z+m[15];return d>0?[(m[0]*x+m[4]*y+m[8]*z+m[12])/d*w/2+w/2,h/2-(m[1]*x+m[5]*y+m[9]*z+m[13])/d*h/2,(m[2]*x+m[6]*y+m[10]*z+m[14])/d]:null;};
        let hit=null;
        for(const face of pickFaces){
          const p=face.vertices.map(projected);if(p.some(v=>!v))continue;let inside=false;
          for(let i=0,j=3;i<4;j=i++)if((p[i][1]>point.y)!==(p[j][1]>point.y)&&point.x<(p[j][0]-p[i][0])*(point.y-p[i][1])/(p[j][1]-p[i][1])+p[i][0])inside=!inside;
          const depth=p.reduce((s,v)=>s+v[2]/4,0);if(inside&&(!hit||depth<hit.depth))hit={...face,depth};
        }return hit;
      },
      render(gl,args){
        if(!this.ready||this.disposed)return;
        const m=args?.defaultProjectionData?.mainMatrix||args?.modelViewProjectionMatrix||(Array.isArray(args)||ArrayBuffer.isView(args)?args:null);if(!m)return;
        this.drawShadow();
        gl.useProgram(this.program);gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);
        if(this.vao)gl.bindVertexArray(this.vao);else for(const a of this.attributes){gl.enableVertexAttribArray(a.loc);gl.vertexAttribPointer(a.loc,a.size,gl.FLOAT,false,STRIDE*4,a.offset*4);}
        this.lastMatrix=localMatrix(m,mesh.origin,mesh.scale);
        gl.uniformMatrix4fv(this.uniforms.u_matrix,false,this.lastMatrix);gl.uniform1f(this.uniforms.u_progress,this.progress);gl.uniform1f(this.uniforms.u_zoom,this.map.getZoom());
        gl.uniform3fv(this.uniforms.u_camera,cameraFromMatrix(this.lastMatrix));
        gl.uniformMatrix4fv(this.uniforms.u_light,false,this.light);gl.uniform1f(this.uniforms.u_shadow_ready,this.shadowDrawn&&this.progress>.99?1:0);
        gl.uniform1f(this.uniforms.u_ground_radius,Math.min(280,Math.max(100,Number(profile.scene.radius_m)||244)));
        gl.activeTexture(gl.TEXTURE2);gl.bindTexture(gl.TEXTURE_2D,this.photoTexture);gl.uniform1i(this.uniforms.u_photos,2);gl.uniform4fv(this.uniforms['u_photo_params[0]'],atlas.photos.params);
        gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,this.shadowTexture||this.texture);gl.uniform1i(this.uniforms.u_shadow,1);
        gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,this.texture);gl.uniform1i(this.uniforms.u_atlas,0);
        gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);gl.depthMask(true);gl.disable(gl.CULL_FACE);
        gl.enable(gl.BLEND);gl.blendFunc(gl.ONE,gl.ONE_MINUS_SRC_ALPHA);gl.drawArrays(gl.TRIANGLES,0,mesh.vertices.length/STRIDE);
        if(this.vao)gl.bindVertexArray(null);
      },
      onRemove(map,gl){this.disposed=true;this.ready=false;map.getCanvas().removeEventListener('webglcontextlost',this.contextLost);map.getCanvas().removeEventListener('webglcontextrestored',this.contextRestored);if(this.buffer)gl.deleteBuffer(this.buffer);if(this.texture)gl.deleteTexture(this.texture);if(this.photoTexture)gl.deleteTexture(this.photoTexture);if(this.program)gl.deleteProgram(this.program);if(this.vao)gl.deleteVertexArray(this.vao);if(this.shadowTexture)gl.deleteTexture(this.shadowTexture);if(this.shadowDepth)gl.deleteRenderbuffer(this.shadowDepth);if(this.shadowFramebuffer)gl.deleteFramebuffer(this.shadowFramebuffer);if(this.shadowProgram)gl.deleteProgram(this.shadowProgram);}
    };
    return layer;
  }
  root.RealCityLayer={create,buildMesh,localMatrix,cameraFromMatrix,subtractRectangles,makePhotoAtlas};
})(globalThis);
