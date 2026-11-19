# Gauge symbols and burn-scar rainfall context

**Goal:** Read current gauge conditions at a glance and locate recent Fresno County burn areas alongside rainfall, without inventing thresholds or debris-flow predictions.

**Approved direction:** Screen-facing thermometer symbols with current readings, recent trends and published, dimensionally comparable thresholds; gray/dashed unknown or stale states; hover/tap details. Add recent public fire perimeters and Basin/Garnet assessment references. Private partner email and attachments remain local.

**Architecture:** A pure gauge-display adapter feeds bounded per-station map icons using existing MapLibre and NWPS collectors. A public, repeatable fire-perimeter collector supplies a compact county-intersection reference. Existing source refreshes and private stores remain unchanged.

**Additional user requirement:** Add city and county boundaries for context. Use existing five-county regional outlines and current Census incorporated-place polygons intersecting Fresno County; distinguish neighboring context from Fresno membership. Labels appear at useful scales, with reference symbology distinct from hazards.

**Constraints:** No capacity percentages, derived water depth, inferred hydraulic connections, automatic debris-flow triggers or current hazard classifications from historical assessments. Fire outlines are not burn severity or inundation boundaries. Published categories, source dates, missing data and differing design storms remain explicit. The forwarded Basin matrix is not a public data feed.

- [x] Test gauge status, units, negative/zero values, trends, stale/missing data and unknown/contradictory thresholds; implement model and icon rendering.
- [x] Wire symbols, hover/tap and accessible details to existing gauges, keeping the map focused and adding a compact legend.
- [x] Acquire public CAL FIRE 2024–25 and NIFC 2026 perimeters intersecting Fresno; reconcile identifiers and retain provenance/coverage limitations. Connect reference selection to rainfall and link dated USGS Basin/Garnet assessments.
- [x] Run regressions, type/build/site checks and desktop/phone visual verification. Independent review corrected date-only timezone handling and hardened an existing flaky UUID assertion. Provide a preview/PR; do not merge or deploy automatically.

Verification: 1,033 JavaScript tests passed; Command type/build and site checks passed. Desktop and 390×844 browser viewport exercised (not a physical-phone performance benchmark). Gauge tap details, threshold-unknown labels, observed trends, Basin dates/source links, burn selection, and reference outlines were checked. Phone readouts use an inset scrollable card to avoid viewport clipping and preserve pointer entry. County/fire label duplication was removed. A later WPC frame request failed visibly; forecast availability is not guaranteed by this reference-layer increment. Local screenshots and private email evidence stay in ignored `work/`.
