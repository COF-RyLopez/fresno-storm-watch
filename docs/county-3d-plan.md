# Fresno County in 3D: porting Storm Watch to three.js

Started 2026-11-27. A working plan, written after the three.js flood-scenario pages (PR #156, #157, draft #158) proved the renderer. Update it as phases land; the change log at the end records what changed and what was measured.

## Why

Emergency managers need one picture of what is happening and where: which water is rising, which roads are cut, where the storm is, who is in the way. Today that picture is spread across four map engines (MapLibre, ArcGIS 2D, ArcGIS SceneView, Leaflet), flat semi-transparent weather overlays on a dark hillshade, and lists that carry most of the meaning. The three.js flood pages showed that a single scene can make the same data legible at a glance: terrain and real imagery, water that sits in the landscape, buildings that change colour as water reaches them, traffic, all on one clock, at 45 fps on a laptop.

The goal is one fast 3D county scene, built once and kept loaded, with live sources layered onto it as they arrive.

## Ground rules (carried over from existing decisions)

These come from `docs/command-calcite-shell-spec.md`, `command-module-weather-ownership.md`, `command-weather-clarity.md`, `command-preview.md` and `performance-080.md`, and still apply in 3D:

- Observations, published forecasts, reference layers and hypothetical scenarios stay visibly distinct. Missing, stale or unknown coverage is shown as such, never as zero or clear.
- No invented data: no interpolated radar scans or forecast frames, gaps stay gaps, no fabricated river velocity or water surfaces from point gauges. Modelled surfaces (flood scenarios) are labelled as models.
- Terrain is reference context. Placing modelled water on lidar terrain needs a vertical-datum check first.
- One persistent map, place, camera, weather product and clock across Watch, Work and Briefing. Timeline, legend and valid time sit below the map, not over it.
- Private data stays in memory, out of URLs and public files. No new feeds or permissions without review.
- A 2D view stays available (Overhead, and a MapLibre fallback for phones or weak GPUs).
- Reduced motion is honoured; nothing autoplays on return.

## Audit (2026-11-27)

### Screens

| Screen | Map today | 3D value | Plan |
|---|---|---|---|
| Command Watch | MapLibre terrain + hillshade, GeoJSON records, raster weather overlays | High | New three.js renderer behind the existing map seam (below) |
| Command Work, Briefing | None (records, forms, versioned briefings) | Low | Keep. Briefing "captured evidence" gains a 3D camera + snapshot |
| river-3d | ArcGIS SceneView (+ optional Google 3D Tiles) | High | Port: surge tubes on DEM-sampled river lines, profile from the same DEM |
| flood-scenario-3js | three.js | Done | Becomes a scene layer; extract its engine |
| flood-scenario-3d | ArcGIS SceneView | Superseded | Retire, redirect to 3js |
| flood-scenario (2D) | ArcGIS MapView | Fallback | Keep for phones / low GPU |
| index.html (legacy Storm Watch) | ArcGIS MapView/SceneView + MapLibre sub-map, ~25 live layers | Medium | Do not port wholesale; its useful layers move into Command layers |
| weather-delivery (lab) | MapLibre terrain | Medium | Test bed for three.js weather texture delivery |
| map-pilot (harness) | MapLibre + ArcGIS | Medium | Add a three.js engine to benchmark against the other two |
| zone-population, reported-locations, pump-readiness | ArcGIS / Leaflet | Low / none | Keep 2D: labels, print, CSV, location confirmation |
| eoc, guides, setup, planning, pump admin pages | None | None | Keep |

### The seam in Command

Every map call in Command goes through one object, `createWatchTerrain` in `site/lib/watch-terrain-map.js`, loaded through the allow-listed module loader (`command/src/module-loader.ts`, `module-contracts.ts`). `main.ts` and `weather-controller.ts` never touch MapLibre. The interface is about 20 methods: `set` (records FeatureCollection), `focus`, `overhead`, `restore`, `resize`, `watershed`, `context`, `highlightTriggers`, `viewBounds`, `rain`, `gust`, `gustPoints`, `snowCover`, `snowfall`, `snowPoints`, `regionalRadar`, `cloud`, `cloudTops`, `radar`, `radarVolume`, `forecastClouds`, `forecastWind`, `destroy`, plus callbacks `onSelect`, `onInspect`, `onCamera`, `onError`. Raster methods take a Web Mercator PNG plus four corners and return `Promise<boolean>` (false = not displayed, which stops playback).

So the port is: write `county-scene-map.js` with the same interface in three.js, add it to the loader allow-list, select it with a flag, and switch the default after acceptance. The attention list, search, timelines, private records and briefing code do not change.

Record features carry `id, name, kind (gauge, area, reservoir, power, road, alert, zone, facility, burn-scar, nws-corridor, trigger, gust), color, detour, gaugeDisplay, readout, hoverText, label`; Multi* geometries must be handled explicitly.

### Data

38 feeds were inventoried (details in the audit notes of this PR). For the 3D design they fall into four groups:

- **Already 3D, already prepared every 15 minutes:** HRRR cloud condensate voxels (32×96×104, 0–16 km, 12 forecast hours), KHNX radar reflectivity Zarr volume (24×48×64, 0–12 km, last hour), KHNX raw radar samples (≤150k points/scan, external host), GOES-18 cloud-top height mesh (≤300k vertices, ≤20 scans). Three of these have WebGL layers in the repo that Command currently switches off.
- **Real-valued surface grids:** HRRR wind u/v, gust and rain rate (201×176, 49 hourly frames), MRMS observed rainfall (101×80, 24 h).
- **Colour-classed images (drape only):** WPC QPF, NDFD snowfall, IMS snow cover, nowCOAST radar mosaic, GOES infrared, WPC probability.
- **Vector features needing terrain placement:** NWS alerts, NWPS/USGS gauges, CDEC reservoirs, road closures and detours, PG&E/SCE outages and PSPS, evacuation zones, care facilities, sandbags, yards/fuel/pumps (some private), cameras (8 Caltrans D6 with JPEG + HLS), burn scars, cities, watersheds, Waze (private key).

County-wide base data in hand: Overture buildings (368,492 footprints, 79% with heights, 35 MB in 0.05° tiles), USGS 3DHP waterways and waterbodies (vector tiles, 113 MB), flood-scenario footprints. Not in hand: any county DEM, imagery mosaic or mesh. Every page streams Terrarium, Esri World Imagery, Esri World Elevation or Google tiles at runtime.

Budget: `site/` is 283 MB of GitHub Pages' 1 GB, before generated weather. A pre-rendered county base must live elsewhere (Cloudflare R2, already used by the KHNX samples host).

## Architecture

### One engine, many layers

`site/lib/county3d/` (vendored three.js 0.187, no new dependencies to start):

- **Scene core:** renderer (reversed depth buffer, log-depth fallback, ACES), sky and sun at the real sun position for the scene clock (night matters in an incident), PMREM environment, fog, shadow window that follows the camera, adaptive resolution that drops DPR when frames run long.
- **Frame:** Web Mercator metres from a county origin, x east, y up, z south, heights scaled by k = 1/cos(lat) (as in the flood page). Every layer converts lon/lat through one `project()`.
- **Terrain:** a quadtree of tiles (heightmap + imagery per tile, skirts, LOD by screen-space error), with a ground-height query for placing features and a GPU height texture for draping.
- **Layers:** each layer declares `kind` (observation, forecast, reference, scenario, private), its time behaviour, and implements `update(clock)`, `pick(ray)`, `dispose()`. Layers never invent frames; a layer with no frame for the clock time shows its gap.
- **Clock:** one scene clock (now, a past observation time, or a forecast valid time), owned by the existing weather controller in Command. The renderer only displays.
- **Picking and labels:** GPU-friendly raycast on simple proxies; labels as a bounded set of HTML elements positioned each frame, hidden when occluded by terrain.

### The county base, in two stages

- **Stage A, streamed (no hosting change):** the quadtree reads Terrarium elevation (z8–z14) and Esri World Imagery (z9–z17) live, exactly as the current pages already do, with attribution. Covers Fresno County and the upstream Millerton/Pine Flat watersheds, bounds [-120.92, 35.91, -118.33, 37.74].
- **Stage B, pre-rendered:** the same tile layout, built once from public-domain sources: USGS 3DEP (1 m lidar where available, 1/3 arc-second elsewhere, after the datum check) and USDA NAIP imagery (0.6 m), plus county-wide Overture buildings packed per tile in the `FP3J` binary layout. Hosted on R2. The client only changes a URL template. Rough size: valley floor at full detail and mountains coarser is low single-digit GB.

### How each feed should look

| Feed | 3D treatment | Kind |
|---|---|---|
| NWS alerts | Draped fill and a low translucent curtain along the polygon edge, colour by category; ends at expiry | Official |
| KHNX radar volume (Zarr) / samples | Raymarched reflectivity volume at true altitude; rain shafts only below observed echoes | Observation |
| Regional radar mosaic | Draped on terrain at county scale; volume takes over near KHNX | Observation |
| GOES-18 cloud tops | Cloud ceiling surface at retrieved altitude, soft-shaded; inspectable height | Observation |
| HRRR condensate | Volumetric cloud field per forecast hour | Forecast |
| HRRR wind / gust | Wind particles advected by u/v at 10 m, coloured by gust class | Forecast |
| MRMS rainfall | Draped accumulation; optional columns per basin | Observation |
| WPC QPF | Draped six-class bands under roads and waterways | Forecast |
| IMS snow cover / NDFD snowfall | Snow on the terrain shader (mask), snowfall bands draped | Observation / forecast |
| NWPS / USGS gauges | Stage column at the gauge: current stage against action/flood/moderate/major marks, forecast crest marker, stale clock | Observation + forecast |
| CDEC reservoirs | Lake surface at the reported pool elevation (storage→elevation table), release arrow at the dam | Observation |
| Road closures / detours | Raised ribbons on the road, closure barriers, detours dashed | Official |
| PG&E / SCE outages, PSPS | Shaded polygons; buildings inside go dark at night | Observation |
| Evacuation zones | Draped zone fills (Order / Warning), zone labels, population on demand | Official |
| Cameras | Pins with a facing cone; snapshot and HLS in Details | Observation |
| Facilities, sandbags, pumps | Simple 3D markers; private ones only when signed in | Reference / private |
| Burn scars, cities, watersheds | Draped outlines | Reference |
| Flood scenarios | The existing scenario layer (water, buildings, traffic) | Scenario |
| River surge (river-3d) | Tubes along DEM-sampled river lines | Illustrative |

### Performance budget

16.7 ms per frame on a recent laptop at DPR 2 for the county view with weather on; 33 ms floor on staff desktops; adaptive resolution before dropping features. Measure with the visible-pane method below. Phones keep the MapLibre renderer until the 3D view passes on actual devices.

## What the flood-scenario work taught us

Measured on Big Dry Creek, Mac, Chrome, 2026-11-27:

- Decode data off the main thread. Moving depth PNG decode to a worker took main-thread stalls over 20 ms from 27 to 0 (worst 49 → 18 ms).
- Never allocate GPU textures per frame. A two-texture pool refilled in place took the frame after a time step from 116 ms to 17 ms. A WebGL DataTexture cannot change size after first upload; make a new one only when the size changes.
- Measure honestly. A hidden browser pane throttles rAF to about 2–11 Hz; only a visible window gives real fps. `gl.finish()` does not block in Chrome on this Mac; a 1-pixel `readPixels` after `render()` gives real GPU time. A MessageChannel ping loop finds main-thread stalls that interval timers miss.
- Water reads as water when it behaves like water: Beer-Lambert absorption so shallow water shows the ground, reflections of the scene's own sky, and ripples and foam carried along the flow. For scenarios the flow comes from the modelled water-surface slope (Manning speed); for live rivers this is not allowed (no fabricated velocity).
- Sample what is drawn. Wall water lines were 0.4 m off until they used the water mesh's own triangle interpolation and a ground texture at one texel per mesh vertex. The depth raster also reads dry inside many building footprints.
- Tone mapping hides subtle cues: a 30–60% darkening on sunlit walls is invisible after ACES. Make operational cues strong.
- Results so far: 45 fps on the flood page (p99 34 ms) before the realism pass; GPU 6.3 → 10.4 ms after see-through water, sky reflections, flow, hip roofs and water lines.

## Phases

Each phase ends with tests, `npm run check`, screenshots at the acceptance viewports and a visible-pane fps check, and an entry in the change log below.

1. **Engine and county base (Stage A).** Extract the scene core from the flood page into `site/lib/county3d/`. Quadtree terrain with streamed elevation and imagery over the full county bounds. A standalone `county-3d.html` to measure it. Flood page moves onto the shared core.
2. **Command adapter.** `county-scene-map.js` implementing the TerrainMap interface: records (polygons, lines, points, gauge columns, closures, facilities), context (counties, cities, burn scars, watershed outline), draped rasters (rain, gust, snow, regional radar, GOES IR), focus/overhead/restore/camera callbacks, picking into `onSelect`/`onInspect`. Behind `?renderer=three`. MapLibre stays the default and the phone renderer.
3. **Weather in 3D.** Port the radar volume, GOES cloud-top surface, HRRR cloud volume and wind trails onto the core; snow on terrain; rain shafts under observed echoes.
4. **Operational 3D.** Gauge stage columns, reservoir pool surfaces, closure ribbons, outage darkening, evacuation zones, cameras.
5. **Pages.** Port river-3d; retire flood-scenario-3d; add three.js to map-pilot and weather-delivery for benchmarking.
6. **Pre-rendered base (Stage B).** Build pipeline for 3DEP + NAIP + Overture tiles, datum check, hosting on R2.
7. **Switch the default** in Command after staff acceptance on actual devices.

## Decisions needed

1. Hosting for the pre-rendered base (Stage B): an R2 bucket and public URL, a few GB. Until then Stage A streams public tiles.
2. Imagery: keep streaming Esri World Imagery (current practice, no offline copy) and pre-render NAIP (public domain) for Stage B. Recommended.
3. Google Photorealistic 3D Tiles for urban close-ups: the key already exists in the workflow, but it needs a 3D Tiles loader and Google's display terms (no caching, logo). Optional, later.
4. When to make three.js the default in Command: after acceptance at the four viewports and on staff machines.
5. The KHNX raw-sample feed is served from `frog-demo.ryanlopez.tech`, outside this repo. Keep, or move it into the workflow like the Zarr volume.

## Change log

- 2026-11-27: Plan written from a full audit of the repo (screens, Command map seam, 38 data feeds). Flood-scenario pages: #156 merged (three.js page), #157 merged (worker decode, texture pool), #158 draft (water realism, flow, roofs, water lines).
