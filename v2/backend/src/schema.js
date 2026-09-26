'use strict';
const db=require('./db');

async function ensureSchema(){
  if(!db.configured)return;
  await db.query(`
  CREATE TABLE IF NOT EXISTS shaurma_venues(
    venue_id TEXT PRIMARY KEY,
    slug TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    config JSONB NOT NULL DEFAULT '{}'::jsonb,
    menu JSONB NOT NULL DEFAULT '[]'::jsonb,
    establishment_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_shaurma_venues_establishment ON shaurma_venues(establishment_id);

  CREATE TABLE IF NOT EXISTS shaurmeg_markers(
    id BIGSERIAL PRIMARY KEY,
    venue_id TEXT NOT NULL REFERENCES shaurma_venues(venue_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    establishment_id TEXT,
    name TEXT NOT NULL,
    address TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    lat DOUBLE PRECISION NOT NULL,
    lon DOUBLE PRECISION NOT NULL,
    hero_image TEXT NOT NULL DEFAULT '',
    gallery JSONB NOT NULL DEFAULT '[]'::jsonb,
    hours TEXT NOT NULL DEFAULT '',
    price_label TEXT NOT NULL DEFAULT '',
    marker_avatar TEXT NOT NULL DEFAULT '',
    marker_style JSONB NOT NULL DEFAULT '{}'::jsonb,
    realcity_astra_assets JSONB NOT NULL DEFAULT '[]'::jsonb,
    realcity_astra_config JSONB NOT NULL DEFAULT '{}'::jsonb,
    realcity_profile JSONB NOT NULL DEFAULT '{}'::jsonb,
    realcity_status TEXT NOT NULL DEFAULT 'pending',
    realcity_quality TEXT NOT NULL DEFAULT 'heuristic',
    realcity_updated_at TIMESTAMPTZ,
    category TEXT NOT NULL DEFAULT 'shawarma',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    source_suppressed BOOLEAN NOT NULL DEFAULT FALSE,
    auto_imported BOOLEAN NOT NULL DEFAULT FALSE,
    position_locked BOOLEAN NOT NULL DEFAULT TRUE,
    appearance_locked BOOLEAN NOT NULL DEFAULT FALSE,
    metadata_locked BOOLEAN NOT NULL DEFAULT TRUE,
    verification_status TEXT NOT NULL DEFAULT 'manual',
    verification_score DOUBLE PRECISION NOT NULL DEFAULT 1,
    relevance_score DOUBLE PRECISION NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_v2_markers_establishment ON shaurmeg_markers(establishment_id);
  ALTER TABLE shaurmeg_markers ADD COLUMN IF NOT EXISTS realcity_astra_assets JSONB NOT NULL DEFAULT '[]'::jsonb;
  ALTER TABLE shaurmeg_markers ADD COLUMN IF NOT EXISTS realcity_astra_config JSONB NOT NULL DEFAULT '{}'::jsonb;
  CREATE INDEX IF NOT EXISTS idx_v2_markers_geo ON shaurmeg_markers(lat,lon);

  CREATE TABLE IF NOT EXISTS shaurma_users(
    telegram_user_id TEXT PRIMARY KEY,
    username TEXT,
    first_name TEXT,
    last_name TEXT,
    language_code TEXT,
    is_premium BOOLEAN NOT NULL DEFAULT FALSE,
    profile JSONB NOT NULL DEFAULT '{}'::jsonb,
    favorites JSONB NOT NULL DEFAULT '[]'::jsonb,
    preferences JSONB NOT NULL DEFAULT '{}'::jsonb,
    payment_provider TEXT,
    payment_customer_id TEXT,
    payment_method_id TEXT,
    payment_card_brand TEXT,
    payment_card_last4 TEXT,
    autopay_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    referral_code TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  ALTER TABLE shaurma_users ADD COLUMN IF NOT EXISTS referral_code TEXT;
  CREATE UNIQUE INDEX IF NOT EXISTS idx_v2_users_referral_code ON shaurma_users(referral_code) WHERE referral_code IS NOT NULL;

  CREATE TABLE IF NOT EXISTS shaurma_orders(
    id BIGSERIAL PRIMARY KEY,
    order_number TEXT UNIQUE NOT NULL,
    items JSONB NOT NULL DEFAULT '[]'::jsonb,
    total INT NOT NULL DEFAULT 0,
    customer_name TEXT DEFAULT 'Гость',
    phone TEXT,
    address TEXT,
    comment TEXT,
    status TEXT NOT NULL DEFAULT 'new',
    source TEXT NOT NULL DEFAULT 'web',
    telegram_user_id TEXT,
    telegram_username TEXT,
    telegram_first_name TEXT,
    fulfillment_type TEXT NOT NULL DEFAULT 'delivery',
    payment_status TEXT NOT NULL DEFAULT 'pending',
    payment_method TEXT,
    venue_id TEXT NOT NULL,
    venue_name TEXT NOT NULL,
    establishment_id TEXT NOT NULL DEFAULT '',
    marker_id BIGINT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_v2_orders_user ON shaurma_orders(telegram_user_id,created_at DESC);
  ALTER TABLE shaurma_orders ADD COLUMN IF NOT EXISTS marker_id BIGINT;
  CREATE INDEX IF NOT EXISTS idx_v2_orders_establishment ON shaurma_orders(establishment_id,created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_v2_orders_marker ON shaurma_orders(marker_id,created_at DESC);

  CREATE TABLE IF NOT EXISTS shaurma_referrals(
    id BIGSERIAL PRIMARY KEY,
    referrer_user_id TEXT NOT NULL,
    referred_user_id TEXT NOT NULL UNIQUE,
    referral_code TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'joined',
    first_order_id BIGINT,
    qualified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK(referrer_user_id<>referred_user_id)
  );
  CREATE INDEX IF NOT EXISTS idx_v2_referrals_referrer ON shaurma_referrals(referrer_user_id,created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_v2_referrals_code ON shaurma_referrals(referral_code);

  CREATE TABLE IF NOT EXISTS shaurma_bonus_ledger(
    id BIGSERIAL PRIMARY KEY,
    telegram_user_id TEXT NOT NULL,
    amount INT NOT NULL DEFAULT 0,
    event_type TEXT NOT NULL,
    source_user_id TEXT,
    order_id BIGINT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_v2_bonus_user ON shaurma_bonus_ledger(telegram_user_id,created_at DESC);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_v2_bonus_event_order ON shaurma_bonus_ledger(telegram_user_id,event_type,order_id) WHERE order_id IS NOT NULL;

  CREATE TABLE IF NOT EXISTS shaurma_venue_admins(
    id BIGSERIAL PRIMARY KEY,
    establishment_id TEXT NOT NULL,
    telegram_user_id TEXT NOT NULL,
    telegram_username TEXT NOT NULL DEFAULT '',
    telegram_first_name TEXT NOT NULL DEFAULT '',
    role TEXT NOT NULL DEFAULT 'owner',
    permissions JSONB NOT NULL DEFAULT '["menu","profile","media","appearance","orders"]'::jsonb,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    added_by TEXT NOT NULL DEFAULT 'superadmin',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(establishment_id,telegram_user_id)
  );

  CREATE TABLE IF NOT EXISTS shaurma_venue_invites(
    id BIGSERIAL PRIMARY KEY,
    establishment_id TEXT NOT NULL,
    code_hash TEXT UNIQUE NOT NULL,
    role TEXT NOT NULL DEFAULT 'owner',
    permissions JSONB NOT NULL DEFAULT '["menu","profile","media","appearance","orders"]'::jsonb,
    expires_at TIMESTAMPTZ NOT NULL,
    max_uses INT NOT NULL DEFAULT 1,
    uses INT NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_by TEXT NOT NULL DEFAULT 'superadmin',
    last_used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  ALTER TABLE shaurma_venue_invites ADD COLUMN IF NOT EXISTS kitchen_enabled BOOLEAN NOT NULL DEFAULT TRUE;
  CREATE INDEX IF NOT EXISTS idx_v2_venue_invites_establishment ON shaurma_venue_invites(establishment_id,is_active);

  CREATE TABLE IF NOT EXISTS shaurma_kitchen_access(
    id BIGSERIAL PRIMARY KEY,
    establishment_id TEXT NOT NULL,
    telegram_user_id TEXT NOT NULL,
    telegram_username TEXT NOT NULL DEFAULT '',
    telegram_first_name TEXT NOT NULL DEFAULT '',
    chat_id TEXT NOT NULL,
    source_invite_id BIGINT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(establishment_id,chat_id)
  );
  CREATE INDEX IF NOT EXISTS idx_v2_kitchen_access_est ON shaurma_kitchen_access(establishment_id,is_active);
  CREATE INDEX IF NOT EXISTS idx_v2_kitchen_access_user ON shaurma_kitchen_access(telegram_user_id,is_active);

  CREATE TABLE IF NOT EXISTS shaurma_kitchen_order_messages(
    order_id BIGINT NOT NULL,
    establishment_id TEXT NOT NULL,
    chat_id TEXT NOT NULL,
    message_id BIGINT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY(order_id,chat_id)
  );
  CREATE INDEX IF NOT EXISTS idx_v2_kitchen_messages_est ON shaurma_kitchen_order_messages(establishment_id,order_id);

  CREATE TABLE IF NOT EXISTS shaurma_venue_audit(
    id BIGSERIAL PRIMARY KEY,
    establishment_id TEXT NOT NULL,
    telegram_user_id TEXT NOT NULL DEFAULT '',
    action TEXT NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS shaurma_migrations(
    migration_key TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    details JSONB NOT NULL DEFAULT '{}'::jsonb
  );

  WITH missing_theme AS (
    SELECT venue_id,row_number() OVER(ORDER BY created_at,venue_id) AS rn
    FROM shaurma_venues
    WHERE COALESCE(config->>'theme_key','')=''
  ), assigned AS (
    SELECT venue_id,(ARRAY['emerald','amber','cobalt','cherry','violet','graphite','ocean','citrus'])[((rn-1)%8)+1] AS theme_key
    FROM missing_theme
  )
  UPDATE shaurma_venues v
  SET config=jsonb_set(COALESCE(v.config,'{}'::jsonb),'{theme_key}',to_jsonb(a.theme_key),TRUE),updated_at=NOW()
  FROM assigned a
  WHERE v.venue_id=a.venue_id;
  `);
}
module.exports={ensureSchema};
