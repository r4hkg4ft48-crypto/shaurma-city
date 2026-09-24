'use strict';

const clean=v=>String(v||'').trim();
const csv=v=>clean(v).split(',').map(x=>x.trim()).filter(Boolean);

module.exports={
  PORT:Number(process.env.PORT||3000),
  DATABASE_URL:clean(process.env.DATABASE_URL),
  PUBLIC_API_URL:clean(process.env.V2_PUBLIC_API_URL||process.env.PUBLIC_API_URL||'https://shaurma-city-api.onrender.com').replace(/\/+$/,''),
  PUBLIC_APP_URL:clean(process.env.V2_PUBLIC_APP_URL||process.env.PUBLIC_APP_URL||'https://shaurmeg-v2-app.onrender.com').replace(/\/+$/,''),
  TELEGRAM_CUTOVER:clean(process.env.V2_TELEGRAM_CUTOVER).toLowerCase()==='true',
  CLIENT_BOT_TOKEN:clean(process.env.CLIENT_TELEGRAM_BOT_TOKEN||process.env.CUSTOMER_BOT_TOKEN||process.env.TELEGRAM_BOT_TOKEN),
  AGGREGATOR_BOT_TOKEN:clean(process.env.AGGREGATOR_TELEGRAM_BOT_TOKEN||process.env.SHAURMEG_TELEGRAM_BOT_TOKEN),
  ADMIN_BOT_TOKEN:clean(process.env.ADMIN_TELEGRAM_BOT_TOKEN),
  VENUE_OWNER_BOT_TOKEN:clean(process.env.VENUE_OWNER_TELEGRAM_BOT_TOKEN),
  OWNER_API_TOKEN:clean(process.env.OWNER_API_TOKEN),
  OWNER_PASSWORD:clean(process.env.OWNER_PASSWORD),
  ADMIN_IDS:new Set(csv([process.env.ADMIN_TELEGRAM_IDS||'',process.env.ADDITIONAL_ADMIN_TELEGRAM_IDS||''].filter(Boolean).join(','))),
  SESSION_TTL_SEC:7*24*60*60,
  BUILD:'v2-clean-1'
};
