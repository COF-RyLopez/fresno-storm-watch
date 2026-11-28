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

Watch source corrections, November 18, 2026

- Records named exactly `test` in the county road source, ignoring case and surrounding spaces, remain inspectable under Coverage & sources → road source test entries. They do not enter current impacts, related-road screening or disappearance alerts. Other unnamed or incomplete road records still require status verification. Source data is read-only.
- Command counts the complete NWS active county list for `CAC019`. Forecast-zone polygons supply display geometry when available, while neighboring zones that only intersect the county outline do not add county alerts. CAP revisions, cancellations, duplicates, expiry and missing geometry have explicit handling. A failed authoritative check retains a visibly unverified previous snapshot. The five-county legacy map retains its regional scope.
- Gusts use a current published HRRR grid first. Overdue/unavailable HRRR or a failed frame falls back to existing NWS forecasts at nine named locations, refreshed directly if the scheduled copy is old. The map labels sample gusts in mph and exposes each sample's actual valid interval and issuance on hover/tap. Missing intervals remain gaps. Both layers and the previous selector clear before refresh, and both providers failing leaves an unavailable display. The open gust panel checks again every 15 minutes. Refreshes do not renew source issuance or relax freshness limits.

## Data and access

Selected NWS alerts expose the publisher's WHAT/HAZARD, IMPACTS and WHEN text before the county follow-up actions. Affected places and precautionary instructions remain expandable with the official alert link. Supported impact-based warning tags retain their NWS labels. Briefing capture freezes the guidance, original source text and source URL.

Explicitly cited highway numbers are matched against the prepared county street index. Dashed cyan corridors show loaded reference geometry intersecting the selected alert; tapping identifies the source date and the need to check current access. Ramps are excluded from corridor emphasis. Loading is bounded to 24 reference records with two requests in flight. Missing alert geometry remains unassessed, and failed/skipped route loads are labeled incomplete. These reference corridors do not establish closures, utility service or confirmed impacts. The alert footprint and existing dated weather selector continue to control the forecast context.

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
| `flood-scenario.html`, `flood-scenario-3js.html`, `scenario-guide.html` | Preserved outside primary operator navigation | Contextual comparison when a usable product covers selection |
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

Version 0.97.0 preview adds one-tap advisory playback. Direct alert selection fits the alert and starts the matching dated sequence once buffered: wind → gust forecasts; winter snowfall → six-hour snowfall; flood planning → rainfall; flash-flood, severe-thunderstorm and tornado warnings → recent Hanford radar. The weather dock retains the observation/forecast distinction, legend, selected period and Pause. A small in-memory cache holds at most three forecast frames. Forecasts stop at their final available step; missing frames stop playback and remain qualified. Background feed refresh and returning through browser history do not request autoplay. Reduced motion starts paused; deliberate Play remains available. Hiding the map or leaving Watch pauses playback. Regular radar is the Command path; its experimental Volume control is unavailable there, while specialist legacy views retain it. No private schemas or permissions change.

The local preview may use a read-only development proxy for the already-published public HRRR, snowfall and watershed-timing artifacts; it does not change the collector or publisher services. Browser viewport checks are not actual-device performance certification.

Command outage cards show utility restoration estimates and customer counts, with explicit unknown values and elapsed-estimate warnings. SCE date text lacking a time zone stays publisher text. A memory-only tracker compares the same stable outage ID across utility updates while the page is open. Newer changed/removed estimates and equal-time conflicting estimates remain review cues on the card and alert strip; ordinary refreshes do not clear them. Older responses cannot replace a newer displayed outage record. Reload establishes a new baseline; there is no unattended notification or persistent estimate archive. Briefing capture freezes the displayed estimate, count and change history. Counts are utility-reported accounts, not residents or buildings. Hover popups use a dark surface with light text in Command.

The Pages workflow builds Command separately with Vite after installing pinned dependencies. A content-keyed import map keeps shared modules consistent with the new shell. Only the public `site/` artifact is deployed; private datasets and working evidence stay out of it.

The original front door is unchanged. Rollback the preview by redeploying the preceding code version; no data migration or AGOL item deletion is required.

## Gauge symbols and regional reference context (0.98.0 preview)

Command renders compact, screen-facing level columns for the existing NWPS stations. The rectangular fill and solid line show the observation; compatible published threshold ticks set the station-specific scale; a hollow diamond identifies the published forecast high where available. A short locator points to the station. The recent observed trend uses the same variable and units. These are not capacity percentages or water-depth estimates. Unknown/contradictory thresholds have no invented fill scale: a dashed column and question mark indicate the missing reference scale while the actual reading remains in the label. Failed checks, old readings and out-of-service stations stay neutral and qualified; retained readings are re-evaluated each minute. Hover/tap and the collapsed Map key & gauge readings provide textual details. This replaces the initial literal thermometer shape in response to the user's CDEC reference.

The shorter rectangular symbol refinement is version 0.98.1. Desktop and 390×844 viewport checks cover the live map plus enlarged, explicitly illustrative known/unknown/stale states. The display adapter and source semantics are unchanged.

County outlines and labels cover the existing five-county operating region. Incorporated-place boundaries intersecting Fresno County appear at closer scales, including neighboring Avenal as context. The Census vintage is January 1, 2026. County and city lines are reference context, distinct from hazard polygons. County names retain the basemap's existing placement to avoid duplicate polygon labels.

Explore a watershed → Burn scars & rainfall opens recent public county-intersecting perimeters with the rainfall forecast. Perimeters are enabled by default throughout County Watch, including Weather Off and advisory selection, with a compact reference swatch. Map key → Recent fire perimeters can hide the context; that in-memory choice persists across weather changes and refreshes. Explicit burn selection still shows the selected outline. Reference polygons draw beneath official alert polygons. Search a fire name to inspect one outline. CAL FIRE 2024–25 and provisional NIFC 2026 coverage is incomplete. Basin and Garnet link to dated USGS assessments with different design storms; these do not classify current danger. Six-hour rainfall cannot establish a 15-minute debris-flow trigger. The private partner email and matrix are not deployed. See docs/command-context-sources.md for provenance and the daily refresh/fallback procedure.

No private storage, access or official alert rules change. This increment remains a preview until its PR is merged and deployed.

## Regional weather (0.99.0 preview)

Command removes Forecast clouds from the weather selector. Its normal radar path is now a dated NWS nowCOAST CONUS reflectivity mosaic rather than the small KHNX echo-patch footprint. The mosaic covers the western region initially and expands on camera movement, retaining the selected observation. Play, pause, scrub and Latest share a bounded three-frame image cache. A manual replay cancels pending follow updates; leaving Watch pauses playback. Radar and paired satellite images expire, and reduced motion disables automatic play. Source gaps and failures remain visible. These are observations, not forecasts or cloud volumes. Optional GOES uses independently timed 2D infrared imagery; no height mesh or cube-like forecast volume is installed by Command. Legacy specialist cloud and KHNX tools remain available on their existing routes.

HRRR gusts/winds and six-hour NWS snowfall now cover a California–Nevada overview (-125,32,-113,42.5). HRRR retains its 3 km source provenance but is prepared at 0.06° for this larger display; the grid is not a local engineering forecast. A new `-canv` frame URL namespace prevents narrow and broad grids sharing a cached URL. The validator accepts the preceding exact grid while deployment catches up. Observed snow and GOES IR use the same broader region. WPC rainfall retains its wider western footprint. Products still have real finite coverage; the map does not extrapolate values outside it.

See [regional-weather-delivery.md](regional-weather-delivery.md) for endpoints, bounds, limits and storage measurements. This preview makes no change to private records, alert counts, agency hazard categories or dispatch logic.

### Snowfall timeline (0.99.1)

Snow forecast uses a touch/keyboard range slider instead of a time dropdown. Each stop selects one available six-hour window; unavailable windows are not synthesized. The selected start/end and time zone stay above the slider, and the existing forecast legend, issue time, advisory fit and Play/Pause remain visible. Playback advances the same slider; manual scrubbing pauses playback and uses the existing superseded-request guards. Refresh retains the selected window when it remains available; returning from another pane redraws it. Empty and single-window states disable the slider. No source, forecast amount, advisory filter or private permission changes.
