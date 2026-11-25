# Command Contracts and Weather Ownership Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Check Command's runtime adapter boundary and give weather requests/playback one lifecycle owner without redesigning the interface or changing source interpretation.

**Architecture:** Preserve external shared JavaScript modules and the Vite shell. Use a closed typed module registry with runtime export validation and compiler checks against actual JavaScript implementations. Move existing weather presentation and cancellation state into a typed controller receiving map, selection and rendering dependencies; keep road-context lookup and private views in their existing owners.

**Tech Stack:** Existing Node 22.22.3, TypeScript 7.0.2, Vite, Calcite and MapLibre; no added runtime dependency.

**Spec:** `docs/code-review-repairs-2026-11-24.md`, subsequent contract and lifecycle passes.

## Global Constraints

- Preserve source times, units, legends, advisory filtering, reduced motion and missing-frame behavior.
- Keep external shared modules and the unified SDK/core/Calcite arrangement.
- Keep private records in their existing authorized exercise storage; no AGOL/schema/access changes.
- Retain the current app and all direct specialist links; no navigation redesign or automatic deployment.
- Keep unrelated PageIndex/untracked work intact.

## Review Focus

Late module/data rejection after another selection; hidden-map initialization; advisory lookup after navigation; sign-out/incident change; timers/listeners and renderer cleanup after destruction.

## Task 1 — Checked adapter boundary

- [x] Add failing compiler fixtures for unknown module/export, invalid feed callback/options, map inputs and weather inputs.
- [x] Add a keyed loader and explicit core contracts with runtime export validation; validate against actual module implementations, not declaration-only shims.
- [x] Add only needed public JSDoc annotations; do not rewrite legacy JavaScript to remove every `any`.
- [x] Test loading actual feed/private/map/weather adapters and reject malformed/unknown exports before use.
- [x] Run compiler fixtures, focused runtime tests and existing regressions; commit this independently testable step.

## Task 2 — Weather lifecycle owner

- [ ] Add lifecycle regression tests using actual forecast playback and controlled module/network boundaries.
- [ ] Extract weather state, request epochs, aborts, timers, visibility listener, advisory playback intent, snowfall summaries and rain-window state to `command/src/weather-controller.ts`.
- [ ] Expose selection/advisory synchronization, suspend/resume, scope invalidation, viewport change, read-only evidence state and destruction.
- [ ] Connect the thin shell to that owner; preserve one map and existing renderer adapters.
- [ ] Verify rapid switching, late success/error, hidden-map requests, navigation, scope invalidation, missing frame and cleanup.
- [ ] Run regression/type/build/site checks and desktop/phone smoke checks; commit the step.

## Task 3 — Review and handoff

- [ ] Perform one independent review of the whole branch, correct material findings and rerun relevant checks.
- [ ] Document ownership, verification, known limits and code-only rollback.
- [ ] Prepare an unmerged PR; no private record mutation or production cutover.

## Execution ledger

- Ruling: implement the requested contracts and weather extraction now; retain Work/Briefing splitting as the next separate pass because it has independent permissions, drafts and approval lifecycles.
- Ruling: use compiler checks against imported implementation namespaces plus runtime/integration tests. Public JSDoc is part of the checked boundary; a detached `.d.ts` alone is insufficient.
- Baseline: merged PR #149, `1f114a9f387e8f51e15cb8267c6c984eb56ecf49`; working source starts clean apart from unrelated untracked files.

- Task 1 verification: negative compiler fixtures initially failed on unchecked JS imports/callbacks; keyed imports now check actual implementation namespaces. 20 focused tests, compiler and Vite build pass. No runtime dependencies added.
