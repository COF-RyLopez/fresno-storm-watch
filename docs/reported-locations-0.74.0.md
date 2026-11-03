# Reported storm locations · November 3, 2026

County Watch and the EOC workspace now open the combined reported-location map. The EOC **Reported locations** section embeds it; the full map also opens at `reported-locations.html`, with `?source=d1` for the seven earlier District 1 reports. The EOC map retains filters and its selected location when operators change sections or public sources refresh.

The dated snapshot contains 92 reports: seven earlier District 1 reports, counted once, and 85 OES additions. Seventy-five reports have supplied coordinates; 17 use reference geometry. Two of the latter have two alternative candidate points each. Counts are reports, not map symbols. Five reports use road-reference lines. Search, source and area filters preserve that accounting.

Blue identifies the District 1 report source; orange identifies OES additions. Filled points represent supplied coordinates; open points represent reference locations or candidates, and dashed lines locate described roads. Each popup retains the original concern, placement basis, source and verification needed. Source decimal precision does not establish accuracy. Source coordinates were not moved or snapped; WGS84 is a display assumption where the email did not state a datum. District 1 is a source label, not a verified district boundary.

This is a reference map, not a live incident feed, hazard assessment, closure map, flood extent, damage inventory or LiDAR mission plan. No private EOC records, reviews, incident counts or approvals are created from these reports. The original portable map and report package remain intact.

The source is the reviewed November 3 map package built from `RE Potential problem areas.msg`, the earlier District 1 list, generalized County roads and documented location references. The distributed GeoJSON is the shareable snapshot; private photograph links and the original email are excluded. Fifteen linked photos were not reviewed. The JSON companion records source-file hashes and counts. The PDF and CSV are available from the EOC section; GIS download is available in the map.

Map runtime: Leaflet 1.9.4, vendored with its BSD 2-Clause license. Esri light-gray tiles require internet access. Location, County-outline and generalized-road files load from the app itself. New scripts follow the existing content-hashed import map and CSP workflow (`npm run build:import-map`).

Validation covers source accounting, coordinate preservation, District 1 and search filtering, alternative candidates, duplicate identity, invalid geometry and missing uncertainty. Browser review covers EOC embedding, filters, popup evidence and navigation without resetting the map. Deployment runs the repository regression and data checks.
