# Performance and open-source 3D checkpoint — 0.80.0

Checked 2026-11-14. This release is a bounded migration experiment, not production certification.

## Changes delivered

- County Watch defers basemap-gallery construction until Map tools opens. HRRR display classes and grid frames wait until their layer is wanted. Snow terrain/route display preparation waits for Weather or an explicit layer choice. NWS, reservoir, gauge and weather health collection continues independently.
- Rivers comparison supports the original MVT and a PMTiles archive generated from precisely those tiles. All 15,250 waterway and 1,031 waterbody tiles are decoded with the standard PMTiles reader and compared by SHA-256 against their originals. Archive sizes: 31,650,714 and 2,468,356 bytes. No geometry simplification, new network inference or source-date changes.
- MapLibre 3D terrain at vertical scale 1, a restrained hillshade, reservoir/gauge selection, existing names and Overhead escape. Terrain is reference context; shoreline outlines do not represent current pool elevation.
- Completed request counts and reported Resource Timing transfer sizes in the comparison download. Cached, cross-origin restricted and reader-cached requests prevent interpreting this as total wire traffic.

## Browser observations

Windows in-app browser, 1280x720 window, 960x472 measured map, DPR 1; other tabs open, cache uncontrolled. Extent tests use zero-duration navigation and wait for settling. These are not smooth-animation FPS or full-app loading measurements.

| Same-data Rivers runs | Startup | Friant / lower San Joaquin / Pine Flat settle | UI frame-gap p95 |
|---|---:|---|---:|
| Public baseline MapLibre 2D | 0.86 s | 0.47 / 0.06 / 0.06 s | 32 ms |
| Public baseline ArcGIS 2D | 1.27 s | 0.97 / 0.50 / 0.58 s | 32 ms |
| Local PMTiles 2D, already-used renderer | 0.41 s | 0.31 / 0.06 / 0.06 s | 32 ms |
| Local MVT 2D, already-used renderer | 0.36 s | 0.31 / 0.06 / 0.06 s | 32 ms |
| Local PMTiles 3D with hillshade, separate snapshot | 0.55 s | 0.38 / 0.22 / 0.19 s | 32 ms |

The first two and middle two rows form respective matched pairs. A separate Area Watch pair (15 features, same snapshot and dimensions) measured MapLibre startup 0.54 s and settles 0.66 / 0.50 / 0.06 s; ArcGIS startup 0.83 s and settles 0.44 / 0.19 / 0.22 s. Both frame-gap p95 values were 32 ms. ArcGIS ran second with cached basemap tiles; the mixed result does not justify a wholesale default switch. The 3D row has extra terrain and a different source check; do not use it to calculate a renderer speedup. PMTiles had no measured advantage over already-cached MVT here. The reference archive is a delivery option, not evidence that every feature service should be converted.

Fixed the comparison evidence panel reopening after its close action; verified close/reopen and a subsequent benchmark.

Manual checks: Pine Flat selection, terrain/waterway names, evidence close and phone list/map switching at 390x844; production-style County Watch selection and old/unknown source labels; deferred basemap gallery opens; Weather HRRR metadata/step and snow-route picker initialize. Automated suite: 827 tests passed, public config/import integrity checks passed. Repeat on actual EOC devices with controlled cold/warm caches before changing the operational renderer default.

## Remaining gates

- Measure full County Watch time to first usable concern, selected evidence, map and peak memory on EOC workstations and a representative phone; record feed failures separately from rendering.
- Validate 3D labels, motion tolerance and navigation with non-specialist operators. Keep 2D available. No fabricated animated river velocity or water surfaces from point gauges.
- Add permitted building geometry and heights through the same reference-data contract, preserving unknowns and exact analytical geometry.
- Keep private FMFCD, facility, readiness and contact data authenticated. Public archives contain existing public reference hydrography only.
- Proposed test targets: useful attention list within 3 seconds and cached concern selection within 1 second on the agreed EOC device/network. These are engineering targets, not measured production guarantees.

## GEM-15 assessment

The user supplied Google's public GEM-15 catalog during this work. It is an experimental 15 m terrain/surface product, available as local-UTM COGs with EGM96 metre heights and CC BY 4.0 attribution. Source imagery is acquired through 2024; it is not a live surface. Water and a buffer are no-data, and regional vertical offsets of several metres are reported. Use its DTM as a candidate regional visualization source, compare with local LiDAR/3DEP control and transform vertical datums before placing measured or modeled water. DSM includes surface objects and must not silently replace bare-earth flood terrain. This release uses the existing public Terrarium terrain source, not GEM-15.

Source checked 2026-11-14: https://developers.google.com/earth-engine/datasets/catalog/projects_climate-and-sustainability_assets_gem-15_v1
Catalog: https://storage.googleapis.com/climate-and-sustainability/gem-15/stac/catalog.json
Next evaluation: clip the Kings/San Joaquin area; inventory coverage/no-data/acquisition metadata; compare elevations on stable ground against local bare-earth control; generate reference terrain tiles only after those checks. Retain original numeric COGs for analysis.
