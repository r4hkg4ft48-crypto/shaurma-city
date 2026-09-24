# Shaurmeg v2 — clean rebuild

This directory is a clean replacement for the accumulated legacy Shaurma City / Lepesh stack.

## Source of truth

- Code: `v2/backend` + `v2/frontend`
- Data: the existing PostgreSQL tables remain authoritative.
- Identity: Telegram signed `initData` and Telegram user ID.
- Venue context: **marker_id + establishment_id + venue_id** must agree before menu/order operations.
- Prices: calculated on the server from the authoritative venue menu, never trusted from the client.

## Apps

### Public
- `index.html` — MapLibre/OpenFreeMap aggregator map.
- `menu.html` — venue-specific menu, persistent cart, cafe/delivery checkout, Telegram profile/order history.

### Administration
- `admin-map.html` — superadmin map and venue control:
  - create/edit/hide markers;
  - coordinates by long press;
  - marker appearance;
  - menu editing;
  - owner access by Telegram ID or one-time code;
  - facade photo analysis and RealCity rebuild.
- `admin-venue.html` — multi-venue owner cabinet:
  - profile;
  - marker appearance;
  - menu;
  - live orders and status workflow.

## Backend modules

- `config.js` — environment contract only.
- `db.js` — PostgreSQL pool/transactions.
- `schema.js` — idempotent non-destructive schema bootstrap.
- `auth.js` — Telegram verification and scoped signed sessions.
- `domain.js` — ID/menu/style normalization.
- `routes.js` — v2 API surface.
- `realtime.js` — SSE event hubs by user/venue/superadmin.
- `telegram.js` — bot menu/webhook synchronization.
- `realcity-analyzer.js` + `realcity-service.js` — facade/street/OSM analysis and profile generation.

## Compatibility with the existing database

v2 intentionally uses the established table names:
- `shaurma_venues`
- `shaurmeg_markers`
- `shaurma_users`
- `shaurma_orders`
- `shaurma_venue_admins`
- `shaurma_venue_invites`
- `shaurma_venue_audit`

No reset, purge, or destructive migration is executed by v2. Existing orders and Telegram-linked users stay in place.

## Safe cutover

1. Keep `main` and the current Render services as rollback.
2. Validate v2 in CI and preview.
3. Point the existing API service at v2 while retaining its current environment variables and `DATABASE_URL`.
4. Smoke-test:
   - map points;
   - marker → exact establishment menu;
   - Telegram client auth;
   - order creation;
   - venue-owner order status update;
   - superadmin marker/menu edit;
   - RealCity facade rebuild.
5. Point the existing static app service at `v2/frontend`.
6. Re-sync Telegram bot web apps/webhooks.
7. Only after production verification, archive legacy BeautyFlow/static services and old monolithic code.

## Validation

GitHub Actions workflow `.github/workflows/v2-validate.yml` checks all JS syntax, installs backend dependencies, loads the API modules and boots the API for a real `/api/v2/health` request.
