# Refreshed 3DHP reference over quiet terrain

Purpose: keep the county waterway and waterbody reference current with its publisher while retaining quiet roads/place names, terrain and existing live observations. Reference geometry is not a live shoreline, measured flow, gate state or hydraulic model. Acquisition does not imply that USGS collected new observations that day.

Implementation sequence:
1. Acquire USGS layers 50 and 60 in a new isolated staging directory for every run; never reuse prior ID-only batch caches.
2. Require declared WGS84 XY geometry, complete inventory, zero rejected records, matching county scope and bounded inventory changes. Preserve source fields and retrieval dates separately from display processing.
3. Rebuild MVT and PMTiles and the waterway/waterbody search references from that acquisition. Retain county street search data and its original dates. Decode tiles, account for features/labels and verify archives before applying.
4. Refresh weekly in GitHub Actions. Commit only validated public reference outputs; on failure leave the published snapshot unchanged. The existing 15-minute Pages schedule publishes the committed result.
5. Show retrieval/check status under map reference details; use revision-aware tile requests. Run one complete refresh locally, CI validation and published desktop/phone checks.

Current coverage is the union of Fresno County and the two full-resolution USGS NLDI drainage polygons pinned in `site/data/reservoir-watersheds.geojson`. The drainage polygons follow the NHDPlusV2 network for the reservoir stations, and the mapped lines and water body footprints come from USGS 3DHP. The source IDs, retrieval dates, original response hashes and area comparisons accompany the polygons. The NLDI polygons include the full outlet catchment. Both split-catchment requests were unavailable at acquisition, so the boundary should be used at watershed scale.

The expanded baseline validates 192,502 flowlines and 8,195 water bodies. An independent county-only ID query confirms that each Fresno source feature remains present. The two reservoir watersheds add 49,907 flowlines and 1,077 water bodies. The `--expand-to-reservoirs` option is only for migration from a reviewed county-only baseline. Regular refreshes pin both the county boundary and upstream watershed hashes. The geographic polygon is queried first. Whole intersecting segments and water bodies may extend beyond it within the envelope. Waterway and lake searches follow this expanded reference, with county streets sourced as before.

County Watch opens the watershed extent from a matching river concern or the two links under **Reference & coordination**. The dashed boundary is independent of the optional WPC 72-hour forecast, which uses publisher colors and shows issue and valid dates. The map displays precipitation contours across the viewed extent. Release, pool elevation and gauge evidence keep their own source times. Forecast precipitation does not establish runoff, verified network routing or arrival times.

First refresh: November 14, 2026. 142,595 flowlines and 7,118 water bodies; source-record hashes match the preceding acquisition. This confirms a fresh retrieval, not new source geometry. All 50,839 county street source records, grouped street search entries and their original retrieval dates remain unchanged.

## Operations

GitHub Actions **Refresh public USGS hydrography** runs Sundays at 12:30 UTC (04:30 PST / 05:30 PDT), or manually through **Run workflow** on main. Scheduling is best effort. It uses public USGS sources and the repository's existing workflow token, with no GIS credentials or ArcGIS credits. Node dependencies are pinned in package-lock; Python dependencies use the existing exposure-requirements pins. Run locally with that Python environment:

```text
python scripts/refresh-hydrography.py --apply
```

Every run creates a new work/hydrography-refresh-* directory. Validated MVT, search files and local PMTiles are promoted together. PMTiles remain Git-ignored; Pages rebuilds and verifies them from the committed MVT. Do not reuse previous batches for a new refresh. Failed stages can be inspected locally without publishing them.

Schema/scope changes, truncated or inconsistent inventories, rejected geometry, a count change over 10%, loss of an entire mapped class or previously populated network field, failed tile/search accounting, or archive round-trip failures stop publication. A small source-count change is allowed, not treated as an operational hazard. Inventory validation cannot make an editing service an atomic snapshot; acquisition timestamps describe its retrieval window.

The workflow commits only allowlisted public reference outputs after regression checks. On acquisition/validation failure it restores the preceding status record and commits a generic failure notice only. Previous reference files stay published. Repository push conflicts fail rather than overwriting concurrent changes. Check the red Actions run if a push itself fails; a failed status push cannot update the app. The existing Pages schedule picks up successful commits approximately every 15 minutes, subject to GitHub delays.

**Map symbols & reference limits** shows the last validated refresh, failures and checks overdue by more than nine days. Reload the app to load a newly published reference. The style is revalidated on load; TileJSON, MVT, PMTiles and search geometry requests use the retrieval revision. Public paths are replaced on deployment, not permanent historical artifact URLs.

To roll back: disable the refresh workflow temporarily, revert the reference commit (or this feature commit if needed), and rerun the existing Pages workflow. No GIS data migration is required. Restore automation after diagnosing the failed source/build contract. Current terrain remains the existing Tilezen reference terrain; this release does not substitute newer LiDAR or claim surveyed reservoir elevations.
