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
 float diffuse=max(0.,dot(normalize(a_normal),normalize(vec3(-.45,-.65,.85))));
 v_color=a_color*(.71+.29*diffuse); v_uv=a_uv; v_texture=a_texture;
 v_visible=a_detail<.5?1.:smoothstep(16.7,17.5,u_zoom);
 gl_Position=u_matrix*vec4(p,1.);
}`;
  const FS=`precision mediump float;
uniform sampler2D u_atlas;
varying vec3 v_color; varying vec2 v_uv; varying float v_texture; varying float v_visible;
void main(){
 if(v_visible<.02)discard;
 vec4 sampleColor=texture2D(u_atlas,v_uv);
 vec3 c=v_texture>.5?sampleColor.rgb*v_color:v_color;
 float a=v_texture>.5?sampleColor.a:1.;
 if(a<.2)discard;
 gl_FragColor=vec4(c*a,a);
}`;
  function rgb(hex){const x=/^#[0-9a-f]{6}$/i.test(hex||'')?hex:'#c9c8c2';return [1,3,5].map(i=>parseInt(x.slice(i,i+2),16)/255);}
  function shader(gl,type,src){const s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)){const e=gl.getShaderInfoLog(s);gl.deleteShader(s);throw new Error(e)}return s;}
  function program(gl){const v=shader(gl,gl.VERTEX_SHADER,VS),f=shader(gl,gl.FRAGMENT_SHADER,FS),p=gl.createProgram();gl.attachShader(p,v);gl.attachShader(p,f);gl.linkProgram(p);gl.deleteShader(v);gl.deleteShader(f);if(!gl.getProgramParameter(p,gl.LINK_STATUS)){const e=gl.getProgramInfoLog(p);gl.deleteProgram(p);throw new Error(e)}return p;}
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
    for(const b of astra.buildings)for(const f of b.facades)for(const m of f.modules){
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
      addTri(p[0],p[1],p[2],n,col,[uv[0],uv[1],uv[2]],slot?1:0,lod,order);
      addTri(p[0],p[2],p[3],n,col,[uv[0],uv[2],uv[3]],slot?1:0,lod,order);
    };
    for(const [bi,b] of astra.buildings.entries()){
      const base=scene.buildings.find(x=>String(x.id)===b.building_id),edges=S.edges(base.ring,[Number(marker.lon),Number(marker.lat)]),order=b.role==='hero'?0:Math.min(1,bi/10),height=b.height_m;
      for(const edge of edges){
        if(edge.length<.2)continue;
        const f=b.facades.find(x=>x.edge_index===edge.index),n=[...edge.normal,0],t=[...edge.tangent,0];
        const point=(u,z,d=0)=>[edge.a[0]+edge.tangent[0]*u+edge.normal[0]*d,edge.a[1]+edge.tangent[1]*u+edge.normal[1]*d,z];
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
        const facadeTexture=atlas.slots.get(f?.material_id);
        plane(0,b.base_m,edge.length,height-b.base_m,0,facadeTexture?'#ffffff':f?.wall?.color||base.palette?.wall,facadeTexture);
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
                plane(u+fw,z+fw,w-2*fw,h-2*fw,d+.003,m.material_id?'#ffffff':m.color,atlas.slots.get(m.material_id),lod);
                for(let pane=1;pane<m.panes;pane++)plane(u+w*pane/m.panes-fw/2,z,fw,h,d+.006,m.frame_color,null,lod);
                continue;
              }
              // Dark reveal, projecting frame, recessed glazing and actual sill.
              plane(u,z,w,h,.012,'#222a2e',null,lod);
              plane(u+fw,z+fw,w-2*fw,h-2*fw,.018,m.material_id?'#ffffff':m.color,atlas.slots.get(m.material_id),lod);
              box(u,z,fw,h,d,m.frame_color,lod);box(u+w-fw,z,fw,h,d,m.frame_color,lod);
              box(u,z,w,fw,d,m.frame_color,lod);box(u,z+h-fw,w,fw,d,m.frame_color,lod);
              for(let pane=1;pane<m.panes;pane++)box(u+w*pane/m.panes-fw/2,z,fw,h,d,m.frame_color,lod);
              if(m.kind==='window')box(u-.04,z-.04,w+.08,.07,d+.07,m.frame_color,lod);
              if(m.kind==='entrance'){box(u+w*.75,z+h*.42,.035,.24,d+.04,'#a5afb2',0);box(u,z-.1,w,.1,.4,'#898b89',0);}
            }else if(m.kind==='balcony'){
              box(u,z,w,.14,d,m.frame_color,0);
              plane(u,z+.14,w,h-.14,d,m.material_id?'#ffffff':m.color,atlas.slots.get(m.material_id));
              box(u,z+.14,.055,h-.14,d,m.frame_color,0);box(u+w-.055,z+.14,.055,h-.14,d,m.frame_color,0);
              if(m.glazed){box(u,z+h-.08,w,.08,d,m.frame_color,0);for(let i=1;i<m.panes;i++)box(u+w*i/m.panes,z,.035,h,d,m.frame_color,0);}
              else{box(u,z+h-.06,w,.06,d,m.frame_color,0);}
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
      for(let j=0;j<idx.length;j+=3)addTri([...roof[idx[j]],height],[...roof[idx[j+1]],height],[...roof[idx[j+2]],height],[0,0,1],col,[[0,0],[0,0],[0,0]],0,0,order);
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
    const pickFaces=astra.buildings.flatMap(b=>{
      const base=profile.scene.buildings.find(x=>String(x.id)===b.building_id);
      return S.edges(base.ring,[Number(marker.lon),Number(marker.lat)]).map(e=>({building_id:b.building_id,edge_index:e.index,role:b.role,evidence:b.facades.find(f=>f.edge_index===e.index)?.evidence||'inferred',vertices:[[...e.a,b.base_m],[...e.b,b.base_m],[...e.b,b.height_m],[...e.a,b.height_m]]}));
    });
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
