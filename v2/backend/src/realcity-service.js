'use strict';
const db=require('./db');
const {PROFILE_VERSION,analyzeRealCityProfile}=require('./realcity-analyzer');

const jobs=new Map();
function normalizeReferences(value){
  if(!Array.isArray(value))return [];
  const allowed=new Set(['hero_facade','street_left','street_right','neighbor','courtyard','environment']);
  return value.slice(0,8).map((x,i)=>{
    if(typeof x==='string')return x.startsWith('data:image/')?{src:x,role:i===0?'hero_facade':'environment'}:null;
    if(!x||typeof x!=='object')return null;
    const src=String(x.src||x.image||x.data||'');
    if(!src.startsWith('data:image/'))return null;
    return {src,role:allowed.has(x.role)?x.role:(i===0?'hero_facade':'environment')};
  }).filter(Boolean);
}
function astraRefs(value){
  const rows=Array.isArray(value)?value:[];
  const main=rows.filter(x=>x&&x.category==='main_building'&&String(x.src||'').startsWith('data:image/')).sort((a,b)=>(b.primary===true)-(a.primary===true)||(Number(b.priority)||0)-(Number(a.priority)||0)).slice(0,4);
  const pano=rows.filter(x=>x&&x.category==='panorama'&&String(x.src||'').startsWith('data:image/')).sort((a,b)=>(b.primary===true)-(a.primary===true)||(Number(b.priority)||0)-(Number(a.priority)||0)).slice(0,4);
  return [...main.map(x=>({src:x.src,role:'hero_facade'})),...pano.map(x=>({src:x.src,role:'environment'}))];
}
function queue(markerId){
  const id=String(markerId||'');if(!/^\d+$/.test(id)||!db.configured)return null;
  if(jobs.has(id))return jobs.get(id);
  const job=(async()=>{
    try{
      await db.query("UPDATE shaurmeg_markers SET realcity_status='processing',realcity_updated_at=NOW() WHERE id=$1",[id]);
      const q=await db.query("SELECT id,establishment_id,venue_id,name,address,description,lat,lon,hero_image,gallery,realcity_reference_images,realcity_astra_assets,realcity_astra_config FROM shaurmeg_markers WHERE id=$1 LIMIT 1",[id]);
      const marker=q.rows[0];if(!marker)return null;
      const seen=new Set();marker.realcity_reference_images=[...astraRefs(marker.realcity_astra_assets),...(Array.isArray(marker.realcity_reference_images)?marker.realcity_reference_images:[])].filter(x=>{const src=String(x?.src||'');if(!src||seen.has(src))return false;seen.add(src);return true}).slice(0,8);
      const profile=await analyzeRealCityProfile(marker);
      if(Array.isArray(marker.realcity_astra_assets)&&marker.realcity_astra_assets.length)profile.astra_input={version:1,establishment_id:marker.establishment_id||'',asset_count:marker.realcity_astra_assets.length,config:marker.realcity_astra_config||{}};
      await db.query("UPDATE shaurmeg_markers SET realcity_profile=$2::jsonb,realcity_status='ready',realcity_quality=$3,realcity_updated_at=NOW() WHERE id=$1",[id,JSON.stringify(profile),profile.quality||'heuristic']);
      return profile;
    }catch(e){
      console.error('realcity',id,e.message);
      await db.query("UPDATE shaurmeg_markers SET realcity_status='failed',realcity_updated_at=NOW() WHERE id=$1",[id]).catch(()=>{});
      throw e;
    }
  })().finally(()=>jobs.delete(id));
  jobs.set(id,job);return job;
}
async function saveReferences(markerId,value){
  const refs=normalizeReferences(value);
  const q=await db.query("UPDATE shaurmeg_markers SET realcity_reference_images=$2::jsonb,realcity_status='pending',updated_at=NOW() WHERE id=$1 RETURNING id,realcity_status",[markerId,JSON.stringify(refs)]);
  if(!q.rows[0])return null;queue(markerId)?.catch(()=>{});return {...q.rows[0],reference_count:refs.length};
}
async function bootstrap(){
  if(!db.configured)return;
  const q=await db.query("SELECT id FROM shaurmeg_markers WHERE is_active=TRUE AND (realcity_status<>'ready' OR COALESCE((realcity_profile->>'version')::int,0)<$1) ORDER BY updated_at DESC LIMIT 8",[PROFILE_VERSION]).catch(()=>({rows:[]}));
  q.rows.forEach(x=>queue(x.id)?.catch(()=>{}));
}
module.exports={queue,saveReferences,normalizeReferences,bootstrap,PROFILE_VERSION};
