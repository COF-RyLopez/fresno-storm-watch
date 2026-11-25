# Weather Delivery Experiment Plan

> **For agentic workers:** Use superpowers:executing-plans. Execute inline; one final independent review if this becomes a release candidate.

**Goal:** Measure whether a prepared WPC display-frame package improves rainfall delivery and keeps image, legend, units and dates together, without changing the forecast or renderer.

**Architecture:** Capture a small public forecast replay using the actual current rainfall adapter. Save the identical image bytes and associated metadata in an immutable, hash-verified manifest. Compare direct service-response reconstruction with prepared delivery on the same local HTTP host and latency profile. Reuse Command's terrain renderer for visual inspection. Keep this opt-in laboratory outside normal operator navigation; no cutover or deployment.

**Tech stack:** Existing Node, browser JavaScript, MapLibre terrain renderer; no new dependencies or infrastructure.

**Spec:** User-approved experiment following Dot's comparison. Keep MapLibre; useful overview first, progressive time-frame loading, explicit time/source/legend. This is a delivery test, not a forecast-skill or full-app/GPU benchmark.

## Constraints

- Only public WPC and existing public reference context. No private records, authentication or browser persistence.
- Label captured forecasts as recorded replay, not live planning data. Keep issue/valid/capture times and publisher units.
- Exact image bytes and metadata must agree across both methods. Blank/missing never means safe or zero rainfall.
- Load the selected frame first; bounded in-memory frame cache. No blending of rainfall accumulation periods.
- Controlled network latency is simulated and reported. Do not extrapolate localhost results into a production speed claim.
- Preserve unrelated untracked files and the published Command app. PR #150 is already merged into main.

## Tasks

- [x] Add strict frame-manifest and loader contracts, byte-integrity checks and focused failure tests.
- [x] Add reproducible public capture and local replay server, recording the original service URLs, responses, times, image dimensions and hashes.
- [x] Add a small optional comparison view using the current terrain map; one watershed selection, timeline, source/units/legend and measured results.
- [x] Run paired cold/warm delivery trials, verify identical evidence and inspect desktop/phone behavior. Record actual method, hardware/browser limitations and results.
- [x] Run appropriate regressions/type/build/site checks. Produce a findings note and next-step recommendation; leave production unchanged.

## Ledger

- Ruling: rainfall is the first experiment because the current adapter rebuilds each image through five publisher-service requests. Precomputing immutable display frames is a bounded test with unchanged scientific inputs; volumetric weather and a renderer replacement are deferred.
- Ruling: prepared PNG display frames plus JSON provenance are object-storage-ready display assets, not numeric COGs, GeoParquet or a new forecast model. No claim of scientific cloud-native conversion.
- Ruling: a separate maintainer laboratory provides repeatable measurements without adding operator navigation or changing the active planning workflow.

- Measurements: five paired trials per period, three periods, three profiles (135 measurements), all evidence identities matched. Corrected final validation timing after one independent review finding; 1,073 tests pass. See docs/weather-delivery-experiment-results.md for actual metrics and limitations.
- Ruling: do not add a lower-resolution rainfall preview yet: the measured source images are only 45–126 KB. The request chain, not oversized images, is the initial optimization target.
- Delivery: local experiment branch only. Published Command and existing private workflows are unchanged. Prepared display packages are recorded replay, not a scheduled live feed.

## November 25 publication authorization

- User requested a PR, merge and Pages publication for testing.
- Added project-relative recording paths, allowlisted public seed assets, immutable recording directories and an atomic recording pointer. The optional refresh cannot block the main deployment; the seed is separately validated before refresh.
- Fixed reference deduplication to use independent gauge IDs; public context contains 10 gauges and 2 reservoir locations, with original observation freshness labels.
- Private data, trial logs and local acquisition files remain outside the deployed artifact. The comparison stays explicitly recorded and outside operator navigation.
