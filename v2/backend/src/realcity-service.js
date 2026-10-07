'use strict';
const db=require('./db');
const config=require('./config');
const {PROFILE_VERSION,analyzeRealCityProfile}=require('./realcity-analyzer');
const zhulebino=require('./realcity-releases/zhulebino');
const photoreal=require('./realcity-photoreal');

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

function needsRefresh(profile){
  if(Number(profile?.version||0)<PROFILE_VERSION)return true;
  if(config.REALCITY_OPEN_WORLD_ENABLED===false)return false;
  const stamp=profile?.real_world?.generated_at;if(!stamp)return true;
  const t=new Date(stamp).getTime();if(!Number.isFinite(t))return true;
  return Date.now()-t>config.REALCITY_OPEN_WORLD_REFRESH_DAYS*86400000;
}

const jobs=new Map();
function queue(markerId){
  const id=String(markerId||'');if(!/^\d+$/.test(id)||!db.configured)return null;
  if(jobs.has(id))return jobs.get(id);
  const job=(async()=>{
    try{
      await db.query("UPDATE shaurmeg_markers SET realcity_status='processing',realcity_updated_at=NOW() WHERE id=$1",[id]);
      const q=await db.query("SELECT id,establishment_id,venue_id,name,address,description,lat,lon,realcity_astra_config,realcity_astra_assets,realcity_profile,jsonb_array_length(realcity_astra_assets) astra_asset_count FROM shaurmeg_markers WHERE id=$1 LIMIT 1",[id]);
      const marker=q.rows[0];if(!marker)return null;
      const profile=await analyzeRealCityProfile(marker);
      if(Number(marker.astra_asset_count||0)>0)profile.astra_input={version:1,mode:'metadata_only',establishment_id:marker.establishment_id||'',asset_count:Number(marker.astra_asset_count||0),config:marker.realcity_astra_config||{}};
      // Merge only generated keys; keep the latest Astra output/input even if an
      // admin saved a reconstruction while the geometry request was in flight.
      await db.query("UPDATE shaurmeg_markers SET realcity_profile=$2::jsonb || (realcity_profile - ARRAY['version','generated_at','quality','confidence','building_style','palette','neighborhood_palette','facade','texture','environment','camera','scene','sources','real_world']),realcity_status='ready',realcity_quality=$3,realcity_updated_at=NOW() WHERE id=$1",[id,JSON.stringify(profile),profile.quality||'heuristic']);
      // GPU reconstruction is a separate bounded job. It never blocks the map
      // profile response; when ready it publishes only the photoreal subtree.
      const refreshed=(await db.query("SELECT id,establishment_id,venue_id,name,address,lat,lon,realcity_astra_assets,realcity_profile FROM shaurmeg_markers WHERE id=$1",[id])).rows[0];
      if(refreshed)photoreal.queue(refreshed,refreshed.realcity_profile||{}).catch(e=>console.warn('RealCity photoreal queue',id,e.message));
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
  const q=await db.query("SELECT id,establishment_id,venue_id,name,address,lat,lon,realcity_status,realcity_profile,realcity_astra_assets FROM shaurmeg_markers WHERE is_active=TRUE ORDER BY CASE WHEN id=3139 OR lower(replace(name,'ё','е')) LIKE '%лепешк%' THEN 0 ELSE 1 END, updated_at DESC LIMIT 32").catch(()=>({rows:[]}));
  const rows=q.rows||[],refresh=rows.filter(x=>x.realcity_status!=='ready'||needsRefresh(x.realcity_profile||{})).slice(0,8);
  refresh.forEach(x=>queue(x.id)?.catch(()=>{}));
  // A photoreal pipeline/source revision must rebuild proactively instead of
  // waiting for a human to open a marker. Geometry-refresh rows enqueue their
  // reconstruction from queue(); stable rows can be checked immediately.
  rows.filter(x=>!refresh.includes(x)&&!needsRefresh(x.realcity_profile||{})).slice(0,16).forEach(x=>
    photoreal.queue(x,x.realcity_profile||{}).catch(e=>console.warn('RealCity photoreal bootstrap',x.id,e.message))
  );
}
module.exports={queue,bootstrap,installPhotoRelease,needsRefresh,PROFILE_VERSION,photoreal};
