# Reservoir changes in Area Watch

Area Watch (the County Watch destination) is the app's default landing workspace.
Storm now, Rivers, Reservoirs and Weather remain contextual tools. Planning / scenarios
remain hypothetical; no simulation is needed to inspect the operational evidence.

## Review contract

- MIL river outlet release (CDEC 85) and spill (71) belong to the configured
  San Joaquin / Friant-to-Mendota review group. Total outflow (23) is excluded.
- PNF outflow (23) belongs to Kings below Pine Flat. No downstream Kings gauge is
  currently connected. KREC1 and NFCC1 remain upstream observations, not substitutes.
- Pool elevation (sensor 6) is included once per reservoir, even when two release
  metrics are associated. MIL uses completed daily reports; PNF uses hourly reports.
- Differences require adjacent valid reports: daily 23–25 hours, hourly 0.5–1.5
  hours. A changed sensor, units, missing comparison, stale collection or incomplete
  daily report cannot create a change cue. Existing CDEC posting-lag handling remains.
- Pool rise at displayed hundredth-foot precision plus positive WPC 72-hour rainfall
  at configured watchpoints prompts operator review. Pool rise alone is monitor-only.
  These are review conditions, not new flood, capacity, rainfall or dispatch thresholds.
- Existing observed/forecast gauge-rise criteria, scheduled releases and published NWS
  thresholds retain their meanings. Falling pools/releases never clear other evidence.
- Rain is a forecast polygon label at sample points, not basin-average rain or runoff.
  Report windows can differ; co-occurrence does not establish simultaneous downstream
  effects. Hydraulic connectivity and travel times are unverified, never inferred.

## Presentation and records

The concern queue includes reservoir changes, rainfall and rising-gauge evidence.
One review per named river group feeds the existing countywide Area reviews count;
map position and display filters do not alter that assessment. Source gaps stay visible.
Selecting a river concern opens dated release/pool observations, forecast window and
connection limitations in the evidence pane. Existing trend charts are one click away.
Source qualifications are expandable, not another top-level control or scenario tab.

Captured briefing/assignment evidence now freezes reservoir observations, comparison
times, source checks, release schedules, rainfall issue/valid times and limitations.
Existing approved records are unchanged. Private storage and access controls are unchanged.

## Sources

- https://cdec.water.ca.gov/dynamicapp/staMeta?station_id=MIL
- https://cdec.water.ca.gov/dynamicapp/staMeta?station_id=PNF
- Existing NWPS station watchlist and WPC Days 1–3 forecast services.

No new collector, cloud resource or credentials. The app reuses its current public
reservoir snapshot and gauge/rainfall collectors. Snapshot timestamps, not file fetch
success, determine eligibility.

## Verification and rollback

Run `node --test tests/reservoir-watch.test.mjs tests/planning.test.mjs tests/mission.test.mjs tests/workspaces.test.mjs`,
then `npm run build:import-map`, `npm test`, `npm run check`.
Browser checks: root opens County Watch; inspect a river concern; compare source
times and gaps; open trends; verify explicit Storm now and Planning links still work.
`?exercise=1` is fictional and cannot replace verification of public source health.
Rollback by reverting this release's code and regenerating import maps; no data migration.
