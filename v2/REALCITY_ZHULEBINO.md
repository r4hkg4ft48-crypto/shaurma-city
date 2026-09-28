# Photo-authored quarter: SC-MSK-9342972B1F

Release `zhulebino-photos-1-10-r2` binds marker `3139`, establishment
`SC-MSK-9342972B1F`, venue `b5fe327852468ac7` and the existing coordinates
`37.852223461867, 55.68545543282221`.

## Reference registration

The owner explicitly supplied these originals directly in chat for this first
reconstruction. They remain private; no original images, people, car plates or
panoramas are distributed with the app. The public model contains architectural
measurements, colours, vector signs, reference filenames and eight rectified
architecture/asphalt material crops. No original photograph is published.

| Annotation | Original | Observation |
|---|---|---|
| 1 | IMG_7096.jpeg | Clinic at the marker, blue medical heart, blank ribbed fields, glazing spine |
| 2 | IMG_7105.jpeg | Corner panorama, adjacent housing, mall and service kiosk |
| 3 | IMG_7094.jpeg | Corner connecting the heart elevation with the windowed elevation |
| 4 | IMG_7095.jpeg | Opposite viewpoint, housing and striped Kinomax facade |
| 5 | IMG_7097.jpeg | Pale panel housing and terracotta upper storey |
| 6 | IMG_7099.jpeg | Long view along the road, relation of the three main buildings |
| 7 | IMG_7100.jpeg | Public green space and metro approaches |
| 8 | IMG_7103.jpeg | Milya mall, junction and metro entrance structures |
| 9 | IMG_7104.jpeg | Zhulebino exit 7, metal frame, lime fascia and glazing |
| 10 | IMG_7110.jpeg | Close clinic elevation, windows, bands, entrance and ribbed material |

## What is reconstructed

The clinic has two lower levels, seven repeated upper window rows, a raised
central roof, thin vertical ribs, charcoal spandrels, reveals, mullions, sills,
cornices, the entrance and a raised blue heart/M outline. Its ground footprint
is exactly the existing OpenFreeMap polygon. Roof parts are subordinate geometry
inside that polygon. The neighboring residential facades, podiums, shopping
centre and four metro structures use their own existing map contours.

Native context stays visible. OpenFreeMap sometimes groups distant houses into
one MultiPolygon feature, so the photo layer masks only the distinct clinic
envelope and covers neighboring surfaces with a 3.5 cm depth offset. It does not
hide all polygons in a shared tile feature or generate extra context extrusions.

This is a manually interpreted architectural reconstruction, not a surveyed
photogrammetric mesh. Hidden elevations, roof depth, opening dimensions, tree
roots, lawn bounds, road widths and street furniture are estimates. Observed
and inferred facade evidence are separate; clicking a facade reports it.
The visible references do not establish the entire district or all rear sides.
There is no invented shawarma storefront on the clinic.

### External cross-checks

- [Clinic's reopening article](https://gp-23.ru/novosti/головное-здание-открыто/),
  16 December 2024: exact address and photograph of the renovated heart elevation,
  corner, dark spandrels, cornices and projecting entrance.
- [Panel manufacturer's project register](https://promalliance.pro/projects/moya-poliklinika/):
  the Milya 6 entry records corrugated powder-coated aluminium honeycomb panels.
  The other clinics in the gallery are not substituted for this building.
- [Mall builder's project page](https://adamant-stroy.ru/objects/zdanie-milya/):
  2017 aerials DJI_0674 and DJI_0737 cross-check the mall, housing, podiums,
  clinic plot and paths. The old clinic appearance is superseded by owner photos.
  Owner photo 5 and these aerials correct the clinic-facing housing end wall:
  its large blind central field must not receive the long elevation's window grid.

These references are recorded in `astra.external_references`; external images
are used for inspection, not redistributed as app textures. They corroborate
relative placement, not centimetre-accurate dimensions or a survey.

## Material realism pass (r2)

`tools/build-zhulebino-materials.js` records the exact quadrilaterals, corrects
perspective and strips metadata. Window samples retain the photographed glazing,
blinds and interior lighting. Ribbed cladding, spandrels and asphalt samples have
their low-frequency photographed illumination removed; calibrated albedo keeps
surface detail without repeating the dusk exposure as a visible tiled pattern.
Only the clinic uses its own glazing/cladding samples. Neighboring facades do not
borrow clinic-specific windows. Sampling does not imply measured dimensions.

Materials are attached to existing edge-local facade/opening geometry. Repeating
surfaces use metre-scale, mirrored UVs, a 2048px atlas and mipmaps. The same map GL
context computes linear-space directional/hemisphere lighting and view-dependent
glass reflection. The sky reflection is an approximation, not captured HDR data.
A single 1024px packed-depth shadow pass is cached for the static quarter, with
PCF filtering. Unsupported shadow framebuffers fall back to ordinary shading;
the packed depth sampler uses high precision and receiver-plane comparison;
numeric shadow rendering disables framebuffer dithering and restores it afterward.
all framebuffer, depth and viewport state is restored. GPU resources are disposed
on selection cleanup and recreated on context restoration. No idle render loop.

Tree crowns use seeded world-oriented leaf clusters and branching rather than
opaque low-poly ellipsoids. Their positions and species remain inferred. Existing
map greens and authored lawns share the lighting model. Local POI labels are
temporarily suppressed to avoid floating labels through the facade; venue markers
and navigation remain interactive, and original labels return on close.

This pass improves surface response and vegetation but is not a claim of complete
photorealism. The supplied photos cannot establish unseen roof equipment, all
back elevations, exact dimensions or a full photogrammetric district mesh.

## Geometry and persistence

`backend/src/realcity-releases/zhulebino-geometry.json` is an OpenFreeMap / OSM
snapshot, not generated architecture. Source tile and ODbL attribution are
included. `tools/build-zhulebino-geometry.js` documents reproducible extraction.
Metro exit refs were checked against OSM API nodes 2516024431 (5), 2516024439 (6),
2516024437 (7) and 2516024427 (4).

At normal backend bootstrap the release acquires a row lock for the exact venue
triad, installs `realcity_profile.astra`, and initializes `.scene` only when no
building geometry exists. An existing nonempty `.scene` and all unrelated
profile fields are preserved. Unknown geometry, moved markers and output saved
by the studio are not silently overwritten. Installation is idempotent. The known
reviewed r1 release may upgrade to r2; unrecognized/studio output is preserved.
No private photo reads, access-control changes or new write endpoints are added.

The same custom WebGL layer uses MapLibre's depth, camera and canvas. The existing
Quarter Dive sources remain. The reconstruction has no original-photo billboard,
separate viewer, infinite render loop or photo-generation dependency. It adds
entrance, heart and quarter camera presets; exploration folds the venue card
while retaining its exact menu route. Closing restores the original map.

The map requests `/map/points?profile=summary`: only palette, camera and profile
version accompany the point list. Complete scene/Astra geometry still comes from
the existing exact-marker endpoint after selection. Older callers retain the
original point response. This avoids downloading every point's quarter before
opening the requested venue; no stored profile is truncated.

## Validation

`node --test v2/backend/test/realcity-astra.test.js` covers venue and geometry
binding, original-scene preservation, studio priority, known photo numbering,
concave roof containment and the complete authored mesh budget. Browser QA must
also inspect all three presets on a phone viewport and verify cleanup, picking,
menu context, GL compilation and the deployment's public per-marker response.

Future reference uploads should use the dedicated Astra Studio. This direct-chat
release is a reviewed exception authorized by the owner for the first venue.
