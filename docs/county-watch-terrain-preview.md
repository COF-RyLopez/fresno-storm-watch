# County Watch terrain preview — November 14, 2026

Branch: `feat/county-watch-terrain`. Local preview only; not a published release.

Selecting a County Watch concern opens the MapLibre terrain reference inside the main map panel. Existing collectors and evidence remain in the ArcGIS application. The regular map remains the fallback and Explore map restores it. An Overhead control changes the pitch without changing the source. Phone Attention / Map / Evidence navigation remains available.

Only allowlisted, already-loaded feature properties enter a transient GeoJSON source. Facilities are eligible only through the existing source/access state. Nearby context uses a 5 km geometric distance from selected watchpoints or the target center; it does not infer network connections, exposure, current power or safe access. No private data is written to storage, files, or a new public service. Unloaded inventories remain unassessed.

Terrain is Mapzen/Tilezen Terrarium reference elevation at exaggeration 1, not DWR LiDAR or a modeled water surface. The FROG style still uses the existing county USGS 3DHP flowline and waterbody tiles, plus an Esri roads/place-name background. Separate USGS service lines are suppressed while the FROG basemap is active. This increment does not refresh or replace the hydrography snapshot.

USGS service metadata checked November 14 reports data refreshed September 4, 2026. The local flowline manifest records retrieval on October 20. Re-reading the same service is not evidence that the geometry is newer. Refreshing the snapshot must validate source inventory/attributes, tile coverage and labels; cached acquisition batches must not mask changed records with unchanged IDs. The user clarified that the unfinished phrase was accidental TV transcription; the quiet background and single 3DHP drawing path remain the selected presentation.

Verification: seven focused tests cover geographic CRS, deduplication, private property exclusion and removal, polygon rings, late/failed initialization, rapid selections and shared-renderer disposal. Local browser checks passed for Pine Flat focus, Overhead, Explore map and return, and phone evidence/map switching at 390 × 844. The 1280 × 720 desktop and phone screenshots are local work artifacts. Private facility integration is tested with synthetic records; no signed-in county facility browser test was performed this turn. The preview's old reservoir readings remain explicitly marked old/unverified; scheduled published collection is separate.

This is the initial local validation record. See release-082.md and the release PR for the subsequent reviewed implementation and deployment checks. No new AGOL permissions or data migration.
