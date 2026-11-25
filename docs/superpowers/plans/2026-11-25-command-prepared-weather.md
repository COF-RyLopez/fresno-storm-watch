# Current prepared weather in Command

> Execute inline with superpowers:executing-plans; retain the existing checkout and private exercise boundaries.

**Goal:** Use the measured prepared WPC rainfall path in Command without replaying old forecasts as current.

**Architecture:** Reuse verified image/legend/time packages, with a distinct current-product manifest. A public collector prepares all supported WPC windows on the existing Pages schedule. A Command adapter accepts only recently prepared, unexpired, correctly covered frames matching the current WPC revision; otherwise it uses the existing direct adapter. No private data enters this package.

**Tech stack:** Existing Node, JavaScript, TypeScript/Vite, MapLibre. No new dependencies or authentication changes.

**Spec / requirements:** User request of 2026-11-25: bring faster prepared weather into Command while keeping forecasts current. Initial scope is the experiment's WPC rain product; radar, gusts, snowfall and operational concern calculations remain unchanged.

## Constraints and review focus

- Preparation age at most 30 minutes, issue age at most 24 hours, future clock tolerance 2 minutes. Never use the recorded experiment as live fallback.
- Query WPC revision before a prepared frame is displayed; share successful checks for at most 60 seconds. Recheck cached playback frames, including after tab resume.
- Refresh the timeline every 15 minutes; preserve the selected actual start time, not a moving layer ID. Pause on refresh rather than unexpectedly restart playback.
- Cancellation, rapid switching and destruction must not repaint superseded data or leak timers.
- Failed preparation, missing/corrupt images, changed revisions and unavailable publisher checks use direct service or a visible unavailable state. No-data is never zero rain.
- Hash-named images are completed before atomically switching the manifest. Publish public weather only. Existing non-weather/private workflows remain intact.

## Tasks

1. [x] Add failing tests for current-package eligibility, revision/fallback checks, integrity, bounded cache, abort and expiry.
2. [x] Extend the shared package validator; implement `site/lib/command-rain.js` with `createCommandRainDelivery`, `windows`, `load`, `validate`, `destroy`.
3. [x] Test and implement `scripts/collect-prepared-weather.mjs`: 72-hour + all available six-hour products, bounded acquisition, per-frame accounting, atomic manifest, optional CI step. Generated files remain ignored.
4. [x] Test and integrate Command rain adapter, periodic refresh, source status, revalidation of cached playback and visibility resume. Preserve actual selected time and alert timing filters.
5. [x] Run focused/full tests, Command type/build checks and repository checks. Review independently; exercise current/missing packages in the browser and stale/malformed fixtures in tests. Document operation and rollback. Deliver without merging unrelated changes.

## Verification record

- 1,103 JavaScript tests passed; Command type check, Vite build and repository check passed.
- Live acquisition: 13 available products, zero failed, layer 13 elapsed; 78 source requests, 863,364 response bytes, 5.0 seconds on the workstation.
- One live six-hour comparison: prepared 381 ms / 3 requests, direct 738 ms / 5 requests; identical source metadata and PNG bytes. This measures data ready, not overall application loading or rendering.
- Signed-in browser: current prepared source and dates displayed; temporarily removing only the local generated manifest triggered direct WPC delivery with the same dates; manifest restored afterward. No operational records saved.
- Independent review fixes: partial-window fallback, overlapping rollover windows, image-coordinate validation and early-alert independent-timeline loading. Each regression was observed failing before correction.

## Operations

Pages already attempts publication four times per hour; GitHub scheduling is best effort, not a delivery guarantee. The runtime validity/revision gates are mandatory even if scheduling is delayed. Preparation failure must not block the rest of the app. Rollback: redeploy the preceding release; direct services and the recorded experiment remain available.

## Requirements handoff

- Work target: existing Command weather delivery update in `storm-watch-pages`.
- Product context: county ArcGIS Online/Enterprise access unchanged; public NOAA WPC only in the new collector.
- Audience: existing signed-in EOC workspace; public weather assets.
- Platform/scope: existing browser pilot, desktop and phone; no new map runtime or permissions.
- Remaining assumptions: use existing geographic bounds, fixed publisher colors/units and freshness policies; refresh cadence is an application check, not guaranteed forecast issuance.

Sources checked 2026-11-25: [WPC service metadata](https://mapservices.weather.noaa.gov/vector/rest/services/precip/wpc_qpf/MapServer?f=pjson), [GitHub scheduled workflows](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).
