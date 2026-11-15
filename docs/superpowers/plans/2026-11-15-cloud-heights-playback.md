# Cloud heights and weather playback

**Goal:** Make a displayed GOES cloud-top surface inspectable and recent Hanford scans easier to follow without obscuring County Watch.

**Design:** Retain the existing terrain and radar. Fixed, muted height bands below 2 km, 2–6 km and 6–20 km distinguish cloud-top altitude, not storm severity. A compact key appears only with retrieved 3D tops. Hover/tap shows approximate height in feet/km, the observation time and geopotential-altitude qualification. Unknown cells and the 2D infrared fallback never acquire a height. Ground records retain click priority.

**Motion:** The present renderers hard-replace each scan, and serial downloads add variable delay. Preload the next two dated radar/cloud frames into bounded memory caches. Fade between existing geometries/textures for 400 ms; do not interpolate heights, reflectivity or storm trajectories. Keep the camera still. Pause, close, source switches and hidden pages cancel pending work; reduced motion uses immediate changes. Do not crossfade large observation gaps or backward seeks. Show the two observation times while a visual crossfade is active.

**Architecture:** MapLibre custom layers own two bounded frame resources and surface picking. The radar controller owns preload, observation selection and playback; cloud preparation is reusable without changing the map. The map adapter owns pointer interaction and popups. No new infrastructure or private data.

## Implementation and checks

- [x] Cloud layer/style: fixed shared palette, perspective-correct nearest surface hit, nodata/behind-camera/motion rejection, bounded crossfade and cleanup. Test vertices at different altitudes and views.
- [x] Radar layers: explicit duration option, opacity composition of two observed frames, immediate/reduced-motion path, GL-state restoration and resource disposal. Test both patch and volume renderers.
- [x] Controllers: bounded deduplicated frame cache with abort/failure handling; two-frame lookahead; cloud observations and height metadata; compact legend. Test replay/preload, abort, failed replacement and dated fallback.
- [x] Map interaction: hover/tap readout from the rendered triangle, record priority, clear on frame/view changes, keyboard Escape and reduced motion. Show no reading during a two-observation fade.
- [x] Verify: regression suite, deployment checks, live NOAA surface readouts, desktop/phone-size pointer behavior and completed patch/volume playback. Publish 0.93.0 after checks. Rollback by redeploying 0.92.0; no data migration.

The colors are display classes, not cloud-type or severity thresholds. A triangulated retrieval is approximate and can have parallax; cloud-top altitude is not cloud thickness or height above local terrain. The opacity transition is a display aid between observations, not a simulated intermediate storm.
