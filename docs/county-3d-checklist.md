# 3D migration checklist: every page and feature

Started 2026-11-28 to track what is on the three.js county scene, what still runs on the old map engines, and which old pages can go. Companion to `docs/county-3d-plan.md` (the why and the architecture). Tick a box in the same PR that lands the work, and add the PR number.

## Short answer: swap defaults, don't remove pages yet

Only one old page is safe to remove now (the ArcGIS 3D flood page, which already redirects). Everything else either has no 3D replacement yet, or is a 2D page the plan keeps on purpose (phones, printing, forms).

The bigger move is to **swap defaults** rather than delete: make the 3D map the default where it already does everything the old map did, and keep the old one one click (or one URL parameter) away. Pages get deleted only after the 3D default has run through a real storm or exercise without anyone needing the fallback.

Two reasons not to start deleting:

1. **Classic Storm Watch is still the front door.** The site root (`site/index.html`) is the classic ArcGIS app, and it holds about 15 tool areas Command does not have yet (list below). Removing it would remove those tools.
2. **Command's 3D map has no safety net yet.** It is behind `?renderer=three`, has not had staff acceptance on county machines, and nothing falls back to MapLibre if WebGL fails on a machine.

## Pages

| Page | Map today | 3D status | Recommendation | What has to be true first |
|---|---|---|---|---|
| Command (`command/`) | MapLibre default, three.js behind `?renderer=three` | Most of the map interface done (see checklist) | **Swap default** on desktop. Keep MapLibre for phones, for machines without WebGL, and at `?renderer=maplibre` | WebGL fallback, fps check during weather playback, staff acceptance on county desktops |
| Classic Storm Watch (`index.html`, site root) | ArcGIS MapView/SceneView + MapLibre | Not ported (by design: its useful layers move into Command) | **Keep for now.** Later: send the site root to Command, keep classic at its own address during acceptance, then retire | Every item in "Classic-only tools" is in Command or deliberately dropped |
| Flood scenarios, 3D (`flood-scenario-3js.html`) | three.js | Done | Keep, it is the 3D flood view | |
| Flood scenarios, 2D (`flood-scenario.html`) | ArcGIS MapView | 2D by design | **Keep** as the phone / weak-GPU fallback | |
| Flood scenarios, ArcGIS 3D (`flood-scenario-3d.html`) | Redirect to the three.js page | Superseded | **Remove now (needs Ryan's okay).** The page still loads the whole ArcGIS SDK and stylesheet before its script redirects. Replace it with a bare redirect stub so old links keep working | Nothing |
| River surge (`river-3d.html`) | County engine (three.js) | Done (SceneView version already gone) | Keep | Google 3D tiles only return once the engine loads 3D Tiles (optional) |
| County scene (`county-3d.html`) | County engine | Test bed | Keep as a developer page. Take it out of Command's Views menu once 3D is Command's default | |
| Weather delivery lab (`weather-delivery.html`) | MapLibre default, three.js behind `?renderer=three` | Done (PR #163) | **Swap default now.** It is a lab, so low risk; keep the toggle so both renderers can still be timed | Nothing |
| Map comparison pilot (`map-pilot.html`) | MapLibre + ArcGIS | In progress in the "Migrate the next screen to 3D" thread | Add three.js there, then **retire** once Command's default is settled, since its job is comparing engines | Command default decided |
| Evacuation-zone population (`zone-population.html`) | ArcGIS | 2D by design | **Keep 2D** (labels, print, CSV) | |
| Reported problem locations (`reported-locations.html`) | Leaflet | 2D by design | **Keep 2D** (printable review list) | |
| Pump readiness, rehearsal, inventory (`pump-*.html`) | ArcGIS (sign-in, location confirm) | 2D by design | **Keep 2D** (forms) | |
| EOC workspace, guides, setup, planning, terrain notes (`eoc*.html`, `*-guide.html`, `setup.html`, `planning.html`, `terrain.html`, `pump-refresh-setup.html`) | No map | n/a | Keep. Update their links and text when classic retires (they point at `./` and describe SceneView sources) | |

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

### Before 3D can be Command's default

- [ ] Fall back to MapLibre automatically when WebGL is missing or the scene fails to start (today a failure shows "3D map unavailable" and no map)
- [ ] `?renderer=maplibre` to force the old map, and the default flipped in `command/src/main.ts`
- [ ] Phones stay on MapLibre until the 3D view passes on actual devices (decide: by screen size or by a GPU check)
- [ ] Visible-pane fps run during weather playback (plan, phase 2 open item)
- [ ] Line labels at close range (phase 2 open item)
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

- (none yet)
