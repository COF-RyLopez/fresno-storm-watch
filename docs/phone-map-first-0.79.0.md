# Phone map-first refinement — 0.79.0

EOC users need to identify a place, review what changed and choose a next step. The phone header had grown to roughly 250 px at 390 x 844, before the list/map/evidence content began. Keep a compact F.R.O.G. identity and menu row, then persistent NWS and source-status controls. Move mission navigation and the other existing monitoring totals into Menu; use the same DOM controls and event handlers, not copied counters. Restore the desktop placement at its breakpoint.

NWS warning counts use the existing publisher Warning classification. Counts remain five-county regional, independent of panning. A failed or stale check says unavailable/outdated; it never becomes zero alerts. The full title and accessible name retain scope and retained count. Source issues keep their separate evidence panel and existing deduplication.

The focused phone map carries the selected place and existing review reason, plus an Evidence action. Explore map & layers is available in Menu. Existing source symbols and selected-watchpoint labels locate the evidence. These are watchpoints and spatial context, not invented watershed boundaries or predicted inundation. Full numerical values, units, times and uncertainty remain in Evidence. One persistent bottom switch preserves the Attention / Map / Evidence return path.

Rejected approach: putting every monitoring badge on the map would recreate the clutter and obscure locations. Replacing the renderer in this release would not address the crowded header and would mix interface acceptance with data/rendering migration. Keep these separate, with the next reference-delivery work in cloud-native-reference-next.md.

No private data, permissions, alert rules or collector endpoints change. No new basemap, extrusion, flow animation or simulation is claimed. Rollback is static release 0.78.1, with no data migration.

Validation: 822 tests and deployment checks pass. Checked 360 x 640 and 390 x 844 phones, landscape, and desktop restoration. Phone header is approximately 82–98 px instead of approximately 250 px. Verified concern selection, map Evidence action, Attention / Map / Evidence return path, Menu and optional map tools. Local fictional exercise confirms a complete regional warning label and an unavailable-feed label; the exercise title remains visible. Fixed an existing exercise initialization error referencing retired weather control IDs. Existing stale/unknown reservoir and gauge evidence stays explicitly qualified.
