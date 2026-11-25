# November 24 review: staged repairs

Review baseline: `1e3528069af550fc7321658cd5bc6a565b2d78c6`. No rewrite or operational cutover is part of this pass. The supplied review was checked against source; its observations about the first two issues remain applicable.

## First pass: correctness and the SDK boundary

1. **Reproduce the controller defect.** Offline HTTP stubs use the existing fictional planning fixtures and the real browser-refresh adapter. A controlled clock and captured one-minute callback exercise successful collection, aging, failed collection and recovery. The unmodified controller fails both new regressions: cards retain earlier freshness assessments, including `Observed` after a failed check.
2. **Assess once for each publication.** `publish()` uses one `now`, reassesses retained bundle data, and derives both evidence rows and map features from that assessment. An aggregate check error flows through the shared assessment and qualifies individual evidence entries. Reassessment never changes bundle/source times or successful-check timestamps.
3. **Preserve utility history.** The existing tracker runs after reassessment. Failure qualifications are added after tracking so they do not become utility revisions. The original restoration time is carried with the display estimate so retaining a newer utility revision against an older response can still age the deadline. Estimate-change history and the utility update timestamp remain unchanged; no restoration is inferred.
4. **Complete existing SDK separation.** Twenty-six SDK-only consumers import `sdk.js` directly. The pilot's ArcGIS branch still uses a lazy import. The legacy map keeps its compatibility re-export; `loadCoreSdk` and Command's separate Calcite setup are unchanged. A dependency-boundary test checks local literal imports, including the previous lazy cycle. This is dependency evidence, not a measured startup-speed improvement.
5. **Verify and present a reviewable release.** Run controller/utility regressions, dependency checks, full JavaScript suite, Command type/build, generated import-map checks and source syntax/data/link checks. Smoke-test legacy map startup, both pilot renderers and SDK specialist routes. Keep this as a PR until separately authorized to merge/deploy.

## Subsequent pass: checked runtime contracts

Inventory actual exports and callbacks of `command-data`, `command-private`, terrain-map and weather adapters. Define a keyed module-loader contract and implementation checks; retain runtime external imports. Add compile-time negative cases for unknown module/export names and argument mismatches, plus bounded adapter-loading tests. Do not declare interfaces that have no check against the JavaScript implementation. Avoid an indiscriminate legacy `any` removal.

## Subsequent pass: lifecycle ownership

Extract weather request epochs, aborts, timers, playback and suspend/resume into one owner before moving evidence rendering. Protect rapid switching, Back/Forward, hidden-map playback, missing frames and late responses with controller tests. Then separate Work and Briefing DOM/view lifecycles while preserving the existing private controller, PIO editor, correction history and exact approved snapshots. Exercise sign-out during requests, incident changes, retained drafts, failed/uncertain writes, approval withdrawal and print cleanup before each extraction. Do not combine these structural moves with changes to forecast interpretation or permissions.

Legacy map view/layer extraction and the small duplicated distance calculation remain lower priority. No live agency records, private schema, sharing or access changes are required for the first pass. Offline fixtures do not constitute account-permission or operational acceptance certification.
