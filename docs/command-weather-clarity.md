# Weather clarity and playback repair — 0.105.0

## Contract and implementation plan

Keep one map, current feeds, official alert meanings, selected place and private permissions. Use six fixed rainfall-amount classes (inches): 0.01–<0.1, 0.1–<0.25, 0.25–<0.5, 0.5–<1, 1–<2 and 2+. These are display classes, not action thresholds. Use restrained blue/purple fills with increasing alpha, drawn beneath reference roads, waterways and all operational features. Unmapped or missing coverage is not zero rain.

1. Give Command rainfall a versioned presentation shared by direct WPC export and prepared images. Preserve source revision/time validation and reject prepared imagery with an incompatible presentation. Legacy and recorded benchmark images retain their existing publisher styling.
2. Replace remove/re-add raster frames with a bounded two-slot presenter. Keep the last frame while the next source loads, promote only when ready, then crossfade briefly. Cancel superseded loads, bound waits, release object URLs, and honor reduced motion. Do not interpolate numerical forecasts or invent missing scans.
3. Make the shared player await presentation. Prefetch the next frame during the current frame's dwell; maintain at least the dwell interval, waiting visibly if data is slow. Stop on missing/revised frames and at the final published time. Do not include the 72-hour overview in six-hour playback: it is a different accumulation duration.
4. Stabilize the weather strip: reserve time/status space; avoid changing the legend DOM when its meaning has not changed. Use concise map-key symbol explanations; put detailed gauge interpretation in a collapsed Block. Keep amounts, units, dates, source age and unknown/stale qualifiers available.
5. Verify cancellation/failure/reduced motion and stale source guards with tests, then check desktop and phone layout/playback using current data. Run regression/build/deployment checks and publish through the existing PR workflow.

## Diagnosis

The old raster renderer removed its layer/source and revoked the image URL before replacement images loaded. Playback preloaded bytes but did not await the map image source. Every forecast render rebuilt its legend; buffering status toggled a row's display. Rain's first playback frame was a 72-hour overview followed by six-hour totals, changing the visual meaning during playback. These are separate from frame rate or network latency.

## References

Checked November 27, 2026: [WPC service](https://mapservices.weather.noaa.gov/vector/rest/services/precip/wpc_qpf/MapServer) supports dynamic layer rendering. [MapLibre ImageSource](https://maplibre.org/maplibre-gl-js/docs/API/classes/ImageSource/) supports persistent sources; [raster style](https://maplibre.org/maplibre-style-spec/layers/#raster) supports opacity transitions. Crossfades are display transitions only. Operator acceptance on actual devices remains required.
