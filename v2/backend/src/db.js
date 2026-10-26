'use strict';
const fs=require('fs');
const {Pool}=require('pg');
const config=require('./config');

function v3SslOptions(connectionString){
  const address=new URL(connectionString);
  const expectedName=String(process.env.V3_DB_NAME||'shaurmeg_v3').trim();
  if(decodeURIComponent(address.pathname.slice(1))!==expectedName){
    throw new Error('v3_database_name_mismatch_refusing_shared_v2_database');
  }
  const transport=String(process.env.V3_DB_TRANSPORT||'tls').toLowerCase();
  if(transport==='local'){
    if(!['localhost','127.0.0.1','[::1]'].includes(address.hostname)){
      throw new Error('v3_insecure_database_transport_requires_loopback');
    }
    return false;
  }
  if(transport!=='tls')throw new Error('v3_database_transport_invalid');
  // URL sslmode fields would override the explicit pg SSL object; keep CA policy here.
  if(['sslmode','sslrootcert','sslcert','sslkey'].some(key=>address.searchParams.has(key))){
    throw new Error('v3_database_url_must_not_override_ssl_options');
  }
  const caFile=String(process.env.V3_DB_CA_FILE||'').trim();
  const ca=caFile?fs.readFileSync(caFile,'utf8'):String(process.env.V3_DB_CA_PEM||'').trim();
  return ca?{rejectUnauthorized:true,ca}:{rejectUnauthorized:true};
}

const pool=config.DATABASE_URL
  ? new Pool({
      connectionString:config.DATABASE_URL,
      ssl:config.UNIFIED_MODE?v3SslOptions(config.DATABASE_URL):{rejectUnauthorized:false},
      max:8,
      idleTimeoutMillis:30000,
      connectionTimeoutMillis:10000
    })
  : null;

async function query(text,params=[]){
  if(!pool)throw Object.assign(new Error('database_not_configured'),{status:503});
  return pool.query(text,params);
}
async function tx(fn){
  if(!pool)throw Object.assign(new Error('database_not_configured'),{status:503});
  const client=await pool.connect();
  try{await client.query('BEGIN');const out=await fn(client);await client.query('COMMIT');return out}
  catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}
  finally{client.release()}
}
module.exports={pool,query,tx,configured:!!pool};
