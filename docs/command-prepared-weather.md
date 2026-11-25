# Command prepared rainfall delivery

Version 0.102.0 adds the weather experiment's prepared display path to Command's Rain forecast. Radar, gusts, snow forecasts, all concern rules and private storage keep their existing paths. The experiment remains a separate recorded comparison.

## Public data preparation

`node --use-system-ca scripts/collect-prepared-weather.mjs` requests only NOAA's public WPC QPF MapServer. It prepares the 72-hour overview (layer 9) and all available six-hour products (13–25), using the existing direct adapter's cycle verification, fixed publisher colors, inch units and broad regional extent. It checks the source before and after requesting a frame.

Output is generated under ignored `site/data/prepared-weather/`: immutable SHA-256 PNG images and a small `manifest.json` containing source revision, issue/valid times, CRS, coordinates and legend for each image. No gauge readings, facilities, private features or credentials are copied. Each image is checked before switching the manifest. Separate failures are logged and remain absent products, never zero rainfall.

The existing Pages workflow attempts collection on main immediately before upload, on pushes, manual runs and its four-times-hourly schedule. Scheduling and upstream availability are best effort. Failed preparation is nonblocking; no bundled historical package is promoted to live data.

## Runtime checks

- Command accepts only `prepared-wpc-display`, never a recorded experiment package.
- Preparation must be no older than 30 minutes and no more than two minutes in the future. Forecast issue age must be at most 24 hours and the valid period must not have ended.
- Top-level bounds and frame corners must match the normal export, including Web Mercator pixel-aspect expansion. PNG byte count, dimensions and SHA-256 must match.
- WPC's current issue/start/end/product/units are checked before display; successful source checks are reused for at most 60 seconds. Cached playback and tab resume revalidate before drawing.
- Missing, malformed, stale or superseded prepared products use the existing direct WPC path. That adapter independently checks the requested cycle, export, legend and rollover. If neither path can verify the frame, the rain image/legend are cleared and an unavailable message stays visible.
- Valid independent timeline windows fill holes in preparation. A newer known revision wins; overlapping/conflicting windows are withheld during source rollover.
- Every 15 minutes Command reloads the manifest/timeline and stops old playback. The selected actual start time is retained if still available, even if its layer number changes. An elapsed selection moves to a current option.
- Images and metadata are cached only in bounded memory. Leaving the mode or signing out cancels owned requests and releases the adapter. No private or operational state is added to browser persistence.

The compact forecast dates and legend remain beside the map. Expand **Source & coverage** for preparation time and whether the frame used prepared or direct delivery. “No contours ≥0.01 in shown” retains its existing limited meaning; it does not establish no rainfall or safety.

## Verification and rollback

Unit/integration tests cover byte identity, incorrect coordinates, clock/issue/window expiry, publisher rollover, missing/corrupt packages, dry versus missing frames, partial and conflicting windows, cancellation, cached-frame revalidation, periodic time preservation and early alert loading. Browser verification uses the unchanged named-account exercise workspace and saves no records.

Rollback is a preceding app deployment. No data migration, AGOL configuration or permission change is required. To disable preparation alone, omit the collector output: Command automatically uses its direct WPC adapter.

Sources checked 2026-11-25: [NOAA WPC service](https://mapservices.weather.noaa.gov/vector/rest/services/precip/wpc_qpf/MapServer?f=pjson), [GitHub scheduled workflow limitations](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).
