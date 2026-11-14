# County Watch terrain implementation plan

Goal: put the existing open-source terrain reference inside the selected County Watch concern, with authorized facility context and no duplicate waterways.

Architecture: lazy MapLibre/PMTiles focused renderer inside the existing map panel; ArcGIS remains the specialist map and fallback. Existing concern selection/navigation supplies the focus geometry. A small adapter copies only allowlisted, already-loaded display features into transient GeoJSON. Both engines share the FROG reference style; no additional hydrography overlay is drawn. Terrain is reference, not modeled inundation or reservoir surface.

- [ ] Pure display contract: WGS84 geometries, selected records plus nearby gauges/reservoir points/authorized facilities, five-kilometer proximity rule, distinct source IDs; reject unknown CRS and locations, deduplicate, never serialize credential/source objects. Test missing, duplicate, edge and private-clearing cases.
- [ ] Reuse pinned pilot terrain styling in a lazy County Watch renderer with latest-request-wins navigation, reduced motion, overhead/terrain control, resize, click-through to evidence and bounded failure fallback. Never persist or upload features. Destroy on leaving the focused view or clearing authorization/selection.
- [ ] Bridge current map navigation/selection, source refresh and facilities removal; hide/suspend the other map only after terrain is ready; keep an explicit fallback and existing tools. Nearby references are not service connections, modeled exposure or safe access.
- [ ] Keep evidence alongside the map, including facility availability and geographic proximity meaning. Test rapid switching, phone panes, feed refresh, failed terrain and signed-out state with synthetic private records in automated checks; do not create private records.
- [ ] Run full regression and deployment checks; verify local desktop/phone and published views, then release with rollback to 0.81.0.

The public style contains cached USGS 3DHP lines plus waterbody polygons. map-context.js suppresses its separate named/unnamed USGS service layers and labels whenever that basemap is active.
