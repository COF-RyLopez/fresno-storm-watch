# Command Calcite shell implementation plan

> **For agentic workers:** Use superpowers:executing-plans for inline execution. Track completion here and in the local ledger.

**Goal:** Consistent docked attention and evidence panels without changing the map, data or private workflows.

**Architecture:** Outer Shell and nested Watch Shell. A layout controller owns visibility; the inspector owns evidence/Flow selection. Existing collectors, map and private editors remain independent.

**Tech Stack:** TypeScript, Vite, MapLibre 6.15.0, existing Calcite CDN 5.1, Node tests.

**Spec:** docs/command-calcite-shell-spec.md

## Global constraints

- Existing Calcite 5.1 runtime only; no second map or GIS runtime.
- Compact: width <=700 px OR height <=520 px; medium: width <=1150 px.
- Weather strip below map; exercise designation and permissions unchanged.
- Selection, camera and time remain in memory; no private persistence.

## Review focus

- Resizing with Details open must retain place and weather clock.
- Same-place refresh after Close must leave Details closed.
- Reading opened from Weather must return there on Back.
- Sign-out must clear reading and selected Flow state.
- Actual CDN hydration must preserve labels, slots and scroll sizing.

### Task 1: State and navigation contracts

Files: create command/src/layout.ts, tests/command-layout.test.mjs; modify command/src/inspector.ts and tests/command-inspector.test.mjs.

Interfaces: layoutPresentation({width,height,pane,inspectorOpen,attentionCollapsed}) returns visible attention/evidence/map and compact status. createCommandLayout synchronizes presentation and attention toggling. Inspector accepts changed(panel), drives two static Flow Items with selected attributes, and returns readings to their originating section.

- [x] Write tests for wide/medium/compact layouts, attention toggle, no blank Details, resize and reading-return/privacy behavior.
- [x] Run node --test tests/command-layout.test.mjs tests/command-inspector.test.mjs; confirm failures before implementation.
- [x] Implement controller/inspector changes; rerun tests and type check.

### Task 2: Calcite regions and integration

Files: command/index.html, command/src/main.ts, command/src/style.css.

- [x] Compose Shell/ShellPanel/Panel, Flow/FlowItem, labeled ActionBar and Blocks; retain adapter/form DOM IDs.
- [x] Integrate controller with pane/route/inspector; resize existing map, never recreate it.
- [x] Replace obsolete grid/pane CSS with documented sizing variables. Keep strip outside viewport.
- [x] Run check:command, build:command, build:import-map, npm test, npm run check, git diff --check.

### Task 3: Review, browser verification and release

Files: verification notes, package version/lockfile; task changes only.

- [x] Obtain independent correctness review; fix material findings and rerun checks.
- [x] Batch four viewport checks: hydration, panel navigation, Back/Close/focus, timeline, route return and keyboard. Private browser tests are read-only.
- [x] Record results and unverified actual-device/multi-account acceptance.
- [ ] Release 0.104.0 via tested PR and Pages; verify published UI and screenshots. Preserve unrelated local work.
