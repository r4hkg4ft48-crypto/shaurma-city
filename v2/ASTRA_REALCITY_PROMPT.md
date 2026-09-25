# Astra 6 — Shaurmeg RealCity implementation prompt

Use this when the user says: **делаем realcity**.

You are continuing the existing production project **Shaurmeg v2** in repository:

`r4hkg4ft48-crypto/shaurma-city`

Do not create a separate demo, new map, detached 3D scene, panorama, video transition, or photo billboard.

## Goal

When a user taps a Shaurmeg venue marker, they must feel that they **fall from the normal map into a digital twin of the real place**.

The normal MapLibre/OpenFreeMap city is the base spatial truth. During the venue-selection transition, the local quarter around the selected marker transforms into a detailed, recognizable digital copy of the real-world location.

The transformation must remain geographically aligned while the user zooms, pitches, bears and pans the map.

## Existing production system you must preserve

Frontend:
- `v2/frontend/map.js`
- `v2/frontend/app.css`
- `v2/frontend/index.html`

Backend:
- `v2/backend/src/realcity-service.js`
- `v2/backend/src/realcity-analyzer.js`
- `v2/backend/src/routes.js`

Persistence:
- `shaurmeg_markers.realcity_profile`
- `shaurmeg_markers.realcity_reference_images`

Identity/routing invariants:
- `marker_id + establishment_id + venue_id`
- Telegram verified initData/session
- menu/order/admin routing must not change

## Quarter Dive Engine already exists

Do not remove it. Improve its visual fidelity.

Current MapLibre sources/layers include:
- `focus-flight` — camera-flight path
- `focus-zone` — venue focus
- `realcity-ground` — local ground transition zone
- `realcity-greens` — green polygons
- `realcity-roads` — local road geometry
- `realcity-context` — neighboring building extrusions
- `focus-building` — hero building
- `realcity-trees` — local tree points

The frontend already:
1. flies the camera toward the selected marker;
2. dims ordinary map buildings locally;
3. reveals ground/green/road context;
4. grows neighboring buildings;
5. grows the hero building;
6. keeps all geometry anchored to the map;
7. clears the digital twin when the venue is deselected.

The backend RealCity profile already persists:
- scene radius
- hero building id
- buildings with exact polygon rings, height, levels, role, procedural palette/style
- trees
- roads
- green zones
- camera parameters
- facade analysis
- user reference-photo analysis

## What you need to improve

Your responsibility is the **realism and facade reconstruction**.

For the selected venue and its local quarter:

### Hero building
Reconstruct recognizable real facade detail:
- true wall/material colors;
- floor rhythm;
- window spacing and proportions;
- balconies/loggias;
- vertical facade bands;
- storefront geometry;
- entrance position;
- venue signage;
- roof/parapet;
- visible technical structures.

### Context buildings
Keep them lower-detail but recognizable:
- correct massing;
- approximate real facade palette;
- floor/window rhythm;
- major balcony bands;
- roof shape where visible.

### Street environment
Improve:
- road appearance;
- sidewalk/curb;
- grass/soil;
- trees;
- parking areas;
- poles/lights/bollards where relevant;
- entrance forecourt;
- other distinctive objects needed to recognize the place.

## Reference material

The user may provide facade photos, street photos or video.

Use them to infer structure and appearance.

Do NOT paste the photo as a flat texture inside the map footprint.

If image textures are used, they must be perspective-correct facade materials mapped to the corresponding building face, not screen-space/photo billboards.

## Preferred rendering architecture

Preferred:
1. MapLibre custom WebGL layer or Three.js custom layer anchored to Mercator/map coordinates;
2. build facade planes from each polygon edge;
3. generate per-edge procedural/detail geometry/materials;
4. use durable profile data so reconstruction survives reload;
5. retain LOD for Telegram Mini App/iPhone performance.

A custom layer may coexist with the current GeoJSON extrusion layers during migration.

Do not replace the base map.

## Suggested persisted extension

Extend `realcity_profile.astra`, for example:

```json
{
  "version": 1,
  "hero_building": {
    "building_id": "...",
    "facades": [
      {
        "edge_index": 0,
        "floors": 12,
        "material": "painted_panel",
        "wall": "#d4d1ca",
        "window_grid": {},
        "balcony_grid": {},
        "storefront": {},
        "signage": []
      }
    ],
    "roof": {}
  },
  "context_buildings": [],
  "environment": {
    "sidewalks": [],
    "parking": [],
    "street_objects": [],
    "trees": []
  }
}
```

You may design a better durable schema if necessary, but keep backward compatibility with current `realcity_profile.scene`.

## Required transition

The user experience should be:

normal map
→ marker tap
→ other markers recede
→ cinematic camera dive
→ focus ring/flight path
→ base buildings locally fade/dim
→ road/ground/green context appears
→ context buildings reconstruct
→ hero building reconstructs in highest detail
→ facade details settle into place
→ digital twin remains interactive on the same map

Returning to the map must reverse/clear the local RealCity state without reloading the Mini App.

## Performance constraints

Target Telegram Mini App on iPhone.

Use LOD:
- no RealCity geometry for unselected venues;
- only one active quarter;
- hero building highest detail;
- nearby buildings medium detail;
- background buildings low detail;
- cap objects and texture sizes;
- lazy-create GPU resources;
- dispose/clear them on deselection;
- keep graceful GeoJSON/procedural fallback.

Respect `prefers-reduced-motion`.

## Validation

Before merge:
- map still opens reliably;
- marker selection still identifies exact venue;
- RealCity stays aligned while changing zoom/pitch/bearing;
- menu opens exact `marker_id + establishment_id`;
- orders/admin flows still work;
- no flat photo pasted inside a footprint;
- iPhone-sized viewport remains usable;
- CI is green;
- deploy exact merged commit;
- verify production API health and Telegram sync.

## Desired result

The result should no longer look like “a recolored map building”.

It should look like:

**the real building and its immediate surroundings have become a digital twin, while still being the same geographically correct Shaurmeg map.**
