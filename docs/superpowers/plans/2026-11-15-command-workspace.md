# F.R.O.G. Command Workspace Implementation Plan

> For agentic workers: implement and review isolated components, preserve the current application. The user approved the Command Workspace redesign specification in chat on 2026-11-15.

**Goal:** Deliver a separate /command/ exercise preview with Watch, Work and Briefing, a persistent MapLibre terrain map, shared evidence and private workflow adapters.

**Architecture:** Vite and TypeScript entry, existing domain modules and public collectors, existing private AGOL append-only storage. No old app bootstrap. Public data contracts and server permission rules remain authoritative.

**Tech stack:** TypeScript, Vite, Calcite web components, MapLibre, existing weather renderers and AGOL identity/storage.

## Global constraints
- Current index, EOC, pump and population entrypoints remain available. No front-door replacement before human acceptance.
- Exercise designation remains; no new privileges or production records.
- Single place selection, one map, no app-specific score or automatic official actions.
- Private records remain in memory; no public build/cache/log export.
- Bounded snapshots, source times, fixed units/legend semantics and source failures remain visible.

## Review focus
- Stale samples and partial sources cannot look current or empty-safe.
- Navigation and background updates cannot reset selected place/camera.
- Expired identity invalidates in-flight private loads and clears drafts.
- Exact approved snapshot and conflicting heads must survive adapters.
- Missing mapping/coordinates cannot become invented impacts.

## Task 1: contracts, inventory and build
- [x] Inventory routes and dispositions.
- [ ] Capture comparable current/new performance baselines on documented EOC hardware and network.
- [x] Add Vite TypeScript build, shared contracts/state and focused tests.
- [x] Extract loadSdk so auth/storage do not import legacy map module.

## Task 2: private Work and Briefing adapter
- [x] Reuse private exercise store, forms, records and approval validation.
- [x] Provide typed adapter/controller for incident/period selection, work filters, append/correction and exact briefing capture.
- [x] Test stale sessions, unclassified legacy tasks, conflicts, private draft clearing and snapshot digest.

## Task 3: shared feed and map adapter
- [x] Normalize current public river/rain/release/roads/power/alerts into concerns and evidence through existing domain functions.
- [x] Persistent MapLibre map with one selected place, retained camera, geographic records and context.
- [x] Shared lazy weather controls preserving radar/GOES/cloud sources and valid time.
- [x] Test incomplete feeds, timestamps, selection races and route restoration.

## Task 4: responsive command interface
- [x] Watch attention/map/details, Work phase/list/edit and Briefing composer.
- [x] Contextual public/private data, search, stable navigation, keyboard and phone layouts.
- [x] Produce migration parity checklist and explicit remaining gates.

## Task 5: verification and preview delivery
- [ ] Full suite/build/static checks, independent review and desktop/phone inspection completed; measured loading/soak remain pending.
- [ ] Publish only the additive preview once verified; retain current front door.
- [ ] Human role-based and two-shift acceptance, eight-hour soak and production permission acceptance remain required before replacement.

## Execution ledger
2026-11-15: Started from 0.95.0 on feat/command-workspace. Unrelated PageIndex files and outputs preserved.
Ruling: implement the authorized additive preview without asking for another plan approval. User explicitly approved implementation.
Ruling: preparation reads work without an incident; persistent work requires a real authorized incident context. Never fabricate activation.

2026-11-15: Implemented additive Command preview with public feeds, persistent terrain, optional private AGOL inventories, Work records and frozen briefing figures. Local county sign-in and existing exercise incident reads verified. See docs/command-preview.md for explicit parity and acceptance gaps; completed preview tasks do not imply production acceptance.
