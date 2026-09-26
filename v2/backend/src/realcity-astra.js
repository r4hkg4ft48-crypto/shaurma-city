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
function compile(raw,row){
  if(!raw||raw.version!==2)fail('astra_schema_version_2_required');
  const t=raw.target||{},point=[Number(row.lon),Number(row.lat)];
  if(String(t.marker_id)!==String(row.id)||t.establishment_id!==row.establishment_id||t.venue_id!==row.venue_id)fail('astra_target_mismatch');
  if(!Array.isArray(t.coordinates)||t.coordinates.some((x,i)=>!Number.isFinite(x)||Math.abs(x-point[i])>1e-7)||t.coordinates.length!==2)fail('astra_coordinates_mismatch');
  const scene=row.realcity_profile?.scene||{},assets=row.realcity_astra_assets||[],assetIds=new Set(assets.map(a=>a.id));
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
    return {id:m.id,rectified:true,source_asset_id:m.source_asset_id,source_quad:m.source_quad,data_url:m.data_url};
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
      const surface={color:color(f.wall?.color,base.palette?.wall),finish:['brick','panel','plaster','metal','stone'].includes(f.wall?.finish)?f.wall.finish:'plaster',joint_color:color(f.wall?.joint_color,'#aaa9a3'),module_m:number(f.wall?.module_m,.12,12,'module',f.wall?.finish==='brick'?.25:3)};
      const parts=[];
      const acceptModule=(m)=>{
        if(++modules>MAX_MODULES)fail('astra_module_budget');
        const kind=String(m.kind||'window');if(!['window','balcony','entrance','storefront','sign','panel','cornice','canopy','vent'].includes(kind))fail('astra_module_kind');
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
    return {building_id:String(base.id),geometry_key:b.geometry_key,height_m:height,base_m:baseM,role:base.role,roof:{color:color(b.roof?.color,base.palette?.roof),parapet_m:number(b.roof?.parapet_m,0,1.8,'parapet',.25)},facades};
  });
  const hero=buildings.find(b=>b.building_id===String(scene.hero_building_id)||b.role==='hero');
  if(!hero||!hero.facades.some(f=>f.evidence==='observed'))fail('astra_observed_hero_required');
  const front=S.nearestEdge(scene.buildings.find(b=>String(b.id)===hero.building_id).ring,point);
  const camera=raw.camera?{
    bearing:number(raw.camera.bearing,-360,360,'bearing'),pitch:number(raw.camera.pitch,0,72,'pitch',66),zoom:number(raw.camera.zoom,16,20,'zoom',18.6)
  }:{bearing:front?(front.bearing+180)%360:0,pitch:66,zoom:18.6};
  return {version:2,status:'ready',target:{marker_id:String(row.id),establishment_id:row.establishment_id,venue_id:row.venue_id,coordinates:point},input_revision:revision(row),generated_at:new Date().toISOString(),buildings,materials,camera,notes:text(raw.notes,2400),coverage:{observed_edges:buildings.reduce((n,b)=>n+b.facades.filter(f=>f.evidence==='observed').length,0),total_edges:buildings.reduce((n,b)=>n+S.edges(scene.buildings.find(x=>String(x.id)===b.building_id).ring).length,0),buildings:buildings.length}};
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
