# RealCity Photoreal Reconstruction Worker

Dedicated CUDA worker for the **photographic** RealCity tier.

It is intentionally separate from the normal Shaurmeg API. The web/API service
must stay responsive while this worker performs multi-view reconstruction.

## Production model

The default checkpoint is `facebook/VGGT-1B-Commercial`. Access is gated by
Hugging Face/Meta and must be accepted by the account that operates the worker.
The older/original VGGT and VGGT-Ω research checkpoints are **not** the
production default.

Pipeline:

1. Download time-limited owner originals and license-compatible open imagery.
2. Decode and quality-screen up to `REALCITY_RECONSTRUCTION_MAX_FRAMES`.
3. Run VGGT multi-view camera + depth reconstruction on CUDA.
4. Optionally refine cameras with VGGT tracks + COLMAP bundle adjustment.
5. Align the reconstruction to the venue's metric map frame using source GPS
   camera positions. Fall back to footprint radius + heading only when there is
   insufficient GPS overlap.
6. Reject low-confidence/outlier points and suppress geometry that has no
   multi-view support when enough views exist.
7. Quantize source-colour surfels into RCSP1 (12 bytes/point).
8. HMAC-sign the artifact and return it to the Shaurmeg API.
9. The API verifies target IDs, input signature, hero footprint geometry key,
   chunk bounds and binary digest before publishing `profile.photoreal`.

The worker does **not** invent a new street layout. OpenFreeMap/OSM geometry is
the metric anchor and distant LOD. The dense reconstruction replaces the
procedural near-field world.

## GPU

Use a CUDA GPU service. More visual observations materially improve the result,
but frame count must fit VRAM. Start with 24–32 views. A 24 GB GPU is a practical
minimum target for useful batches; higher-memory GPUs allow broader simultaneous
multi-view inference.

Environment:

```
REALCITY_WORKER_TOKEN=...
REALCITY_CALLBACK_SECRET=...
HF_TOKEN=...
REALCITY_VGGT_MODEL=facebook/VGGT-1B-Commercial
REALCITY_GPU_CONCURRENCY=1
REALCITY_USE_BA=true
```

`REALCITY_CALLBACK_SECRET` must exactly match the API's
`REALCITY_RECONSTRUCTION_SECRET`. Tokens must never be embedded in the Mini App.

## Health

`GET /health` reports CUDA availability, GPU name and selected model.

## Output

The runtime artifact is deliberately smaller than a training checkpoint or raw
point cloud. RCSP1 records are:

- int16 x/y/z quantized inside chunk bounds (6 bytes)
- source RGB (3 bytes)
- surfel radius (1 byte)
- reconstruction confidence (1 byte)
- semantic byte (1 byte)

The current mobile budget is ~160k points. The renderer draws the result in the
same MapLibre WebGL context and keeps the normal map outside the reconstructed
radius.
