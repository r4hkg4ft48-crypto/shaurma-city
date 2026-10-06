'use strict';
// Admin access-key UI is served by the production adapter; v2 remains the shared data contract.

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
  AGGREGATOR_BOT_USERNAME:clean(process.env.AGGREGATOR_TELEGRAM_BOT_USERNAME||'Shaurmeggbot').replace(/^@/,'')||'Shaurmeggbot',
  ADMIN_BOT_TOKEN:clean(process.env.ADMIN_TELEGRAM_BOT_TOKEN),
  ACCESS_ADMIN_BOT_TOKEN:clean(process.env.ACCESS_ADMIN_TELEGRAM_BOT_TOKEN||process.env.ADMIN_ACCESS_TELEGRAM_BOT_TOKEN),
  ACCESS_ADMIN_BOT_USERNAME:clean(process.env.ACCESS_ADMIN_TELEGRAM_BOT_USERNAME||'Shauermenadmenbot').replace(/^@/,'')||'Shauermenadmenbot',
  VENUE_OWNER_BOT_TOKEN:clean(process.env.VENUE_OWNER_TELEGRAM_BOT_TOKEN),
  KITCHEN_BOT_TOKEN:clean(process.env.KITCHEN_TELEGRAM_BOT_TOKEN),
  KITCHEN_BOT_USERNAME:clean(process.env.KITCHEN_TELEGRAM_BOT_USERNAME||'').replace(/^@/,''),
  CHANNEL_BOT_TOKEN:clean(process.env.CHANNEL_TELEGRAM_BOT_TOKEN),
  CHANNEL_BOT_USERNAME:clean(process.env.CHANNEL_TELEGRAM_BOT_USERNAME||'').replace(/^@/,''),
  CHANNEL_CHAT_ID:clean(process.env.SHAURMEG_CHANNEL_CHAT_ID),
  CHANNEL_ASSET_BASE_URL:clean(process.env.SHAURMEG_CHANNEL_ASSET_BASE_URL).replace(/\/+$/,''),
  CHANNEL_AUTO_PUBLISH_LAUNCH:clean(process.env.CHANNEL_AUTO_PUBLISH_LAUNCH).toLowerCase()==='true'||clean(process.env.CHANNEL_AUTO_PUBLISH_LAUNCH)==='1',
  CHANNEL_BOT_ADMIN_IDS:new Set(csv(process.env.CHANNEL_BOT_ADMIN_IDS||process.env.ADMIN_TELEGRAM_IDS||'')),
  OPENAI_API_KEY:clean(process.env.OPENAI_API_KEY),
  PANORAMAX_API_URL:clean(process.env.PANORAMAX_API_URL),
  MAPILLARY_ACCESS_TOKEN:clean(process.env.MAPILLARY_ACCESS_TOKEN),
  REALCITY_OPEN_WORLD_ENABLED:clean(process.env.REALCITY_OPEN_WORLD_ENABLED||'true').toLowerCase()!=='false',
  REALCITY_OPEN_WORLD_MAX_IMAGES:Math.max(2,Math.min(18,Number(process.env.REALCITY_OPEN_WORLD_MAX_IMAGES||10)||10)),
  REALCITY_OPEN_WORLD_TEXTURES:clean(process.env.REALCITY_OPEN_WORLD_TEXTURES||'true').toLowerCase()!=='false',
  REALCITY_OPEN_WORLD_REFRESH_DAYS:Math.max(1,Math.min(90,Number(process.env.REALCITY_OPEN_WORLD_REFRESH_DAYS||21)||21)),
  VOICE_PROVIDER:clean(process.env.KITCHEN_VOICE_PROVIDER||'off').toLowerCase(),
  VOICE_TRANSCRIBE_MODEL:clean(process.env.KITCHEN_VOICE_TRANSCRIBE_MODEL||'gpt-4o-mini-transcribe'),
  VOICE_INTENT_MODEL:clean(process.env.KITCHEN_VOICE_INTENT_MODEL||'gpt-6-luna'),
  OWNER_API_TOKEN:clean(process.env.OWNER_API_TOKEN),
  OWNER_PASSWORD:clean(process.env.OWNER_PASSWORD),
  ADMIN_IDS:new Set(csv([process.env.ADMIN_TELEGRAM_IDS||'',process.env.ADDITIONAL_ADMIN_TELEGRAM_IDS||''].filter(Boolean).join(','))),
  SESSION_TTL_SEC:7*24*60*60,
  BUILD:'v2-realcity-open-world-2'
};
