# Fresno County water-body reference cache

Publisher: USGS 3D Hydrography Program / The National Map. Endpoint checked October 20, 2026: https://3dhp.nationalmap.gov/arcgis/rest/services/usgs_3dhp_all/MapServer/60 . The service describes its data as open and non-proprietary and requests USGS acknowledgment. The service combines elevation-derived hydrography with NHD where newer coverage is not available.

Query: enumerate all object IDs intersecting the existing Fresno County polygon (GEOID 06019), then query exact ID batches in GeoJSON, outSR=4326, returnZ=false, returnM=false. Validate identity, completeness, polygon validity, XY coordinates and local intersection; check the inventory again. Public geometry clips to the county envelope so border-crossing water-body context remains. Raw responses remain in ignored work files. The manifest records the retrieval window, boundary/inventory/source hashes, field definitions and classification counts. This is a resumable retrieval window, not an atomic editing-service snapshot.

Accepted: 7,118 features; zero rejected and zero missing from maximum-zoom display tiles. Publisher classifications: 6,971 Lake, 82 Canal, 65 River. Named polygons: 417. Labels: 394 normalized names after channel-name and repeated-name deduplication. Largest polygon per normalized name supplies an interior anchor; holes and multipart outlines remain. Source IDs are snapshot identifiers, not a promise of cross-release stability.

Formats: Web Mercator XYZ MVT, extent 4096, tileSize 512, buffer 128, max zoom 12 with overzoom, tolerance 1. Polygon areas used for label scale priority are measured in EPSG:26944 square meters, converted to square kilometers; they are not calculated in Web Mercator. 1,031 polygon/name tiles total 3,895,160 bytes. Original 0.29 flowline tiles are retained unchanged. Muted blue footprints and blue-gray boundaries draw below roads and channel lines. Native label collision avoidance remains enabled. Small polygons may disappear at broad views due to display generalization; all are accounted for at maximum source zoom.

Limitations: reference outlines are not current shorelines, current water levels, flood extents, predicted inundation or proof of access. Local ponds/basins may be missing. Source Z/M and vertical datums are not used. No flow topology or reservoir release inference is added.

Reproduce with the pinned requirements-waterways.txt Python environment and npm lockfile:

1. Run scripts/acquire-waterbodies-county.py (public read-only acquisition).
2. Run node scripts/build-waterbody-basemap.mjs (retains existing flowline cache).
3. Run node --test tests/waterbodies.test.mjs and the Python test_waterbody_export.py tests.

See waterbodies-manifest.json and waterbodies-tilejson.json beside this file. All sources and generated tiles are public reference data; no private assets or credentials are included.
