# Fresno Storm Watch — temporary Self-Improvement Memory

Domain: fresno-storm-watch. Append-only; never change earlier attempts or outcomes. Predictions are committed before evaluation, outcomes in separate commits. Transfer to gbrain only when access works or Ryan asks; preserve order and prediction commit hashes in provenance. This log is outside site/ and is not a GitHub Pages artifact.

Evaluator: primary `npm test` (Node pass/total), supported by `npm run check:command`, `npm run build:command`, `npm run build:import-map`, `npm run check`, GitHub Actions verify/deploy and bounded browser checks. Main 408f206f (release0.104.0) passed1120/1120. Test count is not live-feed uptime, smooth-animation or operator-usability certification. Focused tests are scored separately by exact command.

Access check2026-11-27: no ToolSearch tool is exposed in Codex. Tool inventory searched; gbrain request_tools returned schemas for whoami/get_page/put_page/append_page/takes_add/takes_resolve but the corresponding functions are not exposed. Attempting whoami returned a local TypeError, not a server response. Profile and allowed_operations remain unknown. Do not assert an owner-side permission denial without a whoami response. Gbrain facts227/228 and local work/gbrain-setup-packet.md record the setup work; project/index/problem pages are not filed.

## Problem: weather-raster-playback

- domain: fresno-storm-watch
- root_cause: Visible raster sources are torn down before replacement readiness, and asynchronous map presentation is outside the playback clock.
- symptoms: Repeated rain/radar jumpiness reports; bytes preload while the map image still loads; network preparation extends the dwell; accumulation overview is mixed with six-hour playback.

### A1 — backfill of initial two-slot rendering attempt

- date: 2026-11-27
- agent: Codex Windows; model identity not recorded
- edit: Added bounded two-slot image presentation, awaited rendering and concurrent preload/dwell.
- files: site/lib/weather-raster.js, watch-terrain-map.js, command-weather-player.js, command/src/module-contracts.ts and corresponding tests
- rationale: Keep a visible frame until the next image is ready.
- predicted_fixed: Not recorded prospectively; no retrospective bet claimed.
- confidence: unknown
- status: historical, evaluated before Ryan's local-log instruction; uncommitted

#### A1 outcome

- observed_fixed: Async presentation and slot cancellation tests passed.
- missed: Missing next-frame error left a scheduled timer (expected0, observed1).
- regressions: One focused failure in the existing missing-buffered-frame case.
- score: 12/13 focused (before:9/11 player cases passed with the new tests; missing raster module was an additional file-level failure).
- verdict: kept locally for correction, not deployed; no prospective prediction exists.

### A2 — cancel failed preparation and retain ready-frame sequencing

- date: 2026-11-27
- agent: Codex Windows
- edit: Cancel the dwell timer when next-frame preparation fails; retain bounded slots and awaited presentation; remove duplicate stale completion paths if exposed by tests.
- rationale: A failed preload must not leave a queued advance or clear the valid current image.
- predicted_fixed: `node --test tests/weather-raster.test.mjs tests/command-weather-player.test.mjs` passes13/13, including missing-frame stop, old timer isolation, reduced motion, async readiness and source cleanup.
- confidence: 0.90
- status: pending
- prediction_commit: Commit containing this block; exact hash will be appended with the outcome.

#### A2 outcome

- prediction_commit: eddf16805101cc97a2913ed3e0789dd046cae2f1
- observed_fixed: Focused readiness, cancellation, reduced-motion and failed-preload tests all passed. Failed preparation cancels the dwell timer.
- missed: Actual map/weather integration, rainfall style and UI stability remain for the next attempt.
- regressions: None in this focused run; full suite not run in A2.
- score: 13/13 focused (before:12/13).
- verdict: kept in this branch; not deployed.

### A3 — synchronize actual weather products with ready images

- date: 2026-11-27
- agent: Codex Windows
- edit: Await map presentation for rain/gust/snow/radar before moving the displayed timestamp; remove per-frame gust clears and keep overview out of comparable six-hour playback.
- rationale: A player cannot guarantee readiness if product callbacks discard the map's Promise or clear the old frame first.
- predicted_fixed: New delayed-render/controller and mixed-duration playback regressions pass; existing forecast/radar/player tests remain green. Full npm suite, TypeScript/build/site checks pass before release.
- confidence: 0.82
- status: pending
- prediction_commit: Commit containing this block; exact hash will be appended with the outcome.

#### A3 outcome

- prediction_commit: 5aafd8fa0545ece8498dfe0cbd40944c62091f25
- observed_fixed: Delayed map/date synchronization, comparable-period sequence and slot tests passed in the combined focused suite.
- missed: Failed first six-hour frame emitted an error then overwrote it with paused status (`1 of 3`).
- regressions: Existing missing-rain-frame status assertion failed; TypeScript also rejected readonly palette passed into mutable colors parameter.
- score: 64/65 focused; TypeScript failed (before:A2 focused13/13 on a smaller suite).
- verdict: kept on branch for correction, not deployed; full regression and browser evaluation not yet run.

### A4 — preserve first-playable failure status

- date: 2026-11-27
- agent: Codex Windows
- edit: Do not overwrite show()'s failure report with a paused report when starting playback at the first six-hour frame.
- rationale: show() already owns load/render error reporting; duplicate completion reporting hides the actual failure.
- predicted_fixed: Focused65/65, complete Node suite and compiler/build/site gates pass after the paired readonly fix. Missing frame remains conspicuous and no stale timer survives.
- confidence: 0.92
- status: pending
- prediction_commit: Commit containing this block; exact hash will be appended with the outcome.

#### A4 outcome

- prediction_commit: b848ec0d8ebe12a334d766d1bf923eed4e662da3
- observed_fixed: Failed first-playable frame retains its error status. Complete Node suite and compiler/build/import-map/site checks passed.
- missed: Browser playback cannot be evaluated yet: local data offers only the overview, not current six-hour windows.
- regressions: None in1129 Node cases.
- score: 1129/1129 full suite (before:1120/1120 main; prior focused64/65). Coverage increased, not a measured speed score.
- verdict: kept; not deployed.

### A5 — evaluate current prepared frames and actual map playback

- date: 2026-11-27
- agent: Codex Windows
- edit: No new behavior planned; prepare current public WPC frames locally, inspect PNG alpha and compare frame dimensions/time/legend in desktop/phone browsers. Review outstanding code findings before release.
- rationale: Old local snapshots cannot evaluate current animation; a valid PNG signature alone does not prove visible nontransparent forecast pixels.
- predicted_fixed: Current prepared manifest supplies>=2 six-hour frames, custom PNG has nontransparent pixels, playback advances through actual six-hour dates without map/strip movement>1px. Stop/switch/reduced-motion and resource bounds remain intact.
- confidence: 0.80
- status: pending
- prediction_commit: Commit containing this block; exact hash will be appended with the outcome.

#### A5 outcome

- prediction_commit: d0db88f8332a4426d556baad3fce942749fa6bb6
- observed_fixed: Local current preparation produced13 frames (12 six-hour plus overview), no failed layers, one elapsed layer skipped;65 requests,203227 response bytes.
- missed: Alpha/content and timed browser dimensions not yet evaluated.
- regressions: Independent review found pause during presentation could leave internal index behind the displayed frame; GOES/radar slot ordering could change.
- score: Preparation13/13 selected current products; no all-feed success score. Previous Node1129/1129 did not cover those review cases.
- verdict: keep branch, fix review findings before release.

### A6 — settle paused presentation and retain fixed radar/cloud order

- date: 2026-11-27
- agent: Codex Windows
- edit: Track presentation separately from selection cancellation; settle the in-flight visual frame and index consistently on Pause, while newer selections supersede it. Starting Play waits for that settlement. Insert both GOES slots below both radar slots, below reference/operational linework.
- rationale: Physical presentation and metadata must share a commit boundary; product layering must not depend on fetch order.
- predicted_fixed: New delayed-render pause/resume and superseded-selection tests pass, fixed stack selection tests pass, entire Node suite/type/build checks remain green. Current-frame playback and desktop/phone dimensions can then be measured.
- confidence: 0.85
- status: pending
- prediction_commit: Commit containing this block; exact hash will be appended with the outcome.

#### A6 outcome

- prediction_commit: 99f576ad634a07c2b8be2846aeaaf398d55c7836
- observed_fixed: Pause/committed-index, superseded selection and fixed cloud/radar order regressions pass; all1132 Node tests plus compiler/build/site checks pass.
- missed: Live image audit found the custom WPC PNG entirely transparent, despite a valid PNG header and legend. Timed browser acceptance remains pending.
- regressions: No Node failures; zero visible rain pixels is a release-blocking cartographic failure tracked in weather-layout-obscures-context.
- score: 1132/1132 Node (before1129/1129). PNG audit0 nontransparent pixels of2017400.
- verdict: keep pause/stack repair; do not release until imagery is repaired. Standalone Python audit was blocked by Windows Application Control; approved Node audit produced the pixel evidence instead.

## Problem: weather-layout-obscures-context

- domain: fresno-storm-watch
- root_cause: Highly saturated rainfall and changing legend/status dimensions obscure terrain and shift the map during playback.
- symptoms: User screenshots show bright green rainfall over roads/terrain; repeated text/clutter complaints; weather-controller rebuilds legends and hides/shows status rows each frame.

### A1 — backfill of bounded weather strip and Calcite shell

- date: 2026-11-27
- agent: Codex Windows
- edit: PR153 moved weather controls below the map; PR154 added docked Calcite panels and reading Flow.
- rationale: Keep long evidence out of map overlays and retain one map.
- predicted_fixed: Historical prediction not recorded; no retrospective bet claimed.
- confidence: unknown
- status: historical

#### A1 outcome

- observed_fixed: Docked panels, focus/Back and phone pane checks passed; source times remained visible.
- missed: User still reports rain washout and text-driven animation jumps.
- regressions: Resize/footer mismatch found and repaired before PR154 merge.
- score: 1120/1120 Node tests at408f206f (before:1115/1115 on prior release; changed test coverage, not a measured usability gain).
- verdict: kept, merged/deployed0.104.0; mitigation only.

### A2 — fixed rain classes and stable weather furniture

- date: 2026-11-27
- agent: Codex Windows
- edit: Version the subdued six-band rainfall presentation for prepared/direct delivery; draw weather below reference/operational lines; deduplicate legend updates and reserve consistent time/status space; simplify Map key.
- rationale: Fewer fixed amount classes, restrained fill and stationary controls let users compare timing while retaining terrain and infrastructure context.
- predicted_fixed: Fixed-class boundary/renderer/style-compatibility and stable-legend regressions pass. No mixed publisher/custom palette. Existing freshness tests remain green. Desktop and phone frame stepping retain map/strip bounds within1px; one map; units/window/coverage warnings remain accessible.
- confidence: 0.80
- status: pending
- prediction_commit: Commit containing this block; exact hash will be appended with the outcome.

#### A2 outcome

- prediction_commit: 5aafd8fa0545ece8498dfe0cbd40944c62091f25
- observed_fixed: Amount-class/export and incompatible-prepared-style tests passed. Existing freshness tests passed in the combined suite.
- missed: TypeScript requires the legend helper to accept readonly bands. Browser stability/visibility prediction is not evaluated yet.
- regressions: Shared run has one rain-player error-status failure (weather-raster-playback A3).
- score: 64/65 focused; TypeScript failed (before:main1120/1120, different coverage).
- verdict: kept on branch for correction, not deployed.

### A3 — accept immutable legend contract and verify delivered frames

- date: 2026-11-27
- agent: Codex Windows
- edit: Make legend helper accept readonly data, then run compiler/build/full regression checks and a live custom WPC export probe. Inspect desktop/phone stepping, key, labels and dimensions.
- rationale: The palette is intentionally immutable; consumers should not require mutable arrays. Readiness and UI stability need actual renderer evidence in addition to unit tests.
- predicted_fixed: Compiler passes; focused65/65 and full suite pass; live WPC custom export returns a PNG with the six-band legend and verified dates. Desktop/phone stepping changes map and strip bounds by<=1px after initialization. No second map, unknown/missing data remains qualified.
- confidence: 0.86
- status: pending
- prediction_commit: Commit containing this block; exact hash will be appended with the outcome.

#### A3 outcome

- prediction_commit: b848ec0d8ebe12a334d766d1bf923eed4e662da3
- observed_fixed: Immutable palette contract compiles;1129/1129 tests and build/site checks pass. Live WPC export returned PNG signature89504e470d0a1a0a,11228 bytes, six bands and verified72-hour dates.
- missed: Local browser has only an overview; timed playback stability and nontransparent pixel content were not established by this run.
- regressions: None in the full Node suite.
- score: 1129/1129 full suite; compiler passed (before:focused64/65 and compiler failed).
- verdict: kept; browser prediction remains unverified rather than claimed successful.

### A4 — verify fixed controls with current imagery

- date: 2026-11-27
- agent: Codex Windows
- edit: Evaluate actual prepared six-hour frames and map key at desktop/phone widths; no additional design change unless defects are found and logged.
- rationale: Need current comparable frames to measure text/legend layout rather than infer smoothness from static screenshots.
- predicted_fixed: Six stable legend classes and retained operational context; map/strip bounds vary<=1px while stepping/playing; no horizontal overflow on390px phone; source window remains explicit.
- confidence: 0.82
- status: pending
- prediction_commit: Commit containing this block; exact hash will be appended with the outcome.

#### A4 outcome

- prediction_commit: d0db88f8332a4426d556baad3fce942749fa6bb6
- observed_fixed: Prepared current twelve six-hour frames and overview; fixed six-band key available.
- missed: Custom exported image has0 nontransparent pixels. Visual rainfall and playback stability are not accepted; a quiet image alone was insufficient evidence.
- regressions: Invisible rain overlay is release-blocking. Unit tests used PNG stubs and did not detect this live-render failure.
- score: PNG coverage0/2017400 nontransparent;1132/1132 unit tests do not substitute for this check. Previous live PNG content score unknown.
- verdict: do not deploy; preserve failure and fix exporter.

### A5 — diagnose empty custom WPC rendering against publisher output

- date: 2026-11-27
- agent: Codex Windows
- edit: Inspect actual qpf field type, publisher renderer value codes, queried numeric values and custom export definition. Compare the same-cycle publisher/custom image, then fix exact value matching or dynamic definition as evidence requires.
- rationale: A legend and PNG signature cannot prove the service drew the selected data. Exact publisher value codes and renderer field definitions may differ from normalized numeric display values.
- predicted_fixed: Same-cycle publisher image has visible pixels; preserving the actual renderer value/field contract yields>0 nontransparent custom pixels when publisher has coverage, with unchanged forecast dates/amounts and six fixed classes. Add a regression for the actual mismatch; full suite passes.
- confidence: 0.78
- status: pending
- prediction_commit: Commit containing this block; exact hash will be appended with the outcome.

#### A5 outcome

- prediction_commit: 6a6f94d7052715872c64f96ce7d7ab353f50106d
- observed_fixed: Same-cycle control demonstrated845986 visible publisher pixels; field is numeric qpf and renderer values match normalized codes.
- missed: Adding the publisher delimiter or using a simple uniform dynamic renderer still produced0 visible pixels. Value-code hypothesis did not fix the response; server/proxy cause remains unknown.
- regressions: None additionally deployed; custom-render path remains blocked.
- score: Publisher845986/2017400 nontransparent pixels; all three custom export variants0/2017400. This disproves the matching-only prediction.
- verdict: supersede custom export approach; retain source-image contract and recolor verified publisher PNG instead.

### A6 — recolor verified publisher PNG in preparation and direct fallback

- date: 2026-11-27
- agent: Codex Windows
- edit: Use pinned pngjs for Node preparation and browser canvas for direct fallback, sharing a numeric-value-to-color transform. Preserve source geometry/dates/revision validation, transparent/missing pixels and fixed six-band legend. Keep recorded experiments unchanged.
- rationale: Publisher rendering works; applying a documented display palette to that image avoids unreliable dynamicLayers while retaining authoritative contour boundaries. Prepared delivery avoids repeated client conversion.
- predicted_fixed: Source palette pixels map to their exact amount classes; unsupported pixels stay transparent. Live output contains visible pixels comparable to publisher coverage, no green wash, valid dates and12 current six-hour frames. Tests/type/build pass, browser map/strip moves<=1px during playback and operational symbols stay visible.
- confidence: 0.87
- status: pending
- prediction_commit: Commit containing this block; exact hash will be appended with the outcome.

#### A6 outcome

- prediction_commit: c009542d60eeaeaad754f02c7d5cb7c34d8fff01
- observed_fixed: Shared publisher-PNG recoloring produces six muted amount bands; prepared collection produced13 current images including12 six-hour frames. Desktop1280x720 and phone390x844 playback retained fixed map, strip, time and legend rectangles across multiple frames; measured movement0px and no horizontal overflow. Pause settled to the displayed frame. Static reviewer found no release-blocking defect.
- missed: Pixel coverage differs from original because unsupported/antialiased colors outside the documented tolerance remain transparent; live sample813681/2017400 nontransparent versus publisher control845986. No claim that clear pixels mean zero rain. Actual phone hardware, full-day monitoring and operator acceptance remain untested.
- regressions: None observed in1132 Node tests, TypeScript, Command build, import-map generation or repository checks. No private records or permission changes.
- score: Unit1132/1132 before and after conversion; live output0->813681 nontransparent pixels with alpha0..200; desktop7 samples and phone6 samples each0px layout movement. Prepared collection13/13 requested supported frames,0 failures; unsupported slot13 skipped explicitly.
- verdict: kept; ready for release validation, not a certification of all feed uptime or production usability.

### A7 — release validation of weather clarity package

- date: 2026-11-27
- agent: Codex Windows
- edit: Set package release0.105.0, document actual PNG conversion and evidence, rebuild Command/import map and run final regression/deployment checks. Preserve all prediction commits in Git history.
- rationale: Release artifacts must match the tested source and the display repair must not compromise source freshness or private exercise restrictions.
- predicted_fixed: Node1132/1132, TypeScript/build/repository checks and GitHub CI pass; published Command shows six fixed amount bands, stable timeline and bounded two-slot rendering with current forecast dates. SIM log remains outside Pages.
- confidence: 0.9
- status: pending
- prediction_commit: Commit containing this block; exact hash will be appended with the outcome.

#### A7 outcome

- prediction_commit: bfd33654 (full hash recoverable from Git)
- observed_fixed: Release0.105.0 passed1132/1132 Node tests, TypeScript, Command build, import-map generation, repository checks and git diff --check.
- missed: Remote CI and deployed-page checks not run yet; those claims remain unverified and are covered prospectively by A8.
- regressions: None observed locally. Existing Vite warning for runtime vendor CSS path remains; built app loaded the stylesheet in browser checks.
- score:1132/1132 before and after release build; local validation gates5/5.
- verdict: kept locally; remote release pending.

### A8 — remote CI and published-page validation

- date: 2026-11-27
- agent: Codex Windows
- edit: Push reviewed branch, create PR for0.105.0, require green CI, preserve SIM prediction commits with a normal merge, and verify the deployed Command page. Append the actual remote outcome in a separate commit.
- rationale: Windows checks do not cover Linux CI, Pages packaging or current public-data collection.
- predicted_fixed: Verify CI passes, Pages publishes the exact merged source, six fixed rainfall bands appear with current forecast timing, and SIM log/private data remain outside the Pages artifact. Existing exercise label and access controls remain.
- confidence: 0.88
- status: pending
- prediction_commit: Commit containing this block; exact hash will be appended with the outcome.

## Problem: retained-feed-freshness

- domain: fresno-storm-watch
- root_cause: Retained feed values can retain a successful assessment after collection fails or the source ages.
- symptoms: docs/code-review-repairs-2026-11-24.md records two controlled-clock failures; old successful timestamps and changed source revisions require separate handling.

### A1 — backfill of reassessment and prepared-delivery guards

- date: 2026-11-27 (backfill; original work November24)
- agent: Codex Windows
- edit: PR149/1f114a9f reassessed retained bundles; PR152/f51252b0 validated prepared rainfall freshness/revisions with direct-publisher fallback.
- rationale: Never turn a failed collection into current or safe conditions.
- predicted_fixed: Historical prediction not recorded; no retrospective bet claimed.
- confidence: unknown
- status: historical

#### A1 outcome

- observed_fixed: Changes merged; current main includes freshness/revision/cancellation regressions.
- missed: All-feed operational success rate is unknown; source availability is not certified by unit tests.
- regressions: None attributed in this session; historical per-PR totals unknown.
- score: Main1120/1120 at408f206f; before per-attempt score unknown.
- verdict: kept; regression sentinel, not a claim all feeds are healthy.

## Problem: flood-scenario-realism

- domain: fresno-storm-watch
- root_cause: The 3D flood page renders through the ArcGIS SceneView: depth is a draped colour image, footprints are flat-coloured extrusions recoloured by renderer swaps or edits, and cars are a 2D canvas on a plane. There is no water surface, lighting, imagery or vehicle geometry to make the scenario read as a real place.
- symptoms: Ryan asked (2026-11-27) to recreate the flood scenarios as playable three.js scenes "for better rendering and realism".

### A1 — three.js scenario page (terrain, water surface, GPU-classed buildings, instanced cars)

- date: 2026-11-27
- agent: Claude Code desktop (Opus 5.5)
- edit: New site/flood-scenario-3js.html + flood-scenario-3js.js with vendored three 0.187.0: Terrarium terrain draped with Esri World Imagery, a water surface displaced to terrain + depth decoded from the existing depth PNGs (legend inverted), fresnel/sun/turbidity shading with animated normals, Overture footprints as one merged mesh coloured in the shader from the clock (per-building class hours in a data texture), evacuation cars as an InstancedMesh on the terrain. Compact gzip footprint binaries per scenario (scripts/build-flood-footprints-3js.py) because footprints.geojson is not committed.
- files: site/flood-scenario-3js.{html,js}, site/lib/flood-three-model.js, site/vendor/three-0.187.0/, site/data/flood-scenarios/*/footprints-3js.bin, scripts/build-flood-footprints-3js.py, tests/flood-three-model.test.mjs, scripts/check.mjs
- rationale: A shader-driven scene removes per-tick renderer rebuilds (classes come from a uniform) and adds the physical cues (water level against walls, reflections, terrain, imagery) the SceneView page lacks.
- predicted_fixed: npm test passes 1132+new/1132+new; npm run check passes; the page loads Big Dry Creek and Redbank with no console errors, shows water rising against buildings and moving cars, and plays at >= 30 fps on Ryan's MacBook Air at the opening view (perf readout).
- confidence: 0.6
- status: pending
- prediction_commit: Commit containing this block; exact hash will be appended with the outcome.

#### A1 outcome

- prediction_commit: aafabdd4
- observed_fixed: site/flood-scenario-3js.html loads Big Dry Creek (3.7 s on localhost) and Redbank with no new console errors; T+4 h counters match the scenario (9,677 acres, 12,915 buildings with water). Water rises against footprints, impact colours follow the clock in the shader, cars move along roads as instanced vehicles. npm test 1135/1135 (before 1132/1132 on 5885b0b9); npm run check passed.
- missed: The >= 30 fps prediction was not measured: the browser pane was hidden (rAF throttled to ~11 Hz) and Ryan was not watching. Proxy: GPU-synced render 9.3 ms median at 1568x1212 with 2.91 M triangles, plus 3.0 ms per clock tick, on Ryan's Mac. Decoding a new depth frame costs ~45 ms on the main thread (one hitch per 15 model minutes). Flood front lines, velocity, water shadows and NSI points without footprints are not drawn.
- regressions: none observed. Mid-session slip: deleting a scratch .claude/ in the worktree removed tracked .claude/skills/calcite; restored before committing, never committed.
- score: 1135/1135 tests; fps unmeasured (prediction not confirmed).
- verdict: kept on feat/flood-threejs (701e8aba) for review; fps check pending a visible-pane run.
