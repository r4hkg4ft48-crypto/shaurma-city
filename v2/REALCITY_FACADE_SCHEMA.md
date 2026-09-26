# Astra facade output v2

This is the facade layer of the existing Quarter Dive Engine, not a new viewer.
The MapLibre canvas, camera, depth buffer, controls and GeoJSON sources remain in
use. The raw WebGL custom layer needs no Three.js runtime. Earcut 2.2.4 (ISC)
triangulates the existing polygon roofs; its license is in `frontend/vendor`.

## Authenticated workflow

1. Master Admin → Astra / RealCity → choose establishment and marker.
2. Save photos, their directions and the location comments.
3. **Скачать пакет с фото** exports the saved references and the exact geometry
   revision. The existing copy-manifest action does not contain embedded photos.
4. Interpret the references. Match each observed facade to the exported edge
   endpoints, using the marker-facing edge as a hint, not as proof of camera pose.
   Do not invent details on unseen sides. Mark extrapolation `inferred`.
5. Produce an output JSON in the format below. Optional materials are cropped,
   perspective-rectified architectural patches, never a complete street photo.
6. **Загрузить реконструкцию Astra** validates the result and persists only
   `realcity_profile.astra`. Alternatively, use the authenticated output endpoint.
7. Inspect the venue on the ordinary map. Tap a facade to see whether its
   appearance is observed or inferred. The existing menu button retains all
   venue routing and Telegram identity behavior.

The package contains private source photos: do not commit it to the repository
or expose it as a public static asset. Source photos are not served by the public
RealCity endpoint. Only the approved structural output/material crops are public.

No automatic vision service or model credentials are assumed. Saving reference
photos alone does not claim that reconstruction has occurred. Without a valid
output, the ordinary map geometry remains the fallback.

## Output file

```json
{
  "expected_revision": "copy manifest.geometry.revision verbatim",
  "output": {
    "version": 2,
    "target": {
      "marker_id": "copy target.marker_id",
      "establishment_id": "copy target.establishment_id",
      "venue_id": "copy target.venue_id",
      "coordinates": [37.0, 55.0]
    },
    "buildings": [{
      "building_id": "copy geometry.buildings[].building_id",
      "geometry_key": "copy geometry.buildings[].geometry_key",
      "height_m": 15,
      "base_m": 0,
      "roof": {"color": "#aaa9a3", "parapet_m": 0.25},
      "facades": [{
        "edge_index": 0,
        "edge": [[37.0, 55.0], [37.0003, 55.0]],
        "evidence": "observed",
        "reference_ids": ["actual_asset_id"],
        "confidence": 0.85,
        "wall": {"color": "#d2c3b0", "finish": "panel", "joint_color": "#a6a49b", "module_m": 3},
        "grids": [{
          "kind": "window", "columns": 4, "rows": 3,
          "u_m": 1, "z_m": 4, "spacing_x_m": 3, "spacing_z_m": 3,
          "width_m": 1.4, "height_m": 1.6, "depth_m": 0.12,
          "panes": 2, "color": "#344956", "frame_color": "#e4e4df",
          "omit": [[1, 1]]
        }],
        "modules": [{
          "kind": "entrance", "u_m": 2, "z_m": 0.12,
          "width_m": 1.5, "height_m": 2.2, "depth_m": 0.18
        }]
      }]
    }],
    "materials": [],
    "notes": "Observed details, uncertainties, source dates and side matching."
  }
}
```

The coordinates above are illustrative, not a reconstruction for any venue.
Every real value comes from the exported package and photographic evidence.

`u_m` follows the exported edge from its first endpoint; `z_m` is height above
ground, not floor-relative. Facade normals are derived from polygon winding.
Modules: `window`, `balcony`, `entrance`, `storefront`, `sign`, `panel`, `cornice`,
`canopy`, `vent`. A sign adds `text` and `text_color`; a balcony can add `glazed`.
Materials may be assigned by `material_id` to an edge or a module.

The nearest marker edge is only an orientation hint. The default camera looks
toward it. An observed camera can override `camera: {bearing, pitch, zoom}`.
Unspecified edges retain the map palette and are labeled unobserved, not exact.

## Perspective material helper

```sh
node v2/tools/rectify-astra-material.js package.json crop-spec.json material.json
```

Crop specification: `id`, `source_asset_id`, `source_quad` (normalized TL, TR, BR,
BL photo coordinates), `width`, `height`. The helper uses a projective homography
and bilinear sampling, produces a WebP patch, and retains source provenance.
Crop only planar architectural surfaces; no sky, street, people or vehicles.
This operation does not infer camera pose or automatically recognize the facade.

## Persistence, performance and safety

- `PUT /api/shaurma/admin/astra-realcity/:establishmentId/output` uses existing
  master-admin authorization. Body: `marker_id`, `expected_revision`, `output`.
- A transaction locks the exact marker. Stale inputs return 409. Wrong venue,
  coordinates, footprints, edges, photo IDs and out-of-bounds modules return 422.
- `scene`, menus, orders, source photos, auth and marker IDs are never replaced
  by this endpoint. Generic rebuilds preserve the latest Astra subtree.
- Geometry keys are canonical across starting vertices and winding, and vector
  identities do not depend on ephemeral tile feature indices. This is groundwork
  for district deduplication, not an already implemented multi-venue merger.
- Public points omit the heavy Astra output. Selection requests only one
  marker's profile and loads the renderer lazily. No input photos in public APIs.
- At most 32 buildings / 5,000 modules / 8 material crops; one batched draw call,
  one bounded 2048² atlas, zoom LOD, no continuous idle repaint, explicit GPU
  disposal on close/switch, and context-loss/restoration handling.
- Tests: `node --test v2/backend/test/realcity-astra.test.js`, included in
  `v2-validate`. Render QA uses synthetic facades on real footprints only in a
  local fixture; these are not published as a venue's reconstruction.

## First target

`SC-MSK-9342972B1F` / marker `3139` / venue `b5fe327852468ac7`.
Initial public profile had an empty `scene.buildings`. The missing vector binary
loader and divergent legacy/v2 analyzer versions were corrected. Exact facade
authoring still requires the authenticated saved Astra photo package; do not
substitute the developer QA fixture for the actual reconstruction.
