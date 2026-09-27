# Photo-authored quarter: SC-MSK-9342972B1F

Release `zhulebino-photos-1-10-r1` binds marker `3139`, establishment
`SC-MSK-9342972B1F`, venue `b5fe327852468ac7` and the existing coordinates
`37.852223461867, 55.68545543282221`.

## Reference registration

The owner explicitly supplied these originals directly in chat for this first
reconstruction. They remain private; no original images, people, car plates or
panoramas are distributed with the app. The public model contains architectural
measurements, colours, vector signs and reference filenames only.

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
by the studio are not silently overwritten. Installation is idempotent.
No private photo reads, access-control changes or new write endpoints are added.

The same custom WebGL layer uses MapLibre's depth, camera and canvas. The existing
Quarter Dive sources remain. The reconstruction has no original-photo billboard,
separate viewer, infinite render loop or photo-generation dependency. It adds
entrance, heart and quarter camera presets; exploration folds the venue card
while retaining its exact menu route. Closing restores the original map.

## Validation

`node --test v2/backend/test/realcity-astra.test.js` covers venue and geometry
binding, original-scene preservation, studio priority, known photo numbering,
concave roof containment and the complete authored mesh budget. Browser QA must
also inspect all three presets on a phone viewport and verify cleanup, picking,
menu context, GL compilation and the deployment's public per-marker response.

Future reference uploads should use the dedicated Astra Studio. This direct-chat
release is a reviewed exception authorized by the owner for the first venue.
