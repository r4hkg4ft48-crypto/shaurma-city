# RealCity Open World Core

## Product contract

RealCity remains the existing MapLibre/OpenFreeMap map. Selecting a venue replaces
the local generic building representation with an authored local world anchored to
the same WGS84 footprints. It is not a panorama viewer and not a detached 3D scene.

Runtime priority:

1. \`realcity_profile.astra\` — manually reviewed/private Astra reconstruction.
2. \`realcity_profile.real_world\` — automatic reconstruction from open/public sources.
3. Existing OSM/OpenFreeMap procedural quarter — deterministic fallback.

The exact target remains \`marker_id + establishment_id + venue_id\`.

## Implemented pipeline

\`\`\`
OpenFreeMap vector building geometry + OSM
                  |
                  v
              scene skeleton
                  |
      +-----------+-----------+----------------+
      |           |           |                |
  Panoramax   KartaView   Wikimedia       Mapillary*
      |           |           |                |
      +-----------+-----------+----------------+
                  |
          bounded image sampler
                  |
          Sharp image analysis
      palette / edge rhythm / material
      storefront / balcony likelihood
                  |
        camera-to-building matching
                  |
        exact footprint-edge binding
                  |
       constrained facade compiler
                  |
   realcity_profile.real_world (v2 model)
                  |
       existing RealCity WebGL layer
                  |
           MapLibre Mini App
\`\`\`

\`* Mapillary is enabled only when an official \`MAPILLARY_ACCESS_TOKEN\` is
configured. No scraping fallback is used.

## Source policy

### Panoramax

The connector uses STAC-style \`/api/search\` and reads the instance configuration
for its image-license hint. Default public endpoints are tried with bounded
timeouts; \`PANORAMAX_API_URL\` can add an instance.

### KartaView

The public photo endpoint is queried around the marker. Its imagery attribution is
persisted as \`© Grab and KartaView Contributors\`.

### Wikimedia Commons

Nearby geotagged File-namespace media is a low-priority supplementary source.
Items whose reported license does not look like CC/Public Domain are rejected.

### Mapillary

Only the official Graph API is used and only when a token exists. Image thumbnails
are analyzed transiently; Mapillary source attribution is persisted.

### Google Street View

Not used. The production pipeline must not scrape, cache, texture-extract or derive
3D output from Google Maps/Street View content.

## Image handling

Open imagery is fetched only during reconstruction and is bounded by:

- HTTPS-only URLs;
- local/private host rejection;
- 7 MB maximum per source image;
- configurable image-count budget (default 10, hard max 18);
- four concurrent image decodes globally.

Raw images and external image URLs are not persisted in the final RealCity model.
The stored record contains derived appearance observations and provenance:
source, source item ID, page URL, license/attribution, capture metadata, matched
building/edge and quality score.

This keeps runtime independent from third-party image hosts and avoids turning a
street photograph into a billboard texture.

## Geometry contract

Open-world output is version 2 and intentionally reuses the strict Astra geometry
shape so it can use the same renderer. Every building must:

- point to an existing \`scene.buildings[].id\`;
- carry the exact \`geometry_key\` of that footprint;
- use exact stored edge coordinate pairs;
- place every generated module in edge-local metres;
- keep every opening/module inside edge width and building height.

The frontend calls \`RealCitySpatial.bound()\` before a model can render. A stale
or shifted model therefore falls back instead of attaching a facade to the wrong
building.

## Evidence model

Each facade edge is either:

- \`observed\` — at least one open-image observation was matched to this building
  and edge; or
- \`inferred\` — generated deterministically from the real building dimensions,
  OSM style/material prior and neighboring observed appearance.

Generation is constrained. It may synthesize window rhythm, storefront divisions,
balconies, panels and material finish, but it cannot move the footprint, change
the marker binding or invent a different street layout.

## Client rendering

The same \`realcity-layer.js\` renderer now accepts either Astra or Open World
models. It renders directly into MapLibre's WebGL context and shares map depth.

On selection:

1. Fetch full RealCity profile.
2. Prefer a valid Astra model.
3. Otherwise validate and activate \`real_world\`.
4. Fade the generic local buildings under the authored buildings.
5. Render facade depth, frames, glazing, balconies, roofs, roads, greens, trees
   and shadows.
6. Keep outer-city OpenFreeMap buildings as LOD.
7. Show open-source provenance in the map attribution area.

## Quality states

- \`open-observed\` — five or more matched observed facade edges.
- \`open-partial\` — at least one matched observed facade edge.
- \`generated-constrained\` — no useful public image was available; detailed
  facades are generated inside real geometry.
- \`osm\` / \`heuristic\` — legacy fallback if Open World itself cannot compile.

## Environment variables

\`\`\`
REALCITY_OPEN_WORLD_ENABLED=true
REALCITY_OPEN_WORLD_MAX_IMAGES=10
PANORAMAX_API_URL=
MAPILLARY_ACCESS_TOKEN=
\`\`\`

KartaView and Wikimedia do not need credentials.

## Heavy reconstruction seam (VGGT / COLMAP)

The current production API deliberately does not pretend that GPU
photogrammetry is running. The next precision tier is a separate worker:

\`\`\`
scene + selected open image IDs
          |
          v
      GPU worker
  VGGT/VGGT-Ω initial poses/depth
          |
          v
      COLMAP bundle adjustment
          |
          v
  georeference against OSM footprints
          |
          v
 facade rectification / occlusion masks
          |
          v
 reviewed edge-local geometry/material output
          |
          v
 same version-2 authored model contract
\`\`\`

The worker must return metric/edge-local results, never a detached arbitrary
coordinate system. A worker result is publishable only after target IDs and
geometry keys still match the current scene.

## Performance

The authored Open World model is limited to the hero + nearby buildings (maximum
22 in the first runtime tier). Farther buildings remain the native map 3D layer.
The existing renderer has a triangle budget and compact fallback. No source image
is downloaded by the phone.

## Rebuild lifecycle

Bumping \`PROFILE_VERSION\` causes the background RealCity queue to rebuild active
markers. A selected stale marker also queues itself through the existing RealCity
endpoint. The resulting JSON is persisted in \`shaurmeg_markers.realcity_profile\`,
so later map opens do not have to repeat open-source collection.
