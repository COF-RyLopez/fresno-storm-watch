# Regional weather delivery and storage

## Reviewed sources and display coverage

| Product | Authoritative source / preparation | Display |
| --- | --- | --- |
| Observed radar | [NOAA nowCOAST WMS](https://nowcoast.noaa.gov/geoserver/observations/weather_radar/ows?service=WMS&version=1.3.0&request=GetCapabilities), `conus_base_reflectivity_mosaic`, `weather_radar_base_reflectivity` | Initial bounds -131,28,-107.5,47; expands to camera bounds with padding. Explicit advertised observation times, last 12 within 120 minutes, gaps over ten minutes labeled. No synthetic radar frames. |
| Radar key | Same publisher's GetLegendGraphic JSON for that exact layer | Native 10/20/30/40/50/60/70 dBZ swatches. Retrieval/identity failure fails closed rather than guessing colors. |
| HRRR wind / gusts | Existing NOAA HRRR via Dynamical collector; earth-east/north rotation and missing-cell guards retained | -125,32,-113,42.5; 201×176 cells at 0.06°, native source 3 km. 49 hourly steps. This is an overview resample; native detail is not increased. |
| Six-hour snowfall | Existing [NWS NDFD](https://www.weather.gov/gis/ndfd_metadata.html) ImageServer products | Same California–Nevada bounds, display images 1000×1100. Issue and valid windows retained. No new snowfall thresholds. |
| Observed snow / GOES infrared | Existing NOAA product endpoints and time validation | Same California–Nevada bounds. GOES is observed IR, not cloud thickness or forecast rain. |
| Rain forecast | Existing WPC six-hour products | Retains wider western bounds -131,28,-107.5,47. Rainfall is not routed runoff. |

Radar images use Web Mercator WMS requests, correctly georeferenced corner coordinates, at most 1200 pixels on either axis and an eight MB encoded response bound. PNG signature and dimensions are validated. Browser cross-origin access was checked directly. Reflectivity is not rainfall accumulation; blank pixels do not prove no precipitation or safe conditions. The initial regional mosaic was observed with dated GOES imagery; no cookie or credential is sent to NOAA.

Command has one three-frame radar cache; image requests carry an AbortSignal and twenty-second timeout. Camera expansion preserves replay time and cancels superseded image work. Pending catalog refreshes cannot overwrite manual scrubbing. Source failure stops playback; sufficiently fresh retained observations are labeled. Radar expires after 120 minutes; Command GOES IR also expires against its own observation time. Pause/hidden navigation cancels pending satellite work; resume retries it. Normal Command navigation never installs the forecast-cloud volume. Legacy specialist interfaces retain their original renderer and controls.

## Storage snapshot — local build, November 19, 2026

This is a filesystem measurement, **not** the Cloudflare R2 account's billed usage and **not** a page-startup download:

- Before the wider-weather preparation, local `site/` contained 375,882,366 bytes (~376 MB).
- After local preparation, it contained 446,239,355 bytes (~446 MB), including old test weather files and cached specialist products. It is not a clean deployment manifest.
- Two PMTiles archives total 44,503,163 bytes (~44.5 MB). Waterways are 41,659,587; waterbodies 2,843,576. Existing loose legacy tiles remain separately available.
- The active broad HRRR run (2026-11-19 18:00 UTC) has 49 frames totaling 34,926,481 bytes (~34.9 MB), maximum single frame 749,325 bytes. Frames load on demand, not all at startup.
- The 11 prepared six-hour snowfall images total about 284 KB for the measured run. Size changes with weather patterns.
- Command reads **zero GeoParquet files directly**, and this local public build contains no `.parquet` files. Separate scenario/prototype analysis is not included in that statement.

PMTiles are cloud-native range-read archives. Prepared weather JSON/PNG grids are bounded display products; this is not direct Zarr streaming in the browser. Live gauges, closures, reservoirs and utilities still use normalized JSON or publisher services. Private operational data stays in authorized ArcGIS storage. Terrain and some basemap tiles are fetched from their existing external publishers and are not included in our stored total. Upstream use of Dynamical cloud-native arrays does not make the browser feed GeoParquet or Zarr.

For an initial hosting request, **10–25 GB is a planning allowance** for this pilot and a short rolling public-weather history, not a measured requirement. Recalculate against retention, duplicated releases and selected terrain/model coverage before provisioning. For scale, an uncompressed 100 km², 2 m, float32 depth raster is 100 MB per step; 24 steps are 2.4 GB before compression, masks, water-surface elevation, velocity or additional runs. Detailed LiDAR and scenario outputs need a separate budget. No cloud prices or actual R2/VPS usage were verified in this review.

## Verification

Offline tests cover actual-time selection, native legend identity, request bounds, reduced motion, first-load camera movement, replay/refresh races, paired satellite expiry/resume, initialized controls and old/new HRRR grid/cache separation. Collector checks retain independent vector rotation, unit conversion and missing-versus-zero tests. Live prepared runs verify the larger grids without changing private datasets. Viewport checks are not actual-device frame-rate or staff acceptance certification.
