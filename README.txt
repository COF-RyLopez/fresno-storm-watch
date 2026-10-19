FRESNO COUNTY STORM WATCH — GITHUB PAGES PROTOTYPE
Version 0.15.0 | October 18, 2026 | Named waterways and Open 3D buildings

MAP CONTEXT (v0.15.0)
USGS 3DHP named waterways and close-scale unnamed features are county-filtered
in 2D/3D. Open 3D Buildings loads on demand in 3D. Source geometry is reference
context; private county-to-building matches remain pending. Waze is not connected:
the interim AGOL Data Pipelines route needs privileges, a credit budget and
verified coverage. A managed collector or Velocity can support faster updates.
See site/planning.html#map-context and #waze for source contracts and setup.

EOC PILOT LINKS
App: https://cof-rylopez.github.io/fresno-storm-watch/?view=watch
Testing and setup guide: https://cof-rylopez.github.io/fresno-storm-watch/setup.html
Repository: https://github.com/COF-RyLopez/fresno-storm-watch
Deployment runs: https://github.com/COF-RyLopez/fresno-storm-watch/actions/workflows/pages.yml
The app is ready to share only after its Pages deployment succeeds. This is a
public-source prototype; public-map testers do not need GitHub or ArcGIS accounts.
The separate private EOC exercise requires an authorized county ArcGIS account;
group assignments and two-account acceptance remain pending.
For a manual reservoir refresh/deployment: Actions -> Verify and deploy Storm
Watch -> Run workflow -> main. Normal collection targets 15-minute intervals;
GitHub scheduling can be delayed. Check source and collection times in the app.

START HERE
Open site/setup.html for the complete GitHub and optional ArcGIS sign-in guide.
To run locally: Node 22.22.3; npm test; npm run check; npm start.
Browse http://127.0.0.1:8777/ . Stop with Ctrl+C. No npm install is needed.
For updating reservoir readings, run npm run watch:reservoirs in a second terminal.
The collector runs every 15 minutes until stopped; opening the browser does not start it.
If a managed sandbox prevents Node from spawning its test workers, use:
node --experimental-test-isolation=none --test tests/*.test.mjs

SCOPE
Separate custom ArcGIS Maps SDK for JavaScript 5.1 and Calcite app. The unified
Esri CDN entry loads the compatible component libraries together. The Experience Builder
pilot is untouched. NWS layer 1 queries intersect the complete Fresno, Madera,
Merced, Kings and Tulare county polygons. Five-minute foreground polling;
atomic updates, duplicate handling, new/revised-alert banner, explicit failure
and overdue-query states, Pacific timestamps, source links, and exercise mode.

COUNTY ROAD FEED (v0.10.2)
The road map and EOC queue read through the county's existing public ArcGIS Online
route: https://www.arcgis.com/home/item.html?id=d3081a918b7f41219077449bcaa9146d
The upstream hostname resolves to a private address on county workstations;
requests from the public Pages app failed there while local queries succeeded.
The ArcGIS Online route avoids that browser-to-private-network dependency. All
479 records matched the official public view by layer/GlobalID, selected fields
and geometry on October 17. This includes historical records, not 479 active closures.
No copying schedule, new service, browser security exception or credential change
is needed. Both app workspaces use the same reader, with credentials omitted.
Queries repeat every five minutes. Temporary connection/server failures retry
once; incomplete inventories, duplicate IDs and unexpected geometry CRS fail
closed. Failed refreshes retain the last successful records and source timestamps.
An empty response, expired end date or absent record never means a road is open.
The route's metadata advertises editing capabilities. This app calls only /query;
no write capability was tested or changed. County GIS should review the existing
route's effective permissions and maintain its stored-service connection.
Run npm run check:roads for a read-only count/geometry diagnostic. Add
-- --compare-source to compare against the original public view. Neither command
prints record contents or changes the service. See docs/roads-source-check.json.

F.R.O.G. AND PHOTOREALISTIC 3D (v0.9.0)
The user-provided F.R.O.G. PNG replaces the placeholder header and browser icons
in the app and both guides. Original image bytes are preserved. Required Esri
and data-provider map attribution remains visible.
County 3D in the map toolbar opens the saved county Scene Viewer companion at
the current map area. The baseline app remains anonymous.
Esri's hosted photorealistic preview requires an enabled organization and named
ArcGIS account; it is not yet available inside custom apps. The county gallery
did not expose this basemap on October 17. No org settings or entitlements changed.
The saved companion c01a4396e54448e59b83cfb4bf40ebd7 is in Storm Operations 2026-27,
shared with Storm Operations 2026-27 - Authorized viewers. It currently uses
topographic mapping, Terrain3D and full FEMA reference, not Storm Watch's selected
zone/county filter. After administrator enablement, update this existing scene,
verify mesh coverage and named-user access, then set arcgis.photorealisticVerified
to true. The current false setting explicitly reports pending imagery. No gauge records, camera
media, alert state or credentials are passed. No mesh is loaded by the Pages app.
See site/setup.html#photorealistic for exact tasks, coverage checks and the separate
Google Maps Platform option for future direct integration. Live mesh rendering
and second-user companion acceptance remain unverified until access is configured.

DARK MODE (v0.8.0)
Dark mode is the default for new browser sessions. Use Light mode in the top
navigation (sun icon on phones) to switch; Dark mode switches back. Your browser
remembers the choice when local storage is available. The same preference applies
to the setup and planning guides and other open app tabs on this origin.
Calcite controls, 2D/3D gray basemaps, county labels, gauge symbols, hydrographs,
source gaps and error messages adapt together. Historical imagery and camera
pixels are not recolored. Theme changes preserve map location and imagery choice.
Legend hues and shapes remain consistent with the map; FEMA/radar/QPF colors and
all data, calculations and thresholds retain their meaning.

CALCITE WORKSPACE (v0.7.0)
The application now uses native Calcite Shell Panels and an Action Bar for Area
watch, River watch, Weather & reservoirs, Weather alerts, Map and Cameras.
Hover or focus an action to read its label. The active action is highlighted.
Area and reservoir records use Calcite Blocks; expand Source evidence to inspect
values, timestamps and gaps. Camera choices use a Calcite List.
On screens at most 900 pixels wide, one work pane or the map fills the available
space. Show map and Map watchpoints switch directly to the map; the review banner
stays at the top. Wider screens dock the review panel beside the map. At 1280
pixels and wider the camera panel starts open; it can be closed independently.
Closing the camera panel stops its media and retains camera locations on the map.
Application styles are in site/calcite-layout.css; the standalone setup/planning
guides use site/guide.css. All pages share site/theme.css and site/theme.js. No new account or build step is required.
Source calculations, scope, freshness rules and thresholds are unchanged.

RIVER PLANNING
The default River watch view reads NWPS observations and stage/flow forecasts for
9 candidate watchpoints for Fresno County: San Joaquin boundary reaches, Kings
River, Little Dry Creek and James Bypass.
Five-minute foreground polling; separate station failures retain their last values.
Choose a 24/48/72-hour window and river group. Counts cover the entire Fresno watchlist. The river map initially fits Fresno
County; the weather view retains its five-county regional scope.
Open a gauge for its hydrograph, native units, source times, forecast high, gaps
and published threshold cues. Missing categories are unknown, never assumed zero.
The selected live stations lacked usable thresholds at the October 17 source check.
Two-hour observation and 24-hour forecast age limits are prototype review rules.
No local action thresholds, inundation prediction or staging recommendation is
generated. This is a candidate watchlist, not complete river/channel coverage.
For a read-only publisher spot check: node --use-system-ca scripts/probe-rivers.mjs
This command reports station and FEMA failures independently; it does not publish.

Use Inspect FEMA vicinity to see selected NFHL flood zones intersecting Fresno
County at local zoom levels. This display filter retains whole source polygons;
it does not clip cross-boundary polygons or calculate exposure.
Click a polygon for its zone and study identifiers. FEMA mapped susceptibility is
separate from the point forecast; an unshaded area is not established as safe.
3D AND CAMERAS
Use 3D terrain to tilt the existing map over Esri World Terrain, then choose
Overhead, Tilt terrain or 2D. One view renders at a time. Gauges and cameras stay
selectable; FEMA keeps the same county display filter and local scale limit.
Imagery is optional historical basemap context, never a live scene. Elevation
uses the publisher's orthometric meter surface, with variable resolution and
no vertical exaggeration. There is no flood-depth surface or camera viewshed.

Eight Caltrans District 6 highway cameras are curated for Fresno river approaches:
SR-41 Avenue 9, Friant Road and Valley Children's Blvd; SR-99 Herndon and Avenue 7;
SR-99 Route 201/Kingsburg and south of 18th Avenue; SR-180 Reed Avenue.
Madera/Tulare-side cameras are labeled boundary approaches, not Fresno locations.
The list is not a full camera inventory; direct river visibility is unverified.
Choose a camera from the dropdown or its map icon. Locate on map keeps the current
2D/3D mode. The SR-41 cameras link to the existing Highway 41 gauge.

The catalog refreshes every five minutes while the tab is visible. One selected
still image refreshes at the publisher interval (at least 60 seconds), only while
the camera panel and tab are visible. Source file Last-Modified and app load time
are separate; file time is a freshness proxy, not a verified capture time. Old,
unknown, future-dated and failed images are explicit. Catalog record time never
stands in for frame time. Media URLs are allowlisted to the observed Caltrans hosts.
Live HLS video starts only on request, uses a pinned bundled hls.js 1.7.3 player,
and stops when the panel/tab is hidden or camera changes. Failed or stalled video
returns to still-image view. No camera media is archived or sent through a proxy.
Read-only source check: node --use-system-ca scripts/probe-cameras.mjs
See docs/camera-source-check.json for a dated endpoint check, not an uptime promise.

At the October 17 visual check, five still images showed road conditions. Valley
Children's Blvd, Herndon Avenue and Route 201/Kingsburg served outage graphics
despite recent file times and in-service catalog flags. These three carry dated
review warnings and crossed map icons. A maintainer must recheck before clearing
the warnings; no automatic image-content availability detector is implemented.

site/planning.html explains evidence, coverage gaps and future cloud-data work.
DuckDB, private assets, hydraulic modeling, task workflows and routing remain future work.

PUBLICATION
Publish this folder alone as the repository root. The included GitHub Actions
workflow checks the code and deploys only site/. No GitHub repository or Pages
deployment has been created as part of this package. See site/setup.html.
Do not upload the surrounding workspace or the Experience Builder pilot package.

WEATHER AND RESERVOIRS
Open Weather & reservoirs, or /?view=conditions&overlay=qpf&qpf=11 for the seven-day
forecast view. Radar uses a locked, dated CONUS image from NOAA MRMS; choose Latest
or a historical frame. Rainfall forecast offers WPC Day 1 (24h), Days 1-3 (72h)
and Days 1-7 (168h). Their fixed source periods and issuance times are explicit.
QPF is liquid equivalent including snow/ice, not runoff or an inundation model.
One atmospheric overlay is visible at a time; gauges/cameras/FEMA remain available.

CDEC supplies two initial reservoir controls: Millerton/Friant daily reports and
Pine Flat hourly reports. Elevation, storage, inflow and outflow retain units and
individual timestamps. Millerton river outlet release (85), spill (71) and total
outflow (23) remain separate. No future release schedule is ingested. Pine Flat's
USACE release notices link opens separately. Datum reconciliation is not performed.

CDEC lacks browser CORS at the source check. scripts/collect-reservoirs.mjs requests
only public series and atomically writes site/data/reservoir-latest.json. Local
watch:reservoirs or the included scheduled Pages workflow targets 15-minute updates.
GitHub scheduled work can be delayed or disabled; confirm deployments in Actions.
The app checks the snapshot each minute, warns after 45 minutes without collection,
and never treats a fresh collection as a fresh measurement. Failed source checks
retain marked old data. Daily/hourly age rules are 72h/3h prototype review limits.
No credentials or npm package installation is required. A ZIP alone is not a running
collector. See site/setup.html and site/planning.html#weather-reservoirs.

AUTHENTICATION
Public NWS alerts, NWPS gauges, FEMA zones, terrain and Caltrans cameras need no account.
County user OAuth and the private AGOL EXERCISE views are configured in v0.10.1.
The EOC workspace loads private records after sign-in; ordinary group membership
and AGOL view permissions control access. No client secret is used. Private records
stay out of GitHub and persistent app-owned browser storage. Pilot group assignments
and two-account permission acceptance remain pending; see site/eoc-guide.html#access.

BEHAVIOR AND LIMITS
Clear notification affects only this tab's memory. Reloading starts a new session.
It never removes a hazard or records a team acknowledgement. No SMS/email,
background escalation, push notifications or complete source archive is provided.
Queries are tied to fixed county boundaries, not the visible map extent.
Known expired records are excluded. Source removals appear on the next complete
query. The NWS product-code field is not treated as a cancellation flag.
Unknown expiration is shown.
Failure keeps last successful data. Empty results are never called safe.
County boundaries are display/query data, not legal or hydrologic boundaries.

FILES
docs/interface.json          Calcite component inventory and interface decisions
site/                       Public static website and source metadata
site/config.js              Public configuration; optional OAuth Client ID
site/lib/model.js            Alert identity, data validation, notification rules
site/lib/nws.js              Complete county queries, pagination and timeouts
site/lib/map.js              Shared ArcGIS 2D/3D map and graphic layers
site/lib/camera-model.js     Camera identity, URL safety and freshness contracts
site/lib/camera-ui.js        Camera catalog, still images, selection and failures
site/lib/camera-video.js     On-demand HLS playback and cleanup
site/data/camera-watchlist.json Curated river-crossing approaches and coverage gaps
site/vendor/                Pinned HLS player, license and source integrity
site/lib/river-model.js      Units, freshness, forecast windows and threshold cues
site/lib/nwps.js             Bounded direct NWPS queries; independent failures
site/lib/river-ui.js         River list, banner, filters and source detail
site/lib/river-chart.js      Observed and forecast samples with time/units labels
site/data/river-watchlist.json Candidate stations, source coordinates and caveats
site/planning.html          Evidence rules and next integration increments
site/lib/auth.js             Optional user OAuth; no data-writing calls
site/lib/exercise.js         Explicitly fictional test scenarios
scripts/                    Local server and checks (not deployed)
tests/                      Domain and HTTP-contract tests (not deployed)
.github/workflows/pages.yml  Test then deploy site/ on main
docs/validation.json         Recorded verification and remaining setup work

OPERATIONS
Assign a county maintainer and backup. Update through reviewed commits. Revert a
bad commit and redeploy for rollback; preserve Git history. Watch service errors,
last-successful query, source issue/expiry times and regional counts. No unattended
monitoring is implied. Keep direct official NWS links available during outages.

SOURCE / STYLE
NOAA WWA FeatureServer is authoritative for the displayed products; original
product types remain visible. Warning/red, Watch/amber, Advisory/blue, Other/purple
is an app category scheme, not NOAA's full product symbology. Text accompanies
colors. Display uses Web Mercator, data/query coordinates WGS84 (EPSG:4326).
FEMA NFHL uses its publisher coordinates (NAD83); the SDK projects for display.
There are no area, depth or impact calculations. Source provenance and original
geometry validation are in site/data/. Esri attribution remains visible on map.

License terms for Esri SDK/services remain applicable. Census/NOAA data retain
publisher attribution. County distribution/licensing of application code has
not been assigned by this package.

RIVER-AREA REVIEW (v0.6.0)
Open /?view=watch for six fixed Fresno river groups and /?exercise=1&view=watch
for isolated fictional cases. The banner combines WPC Days 1-3 point samples,
NWPS observed/forecast changes, and consecutive valid CDEC release reports.
Map layers, panning and gauge filters do not change this fixed scope.
Source changes are readiness-review cues; no county action thresholds, risk
score, inundation prediction or staging-site selection have been configured.
See site/planning.html#area-watch and site/setup.html#area-watch-check.

POWER SYMBOLS AND TERRAIN (v0.16.0)
The Power symbols dialog and map legend share shapes, glyphs and area patterns
with utility cards and map graphics. Source failure adds a retained-data clock
badge without changing the last utility status. Use All symbols in the fictional
power exercise to inspect all seven states. County assets remain overlap cues.

site/terrain.html contains a Fresno USGS LiDAR shortlist, 15-work-unit inventory,
download links and a Pro preparation guide. No new terrain is connected yet.

The named-waterway format trial preserves 16,184 county-intersecting segments,
stable IDs and full WKB geometry. GeoParquet is 4.67 MB; equivalent plain GeoJSON
14.04 MB; gzip GeoJSON 3.73 MB. No browser rendering speed improvement is claimed.
The live app retains its viewport USGS service for both 2D and 3D. ParquetLayer
is currently a beta 2D option, not a replacement for SceneView.

Reproduce with a separate Python environment (do not modify the Pro environment):
  python -m venv work/waterways-env
  work/waterways-env/Scripts/python -m pip install -r scripts/requirements-waterways.txt
  work/waterways-env/Scripts/python scripts/export-waterways.py
  work/waterways-env/Scripts/python -m unittest discover -s tests -p test_waterway_export.py
Results, source download, rejected-record accounting and manifest go under
work/waterways-geoparquet. --reuse-download repeats conversion of that snapshot.
No credentials, private layers, AGOL writes or scheduled collection are used.
