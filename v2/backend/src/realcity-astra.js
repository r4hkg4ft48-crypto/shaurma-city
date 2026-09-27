'use strict';
const crypto=require('crypto');
const S=require('../../frontend/realcity-spatial');
const MAX_BUILDINGS=32,MAX_MODULES=5000;
const fail=m=>{throw Object.assign(new Error(m),{status:422})};
const color=(x,f='#c9c8c2')=>/^#[0-9a-f]{6}$/i.test(String(x))?x:f;
const text=(x,n=180)=>String(x||'').slice(0,n);
function number(x,min,max,label,def){const v=x===undefined?def:Number(x);if(!Number.isFinite(v)||v<min||v>max)fail('astra_invalid_'+label);return v;}
function revision(row){
  const {updated_at,status,...config}=row.realcity_astra_config||{};
  return crypto.createHash('sha256').update(JSON.stringify({
    target:[String(row.id),row.establishment_id,row.venue_id,Number(row.lon),Number(row.lat)],
    scene:row.realcity_profile?.scene||{},assets:row.realcity_astra_assets||[],config
  })).digest('hex');
}
function geometryManifest(row){
  const scene=row.realcity_profile?.scene||{},point=[Number(row.lon),Number(row.lat)];
  return {revision:revision(row),scene,buildings:(scene.buildings||[]).map(b=>({
    building_id:String(b.id),geometry_key:S.geometryKey(b.ring),role:b.role,height_m:b.height,levels:b.levels,
    nearest_edge:S.nearestEdge(b.ring,point)?.index,
    edges:S.edges(b.ring,point).map(e=>({edge_index:e.index,edge:e.coordinates,length_m:e.length,outward_bearing:e.bearing}))
  }))};
}
function compile(raw,row,partDepth=0){
  if(!raw||raw.version!==2)fail('astra_schema_version_2_required');
  const t=raw.target||{},point=[Number(row.lon),Number(row.lat)];
  if(String(t.marker_id)!==String(row.id)||t.establishment_id!==row.establishment_id||t.venue_id!==row.venue_id)fail('astra_target_mismatch');
  if(!Array.isArray(t.coordinates)||t.coordinates.some((x,i)=>!Number.isFinite(x)||Math.abs(x-point[i])>1e-7)||t.coordinates.length!==2)fail('astra_coordinates_mismatch');
  const scene=row.realcity_profile?.scene||{},assets=row.realcity_astra_assets||[],storedReferences=row.realcity_profile?.astra?.references||[],assetIds=new Set([...assets,...storedReferences].map(a=>a.id));
  if(!Array.isArray(scene.buildings)||!scene.buildings.length)fail('astra_map_geometry_required');
  if(!Array.isArray(raw.buildings)||!raw.buildings.length||raw.buildings.length>MAX_BUILDINGS)fail('astra_building_limit');
  const refs=(values,required=false)=>{
    if(!Array.isArray(values)||values.length>24)fail('astra_reference_ids_required');
    const ids=[...new Set(values.map(String))];
    if(ids.some(id=>!assetIds.has(id))||(required&&!ids.length))fail('astra_unknown_reference');return ids;
  };
  let modules=0;
  const materialIds=new Set();
  const materials=(Array.isArray(raw.materials)?raw.materials:[]).map(m=>{
    if(materialIds.has(m.id)||!/^[a-z0-9_-]{1,60}$/i.test(m.id)||materialIds.size>=8)fail('astra_material_limit');materialIds.add(m.id);
    // Only rectified, cropped architecture patches. Original photos stay private.
    if(m.rectified!==true||!assetIds.has(m.source_asset_id)||!/^data:image\/(png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(m.data_url||'')||m.data_url.length>900000)fail('astra_rectified_material_required');
    if(!Array.isArray(m.source_quad)||m.source_quad.length!==4||m.source_quad.some(p=>!Array.isArray(p)||p.length!==2||p.some(v=>!Number.isFinite(v)||v<0||v>1)))fail('astra_material_quad_required');
    let repeat;
    if(m.repeat_m!==undefined){if(!Array.isArray(m.repeat_m)||m.repeat_m.length!==2)fail('astra_material_repeat');repeat=m.repeat_m.map(v=>number(v,.1,30,'material_repeat'));}
    return {id:m.id,rectified:true,source_asset_id:m.source_asset_id,source_quad:m.source_quad,data_url:m.data_url,...(repeat?{repeat_m:repeat}:{})};
  });
  const ids=new Set();
  const buildings=raw.buildings.map(b=>{
    const base=scene.buildings.find(x=>String(x.id)===String(b.building_id));
    if(!base||ids.has(String(base.id))||b.geometry_key!==S.geometryKey(base.ring))fail('astra_footprint_mismatch');ids.add(String(base.id));
    const edges=S.edges(base.ring,point),height=number(b.height_m,2,160,'height',base.height),baseM=number(b.base_m,0,height-1,'base',base.base_m||0);
    const facades=[],seen=new Set();
    if(!Array.isArray(b.facades)||b.facades.length>edges.length)fail('astra_invalid_facades');
    for(const f of b.facades){
      const edge=edges.find(e=>e.index===f.edge_index);
      if(!edge||edge.length<.2||seen.has(edge.index))fail('astra_edge_mismatch');seen.add(edge.index);
      if(JSON.stringify(f.edge)!==JSON.stringify(edge.coordinates))fail('astra_edge_anchor_mismatch');
      const evidence=f.evidence==='observed'?'observed':'inferred',referenceIds=refs(f.reference_ids,evidence==='observed');
      if(f.material_id&&!materialIds.has(f.material_id))fail('astra_material_not_found');
      const surface={color:color(f.wall?.color,base.palette?.wall),finish:['brick','panel','plaster','metal','stone','ribbed'].includes(f.wall?.finish)?f.wall.finish:'plaster',joint_color:color(f.wall?.joint_color,'#aaa9a3'),module_m:number(f.wall?.module_m,.06,12,'module',f.wall?.finish==='brick'?.25:3)};
      const parts=[];
      const acceptModule=(m)=>{
        if(++modules>MAX_MODULES)fail('astra_module_budget');
        const kind=String(m.kind||'window');if(!['window','balcony','entrance','storefront','sign','panel','cornice','canopy','vent','medical-heart','metro-m'].includes(kind))fail('astra_module_kind');
        const w=number(m.width_m,.08,edge.length,'width'),h=number(m.height_m,.06,height,'height');
        const u=number(m.u_m,0,edge.length,'u'),z=number(m.z_m,baseM,height,'z');
        if(u+w>edge.length+.005||z+h>height+.005)fail('astra_module_outside_facade');
        parts.push({kind,u_m:u,z_m:z,width_m:w,height_m:h,depth_m:number(m.depth_m,0,2.5,'depth',kind==='balcony'?.85:.12),color:color(m.color,kind==='sign'?'#26343b':kind==='panel'?surface.color:'#344956'),frame_color:color(m.frame_color,'#e4e4df'),frame_m:number(m.frame_m,.015,.25,'frame',.065),panes:Math.round(number(m.panes,1,6,'panes',2)),text:kind==='sign'?text(m.text,80):'',text_color:color(m.text_color,'#fff4df'),glazed:m.glazed===true,material_id:m.material_id&&materialIds.has(m.material_id)?m.material_id:null,lod:kind==='window'||kind==='panel'?1:0});
      };
      for(const m of (f.modules||[]))acceptModule(m);
      for(const grid of (f.grids||[])){
        const cols=Math.round(number(grid.columns,1,80,'columns')),rows=Math.round(number(grid.rows,1,50,'rows'));
        const du=number(grid.spacing_x_m,.2,20,'spacing_x'),dz=number(grid.spacing_z_m,.2,8,'spacing_z');
        for(let j=0;j<rows;j++)for(let i=0;i<cols;i++){
          if((grid.omit||[]).some(p=>p[0]===i&&p[1]===j))continue;
          acceptModule({...grid,u_m:Number(grid.u_m)+i*du,z_m:Number(grid.z_m)+j*dz});
        }
      }
      facades.push({edge_index:edge.index,edge:edge.coordinates,evidence,reference_ids:referenceIds,confidence:number(f.confidence,0,1,'confidence',evidence==='observed'?.8:.25),wall:surface,material_id:f.material_id||null,modules:parts});
    }
    if(!facades.length)fail('astra_facades_required');
    const parts=[];
    if(b.parts!==undefined){
      if(partDepth||!Array.isArray(b.parts)||b.parts.length>8||!b.parts.length)fail('astra_part_limit');
      if(S.geometryKey(b.parts[0].ring)!==S.geometryKey(base.ring)||Number(b.parts[0].base_m||0)!==baseM)fail('astra_ground_footprint_required');
      for(const [i,p] of b.parts.entries()){
        if(!S.containsRing(base.ring,p.ring)||Number(p.height_m)>height)fail('astra_part_outside_footprint');
        const partBase={...base,id:String(base.id)+':'+i,ring:S.ring(p.ring),role:'hero'};
        const part=compile({...raw,materials:raw.materials||[],buildings:[{...p,building_id:partBase.id,geometry_key:S.geometryKey(p.ring)}]},
          {...row,realcity_profile:{...row.realcity_profile,scene:{buildings:[partBase],hero_building_id:partBase.id}}},1).buildings[0];
        // Parts remain subordinate to one original map building, never new map footprints.
        modules+=part.facades.reduce((n,f)=>n+f.modules.length,0);if(modules>MAX_MODULES)fail('astra_module_budget');
        parts.push({...part,ring:partBase.ring,role:base.role});
      }
    }
    return {building_id:String(base.id),geometry_key:b.geometry_key,height_m:height,base_m:baseM,role:base.role,roof:{color:color(b.roof?.color,base.palette?.roof),parapet_m:number(b.roof?.parapet_m,0,1.8,'parapet',.25)},facades,...(parts.length?{parts}:{})};
  });
  const hero=buildings.find(b=>b.building_id===String(scene.hero_building_id)||b.role==='hero');
  if(!hero||(!partDepth&&!hero.facades.some(f=>f.evidence==='observed')))fail('astra_observed_hero_required');
  const front=S.nearestEdge(scene.buildings.find(b=>String(b.id)===hero.building_id).ring,point);
  const frame=S.frame(point),coordinate=p=>{
    if(!Array.isArray(p)||p.length!==2||p.some(x=>!Number.isFinite(x))||Math.abs(p[0])>180||Math.abs(p[1])>85||Math.hypot(...frame.toLocal(p))>500)fail('astra_environment_coordinates');return [...p];
  };
  const view=v=>({bearing:number(v.bearing,-360,360,'bearing'),pitch:number(v.pitch,0,72,'pitch',66),zoom:number(v.zoom,16,20,'zoom',18.6),...(v.center?{center:coordinate(v.center)}:{})});
  const camera=raw.camera?view(raw.camera):{bearing:front?(front.bearing+180)%360:0,pitch:66,zoom:18.6};
  if(raw.camera?.views){
    if(!Array.isArray(raw.camera.views)||raw.camera.views.length>4)fail('astra_camera_views');
    camera.views=raw.camera.views.map(v=>({...view(v),label:text(v.label,24)}));
  }
  let environment;
  if(raw.environment){
    const env=raw.environment,list=(v,max,label)=>{if(v===undefined)return [];if(!Array.isArray(v)||v.length>max)fail('astra_environment_'+label);return v;};
    let points=0;
    const path=p=>{if(!Array.isArray(p)||p.length<2||p.length>512||(points+=p.length)>8192)fail('astra_environment_points');return p.map(coordinate);};
    environment={
      trees:list(env.trees,96,'trees').map(t=>({coordinates:coordinate(t.coordinates),height_m:number(t.height_m,1,35,'tree_height'),radius_m:number(t.radius_m,.3,9,'tree_radius'),color:color(t.color,'#647b4b'),evidence:t.evidence==='observed'?'observed':'inferred',reference_ids:refs(t.reference_ids||[],t.evidence==='observed')})),
      fences:list(env.fences,96,'fences').map(f=>({start:coordinate(f.start),end:coordinate(f.end),height_m:number(f.height_m,.2,4,'fence_height')})),
      lamps:list(env.lamps,48,'lamps').map(l=>({coordinates:coordinate(l.coordinates),height_m:number(l.height_m,2,15,'lamp_height'),bearing:number(l.bearing,-360,360,'lamp_bearing')})),
      roads:list(env.roads,1024,'roads').map(r=>({coordinates:path(r.coordinates),class:['path','minor','service','tertiary','secondary','primary'].includes(r.class)?r.class:'path'})),
      greens:list(env.greens,48,'greens').map(g=>{const r=S.ring(path(g));if(!r.length)fail('astra_environment_polygon');return r;}),
      placement_note:text(env.placement_note,400)
    };
  }
  return {version:2,status:'ready',target:{marker_id:String(row.id),establishment_id:row.establishment_id,venue_id:row.venue_id,coordinates:point},input_revision:revision(row),generated_at:new Date().toISOString(),buildings,materials,camera,...(environment?{environment}:{}),...(storedReferences.length?{references:storedReferences}:{}),notes:text(raw.notes,2400),coverage:{observed_edges:buildings.reduce((n,b)=>n+(b.parts||[b]).reduce((s,p)=>s+p.facades.filter(f=>f.evidence==='observed').length,0),0),total_edges:buildings.reduce((n,b)=>n+(b.parts||[b]).reduce((s,p)=>s+p.facades.length,0),0),buildings:buildings.length}};
}
async function save(client,row,body){
  if(body.expected_revision!==revision(row))throw Object.assign(new Error('astra_inputs_changed_reload_package'),{status:409});
  const output=compile(body.output,row);
  if(output.materials.length){
    const sharp=require('sharp');
    for(const m of output.materials){const metadata=await sharp(Buffer.from(m.data_url.split(',')[1],'base64'),{limitInputPixels:4194304}).metadata();if(!metadata.width||metadata.width>2048||metadata.height>2048)fail('astra_material_dimensions');}
  }
  await client.query("UPDATE shaurmeg_markers SET realcity_profile=jsonb_set(COALESCE(realcity_profile,'{}'::jsonb),'{astra}',$2::jsonb),realcity_updated_at=NOW() WHERE id=$1",[row.id,JSON.stringify(output)]);
  return output;
}
module.exports={revision,geometryManifest,compile,save};
