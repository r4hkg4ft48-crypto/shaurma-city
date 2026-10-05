'use strict';
// One-time cleanup explicitly requested by the owner on 2026-10-06.
const KEY='2026-10-06_keep_three_venues_full_cleanup_v1';
const KEEP=[
 {marker_id:'1',venue_id:'lepyoshka',establishment_id:'SC-MSK-B7441AB59F',name:'В Лепёшке'},
 {marker_id:'5',venue_id:'f38a0a130ebd9a0e',establishment_id:'SC-MSK-5E435A0F67',name:'Мак'},
 {marker_id:'3139',venue_id:'b5fe327852468ac7',establishment_id:'SC-MSK-9342972B1F',name:'Тестовая генерация цифровой копии'}
];
const SCOPED=['shaurma_venue_admins','shaurma_venue_invites','shaurma_venue_audit','shaurma_kitchen_access','shaurma_kitchen_order_messages','shaurma_owner_command_context','shaurma_menu_aliases','shaurmeg_builder_cinema'];
const MARKER_SCOPED=['realcity_astra_originals','realcity_astra_access','realcity_astra_drafts'];
function validateKeep(rows){
 if(rows.length!==KEEP.length)throw new Error('catalog_cleanup_keep_set_incomplete');
 for(const k of KEEP){const r=rows.find(x=>String(x.id)===k.marker_id);if(!r||r.venue_id!==k.venue_id||r.establishment_id!==k.establishment_id||r.venue_establishment_id!==k.establishment_id||r.name!==k.name)throw new Error('catalog_cleanup_keep_binding_mismatch:'+k.marker_id)}
}
async function run(db){
 if(!db)return null;
 const client=await db.connect(),counts={};
 const ests=KEEP.map(x=>x.establishment_id),venues=KEEP.map(x=>x.venue_id),markers=KEEP.map(x=>x.marker_id);
 try{
  await client.query('BEGIN');
  await client.query("SET LOCAL lock_timeout='10s'");
  await client.query("SET LOCAL statement_timeout='120s'");
  await client.query('SELECT pg_advisory_xact_lock(20261006,3)');
  const done=await client.query('SELECT 1 FROM shaurma_migrations WHERE migration_key=$1',[KEY]);
  if(done.rows.length){await client.query('COMMIT');return {already_applied:true}}
  // Block concurrent venue/order changes while selecting and deleting their data.
  await client.query('LOCK TABLE shaurma_venues,shaurmeg_markers,shaurma_orders IN SHARE ROW EXCLUSIVE MODE');
  const kept=await client.query('SELECT m.id,m.name,m.venue_id,m.establishment_id,v.establishment_id venue_establishment_id FROM shaurmeg_markers m JOIN shaurma_venues v ON v.venue_id=m.venue_id WHERE m.id=ANY($1::bigint[]) FOR UPDATE OF m,v',[markers]);
  validateKeep(kept.rows);
  const columns=await client.query("SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public' AND column_name IN ('establishment_id','venue_id','marker_id','order_id','first_order_id')");
  const tables=new Set(columns.rows.map(x=>x.table_name));
  const known=new Set([...SCOPED,...MARKER_SCOPED,'shaurma_venues','shaurmeg_markers','shaurma_orders','shaurma_referrals','shaurma_bonus_ledger']);
  for(const t of tables)if(!known.has(t))throw new Error('catalog_cleanup_unhandled_related_table:'+t);
  await client.query(`CREATE TEMP TABLE cleanup_removed_orders ON COMMIT DROP AS SELECT id FROM shaurma_orders WHERE venue_id<>ALL($1::text[]) OR (COALESCE(establishment_id,'')<>'' AND establishment_id<>ALL($2::text[])) OR (marker_id IS NOT NULL AND marker_id<>ALL($3::bigint[]))`,[venues,ests,markers]);
  async function remove(table,condition,params=[]){if(!tables.has(table))return;const r=await client.query('DELETE FROM '+table+' WHERE '+condition,params);counts[table]=r.rowCount||0}
  await remove('shaurma_bonus_ledger',"order_id IN (SELECT id FROM cleanup_removed_orders) OR (COALESCE(metadata->>'establishment_id','')<>'' AND (metadata->>'establishment_id')<>ALL($1::text[])) OR (COALESCE(metadata->>'venue_id','')<>'' AND (metadata->>'venue_id')<>ALL($2::text[]))",[ests,venues]);
  await remove('shaurma_referrals','first_order_id IN (SELECT id FROM cleanup_removed_orders)');
  for(const t of SCOPED)await remove(t,'(establishment_id IS NOT NULL AND establishment_id<>ALL($1::text[]))'+(t==='shaurma_kitchen_order_messages'?' OR order_id IN (SELECT id FROM cleanup_removed_orders)':''),[ests]);
  for(const t of MARKER_SCOPED)await remove(t,'marker_id<>ALL($1::bigint[])',[markers]);
  await remove('shaurma_orders','id IN (SELECT id FROM cleanup_removed_orders)');
  await remove('shaurmeg_markers','id<>ALL($1::bigint[])',[markers]);
  await remove('shaurma_venues','venue_id<>ALL($1::text[])',[venues]);
  const favorites=await client.query(`UPDATE shaurma_users u SET favorites=(SELECT COALESCE(jsonb_agg(f),'[]'::jsonb) FROM jsonb_array_elements(u.favorites) f WHERE f->>'establishment_id'=ANY($1::text[])),updated_at=NOW() WHERE jsonb_typeof(favorites)='array' AND EXISTS(SELECT 1 FROM jsonb_array_elements(u.favorites) f WHERE COALESCE(f->>'establishment_id','')<>ALL($1::text[]))`,[ests]);
  counts.users_favorites_cleaned=favorites.rowCount||0;
  await client.query('DROP TABLE IF EXISTS shaurmeg_discovery_runs');
  await client.query("UPDATE shaurma_migrations SET details=details-'removed_venues' WHERE migration_key='2026-09-24_keep_only_mak_and_lepyoshka_v1'");
  const final=await client.query('SELECT (SELECT COUNT(*)::int FROM shaurma_venues) venues,(SELECT COUNT(*)::int FROM shaurmeg_markers) markers');
  if(final.rows[0]?.venues!==3||final.rows[0]?.markers!==3)throw new Error('catalog_cleanup_final_count_mismatch');
  await client.query('INSERT INTO shaurma_migrations(migration_key,details) VALUES($1,$2::jsonb)',[KEY,JSON.stringify({kept:KEEP,deleted:counts,historical_orders_preserved:false})]);
  await client.query('COMMIT');
  console.log('Catalog cleanup complete',JSON.stringify({kept:3,deleted:counts}));
  return {kept:3,deleted:counts};
 }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}finally{client.release()}
}
module.exports={run,validateKeep,KEEP,KEY};
