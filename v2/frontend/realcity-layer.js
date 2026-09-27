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
void main(){
 float t=clamp((u_progress-a_order*.13)/.87,0.,1.); float e=1.-pow(1.-t,3.);
 vec3 p=a_position; p.z*=e;
 float diffuse=max(0.,dot(normalize(a_normal),normalize(vec3(.6,.35,.85))));
 v_color=a_color*(.82+.18*diffuse); v_uv=a_uv; v_texture=a_texture;
 v_visible=a_detail<.5?1.:smoothstep(16.7,17.5,u_zoom);
 gl_Position=u_matrix*vec4(p,1.);
}`;
  const FS=`#extension GL_OES_standard_derivatives : enable
precision highp float;
uniform sampler2D u_atlas;
varying vec3 v_color; varying vec2 v_uv; varying float v_texture; varying float v_visible;
void main(){
 if(v_visible<.02)discard;
 vec4 sampleColor=texture2D(u_atlas,v_uv);
 vec3 c=v_texture>.5&&v_texture<1.5?sampleColor.rgb*v_color:v_color;
 if(v_texture>1.5&&v_texture<2.5)c*=.97+.03*cos(v_uv.x*6.283185)*(1.-smoothstep(.25,.85,fwidth(v_uv.x)));
 if(v_texture>2.5&&v_texture<3.5)c*=.76+.24*v_uv.y+.045*sin(v_uv.x*13.+v_uv.y*3.);
 float a=v_texture>.5&&v_texture<1.5?sampleColor.a:1.;
 if(v_texture>4.5)a=v_uv.x;
 if(a<.005)discard;
 gl_FragColor=vec4(c*a,a);
}`;
  function rgb(hex){const x=/^#[0-9a-f]{6}$/i.test(hex||'')?hex:'#c9c8c2';return [1,3,5].map(i=>parseInt(x.slice(i,i+2),16)/255);}
  function shader(gl,type,src){const s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)){const e=gl.getShaderInfoLog(s);gl.deleteShader(s);throw new Error(e)}return s;}
  function program(gl){
    const modern=typeof gl.texStorage2D==='function';
    const vertex=modern?'#version 300 es\n'+VS.replace(/attribute /g,'in ').replace(/varying /g,'out '):VS;
    let fragment=FS;
    if(modern)fragment='#version 300 es\n'+FS.replace('#extension GL_OES_standard_derivatives : enable\n','').replace('precision highp float;','precision highp float;\nout vec4 fragmentColor;').replace(/varying /g,'in ').replace(/texture2D\(/g,'texture(').replace(/gl_FragColor/g,'fragmentColor');
    else if(!gl.getExtension('OES_standard_derivatives'))fragment=FS.replace('#extension GL_OES_standard_derivatives : enable\n','').replace('fwidth(v_uv.x)','1.');
    const v=shader(gl,gl.VERTEX_SHADER,vertex),f=shader(gl,gl.FRAGMENT_SHADER,fragment),p=gl.createProgram();gl.attachShader(p,v);gl.attachShader(p,f);gl.linkProgram(p);gl.deleteShader(v);gl.deleteShader(f);if(!gl.getProgramParameter(p,gl.LINK_STATUS)){const e=gl.getProgramInfoLog(p);gl.deleteProgram(p);throw new Error(e)}return p;
  }
  function localMatrix(m,origin,scale){
    const out=new Float32Array(16);
    for(let i=0;i<4;i++){out[i]=m[i]*scale;out[4+i]=-m[4+i]*scale;out[8+i]=m[8+i]*scale;out[12+i]=m[i]*origin[0]+m[4+i]*origin[1]+m[12+i];}
    return out;
  }
  function makeAtlas(astra){
    const canvas=document.createElement('canvas');canvas.width=2048;canvas.height=2048;
    const ctx=canvas.getContext('2d');ctx.fillStyle='#ffffff';ctx.fillRect(0,0,2048,2048);
    const slots=new Map(),jobs=[];let materialSlot=0,signSlot=0;
    const reserve=(id,material=false)=>{if(slots.has(id))return slots.get(id);if(material?materialSlot>=8:signSlot>=32)return null;const slot=material?materialSlot++:signSlot++,cell=material?512:256,columns=2048/cell,x=slot%columns*cell,y=Math.floor(slot/columns)*cell+(material?0:1024);const r={x,y,cell,u0:(x+2)/2048,v0:(y+2)/2048,u1:(x+cell-2)/2048,v1:(y+cell-2)/2048};slots.set(id,r);return r;};
    for(const m of astra.materials||[]){
      const r=reserve(m.id,true);if(!r)continue;
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
    return {canvas,slots,ready:Promise.all(jobs)};
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
          const uv=slot&&edge.normal[0]*edge.tangent[1]-edge.normal[1]*edge.tangent[0]<0?{...slot,u0:slot.u1,u1:slot.u0}:slot;
          quad([point(u,z,d),point(u+w,z,d),point(u+w,z+h,d),point(u,z+h,d)],n,rgb(col),uv,lod,order);
        };
        const box=(u,z,w,h,d,col,lod=0)=>{
          plane(u,z,w,h,d,col,null,lod);const c=rgb(col);
          quad([point(u,z,0),point(u,z,d),point(u,z+h,d),point(u,z+h,0)],t.map(v=>-v),c,null,lod,order);
          quad([point(u+w,z,d),point(u+w,z,0),point(u+w,z+h,0),point(u+w,z+h,d)],t,c,null,lod,order);
          quad([point(u,z+h,d),point(u+w,z+h,d),point(u+w,z+h,0),point(u,z+h,0)],[0,0,1],c,null,lod,order);
          quad([point(u,z,0),point(u+w,z,0),point(u+w,z,d),point(u,z,d)],[0,0,-1],c,null,lod,order);
        };
        const facadeTexture=atlas.slots.get(f?.material_id),ribbed=f?.wall?.finish==='ribbed';
        plane(0,b.base_m,edge.length,height-b.base_m,0,facadeTexture?'#ffffff':f?.wall?.color||base.palette?.wall,facadeTexture||(ribbed?{u0:0,u1:edge.length/f.wall.module_m,v0:1,v1:0,texture:2}:null));
        if(f){
          // Joints describe a measured material; they do not invent openings.
          if(['panel','metal','stone','brick'].includes(f.wall.finish)){
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
                plane(u+fw,z+fw,w-2*fw,h-2*fw,d+.003,m.material_id?'#ffffff':m.color,atlas.slots.get(m.material_id)||{u0:0,u1:1,v0:1,v1:0,texture:3},lod);
                for(let pane=1;pane<m.panes;pane++)plane(u+w*pane/m.panes-fw/2,z,fw,h,d+.006,m.frame_color,null,lod);
                continue;
              }
              // Dark reveal, projecting frame, recessed glazing and actual sill.
              plane(u,z,w,h,Math.max(.032,d*.38),'#222a2e',null,lod);
              plane(u+fw,z+fw,w-2*fw,h-2*fw,Math.max(.036,d*.55),m.material_id?'#ffffff':m.color,atlas.slots.get(m.material_id)||{u0:0,u1:1,v0:1,v1:0,texture:3},lod);
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
            }else box(u,z,w,h,Math.max(.02,d),m.color,lod);
          }
        }
        if(b.roof.parapet_m)box(0,height-b.roof.parapet_m,edge.length,b.roof.parapet_m,.055,b.roof.color,0);
      }
      const roof=S.ring(base.ring).slice(0,-1).map(coordinateFrame.toLocal),idx=root.earcut(roof.flat()),col=rgb(b.roof.color);
      for(let j=0;j<idx.length;j+=3)addTri([...roof[idx[j]],height+.035],[...roof[idx[j+1]],height+.035],[...roof[idx[j+2]],height+.035],[0,0,1],col,[[0,0],[0,0],[0,0]],0,0,order);
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
      const strip=(a,b,width,z,color)=>{const dx=b[0]-a[0],dy=b[1]-a[1],len=Math.hypot(dx,dy);if(len<.1)return;const n=[-dy/len*width/2,dx/len*width/2];quad([[a[0]+n[0],a[1]+n[1],z],[b[0]+n[0],b[1]+n[1],z],[b[0]-n[0],b[1]-n[1],z],[a[0]-n[0],a[1]-n[1],z]],[0,0,1],rgb(color),null,0,0);};
      for(let i=1;i<line.length;i++){
        const a=line[i-1],b=line[i];strip(a,b,w+.4,.018,'#acaea4');strip(a,b,w,.025,path?'#a7aaa5':'#737b7d');
        if(!path&&!['service','minor'].includes(road.class)){
          const len=Math.hypot(b[0]-a[0],b[1]-a[1]);
          for(let u=0;u+2<len;u+=7){const at=t=>[a[0]+(b[0]-a[0])*t/len,a[1]+(b[1]-a[1])*t/len];strip(at(u),at(u+2),.11,.032,'#dbdacd');}
        }
      }
    }
    if(astra.environment){
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
    for(const tree of astra.environment?.trees||[]){
      const p=coordinateFrame.toLocal(tree.coordinates),h=tree.height_m,r=tree.radius_m;
      const bark=rgb('#6a6659'),leaf=rgb(tree.color||'#6b7e43');
      for(let i=0;i<7;i++){
        const a=i/7*Math.PI*2,b=(i+1)/7*Math.PI*2;
        quad([[p[0]+.13*Math.cos(a),p[1]+.13*Math.sin(a),0],[p[0]+.13*Math.cos(b),p[1]+.13*Math.sin(b),0],[p[0]+.09*Math.cos(b),p[1]+.09*Math.sin(b),h*.62],[p[0]+.09*Math.cos(a),p[1]+.09*Math.sin(a),h*.62]],[Math.cos(a),Math.sin(a),.1],bark,null,0,.5);
      }
      for(let l=0;l<4;l++){
        const cx=p[0]+Math.sin(l*2.4)*r*.34,cy=p[1]+Math.cos(l*2.4)*r*.34,cz=h*.62+(l===3?r*.45:0),rr=r*(l===3?.76:.81);
        for(let j=0;j<8;j++)for(let i=0;i<16;i++){
          const at=(a,b)=>{const ph=a/16*Math.PI*2,th=-Math.PI/2+b/8*Math.PI,noise=1+.1*Math.sin(a*7+b*3+l);return [cx+Math.cos(ph)*Math.cos(th)*rr*noise,cy+Math.sin(ph)*Math.cos(th)*rr*noise,cz+Math.sin(th)*rr*1.2];};
          const n=[Math.cos((i+.5)/16*Math.PI*2)*Math.cos(-Math.PI/2+(j+.5)/8*Math.PI),Math.sin((i+.5)/16*Math.PI*2)*Math.cos(-Math.PI/2+(j+.5)/8*Math.PI),Math.sin(-Math.PI/2+(j+.5)/8*Math.PI)];
          quad([at(i,j),at(i+1,j),at(i+1,j+1),at(i,j+1)],n,leaf.map(c=>c*(.91+.09*Math.sin(i*11+j*5+l))),null,0,.5);
        }
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
      stats:{buildings:astra.buildings.length,triangles:mesh.triangles,bytes:mesh.vertices.byteLength},
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
          this.uniforms={};for(const n of ['u_matrix','u_progress','u_zoom','u_atlas'])this.uniforms[n]=gl.getUniformLocation(this.program,n);
          this.texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,this.texture);
          gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
          this.uploadAtlas();this.ready=true;
          atlas.ready.then(()=>{if(!this.disposed){this.uploadAtlas();map.triggerRepaint()}});
        }catch(e){this.onRemove(map,gl);onError(e);}
      },
      uploadAtlas(){const gl=this.gl;gl.bindTexture(gl.TEXTURE_2D,this.texture);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,false);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,atlas.canvas);},
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
        gl.useProgram(this.program);gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);
        if(this.vao)gl.bindVertexArray(this.vao);else for(const a of this.attributes){gl.enableVertexAttribArray(a.loc);gl.vertexAttribPointer(a.loc,a.size,gl.FLOAT,false,STRIDE*4,a.offset*4);}
        this.lastMatrix=localMatrix(m,mesh.origin,mesh.scale);
        gl.uniformMatrix4fv(this.uniforms.u_matrix,false,this.lastMatrix);gl.uniform1f(this.uniforms.u_progress,this.progress);gl.uniform1f(this.uniforms.u_zoom,this.map.getZoom());
        gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,this.texture);gl.uniform1i(this.uniforms.u_atlas,0);
        gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);gl.depthMask(true);gl.disable(gl.CULL_FACE);
        gl.enable(gl.BLEND);gl.blendFunc(gl.ONE,gl.ONE_MINUS_SRC_ALPHA);gl.drawArrays(gl.TRIANGLES,0,mesh.vertices.length/STRIDE);
        if(this.vao)gl.bindVertexArray(null);
      },
      onRemove(map,gl){this.disposed=true;this.ready=false;map.getCanvas().removeEventListener('webglcontextlost',this.contextLost);map.getCanvas().removeEventListener('webglcontextrestored',this.contextRestored);if(this.buffer)gl.deleteBuffer(this.buffer);if(this.texture)gl.deleteTexture(this.texture);if(this.program)gl.deleteProgram(this.program);if(this.vao)gl.deleteVertexArray(this.vao);}
    };
    return layer;
  }
  root.RealCityLayer={create,buildMesh,localMatrix};
})(globalThis);
