# RealCity photo facade pipeline v3

This is an extension of the existing Quarter Dive Engine and MapLibre custom
layer. `realcity_profile.scene`, venue identity and the ordinary map are retained.
It is a working deterministic preparation/rendering pipeline, not an autonomous
photogrammetry, LiDAR or generative vision service.

## Studio workflow

1. Master Admin → Astra / RealCity → select the exact venue and marker.
2. Upload original photographs. Each upload saves the original bytes and EXIF
   in private PostgreSQL storage, with SHA-256 deduplication per marker. A separate
   oriented WebP preview is used in the UI. JPEG/PNG/WebP are supported; HEIC
   requires the installed libvips decoder. Unsupported originals fail explicitly
   rather than silently replacing them with a browser screenshot.
3. Upload immediately checks dimensions, contrast, clipping and focus. These are
   screening heuristics at 512px, not accuracy/confidence measurements of a twin.
   Capture location/direction and side descriptions belong in the asset notes.
   Original EXIF remains downloadable; GPS/compass are not automatically parsed.
4. Add location comments and save. Creating the **Astra access** link saves the
   current form first. Send the link to the agent in the project conversation.
5. Astra reads the live manifest and original photos through that scoped link,
   matches map edges, and submits a v3 recipe to the returned `submit_draft_path`.
   No login credential, export archive or public source-photo upload is needed.
6. The server rectifies the confirmed planar regions, applies explicit masks and
   alternate-view replacements, compiles bounded facade geometry, and saves a
   durable draft. Repeated builds reuse unchanged materials by source hash and
   recipe hash. A JSON recipe can also be uploaded in Studio.
7. **Проверить на карте** opens the actual `v2/frontend` application with the
   draft supplied in memory by the same-origin admin parent. It uses the same
   Quarter Dive, basemap, sources, renderer and camera as the public product.
   Closing the preview destroys its canvas. No draft is put into public storage.
8. **Опубликовать проверенный фасад** commits only `.astra`. Both input revision
   and draft timestamp are checked under a row lock. Changed originals, comments,
   coordinates or geometry require reprocessing. Existing output import remains
   available for backwards compatibility.

The bridge is an opaque 256-bit capability; only its hash is stored. It expires
after seven days, can be revoked, and rotates when a new link is issued. It can
read one marker's active dataset and prepare a draft, never publish, access other
markers, alter settings or read admin/menu/order credentials. Treat the link as
private. Routes return `no-store` and `no-referrer`. Do not commit the link,
originals, draft packages or screenshots containing private access URLs.

## Recipe and alignment

The package's `manifest.processing` is the authoritative machine-readable method.
Existing per-venue `astra_instruction` and `notes` accompany it; image text is
source evidence, never an instruction to change permissions or spatial binding.

```json
{
  "version": 3,
  "expected_revision": "manifest.geometry.revision",
  "materials": [{
    "id": "front-surface",
    "width_m": 20,
    "height_m": 12,
    "pixels_per_m": 60,
    "sharpen": 0.25,
    "roughness": 0.85,
    "metalness": 0,
    "lighting_mix": 0.35,
    "views": [{
      "source_asset_id": "saved_photo_id",
      "source_quad": [[0.1,0.1],[0.9,0.2],[0.85,0.9],[0.15,0.8]],
      "exclude": [],
      "exposure_ev": 0,
      "white_balance": [1,1,1]
    }]
  }],
  "output": {
    "version": 2,
    "target": "copy the exact v2 target, including marker/establishment/venue and [lon,lat]",
    "buildings": "v2 building definitions with the surface additions below"
  }
}
```

The placeholders above are explanatory and must be replaced with valid v2
objects, not submitted literally. Facades may add:

```json
{
  "surfaces": [{
    "material_id": "front-surface",
    "u_m": 0, "z_m": 0, "width_m": 20, "height_m": 12,
    "depth_m": 0,
    "confirmed": true,
    "flip_u": false,
    "openings": [{
      "u_m": 2, "z_m": 3, "width_m": 1.4, "height_m": 1.6,
      "depth_m": 0.15, "glass": true,
      "reveal_color": "#b9b5aa", "depth_evidence": "inferred"
    }]
  }]
}
```

`u_m` follows the exported edge. Quad order is TL, TR, BR, BL in the oriented
photo; `flip_u` explicitly relates that photographic direction to edge direction.
Source quads must be convex. Every source must appear in the facade's evidence
list. Surface rectangles cannot overlap or leave their anchored edge/height.
Openings are local to their surface and cannot overlap. Their back face uses
the corresponding portion of the same photograph; reveals are real geometry.
Do not place a second generic window grid on top of a photographed facade.
R2 parts remain supported; use separate surfaces for genuinely separate planes.

Each `views` array contains 1–4 views of the **same planar rectangle**, ordered
by preference. `exclude` is a list of normalized polygons in that view's oriented
source image (cars, people, trees, occlusions). A valid alternate fills excluded
pixels. Views are not averaged, avoiding double window frames from misalignment.
Uncovered pixels remain transparent and show the documented neutral wall fallback.
No image inpainting is performed or misrepresented as observed architecture.

Output is aspect-preserving WebP, up to 2048px on its longest side, bounded by
native source detail. `pixels_per_m` is a requested density, not a measurement
promise. Actual density, missing-pixel fraction and source/recipe hashes are
reported. Strong sharpening, exposure equalization, inferred normal maps and
generative upscaling cannot supply missing geometric evidence and are not used.

## Rendering and budgets

- Up to 12 unique facade materials, alongside the existing 8 repeating materials.
- Unique facade atlas up to 4096², packed preserving proportions; it reduces
  resolution when the bounded atlas fills. Reported `photo_atlas_scale` indicates
  that reduction. Small devices fall back according to `MAX_TEXTURE_SIZE`.
- Mipmaps, 16px gutters and anisotropic filtering (up to 8× where supported) help
  oblique views. Original photos stay private; only approved cropped textures
  without source EXIF are present in public output.
- Material roughness/metalness, measured relief, existing shadow pass and
  controlled additional lighting. Ordinary photographs contain capture lighting:
  this does not pretend to recover calibrated albedo, HDR environment or full PBR.
- 120 references / 16 MiB per original / 256 MiB originals per marker. This initial
  bounded original store uses the existing DB; a city-scale deployment needs
  dedicated object storage and reconstruction workers. Removed source bytes are
  retained for evidence and may be reattached by duplicate hash; no destructive
  cleanup is automatic.
- At most one material build runs per API process; busy requests return 429 for
  explicit retry. Draft writes are atomic; a failed build leaves the old draft.
- No idle render loop, one selected quarter, bounded geometry, GPU cleanup and
  context restoration remain in place. R2 output renders unchanged.

## What is and is not automatic

Uploading performs original storage and image screening immediately. Perspective
rectification, masked view replacement, conservative sharpening and geometry
compilation run automatically **after a recipe with confirmed wall assignments**.
No model API key or unattended agent is configured by this change. Arbitrary new
photos do not automatically become a verified twin; Astra must interpret them.
Video links remain reference inputs; stereo extraction/SfM/LiDAR import, lens
calibration, roof photogrammetry and city-wide object reconciliation are future
extensions, not implemented capabilities. Existing geometry keys support identity
checking but do not yet constitute a shared multi-venue building registry.

Verification: photo preservation/orientation, convexity, source-limited output,
mask replacement, UV direction, recess bounds, HTTP access/revocation, hash
deduplication, stale inputs/draft rejection, scene preservation, renderer/mobile
cleanup, and the existing `v2-validate` gate.

Method references: OpenCV planar homography documentation
<https://docs.opencv.org/4.0.0/d9/dab/tutorial_homography.html>, Sharp image
operations <https://sharp.pixelplumbing.com/api-operation/>, MapLibre custom layer
contract <https://maplibre.org/maplibre-gl-js/docs/API/interfaces/CustomLayerInterface/>.
