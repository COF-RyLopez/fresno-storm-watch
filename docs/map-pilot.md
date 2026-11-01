# MapLibre / ArcGIS pilot · 0.38.0

Open [the separate public pilot](https://cof-rylopez.github.io/fresno-storm-watch/map-pilot.html). The existing app, Experience Builder pilot and private EOC workspace retain their existing behavior and storage. No AGOL items or permissions change.

## Test procedure

1. Use the same computer, browser, window size and network throughout. Close unnecessary heavy tabs. Start with Area Watch or Rivers.
2. Choose **Compare speed → Run three-view test**. The evidence panel closes during measurement so both engines receive the same map area. The test resets countywide, then visits the Friant, lower San Joaquin and Pine Flat reaches without animation, waiting for visible tiles after each change.
3. Switch **Map engine** to the other renderer and repeat with unchanged filters. The snapshot remains in memory across the switch. A matched-pair message appears only for completed error-free runs with equal data, features, styles, dimensions and pixel ratio. **Check live feeds** starts a new data check and a new comparison context.
4. Repeat in reverse order. Reload with `engine=arcgis` to start there. Browser caches are not cleared or controlled by the pilot. Record which engine was used first; a previously cached tile or runtime can favor either engine.
5. Download results. Test both tabs, zoom manually, select cards and compare readable labels, source evidence and responsiveness. Keep browser resizing outside each measured run.

Startup includes loading the selected runtime, parsing styles, processing source features and visible tile settling. Shared snapshot fetching is measured separately. The three extent-change times include network/worker processing. UI frame-gap p95 uses requestAnimationFrame; it is not GPU frame rate. No universal speed improvement is claimed. This compares reduced 2D public-source maps, not the full operational app or 3D/HRRR workloads.

## Data and map contracts

- `scripts/collect-map-pilot.mjs` reuses the existing NWPS and WPC collectors plus the public reservoir, power, NWS wind and NWS/Dynamical comparison snapshots. Seven existing review groups, ten gauge IDs and two reporting reservoirs are retained.
- The bundle has a SHA-256 identifier covering all shared inputs. Both modes consume precisely the same GeoJSON feature IDs, geometry, tone, county outline, targets and assessments. Observation, issue and valid times remain publisher times. No engine-specific warning thresholds are introduced.
- Earlier observed NWPS samples are omitted after retaining 26 hours; this covers the existing 24-hour chart and trend comparison. All normalized forecasts and original units/status/times remain. Missing and failed queries stay explicit.
- The browser checks the same NWPS and WPC collectors on open and on demand, separately from map timing. It holds those results across engine switches. Failures retain prior dated evidence with explicit errors, never relabeling old source observations. The shared input hash is recalculated after each check.
- Public wind, reservoir, power and model-comparison copies come from the scheduled deployment, normally every 15 minutes; GitHub scheduling/delivery is not guaranteed. Original source issue, observation, collection and last-success times remain intact. Freshness limits from the main app remain unchanged. Browser checks can become overdue after seven minutes: click **Check live feeds**, which also reads the latest public source bundle. No automatic refresh interrupts a matched comparison. The full app retains its regular polling.
- Area Watch shows configured sample points and referenced utility polygons, not invented area boundaries. Polygon membership at those samples is not complete facility exposure or proof of access. Rivers displays all ten gauges and two dam reporting locations; no inundation is inferred.
- Geometry is GeoJSON longitude/latitude (EPSG:4326), rendered in Web Mercator. Both views use the same Esri Dark Gray raster tile families or the existing F.R.O.G. Waterways-Dark vector tile style. MapLibre adapts the native Esri vector service metadata to its public PBF tile template; native label placement and marker pixels can differ across engines.
- Existing colors are retained: published-threshold cue, change/review, monitor, gap. Text and triangle/circle/diamond symbols distinguish review points, gauges and reservoirs. Utility colors retain existing utility status semantics; source evidence links back to the full app. No new hazard, dispatch or staging logic.
- This first pilot excludes private facilities, forms, credentials, 3D and animation. It loads no private services and uses no persistent browser storage. Metrics are public-only, tab-memory records with an explicit download. No analytics transmission occurs.

## Maintenance and rollback

Pinned runtime: MapLibre GL JS 6.15.0 (BSD-3-Clause), locally vendored from its npm package; checksums in `docs/map-pilot-runtime.json` verified by `npm run check`. Calcite 5.1.1 loads through the same component URL as the unified ArcGIS 5.1 loader. MapLibre mode does not import the ArcGIS map engine. ArcGIS mode loads it only when selected. Terraformer ArcGIS 2.2.2 (MIT) converts public utility geometry during collection, preserving polygon parts/holes.

Local setup: `npm ci --ignore-scripts`, `npm run collect:map-pilot -- --published`, then `npm start`. The generated public bundle is excluded from git and recreated before Pages uploads; never add operational records to it. Collector logs duration, station count and failures; UI shows missing/stale evidence. Pipeline failure writes an unavailable manifest rather than retaining apparently current data.

Rollback: redeploy 0.37.0 commit `9efec1c31bab3d00f84239d9fc32c44c6ab2b64f`, or remove the pilot link and deployment collector step. No data migration is required. The production map's renderer is unchanged.

API references checked 2026-10-20: [MapLibre Map](https://maplibre.org/maplibre-gl-js/docs/API/classes/Map/), [Calcite Shell Panel](https://developers.arcgis.com/calcite-design-system/components/shell-panel/), [Esri SDK loader](https://developers.arcgis.com/javascript/latest/), [Terraformer](https://github.com/terraformer-js/terraformer).
