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
