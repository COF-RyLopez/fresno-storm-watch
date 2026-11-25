# Command adapter contracts and weather ownership

Release candidate: **0.100.0**, based on main `1f114a9f387e8f51e15cb8267c6c984eb56ecf49`.

## Ownership

`command/src/module-loader.ts` permits only named shared modules. Before a loaded namespace reaches a caller, the loader checks required function exports. The registry's names and exports are compiler checked against the actual JavaScript modules. Public JSDoc supplies feed callbacks, private state/session, map callbacks/bounds and generic playback contracts. This is a checked migration boundary, not full strict checking of every legacy JavaScript function body or incoming JSON field.

`contracts.compile.ts` contains nonexecuted negative fixtures. Unknown modules, absent exports, incorrect callbacks, unauthenticated session shapes, invalid bounds, unsupported weather modes and invalid playback inputs must remain compiler errors. Runtime tests also import the actual feed, private, terrain and playback modules. No declaration-only facade or second SDK runtime was introduced.

`weather-controller.ts` owns weather selection, advisory intent, pending imports, request aborts, refresh timers, forecast playback, snow summaries and retained rain-window state. It observes document visibility and the phone breakpoint. The shell retains the persistent map, selected place, road-context lookup, incident/private controller, Work and Briefing views. Its getters provide current state without capturing an old incident or selection.

Changing products invalidates the previous generation. A late error cannot clear a newer product. Scope invalidation aborts requests and clears weather evidence; old imports/results cannot redraw it. Leaving Watch or hiding the phone map pauses playback. Returning restores eligible retained presentation without automatically restarting animation. Destroy removes visibility/breakpoint/selector listeners, cancels requests/timers and closes renderer adapters. Forecast gaps remain gaps; reduced-motion and publisher units/times/legends are retained.

## Verification

Run from repository root:

```text
npm run check:command
npm run build:command
npm run build:import-map
npm test
npm run check
git diff --check
```

Focused regressions are in `tests/command-module-contracts.test.mjs` and `tests/command-weather-controller.test.mjs`. The lifecycle tests use the real published-frame player with controlled module/data responses. They cover obsolete errors, late successes after scope changes/destruction, hidden-map drawing, advisory navigation, missing frames, early-alert request cancellation, phone resizing and radar adapter reuse/cleanup.

Browser checks use the local preview, without saving private records. Public source failures must remain explicit; an unavailable snowfall grid can show named point guidance, and does not establish a snow-free area. This refactor does not certify live feed availability, hydraulic modeling, private account permissions or production operational readiness. It does not claim a measured speed increase.

## Delivery and rollback

Keep the release in an unmerged PR until review. GitHub Pages deployment remains the existing workflow; only `site/` is published, with generated Command output built by Vite. Compiler fixtures, TypeScript sources and local test logs are not public deployment assets. No private schemas, group memberships, permissions or data are migrated.

To roll back a deployed release, redeploy the previously accepted main build (`1f114a9f`, package 0.99.2), following the repository's deployment workflow. No database or record rollback is required. Keep unrelated local PageIndex files and outputs intact. Work/Briefing view extraction remains a separate next pass.
