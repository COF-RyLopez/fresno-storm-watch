# Command workspace — exercise preview

This is an additive preview at `/command/`, built from `command/`. The existing Storm Watch front door, private EOC application, forms and published data collectors remain available. This preview is not an operational cutover or county acceptance.

## Implemented journey

1. Watch shows the first five concerns, ordered by category then source/timing context. Official agency alerts remain discoverable above all filters. Current reported impacts show newest source times first; elapsed-date road contradictions are grouped for reconciliation. Unknown and failed data remain visible.
2. Select a place in the list or map. One persistent MapLibre terrain map focuses the location and its watershed; the same evidence pane shows rainfall, release and gauge observations. Nearby records are geographic context, not verified connections. Reference search loads its name index on demand, then only the chosen geometry shard.
3. Choose Assign verification. The place, evidence and next review carry into Work. Choose an existing authorized exercise incident before saving. Tasks filter by phase, owner, place and status. Completed work and supporting collections are expandable. Corrections and conflict resolution retain record history.
4. Capture evidence into Briefing, select an operational period, edit the narrative and save a version. The version includes selected-incident operational records and bounded figure samples. Approval covers its exact digest. Printed charts are recreated from frozen samples, never current feeds. Legacy briefing formats retain their original EOC review/print route.
5. On phones, Attention, Map and Details retain the selected place. Weather starts off and playback paused. Navigation pauses rendering; returning preserves a valid selected weather frame. Expired scans are labeled, not silently refreshed into a different time.
6. Work → PIO outreach reuses the existing private editor: confirmed languages, zone applicability, saved population/AFN evidence, exact-message approvals/withdrawals and manual distribution receipts/corrections. Source revisions can be acknowledged or reopened without changing approved messages. Zone or incident-wide PIO handoffs open the Command briefing composer and retain their declared scope, provenance and uncertainty.
7. Selecting an NWS advisory fits its published footprint and exposes hazard-appropriate local context: river observations for flooding, power for wind, and access/care for winter or travel concerns. Phone selection opens Map first when a footprint exists. Context uses geometric overlap including polygon holes (up to 24 records; first five expanded); it does not establish impact, connectivity or safe access. Authorized facilities appear only after loading them. Missing geometry is explicitly unassessed.

## Data and access

- Public sources reuse the current validated collectors and domain assessment rules: NWS alerts and gauges, WPC rainfall, scheduled reservoir/power/wind/comparison data, county road records, evacuation zones and resident care.
- Authorized county facilities and the existing-only AGOL pump copy load only after an explicit action and eligible county AGOL sign-in. No Enterprise prompt is needed for those copies. Proposed pumps are excluded.
- Private selections, geometries, reports and drafts stay in memory. Private IDs are not put in the URL. Sign-out removes private context. No data export or permission changes are part of this deployment.
- ArcGIS remains the identity/storage service. Its core loader is separate from the legacy map bootstrap. One standalone Calcite runtime and one MapLibre map are used by Command.
- Existing PMTiles waterways and reference terrain are reused. Weather uses the existing bounded radar/cloud volumes. No unmeasured Zarr/DuckDB rewrite is introduced by this interface change.
- Private storage stays `environment: exercise`. Production storage/access approval is a separate gate.

## Sign-in

The existing county OAuth registration accepts the local origin on port **8777**. The live check reached county sign-in and loaded the existing exercise incidents after the user signed in. Port 8778 was rejected; do not use that port for private testing.

Start with `npm run build:command`, then `npm start`, and open `http://127.0.0.1:8777/command/`.

For the published preview use `https://cof-rylopez.github.io/fresno-storm-watch/command/`. If the county registration rejects that address, its owner should add that exact HTTPS return address to the existing app registration without changing scopes, groups or sharing. Do not enter credentials into a setup script or chat.

## Migration inventory

| Existing route/capability | Treatment in preview | Before replacing the front door |
| --- | --- | --- |
| `index.html`: Watch, Rivers, Weather, Reservoirs, Alerts, Power, Roads, Drainage, Population | Combined Watch map, place selection and contextual evidence; current route retained | Finish every specialist evidence/action parity check |
| `eoc.html`: incidents, periods, reports, verification, coordination, checklists, staging, references | Shared private adapters in Work, with append-only corrections | Distinct-account read/write/denial exercise |
| `eoc.html`: briefings/approvals/withdrawals | New exact Command snapshot and approval; legacy versions open in EOC | Print review and shift handoff exercise |
| PIO outreach / AFN source-change review | Native Work tool using the shared editor, source checks, team reviews and scoped readable Command handoffs | Distinct PIO/approver account exercise and staff acceptance |
| Pump readiness and assignments | Private inventory in Watch; records preserved; direct existing form/action links | Migrate all readiness-specific review and task actions into Work |
| `pump-readiness.html`, `zone-population.html` | Preserved focused external entry points | Shared visual polish; retain direct URLs |
| `flood-scenario.html`, `flood-scenario-3d.html`, `scenario-guide.html` | Preserved outside primary operator navigation | Contextual comparison when a usable product covers selection |
| `river-3d.html`, `map-pilot.html`, `reported-locations.html` | Retained specialist/benchmark routes, absent from normal menus | Remove only after equivalent coverage is accepted |
| `planning.html` | Retained detailed reference; technical qualifications move into Details | Complete maintainer/operator content split |
| `eoc-guide.html` | Account → access/help | Keep current help and workflow links |
| `setup.html`, `terrain.html`, `pump-inventory.html`, `pump-refresh-setup.html`, `pump-readiness-test.html` | Retained setup/maintenance routes, absent from operator navigation | Maintainer directory and county ownership review |

## Remaining acceptance gates — not claimed complete

- Pump-specific editing; old pump links remain intentional until replacements pass. PIO editing is now available inside Work.
- Full private drainage/basin topology context and contextual building extrusion in Command; current specialist views retain them.
- Incident-specific reviewed staging, readiness, people, power and road relationship validation with responsible agencies.
- Exact graphical map capture in approved briefings. The current snapshot freezes camera/product/window settings and numeric figure data; it does not archive an external basemap or weather volume.
- Four representative staff, two exercise shifts, distinct-account permission tests, actual phone browsers, screen readers, 200% zoom and eight-hour memory soak.
- Production storage ownership, permissions, county approval and explicit cutover. No exercise guard is removed.

## Engineering validation and limits

Automated tests cover source normalization, disjoint polygon topology, official category preservation, old-road reconciliation, marker-to-evidence resolution, bounded figures, private access, stale requests after sign-out, ambiguous-write retries, conflicting revisions and frozen briefing records/digests. Full regression and static checks are run with the existing app.

Browser checks include 1280×720 and 390×844 layouts, selected watershed evidence, Work/back navigation, explicit county sign-in, current incident loading and optional authorized asset loading. Browser viewport checks do not substitute for an actual phone or staff acceptance.

2026-11-15 validation: 967 automated tests passed, along with TypeScript, production build and the existing site checks. Independent review fixes cover private selection/DOM cleanup on incident changes and sign-out, superseded searches, failed rainfall windows, radar expiry recovery and cloud refresh after navigation. The live private check was read-only: existing incidents/reports loaded, an incident switch cleared the prior report, and sign-out cleared the private workspace and search text. No exercise records, group memberships or permissions were changed by this check.

The built shell is approximately 21 KB JavaScript, 13 KB CSS and 26 KB HTML before compression, excluding shared modules, Calcite, MapLibre, reference tiles and weather. These are build sizes, not claims of three-second loading or 30 FPS. A performance run must document hardware/network, cold/warm caches and long-session memory before renderer defaults replace the legacy app.

2026-11-15 PIO increment: 972 tests, TypeScript, Vite build and site checks pass. Fresh review findings were corrected and rechecked. The signed-in browser loaded existing exercise outreach with population/AFN snapshots; an unsaved draft survived Follow-ups/PIO and Watch/Work navigation at phone width; a zone handoff opened Command Briefing. The new adapter's save/approval/receipt/retry and source-review paths were tested with the isolated exercise store, not by modifying AGOL records. At 390px the form had no horizontal overflow. Live advisory selection opened the phone map; follow-up geometry tests verify holes, crossing lines and exclusion outside the alert polygon. Browser dialog automation was unable to dismiss the test-draft discard confirmation, so that confirmation was handed to the user. Actual phone and distinct-account acceptance remain pending.

## Release and rollback

The Pages workflow builds Command separately with Vite after installing pinned dependencies. A content-keyed import map keeps shared modules consistent with the new shell. Only the public `site/` artifact is deployed; private datasets and working evidence stay out of it.

The original front door is unchanged. Rollback the preview by redeploying the preceding code version; no data migration or AGOL item deletion is required.
