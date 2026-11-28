# 3D migration checklist: every page and feature

Started 2026-11-28 to track what is on the three.js county scene, what still runs on the old map engines, and which old pages can go. Companion to `docs/county-3d-plan.md` (the why and the architecture). Tick a box in the same PR that lands the work, and add the PR number.

## Short answer: swap defaults, don't remove pages yet

Only one old page was safe to remove (the ArcGIS 3D flood page), and it is gone. Everything else either has no 3D replacement yet, or is a 2D page the plan keeps on purpose (phones, printing, forms).

**No redirects.** Only Ryan and Claude use the app (Ryan, 2026-11-28), so a retired page is deleted outright and links to it are updated in the same PR. No stub pages are kept for old bookmarks.

The bigger move is to **swap defaults** rather than delete: make the 3D map the default where it already does everything the old map did, and keep the old one one click (or one URL parameter) away. Pages get deleted (no redirect) only after the 3D default has run through a real storm or exercise without anyone needing the fallback.

Two reasons not to start deleting:

1. **Classic Storm Watch is still the front door.** The site root (`site/index.html`) is the classic ArcGIS app, and it holds about 15 tool areas Command does not have yet (list below). Removing it would remove those tools.
2. **Command's 3D map has no safety net yet.** It is behind `?renderer=three`, has not had staff acceptance on county machines, and nothing falls back to MapLibre if WebGL fails on a machine.

## Pages

| Page | Map today | 3D status | Recommendation | What has to be true first |
|---|---|---|---|---|
| Command (`command/`) | three.js default on desktops; MapLibre on phones, without WebGL2, on 3D failure, and at `?renderer=maplibre` | Most of the map interface done (see checklist) | **Default swapped** (PR #165) | fps check during weather playback, staff acceptance on county desktops |
| Classic Storm Watch (`index.html`, site root) | ArcGIS MapView/SceneView + MapLibre | Not ported (by design: its useful layers move into Command) | **Keep for now.** Later: make Command the site root and delete classic | Every item in "Classic-only tools" is in Command or deliberately dropped |
| Flood scenarios, 3D (`flood-scenario-3js.html`) | three.js | Done | Keep, it is the 3D flood view | |
| Flood scenarios, 2D (`flood-scenario.html`) | ArcGIS MapView | 2D by design | **Keep** as the phone / weak-GPU fallback | |
| ~~Flood scenarios, ArcGIS 3D (`flood-scenario-3d.html`)~~ | — | Superseded | **Removed** (PR #164, Ryan's okay 2026-11-28), no redirect | |
| River surge (`river-3d.html`) | County engine (three.js) | Done (SceneView version already gone) | Keep | Google 3D tiles only return once the engine loads 3D Tiles (optional) |
| County scene (`county-3d.html`) | County engine | Test bed | Keep as a developer page. Take it out of Command's Views menu once 3D is Command's default | |
| Weather delivery lab (`weather-delivery.html`) | three.js default, MapLibre at `?renderer=maplibre` | Done (PR #163) | **Default swapped to 3D** (PR #164). The toggle stays so both renderers can still be timed | |
| Map comparison pilot (`map-pilot.html`) | MapLibre + ArcGIS | In progress in the "Migrate the next screen to 3D" thread | Add three.js there, then **retire** once Command's default is settled, since its job is comparing engines | Command default decided |
| Evacuation-zone population (`zone-population.html`) | ArcGIS | 2D by design | **Keep 2D** (labels, print, CSV) | |
| Reported problem locations (`reported-locations.html`) | Leaflet | 2D by design | **Keep 2D** (printable review list) | |
| Pump readiness, rehearsal, inventory (`pump-*.html`) | ArcGIS (sign-in, location confirm) | 2D by design | **Keep 2D** (forms) | |
| EOC workspace, guides, setup, planning, terrain notes (`eoc*.html`, `*-guide.html`, `setup.html`, `planning.html`, `terrain.html`, `pump-refresh-setup.html`) | No map | n/a | Keep. Update their links and text when classic is deleted (they point at `./` and describe SceneView sources) | |

## Command 3D map (`site/lib/county-scene-map.js`)

Checked against the TerrainMap interface Command calls and the open items in the plan.

### Done

- [x] Records: polygons and lines draped, points and gauges standing on the terrain, labels (phase 2, efc122ee)
- [x] Camera: focus, overhead, restore, view bounds, camera callback; fits held while hidden (d3decaac)
- [x] Picking and hover into `onSelect` / `onInspect`; selection halo and beacon (9bfebd9d)
- [x] Context: counties, cities, burn scars, watershed outline, trigger highlights, snow and gust points
- [x] Rain forecast, observed regional radar, GOES infrared, snow cover, snowfall (draped)
- [x] Gust forecast with HRRR 10 m wind trails (9720bcd2)
- [x] GOES-18 cloud tops as a surface at altitude (0211d056)
- [x] Hanford KHNX reflectivity volume (PR #160)
- [x] Public-domain USGS imagery with Esri fallback (PR #160)
- [x] County buildings streamed from R2 (PR #161, #162)
- [x] Four acceptance viewports: 1920x1080, 1280x720, 390x844, 844x390 (d3decaac)
- [x] Briefing evidence "Show on map" with the captured camera (c20fd60e)
- [x] Views menu reaches every screen and switches 2D/3D (cd378060)

### Making 3D Command's default

Done in PR #165 for desktops. Still needed before calling it accepted:

- [x] Fall back to MapLibre automatically when hardware WebGL2 is missing or the scene fails to start, with a note under the map saying why (`command/src/renderer.ts`)
- [x] `?renderer=maplibre` / `?renderer=three` force either map; the default flipped to 3D on desktops
- [x] Phones stay on MapLibre until the 3D view passes on actual devices (touch screen under 600 px on its short side; judged by the device screen, so a narrow desktop window keeps 3D)
- [ ] Visible-pane fps run during weather playback (plan, phase 2 open item). Needs a real GPU in a visible window; the cloud container only has software WebGL and cannot reach the tile hosts
- [x] Line labels at close range: named roads, closures and detours show their name at the middle of their longest part within about 25 km
- [ ] Staff acceptance on county desktops

### Nice to have, not blocking the default

- [ ] Snapshot image of the 3D view in briefings (today the camera is captured, not the picture)
- [ ] HRRR forecast cloud volume (`forecastClouds`, a no-op today; Command does not turn it on)
- [ ] Raw KHNX radar samples (`radar`, a no-op today; Command does not turn it on)
- [ ] `forecastWind` (a no-op today; Command does not turn it on)

### Phase 4: operational 3D (not started, by code search)

- [ ] Gauge stage columns with action / flood / moderate / major marks and forecast crest
- [ ] Reservoir pool surfaces at reported elevation, release arrow at the dam
- [ ] Road closures as raised ribbons with barriers, detours dashed (today: draped lines)
- [ ] Outage and PSPS areas, buildings dark at night (today: draped)
- [ ] Evacuation zone fills with Order / Warning and labels (today: draped records)
- [ ] Cameras as pins with a facing cone, snapshot and HLS in Details

## Classic-only tools (must reach Command, or be dropped on purpose, before classic retires)

Found in the classic app's modules with no matching module in Command (code search, 2026-11-28). Each needs a decision: move into Command (any renderer), or drop.

- [ ] FEMA flood zones (1% / 0.2% / Zone D)
- [ ] Inundation scenario fly-to and in-map playback (Command links out to the flood page instead)
- [ ] DWR flood-fight layers and supply planning
- [ ] Forecast review: rank forecast differences across the seven river areas
- [ ] Release and gauge trends; reservoir watch summary; Pine Flat telemetry
- [ ] Waterway / irrigation connections
- [ ] Briefing nearby-record search around gauges and dams
- [ ] Facility and critical-site power review; power network and power-buildings maps
- [ ] Drainage: nearby connections, pump power, review
- [ ] Population: ACS / AFN / zone population panels
- [ ] Caltrans cameras with snapshots and video
- [ ] Waze reports (private key)
- [ ] County sandbags and yards
- [ ] Map search for lakes, streams, roads and assets
- [ ] Basemap gallery and Google Photorealistic 3D (likely dropped: the county scene replaces both)
- [ ] Phone alert summary, mission follow-up, planning questions

## Infrastructure

- [x] R2 bucket `fsw-county-3d` public, CORS set, tiles published (PR #161, #162)
- [x] Tile and manifest retry with backoff for r2.dev rate limits (PR #162)
- [ ] Custom domain for the R2 bucket (r2.dev is rate limited and not meant for production)
- [ ] Pages dispatch Worker: re-set its GitHub token secret (401 Bad credentials since 2026-11-28 04:52 UTC), so feeds publish every 15 minutes
- [ ] Sharper terrain: 3DEP 1 m lidar after the vertical-datum check (Stage B)

## Removal log

Record each page removed or redirected, with the PR and Ryan's okay.

- 2026-11-28, PR #164: deleted `flood-scenario-3d.html` and `flood-scenario-3d.js` (ArcGIS SceneView flood page, superseded by `flood-scenario-3js.html`). No redirect. Ryan's okay in the project thread.
- 2026-11-28, PR #165: Command defaults to the 3D county map on desktops, with automatic MapLibre fallback; MapLibre at `?renderer=maplibre`.
- 2026-11-28, PR #164: weather delivery lab defaults to the 3D county map; MapLibre at `?renderer=maplibre`.
