'use strict';
const db=require('./db');
const {PROFILE_VERSION,analyzeRealCityProfile}=require('./realcity-analyzer');
const zhulebino=require('./realcity-releases/zhulebino');

async function installPhotoRelease(){
  if(!db.configured)return null;
  return db.tx(async client=>{
    const q=await client.query('SELECT id,establishment_id,venue_id,lat,lon,realcity_profile,realcity_astra_config FROM shaurmeg_markers WHERE id=$1 AND establishment_id=$2 AND venue_id=$3 AND is_active=TRUE FOR UPDATE',[zhulebino.TARGET.marker_id,zhulebino.TARGET.establishment_id,zhulebino.TARGET.venue_id]);
    const row=q.rows[0];if(!row)return null;
    const profile=zhulebino.build(row);if(!profile)return null;
    // Lock + exact venue binding. Existing nonempty .scene and all unrelated
    // profile keys survive. Studio output takes precedence over this release.
    await client.query("UPDATE shaurmeg_markers SET realcity_profile=$2::jsonb,realcity_status='ready',realcity_updated_at=NOW() WHERE id=$1",[row.id,JSON.stringify(profile)]);
    console.log('RealCity photo release installed',zhulebino.RELEASE,row.establishment_id);
    return profile;
  });
}

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
      if(Number(marker.astra_asset_count||0)>0)profile.astra_input={version:1,mode:'metadata_only',establishment_id:marker.establishment_id||'',asset_count:Number(marker.astra_asset_count||0),config:marker.realcity_astra_config||{}};
      // Merge only generated keys; keep the latest Astra output/input even if an
      // admin saved a reconstruction while the geometry request was in flight.
      await db.query("UPDATE shaurmeg_markers SET realcity_profile=$2::jsonb || (realcity_profile - ARRAY['version','generated_at','quality','confidence','building_style','palette','neighborhood_palette','facade','texture','environment','camera','scene']),realcity_status='ready',realcity_quality=$3,realcity_updated_at=NOW() WHERE id=$1",[id,JSON.stringify(profile),profile.quality||'heuristic']);
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
  await installPhotoRelease().catch(e=>console.error('RealCity photo release:',e.message));
  const q=await db.query("SELECT id FROM shaurmeg_markers WHERE is_active=TRUE AND (realcity_status<>'ready' OR COALESCE((realcity_profile->>'version')::int,0)<$1) ORDER BY updated_at DESC LIMIT 8",[PROFILE_VERSION]).catch(()=>({rows:[]}));
  q.rows.forEach(x=>queue(x.id)?.catch(()=>{}));
}
module.exports={queue,bootstrap,installPhotoRelease,PROFILE_VERSION};
