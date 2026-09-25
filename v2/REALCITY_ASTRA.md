# Shaurmeg RealCity — Astra 6 handoff contract

## Trigger phrase

**делаем realcity**

When this phrase is used, Astra 6 should assume the user is continuing RealCity work in the existing Shaurmeg project.

## Product intent

When a user selects a shawarma venue, the normal map should transform locally into a detailed representation of the real surrounding city.

The map remains the base. Existing building footprints are the spatial truth. RealCity adds real facade identity on top of those buildings.

The target is: the building on the map should visually become the real building — wall colors, facade rhythm, windows, balconies, storefront, signage, roof/edge details, entrance zone and nearby environmental cues — while staying aligned to the map footprint.

Do not implement a photo billboard inside a building. Do not replace the map with a video, panorama or unrelated 3D scene.

## Current architecture

Repository: `r4hkg4ft48-crypto/shaurma-city`

Source of truth:
- `v2/frontend/map.js` — public MapLibre map and venue-selection camera.
- `v2/frontend/app.css` — map/UI styling.
- `v2/backend/src/realcity-service.js` — RealCity orchestration/profile persistence.
- `v2/backend/src/realcity-analyzer.js` — facade/environment analysis.
- `v2/backend/src/routes.js` — map and RealCity API.
- `shaurmeg_markers.realcity_profile` — persisted per-marker RealCity data.
- `shaurmeg_markers.realcity_reference_images` — reference material.

Existing map selection already creates a focused building overlay from rendered MapLibre/OpenFreeMap building geometry. Astra may extend or replace only that RealCity overlay implementation, not the base map.

## Spatial contract

Every RealCity result must stay keyed to:
- `marker_id`
- `establishment_id`
- venue coordinates
- the corresponding map building footprint / source geometry

Facade details must be reproducible after reload from persisted profile data.

A suitable future profile can extend `realcity_profile` with an `astra` object, for example:

```json
{
  "astra": {
    "version": 1,
    "hero_building": {
      "geometry": {},
      "height_m": 48,
      "facades": [
        {
          "edge": 0,
          "wall": "#b7aa96",
          "floors": 16,
          "window_pattern": {},
          "balconies": {},
          "storefront": {},
          "signage": []
        }
      ]
    },
    "environment": {
      "trees": [],
      "street_objects": [],
      "ground": {}
    }
  }
}
```

This is a contract direction, not a requirement to force this exact JSON shape if a better durable representation is needed.

## Rendering direction

Preferred approaches, in order:
1. MapLibre custom WebGL/Three.js layer anchored to map coordinates and building footprint;
2. deterministic facade panel geometry derived from each footprint edge;
3. GeoJSON/custom extrusion overlays for simpler cases.

The renderer should support:
- per-edge facade material/appearance;
- repeated window/floor rhythm;
- balconies and entrance/storefront modules;
- signage placement;
- roof/parapet details;
- nearby trees/street objects where useful;
- LOD so iPhone Mini App performance remains stable;
- smooth fade/morph from base map building to RealCity building.

## Reference workflow

When the user provides photos/video:
1. identify the exact marker/establishment;
2. preserve the base map footprint and coordinates;
3. infer facade orientation from photos + map geometry;
4. generate/update durable RealCity profile data;
5. render on top of the same building;
6. verify from the expected map camera angle;
7. keep a graceful fallback to current map styling if assets/profile fail.

## Must not break

- @Shaurmeggbot entry flow
- map marker selection
- menu opening
- Telegram initData/session
- order creation
- owner admin
- superadmin map admin
- RealCity photo upload/rebuild endpoints
- production database compatibility

## Validation

Before production:
- syntax/CI green;
- map loads on iPhone-sized viewport;
- selection still opens the correct venue;
- RealCity overlay stays aligned during zoom, pitch, bearing and camera movement;
- no facade image is merely pasted as a flat photo inside the footprint;
- performance remains usable in Telegram Mini App;
- API health and Telegram sync remain green.
