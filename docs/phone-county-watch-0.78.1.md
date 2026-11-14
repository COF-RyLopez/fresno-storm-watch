# County Watch phone verification — 0.78.1

Phone County Watch uses a pinned Attention / Map / Evidence switch. Selecting a concern opens its evidence; the map retains the selection behind it. Switching views preserves evidence, list selection and map position. Closing evidence disables its switch until another item is opened.

Fixes: remove the cramped stacked map/evidence layout; keep the return path outside scrolling content; shorten the phone account label; compact the landscape header; make explicit Map and Focus area actions open the map. Hidden panes are inert. The covered map uses opacity rather than visibility so the SDK can finish focusing the selected geometry while evidence is visible.

Browser checks: 360 x 640 and 390 x 844 portrait, 844 x 390 landscape, and 1280 x 720 desktop. Verified attention-to-evidence-to-map and return, retained selection, keyboard Tab/Enter switching, explicit Focus area, source uncertainty and readable source metrics. Desktop retains its three-column layout. These are responsive Chromium checks, not physical iOS/Android device certification.

Local preview has an older reservoir snapshot: Oct 18 values remain explicitly old/unverified, and missing downstream stage remains unknown. No feed values, alert rules, access permissions or private records were changed.

Validation: all 820 JavaScript tests and npm run check passed; CI and published-page confirmation follow before release. Rollback is the preceding static release (0.78.0); no data migration.
