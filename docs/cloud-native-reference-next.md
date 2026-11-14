# Reference delivery priorities after 0.76.0

The operational F.R.O.G. waterways basemap already serves static vector tiles
(`site/lib/waterway-basemap.js`, county flowline and waterbody tile catalogs).
The separate cloud-native pilot already has regional hydrography PMTiles and
GeoParquet. Reuse those outputs through the renderer adapter rather than acquiring
the same hydrography again. Area Watch's weather/gauge feed issue is observation
freshness, not feature-service geometry transfer.

Next scoped increments, in order:

1. Profile the same county extent and selected Pine Flat reach in both renderers:
   cold/warm bytes, time to first useful map, complete evidence time, pan/zoom
   responsiveness and memory. Record geometry counts and failures as well as
   timing. No speedup claim until equivalent data and symbology are compared.
2. Use existing regional hydrography MVT/PMTiles for drawing in the cloud-native
   renderer. Preserve source IDs, named waterways, canals, waterbody outlines,
   source date and no-network-trace qualification. GeoParquet remains the
   full-detail query counterpart; it is not a replacement for zoom-level tiles.
3. Prepare permitted building footprint reference tiles, with height/source IDs
   and a GeoParquet analytical counterpart. Keep exact footprint geometry for
   overlap analysis and unknown heights distinct. Query only a selected area.
4. Profile drainage detail queries. If geometry transfer is the bottleneck,
   propose a versioned reference snapshot with existing/proposed asset status,
   owner-approved refresh, deletion handling, completeness accounting and the
   same access classification. Never place private FMFCD, facilities, readiness
   or contacts in a public R2 bucket. A faster mirror cannot bypass sign-in.
5. Keep utility alerts, closures, gauges and readiness updates in their existing
   live/controlled collection paths. Join current status to stable IDs rather
   than baking changing status into long-lived reference tiles. Show snapshot
   age, missing joins and source failures visibly.

Format choice: MVT/PMTiles for drawing, GeoParquet for spatial queries, numeric
COGs for terrain/depth and Zarr when multidimensional chunk access is useful.
DuckDB-Wasm helps bounded analytical queries; it does not make every map layer
draw faster. Check range requests, CORS, cache headers, data licenses and private
access before choosing delivery. No new data migration or renderer-default change
is included in 0.76.0; this file records the next measured migration scope.


## Mission UX gate after 0.79.0

The phone header and selected-area map callout now establish the shared interaction contract for either renderer: choose concern, see its actual source locations, inspect evidence and next review. Keep that contract when moving reference geometry to the cloud-native pilot. Do not add renderer switches to the operational workflow.

Next delivery trial: reuse the existing Millerton/Pine Flat hydrography PMTiles plus its full-detail GeoParquet counterpart, then compare the same selected reach against the current vector-tile basemap. This release does not change renderer defaults or promise an unmeasured speedup. Source freshness and feature-transfer speed are different problems.

Use extruded building footprints with documented heights for simple 3D context; use 3D Tiles/I3S only for complex meshes that justify the delivery and memory cost. Terrain and numeric depth remain distinct, with matching datums and explicit NoData. Weather time slices retain observed/forecast/model labels. Gauges are observations, not a measured floodplain velocity field.

Official documentation checked 2026-11-14: PMTiles retrieves relevant tiles using HTTP ranges and is read-only (https://docs.protomaps.com/pmtiles/). deck.gl Tile3DLayer supports 3D Tiles and I3S (https://deck.gl/docs/api-reference/geo-layers/tile-3d-layer). Use these for reference delivery while live utility/closure/gauge status remains separately timestamped and joined by stable identifiers. Private county data keeps the same access controls.
