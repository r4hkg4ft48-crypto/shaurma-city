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
function queue(markerId){
  const id=String(markerId||'');if(!/^\d+$/.test(id)||!db.configured)return null;
  if(jobs.has(id))return jobs.get(id);
  const job=(async()=>{
    try{
      await db.query("UPDATE shaurmeg_markers SET realcity_status='processing',realcity_updated_at=NOW() WHERE id=$1",[id]);
      const q=await db.query("SELECT id,venue_id,name,address,description,lat,lon,hero_image,gallery,realcity_reference_images FROM shaurmeg_markers WHERE id=$1 LIMIT 1",[id]);
      const marker=q.rows[0];if(!marker)return null;
      const profile=await analyzeRealCityProfile(marker);
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
