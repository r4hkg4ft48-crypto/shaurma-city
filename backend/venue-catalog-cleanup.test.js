'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite');
const {run,KEEP,KEY}=require('./venue-catalog-cleanup');
async function fixture(){
 const pg=new PGlite();
 await pg.exec(`CREATE TABLE shaurma_migrations(migration_key text PRIMARY KEY,details jsonb DEFAULT '{}');
 CREATE TABLE shaurma_venues(venue_id text PRIMARY KEY,establishment_id text UNIQUE,name text,menu jsonb DEFAULT '[]');
 CREATE TABLE shaurmeg_markers(id bigint PRIMARY KEY,venue_id text REFERENCES shaurma_venues ON DELETE RESTRICT,establishment_id text,name text);
 CREATE TABLE shaurma_orders(id bigint PRIMARY KEY,venue_id text,establishment_id text,marker_id bigint);
 CREATE TABLE shaurma_bonus_ledger(id bigint PRIMARY KEY,order_id bigint,metadata jsonb DEFAULT '{}');
 CREATE TABLE shaurma_referrals(id bigint PRIMARY KEY,first_order_id bigint);
 CREATE TABLE shaurma_users(telegram_user_id text PRIMARY KEY,profile jsonb,favorites jsonb,updated_at timestamptz);
 CREATE TABLE shaurma_venue_admins(establishment_id text REFERENCES shaurma_venues(establishment_id) ON DELETE CASCADE);
 CREATE TABLE shaurma_venue_invites(establishment_id text REFERENCES shaurma_venues(establishment_id) ON DELETE CASCADE);
 CREATE TABLE shaurma_venue_audit(establishment_id text);
 CREATE TABLE shaurma_kitchen_access(establishment_id text);
 CREATE TABLE shaurma_kitchen_order_messages(establishment_id text,order_id bigint);
 CREATE TABLE shaurma_owner_command_context(establishment_id text);
 CREATE TABLE shaurma_menu_aliases(establishment_id text);
 CREATE TABLE shaurmeg_builder_cinema(establishment_id text);
 CREATE TABLE realcity_astra_originals(marker_id bigint REFERENCES shaurmeg_markers ON DELETE CASCADE);
 CREATE TABLE realcity_astra_access(marker_id bigint REFERENCES shaurmeg_markers ON DELETE CASCADE);
 CREATE TABLE realcity_astra_drafts(marker_id bigint REFERENCES shaurmeg_markers ON DELETE CASCADE);
 CREATE TABLE shaurmeg_discovery_runs(id bigint);`);
 for(const k of [...KEEP,{marker_id:'99',venue_id:'removed',establishment_id:'REMOVED',name:'Remove'}]){
  await pg.query('INSERT INTO shaurma_venues VALUES($1,$2,$3,$4)',[k.venue_id,k.establishment_id,k.name,JSON.stringify([{id:'stable',p:280}])]);
  await pg.query('INSERT INTO shaurmeg_markers VALUES($1,$2,$3,$4)',[k.marker_id,k.venue_id,k.establishment_id,k.name]);
 }
 await pg.query('INSERT INTO shaurma_orders VALUES(1,$1,$2,1),(20,$3,$4,99)',[KEEP[0].venue_id,KEEP[0].establishment_id,'removed','REMOVED']);
 await pg.exec(`INSERT INTO shaurma_bonus_ledger VALUES(1,1,'{}'),(20,20,'{}');INSERT INTO shaurma_referrals VALUES(1,1),(20,20);`);
 for(const table of ['shaurma_venue_admins','shaurma_venue_invites','shaurma_venue_audit','shaurma_kitchen_access','shaurma_owner_command_context','shaurma_menu_aliases','shaurmeg_builder_cinema'])await pg.query('INSERT INTO '+table+' VALUES($1),($2)',[KEEP[0].establishment_id,'REMOVED']);
 await pg.query('INSERT INTO shaurma_kitchen_order_messages VALUES($1,1),($2,20),($1,20)',[KEEP[0].establishment_id,'REMOVED']);
 for(const table of ['realcity_astra_originals','realcity_astra_access','realcity_astra_drafts'])await pg.exec('INSERT INTO '+table+' VALUES(1),(99)');
 await pg.query('INSERT INTO shaurma_users VALUES($1,$2,$3,NOW())',['user',JSON.stringify({first_name:'Keep user'}),JSON.stringify([{establishment_id:KEEP[0].establishment_id,item_id:'keep'},{establishment_id:'REMOVED',item_id:'gone'}])]);
 const db={connect:async()=>({query:async(sql,args)=>{const r=await pg.query(sql,args);return {...r,rowCount:r.affectedRows??r.rowCount}},release(){}})};
 return {pg,db};
}
test('Real PostgreSQL cleanup preserves all three bindings and removes linked data atomically',async()=>{
 const {pg,db}=await fixture();try{
 const before=(await pg.query('SELECT * FROM shaurma_venues WHERE venue_id<>$1 ORDER BY venue_id',['removed'])).rows;
 const result=await run(db);assert.equal(result.kept,3);
 assert.deepEqual((await pg.query('SELECT * FROM shaurma_venues ORDER BY venue_id')).rows,before);
 assert.equal((await pg.query('SELECT * FROM shaurmeg_markers')).rows.length,3);
 for(const t of ['shaurma_orders','shaurma_bonus_ledger','shaurma_referrals','shaurma_venue_admins','shaurma_venue_invites','shaurma_venue_audit','shaurma_kitchen_access','shaurma_kitchen_order_messages','shaurma_owner_command_context','shaurma_menu_aliases','shaurmeg_builder_cinema','realcity_astra_originals','realcity_astra_access','realcity_astra_drafts'])assert.equal((await pg.query('SELECT * FROM '+t)).rows.length,1,t);
 const user=(await pg.query('SELECT * FROM shaurma_users')).rows[0];assert.deepEqual(user.profile,{first_name:'Keep user'});assert.deepEqual(user.favorites,[{establishment_id:KEEP[0].establishment_id,item_id:'keep'}]);
 assert.deepEqual(await run(db),{already_applied:true});assert.equal((await pg.query('SELECT * FROM shaurma_migrations WHERE migration_key=$1',[KEY])).rows.length,1);
 }finally{await pg.close()}
});
test('Missing keep marker aborts without deleting any venue, order or history',async()=>{
 const {pg,db}=await fixture();try{await pg.exec('DELETE FROM shaurmeg_markers WHERE id=5');await assert.rejects(run(db),/keep_set_incomplete/);assert.equal((await pg.query('SELECT * FROM shaurma_venues')).rows.length,4);assert.equal((await pg.query('SELECT * FROM shaurma_orders')).rows.length,2);assert.equal((await pg.query('SELECT * FROM shaurma_bonus_ledger')).rows.length,2);assert.equal((await pg.query('SELECT * FROM shaurma_migrations')).rows.length,0)}finally{await pg.close()}
});
test('Unknown related table forces rollback and refuses an incomplete purge',async()=>{
 const {pg,db}=await fixture();try{await pg.exec('CREATE TABLE unknown_related(marker_id bigint)');await assert.rejects(run(db),/unhandled_related_table/);assert.equal((await pg.query('SELECT * FROM shaurma_venues')).rows.length,4);assert.equal((await pg.query('SELECT * FROM shaurma_orders')).rows.length,2)}finally{await pg.close()}
});
test('Failure after dependent data deletion rolls the entire transaction back',async()=>{
 const {pg,db}=await fixture();try{await pg.exec("CREATE FUNCTION reject_order_delete() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'simulated delete failure'; END$$; CREATE TRIGGER reject_delete BEFORE DELETE ON shaurma_orders FOR EACH ROW EXECUTE FUNCTION reject_order_delete();");await assert.rejects(run(db),/simulated delete failure/);for(const t of ['shaurma_venues','shaurmeg_markers'])assert.equal((await pg.query('SELECT * FROM '+t)).rows.length,4);for(const t of ['shaurma_orders','shaurma_bonus_ledger','shaurma_referrals','shaurma_venue_admins'])assert.equal((await pg.query('SELECT * FROM '+t)).rows.length,2);assert.equal((await pg.query('SELECT * FROM shaurma_migrations')).rows.length,0)}finally{await pg.close()}
});
