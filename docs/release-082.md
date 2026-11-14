# 0.82.0 — County Watch terrain

Selecting a County Watch concern opens the terrain reference in the existing map panel. The evidence pane and collectors continue working; no separate pilot is needed. The same FROG waterways style supplies flowlines, waterbody outlines, roads and place names. An Overhead control changes pitch, and Explore map restores the specialist map at the selected location.

Already-loaded gauges, reservoir reporting points and authorized facilities provide nearby context within 5 km of the selected river's watchpoints or other concern's focus center. Locations and geometry remain in memory. Facility diamonds distinguish them from source-location circles. Polygon outlines are reference boundaries, not 3D buildings. Source-record multipart geometry is preserved. Context is proximity, not verified downstream connectivity, powered service, exposure or safe access.

Terrain uses the existing Mapzen/Tilezen Terrarium source at exaggeration 1. It is not DWR LiDAR, modeled flood depth or a live reservoir surface. Waterway display tiles remain the existing USGS 3DHP snapshot: this release does not claim a refreshed dataset. Separate USGS flowline service drawings are suppressed when the FROG basemap is active. There is one hydrography drawing path in the focused map.

The focused renderer is lazy, closes on leaving its context, and yields to the regular map if startup, tiles or WebGL fail. Rapid selections cannot publish a superseded request. No new AGOL items, access grants, private exports or browser persistence. Phone Attention / Map / Evidence navigation remains available.

Validation: 12 focused tests cover geographic CRS and large/malformed geometry, multipart records, distinct facility counts, current-concern proximity, allowlisted properties, private clearing, startup errors, runtime errors and overlapping requests. Desktop/phone local checks cover Pine Flat selection, Overhead, Explore/return and phone map/evidence switching. Synthetic records exercise private handling; signed-in facility testing was not repeated for this release. The published collectors continue to supply current source data independently of local reference snapshots.

Rollback: redeploy 0.81.0 / commit 83863e69c0a61f1a35c68e526ec38ace833a8aca. No data migration.
