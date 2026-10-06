# RealCity Photoreal v1

RealCity Photoreal is the near-field rendering tier that replaces the old
"extruded map" look with a dense reconstruction of captured reality.

Runtime priority:

```
Photoreal Gaussian scene
        ↓ unavailable / stale
Reviewed Astra authored scene
        ↓ unavailable
Open World observed facade scene
        ↓ unavailable
OpenFreeMap / OSM geometry
```

The base map remains the coordinate system and distant LOD. A photoreal artifact
is accepted only when its marker ID, establishment ID, venue ID, WGS84 origin,
input signature and hero-building geometry key match the current map scene.

## Reconstruction pipeline

```
owner originals + licensed open frames
              │
      bounded source collector
              │
      image quality / resize
              │
 VGGT-1B-Commercial (CUDA)
 camera intrinsics/extrinsics + depth
              │
 VGGT tracks → COLMAP bundle adjustment
              │
 multi-view support / outlier removal
              │
 CUDA Gaussian optimization (gsplat)
 means + anisotropic scales + quaternion
 opacity + captured RGB
              │
 GPS camera similarity alignment
  (map-scale/heading fallback)
              │
 exact venue/footprint integrity check
              │
 RCSP2 quantization
              │
 HMAC callback
              │
 shaurmeg_markers.realcity_profile.photoreal
              │
 MapLibre custom 3D Gaussian layer
```

### Why this is different

The map renderer no longer invents close-range windows, trees, lawns or roads
when a photoreal scene is ready. Inside the reconstruction radius those
procedural layers are suppressed and the dense captured scene is rendered
directly. OpenFreeMap resumes outside the reconstructed radius.

## GPU worker

The worker lives in `v2/reconstruction-worker` and is deliberately not part of
the regular Render API instance.

The production checkpoint is `facebook/VGGT-1B-Commercial`. The gated
checkpoint license/access must be accepted by the account operating the GPU
worker. VGGT-Ω is not the production backend because its published checkpoint is
non-commercial research licensed.

The worker can process up to 48 selected frames by default and the source
manifest can hold up to 96 observations. Owner close-ups are interleaved with
geotagged public frames so the neural reconstruction gets both visual detail
and absolute-world anchors.

When enabled, a second CUDA pass optimizes the dense geometry as 3D Gaussians
against the captured RGB frames. COLMAP bundle adjustment is independently
optional and fails open to VGGT camera estimates if refinement cannot converge.

## Dynamic-object suppression

Before Gaussian optimization, depth points are grouped spatially and checked for
support across multiple input views. Geometry visible from only one frame is
removed unless it has very high model confidence. This reduces ghost cars,
people and one-frame occluders without destroying details when only a small
number of source images exists.

This is intentionally conservative: it does not hallucinate an empty road where
the evidence is insufficient.

## RCSP2

The mobile artifact is a quantized Gaussian representation. Each point is
22 bytes before base64 transport:

- position: 3 × int16, relative to chunk bounds;
- captured RGB: 3 × uint8;
- anisotropic Gaussian scales: 3 × uint16 millimetres;
- orientation quaternion: 4 × int8;
- opacity: uint8;
- confidence: uint8;
- semantic byte: uint8.

The WebGL shader projects the 3D covariance into screen space and evaluates the
resulting 2D Gaussian per fragment. This gives perspective-correct elliptical
splats rather than round point sprites.

## Integrity / privacy

Owner originals are never embedded into the reconstruction job JSON. The GPU
worker receives time-limited HMAC URLs that resolve a single source image.
Raw photos are not added to the public RealCity profile.

The callback HMAC includes a digest of every binary reconstruction chunk.
Changing one byte invalidates the callback.

An accepted scene must also match:

- marker ID;
- establishment ID;
- venue ID;
- input signature;
- WGS84 origin;
- hero building ID;
- hero footprint geometry key.

If the map footprint or source set changes, the old artifact fails binding and
the client falls back to Astra/Open World instead of displaying a misplaced
world.

## API environment

```
REALCITY_PHOTOREAL_ENABLED=true
REALCITY_RECONSTRUCTION_WORKER_URL=https://<gpu-worker>
REALCITY_RECONSTRUCTION_WORKER_TOKEN=<random secret>
REALCITY_RECONSTRUCTION_SECRET=<random callback/source signing secret>
REALCITY_RECONSTRUCTION_MIN_VIEWS=4
REALCITY_RECONSTRUCTION_MAX_FRAMES=48
REALCITY_RECONSTRUCTION_MAX_POINTS=180000
REALCITY_RECONSTRUCTION_TARGET_BYTES=6000000
```

GPU worker:

```
REALCITY_WORKER_TOKEN=<same worker token>
REALCITY_CALLBACK_SECRET=<same reconstruction secret>
HF_TOKEN=<account with VGGT-1B-Commercial access>
REALCITY_VGGT_MODEL=facebook/VGGT-1B-Commercial
REALCITY_GPU_CONCURRENCY=1
REALCITY_USE_BA=true
REALCITY_USE_GSPLAT=true
REALCITY_GSPLAT_STEPS=720
```

## Quality tiers

A reconstruction with GPS overlap reports `gps-similarity` alignment and an
RMS error in metres. Owner-only reconstructions can still be built, but are
reported as `map-scale` or `map-scale-heading` and should not replace a
high-confidence georegistered scene until reviewed.

The long-term target is not to make every unknown region look plausible. It is
to increase real observation coverage so the fraction of generated/inferred
world continuously approaches zero.
