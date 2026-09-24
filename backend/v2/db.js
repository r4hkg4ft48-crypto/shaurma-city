'use strict';
const {Pool}=require('pg');
const config=require('./config');

const pool=config.DATABASE_URL
  ? new Pool({connectionString:config.DATABASE_URL,ssl:{rejectUnauthorized:false},max:8,idleTimeoutMillis:30000})
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
