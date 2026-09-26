/* Shared, dependency-free spatial contract. Coordinates remain WGS84. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.RealCitySpatial=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const R=6371008.8, TAU=2*Math.PI;
  const finite=v=>typeof v==='number'&&Number.isFinite(v);
  function ring(input){
    if(!Array.isArray(input)||input.length<3||input.length>512)return [];
    if(input.some(p=>!Array.isArray(p)||!finite(p[0])||!finite(p[1])||Math.abs(p[0])>180||Math.abs(p[1])>85))return [];
    const r=input.map(p=>[p[0],p[1]]);
    if(r[0][0]!==r.at(-1)[0]||r[0][1]!==r.at(-1)[1])r.push([...r[0]]);
    return r;
  }
  function mercator(p){const lat=p[1]*Math.PI/180;return [(p[0]+180)/360,(1-Math.log(Math.tan(Math.PI/4+lat/2))/Math.PI)/2];}
  function frame(origin){
    const o=mercator(origin),scale=1/(TAU*R*Math.cos(origin[1]*Math.PI/180));
    return {origin:o,scale,toLocal:p=>{const m=mercator(p);return [(m[0]-o[0])/scale,-(m[1]-o[1])/scale];},fromLocal:p=>[(o[0]+p[0]*scale)*360-180,Math.atan(Math.sinh(Math.PI*(1-2*(o[1]-p[1]*scale))))*180/Math.PI]};
  }
  function signedArea(r){let a=0;for(let i=0;i<r.length-1;i++)a+=r[i][0]*r[i+1][1]-r[i+1][0]*r[i][1];return a/2;}
  function geometryKey(input){
    const r=ring(input).slice(0,-1);if(!r.length)return '';
    const s=r.map(p=>p.map(v=>v.toFixed(7)).join(','));
    let min=0;for(let i=1;i<s.length;i++)if(s[i]<s[min])min=i;
    const f=s.map((_,i)=>s[(min+i)%s.length]).join(';'),b=s.map((_,i)=>s[(min-i+s.length)%s.length]).join(';');
    // The full canonical key is collision-free at the stored 1 cm precision.
    return f<b?f:b;
  }
  function edges(input,origin){
    const r=ring(input);if(r.length<4)return [];
    const f=frame(origin||r[0]),pts=r.map(f.toLocal),winding=signedArea(pts)>=0?1:-1;
    return pts.slice(0,-1).map((a,i)=>{
      const b=pts[i+1],dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy),t=length?[dx/length,dy/length]:[0,0];
      const normal=[winding*t[1],-winding*t[0]];
      return {index:i,coordinates:[r[i],r[i+1]],a,b,length,tangent:t,normal,bearing:(Math.atan2(normal[0],normal[1])*180/Math.PI+360)%360};
    });
  }
  function nearestEdge(input,point){
    let best=null;for(const e of edges(input,point)){
      if(e.length<.2)continue;
      const u=Math.max(0,Math.min(e.length,-e.a[0]*e.tangent[0]-e.a[1]*e.tangent[1]));
      const d=Math.hypot(e.a[0]+u*e.tangent[0],e.a[1]+u*e.tangent[1]);
      if(!best||d<best.distance)best={...e,distance:d,u};
    }return best;
  }
  function bufferRing(input,meters=.7){
    const r=ring(input);if(!r.length)return [];
    const f=frame(r[0]),es=edges(r,r[0]),result=es.map((e,i)=>{
      const previous=es[(i+es.length-1)%es.length],a=previous.normal,b=e.normal;
      const k=Math.sign(meters)*Math.min(Math.abs(meters)*4,Math.abs(meters)/Math.max(.05,1+a[0]*b[0]+a[1]*b[1]));
      return f.fromLocal([e.a[0]+(a[0]+b[0])*k,e.a[1]+(a[1]+b[1])*k]);
    });return [...result,result[0]];
  }
  function bound(astra,marker,scene){
    if(astra?.version!==2||astra.status!=='ready'||!Array.isArray(astra.buildings))return false;
    const t=astra.target||{};
    if(String(t.marker_id)!==String(marker.id??marker.marker_id)||String(t.establishment_id)!==String(marker.establishment_id)||String(t.venue_id)!==String(marker.venue_id))return false;
    if(!Array.isArray(t.coordinates)||t.coordinates.length!==2||!t.coordinates.every(finite)||!Number.isFinite(Number(marker.lon))||!Number.isFinite(Number(marker.lat))||Math.abs(t.coordinates[0]-Number(marker.lon))>1e-7||Math.abs(t.coordinates[1]-Number(marker.lat))>1e-7)return false;
    return astra.buildings.length>0&&astra.buildings.every(b=>{
      const base=scene?.buildings?.find(x=>String(x.id)===String(b.building_id));
      if(!base||b.geometry_key!==geometryKey(base.ring)||!Array.isArray(b.facades))return false;
      const es=edges(base.ring,t.coordinates);
      // A canonical footprint can survive reordering, but edge-local u cannot.
      // Reject stale edge order instead of attaching a facade to another side.
      return b.facades.every(f=>JSON.stringify(f.edge)===JSON.stringify(es[f.edge_index]?.coordinates));
    });
  }
  return {ring,frame,edges,nearestEdge,bufferRing,geometryKey,bound,signedArea};
});
