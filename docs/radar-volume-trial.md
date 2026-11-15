# Hanford radar volume trial — 0.92.0

## Purpose and bounds

An opt-in **Volume** button (labeled Experimental volume) in County Watch → Millerton or Pine Flat watershed → Hanford radar compares a translucent volume with the established echo-patch display. Existing gauges, reservoirs, road closures, GOES cloud tops and rainfall forecast controls remain available. The experiment has no effect on alert or prepositioning rules.

The volume represents sampled **radar reflectivity in dBZ**. It is not a visible-cloud reconstruction. NOAA GOES cloud-top retrievals remain a separate source and time. Unknown space is transparent and never means clear sky or zero rain.

## Data and reproducibility

The existing public Hanford collector decodes completed NOAA KHNX Level II volumes and samples approximately every 2 degrees azimuth and 2 km range. It retains 10–<80 dBZ within longitude −120.6 to −118.5, latitude 36.3 to 37.7 and estimated heights 0–12,000 metres MSL. It performs no clutter classification. Missing, filtered and unsampled gates cannot establish absence of echoes. The original source URL, scan start/end and hashes accompany each derivative.

`scripts/collect-radar-volume.mjs` bins these samples into a fixed [height,y,x] = [24,48,64] array. XY bins are uniform in EPSG:3857, approximately 3 km on the ground, with northward row order. Vertical bins are 500 metres. A bin stores its maximum retained sampled dBZ. Multiple samples collapse deliberately; input, occupied and collapsed counts are recorded. No horizontal or vertical gap filling is performed.

Each completed frame is an immutable standard Zarr v3 array. It uses float32 little-endian bytes and gzip, 4×16×16 chunks and fill_value −999. Only occupied chunks are written. The metadata lists chunk sizes and SHA-256 checksums. Missing listed chunks are errors; unlisted chunks are unknown. Metadata is published after chunks and the catalog last. Native radar files, private features and credentials do not enter this pipeline.

The browser reads at most four chunk requests concurrently, checks metadata and checksums, limits inflated bytes, assembles one bounded regional texture and caches at most three decoded frames. This first experiment loads the regional cube for one time, not a global multiresolution/frustum-streaming system. Its uncompressed scalar array is 294,912 bytes. There is no new library or new map engine.

## Rendering and clocks

The WebGL2 shader raymarches the sampled volume using the existing dBZ colors. It limits cumulative opacity, feathers occupied edges inward and keeps unknown voxels transparent. It uses physical heights with latitude-dependent Mercator scaling. Terrain depth testing uses the first retained echo along each viewing ray; farther echo contributions are not individually terrain-clipped and can appear through intervening terrain. Treat this as an approximate overview, not terrain-occlusion analysis. The weather layer does not write depth over later ground context. These are display bins, not reconstructed cloud boundaries or beam-support estimates.

Volume mode uses its own completed-snapshot scan list, matching GOES by the displayed radar observation. Pages prepares volumes on each deployment (normally scheduled every 15 minutes, subject to runner delays). Consequently its latest scan can lag the direct Hanford feed. The exact observation time and stale/delayed notices remain visible. Playback pauses on hidden pages and does not interpolate between scans. Unavailable volume data falls back to dated echo patches with an explicit message.

## Why this option

Sources checked November 15, 2026 UTC:

- [Zarr specification](https://zarr-specs.readthedocs.io/en/latest/v3/core/index.html) defines chunked N-dimensional arrays. An ordinary unsharded Zarr store fetches chunk objects; byte-range requests are relevant to sharding, not mandatory for this store.
- [NEXRAD ARCO registry](https://registry.opendata.aws/nexrad-arco/) lists KLOT (Chicago), so it does not supply our Hanford volume.
- [Cesium VoxelPrimitive](https://cesium.com/learn/cesiumjs/ref-doc/VoxelPrimitive.html) remains experimental. [Proposed voxel content extension](https://github.com/CesiumGS/3d-tiles/issues/850) is distinct from assuming all 3D Tiles 1.1 clients support weather cubes.
- [Zarr-Cesium](https://github.com/noc-oi/zarr-cesium) offers scientific cube providers but would add a new rendering engine here. Our current MapLibre map already supports a small WebGL2 custom layer.
- [NOAA NEXRAD source](https://www.ncei.noaa.gov/products/radar/next-generation-weather-radar) and [GOES cloud-top heights](https://vlab.noaa.gov/web/towr-s/goes-cloud-top-height) describe different measured products.

## Verification and operations

Run `node --test tests/radar-volume-*.test.mjs tests/hanford-volume-layer.test.mjs`, `npm run build:import-map`, `npm test`, and `npm run check`. Run `node --use-system-ca scripts/collect-radar-volume.mjs` for a current public sample. Verify it with an independent Zarr implementation, and exercise real GPU rendering, timeline replay, mode switching, failure fallback and phone controls before describing the experiment as verified.

Keep the default echo display during the trial. Rollback is removal of the experimental button/collector or redeployment of 0.91.0; no operational datasets change. R2 can serve the same unsharded store with CORS, but this trial uses existing Pages delivery and adds no paid infrastructure.

Initial live validation: 12 real frames required 38,557 compressed chunk bytes plus 75,954 metadata bytes and a 6,581-byte catalog; collection took 1.43 seconds on this workstation. Python `zarr==3.4.2` independently decoded the store and reconciled 754 occupied cells in the inspected frame. Browser replay, volume-to-patch switching, GOES pairing and blocked-volume fallback were exercised at 390-pixel width. These are a small quiet-weather sample, not a performance guarantee for dense storms or mobile hardware.
