# Command Calcite shell specification

Status: implemented for release 0.104.0. Base: 0.103.0 / 28d5a28.

## Operator contract

Keep one MapLibre map, selected place, camera, weather product and forecast clock while navigating Watch, Work and Briefing. Use Calcite for layout, not a second GIS runtime. Retain F.R.O.G. dark identity and the exercise-only private storage designation.

## Regions and behavior

- Outer Shell: existing compact header, incident context and warning strip in its header slot; destination content; phone navigation in footer slot.
- Watch Shell: docked start Shell Panel containing a headed Panel for attention; central map and existing weather strip; docked end Shell Panel with a Flow for evidence.
- Attention starts open. A labeled Attention map action toggles it on desktop. At widths 701–1150 px, one side panel is visible at a time. Above 1150 px both can be visible.
- Compact means width <=700 px OR height <=520 px. Attention, Map and Details occupy the workspace one at a time, using the existing labeled footer. Resizing changes presentation only.
- Details retains Place, Weather and Map key. A temporary map reading is a second Flow Item. Back returns to its originating section. Close returns focus to the map without discarding selection. Same-place feed refreshes never reopen dismissed Details.
- Use one labeled Calcite Action Bar: Attention, Fit, Overhead and Map key. Preserve keyboard activation, accessible names and active states.
- Group source coverage and gauge instructions with Blocks. Keep cards and private forms intact. Each side panel has one scrolling content region with fixed headings/actions.
- Timeline, units, valid time and legend stay below the map. Do not float long text over it. Preserve existing playback and reduced-motion rules.

## Runtime and boundaries

Use the existing CDN Calcite 5.1 runtime only. Verify pinned properties: Shell slots, ShellPanel display-mode=dock, FlowItem selected and calciteFlowItemBack, Block collapsible/expanded and ActionBar expand-disabled. Use public theme variables, never shadow-internal CSS. Existing forms and timeline retain native semantic controls.

No new permissions, AGOL items, feeds, thresholds or private schemas. Preserve approval records, freshness, provenance, authorization and map association meanings. Keep private data out of persistence and deployment artifacts. Work and Briefing DOM stays mounted during navigation, preserving drafts.

## Acceptance and rollback

Test 1920x1080, 1280x720, 390x844 and 844x390; distinguish viewport emulation from actual-device acceptance. Check hydration, one runtime, reading Back, Close/focus, same-place refresh, Weather/Map key without selection, attention toggle, Work/Briefing return and sign-out clearing. Confirm the weather strip never overlaps the map. Run regression checks. Preserve legacy app. Roll back by redeploying 0.103.0; no migration.

## References

- [Esri application layouts](https://developers.arcgis.com/javascript/latest/creating-app-layouts/): separate layout, mapping and theme responsibilities.
- [Shell](https://developers.arcgis.com/calcite-design-system/components/shell/), [Shell Panel](https://developers.arcgis.com/calcite-design-system/components/shell-panel/), [Flow](https://developers.arcgis.com/calcite-design-system/components/flow/).

Checked November 27, 2026 against the deployed 5.1 definitions. Current documentation may describe newer APIs; the pinned runtime is the compatibility boundary.

## Verification record — November 27, 2026

- TypeScript, Vite build, import-map integrity, repository checks and all 1,120 Node tests passed.
- Independent review found a panel/application-state mismatch on resize. Internal layout changes now notify the application pane controller; a regression test reproduces and prevents the mismatch. Reviewer confirmed the fix.
- Actual Calcite 5.1 components hydrated in the browser, with one runtime and one MapLibre canvas. No new rendering or authentication dependency.
- Emulated 1920x1080 and 1280x720: docked attention/map/Details; strip outside map. At 1000x720 only one side panel was visible. Phone 390x844: one panel, synchronized footer, no horizontal page overflow. Landscape 844x390: horizontal tools, 125 px usable map and 102 px weather strip with gust samples selected.
- Keyboard Map key action focused its heading. Closing Details focused the map. Tapping the Kings River near Trimmer gauge opened a second Flow Item; native Back restored the selected-place section. Unit tests also cover reading from Weather and private reading clearing.
- Work and Briefing loaded with county exercise access; returning retained Pine Flat and the weather selection. No operational records were created or changed.
- Local cached reservoir/power observations were old and remained explicitly marked; this release does not change collection freshness rules. Direct WPC fallback delivered a current dated forecast during verification.
- Still requires staff acceptance on actual phones, assistive technology and distinct authorized accounts. Viewport emulation and regression tests do not establish production readiness or long-duration memory performance.
