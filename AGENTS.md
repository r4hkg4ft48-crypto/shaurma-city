# AGENTS.md

## Shaurmeg v2 is the active product

Use `v2/backend` + `v2/frontend` as the source of truth. Preserve the existing production database, Telegram identity, marker routing and Render services. Legacy code is rollback/reference only.

## Non-negotiable invariants

- Venue context is `marker_id + establishment_id + venue_id`; never loosen this binding.
- Menu prices are authoritative on the server.
- Orders must remain routed to the exact establishment and marker.
- Telegram user identity comes from verified signed `initData`.
- Do not reset/purge production tables.
- Do not replace MapLibre/OpenFreeMap or break existing markers, menu pages, owner admin, superadmin or Telegram bots without an explicit migration plan.

## Astra 6 / RealCity trigger

When the user says **"делаем realcity"**, treat it as a project command for Shaurmeg RealCity work. Before editing code, read `v2/REALCITY_ASTRA.md`.

The intended result is NOT a photo pasted inside a map building and NOT a detached 3D scene.

RealCity means:
1. keep the current map and its existing building footprints/geometry;
2. identify the building(s) around the selected Shaurmeg marker;
3. use user-provided facade/environment photos or other approved source material to infer real-world facade appearance;
4. render detailed facade appearance aligned to and visually covering the corresponding existing map building geometry;
5. preserve selection, marker, menu, orders, admin and RealCity routing;
6. make the transition on venue selection cinematic and seamless.

If implementation requires a new renderer, add it as an overlay/custom layer tied to MapLibre coordinates and building geometry rather than replacing the map.

## Production discipline

- Work on a branch.
- Run the existing `v2-validate` CI.
- Merge only after green CI.
- Deploy the exact merged commit.
- Verify production health, DB bootstrap and Telegram sync.
