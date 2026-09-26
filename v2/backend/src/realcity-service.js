'use strict';
const db=require('./db');
const {PROFILE_VERSION,analyzeRealCityProfile}=require('./realcity-analyzer');

const jobs=new Map();
function queue(markerId){
  const id=String(markerId||'');if(!/^\d+$/.test(id)||!db.configured)return null;
  if(jobs.has(id))return jobs.get(id);
  const job=(async()=>{
    try{
      await db.query("UPDATE shaurmeg_markers SET realcity_status='processing',realcity_updated_at=NOW() WHERE id=$1",[id]);
      const q=await db.query("SELECT id,establishment_id,venue_id,name,address,description,lat,lon,realcity_astra_config,realcity_profile,jsonb_array_length(realcity_astra_assets) astra_asset_count FROM shaurmeg_markers WHERE id=$1 LIMIT 1",[id]);
      const marker=q.rows[0];if(!marker)return null;
      const profile=await analyzeRealCityProfile(marker);
      if(marker.realcity_profile?.astra)profile.astra=marker.realcity_profile.astra;
      if(Number(marker.astra_asset_count||0)>0)profile.astra_input={version:1,mode:'metadata_only',establishment_id:marker.establishment_id||'',asset_count:Number(marker.astra_asset_count||0),config:marker.realcity_astra_config||{}};
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
async function bootstrap(){
  if(!db.configured)return;
  const q=await db.query("SELECT id FROM shaurmeg_markers WHERE is_active=TRUE AND (realcity_status<>'ready' OR COALESCE((realcity_profile->>'version')::int,0)<$1) ORDER BY updated_at DESC LIMIT 8",[PROFILE_VERSION]).catch(()=>({rows:[]}));
  q.rows.forEach(x=>queue(x.id)?.catch(()=>{}));
}
module.exports={queue,bootstrap,PROFILE_VERSION};
