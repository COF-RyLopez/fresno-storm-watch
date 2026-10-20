# Map search references

Release: 0.31.0. Private assets and search queries are never written here.

County streets publisher: Fresno County Public Works and Planning.
Endpoint: https://gisprod10.co.fresno.ca.us/server/rest/services/PublicWorks/PublicWorks_BaseLayers/MapServer/4
Queried October 20, 2026 with the application's exact Fresno County polygon
(GEOID 06019), EPSG:4326, intersects. Complete object-ID inventory checked before
and after download; exact batches of 500 reconciled. 50,839 intersecting segments
accepted, zero rejected; 5,666 grouped street names. Native service CRS is
EPSG:2228; ArcGIS returned EPSG:4326. Only public name/alias and geometry fields
are retained. No address ranges, property records or protected services used.
Source is county-published public reference GIS; publisher metadata exposed no
additional use restrictions at retrieval. Credit Fresno County PWP. Inventory
does not establish maintenance responsibility, public access or current closures.

Waterways publisher: USGS 3D Hydrography Program (federal public-domain reference).
Endpoint: https://3dhp.nationalmap.gov/arcgis/rest/services/usgs_3dhp_all/MapServer/50
Reuses the validated county-intersecting October 19, 2026 snapshot from
acquire-waterways-county.py. Of 142,595 input segments, 16,184 named segments
are indexed under 496 normalized names; 126,411 unnamed segments remain outside
name search, with zero rejected named geometries. See the waterways basemap
manifest for original snapshot accounting and network limitations.

Display conversion: clip source line parts to the county polygon; transform to
NAD83 California State Plane IV, EPSG:26944 (meters); simplify five meters while
preserving topology within each part; return EPSG:4326 XY rounded to six decimal
places. No lines are snapped or connected and no elevation, road status, hydraulic
direction, gate state or travel time is inferred. This is generalized search
highlight geometry, not an engineering dataset.

Rebuild with scripts/build-map-search.py in the pinned requirements-waterways.txt
environment. Raw public street batches stay in ignored work/search-build.
The versioned manifest records accounting, boundary/input hashes, publisher URLs,
retrieval dates and every geometry-shard checksum. The browser downloads the
public name index once and fixed public geometry shards only when selected.
Names in different sources retain separate result identifiers. Repeated street
names can represent disconnected segments and fit a broad countywide extent.
