# Water-body extension (0.33.0)

F.R.O.G. Waterways — Dark now includes 7,118 Fresno-intersecting public USGS waterbody polygons and 394 label anchors. The separate polygon cache adds approximately 3.9 MB across 1,031 tiles. Existing 0.29 flowline tiles are unchanged. Muted blue footprints draw below roads and channel linework in both 2D and 3D. These are reference outlines, not current shorelines, water levels or inundation.

The public `site/basemaps/frog-waterways-dark/waterbodies-DATA_SOURCES.md` and `waterbodies-manifest.json` record source, acquisition, CRS, validation and display accounting. Acquire with `scripts/acquire-waterbodies-county.py`, then build with `node scripts/build-waterbody-basemap.mjs`. The full flowline builder also preserves the committed water-body extension when rebuilding the original cache. No AGOL items or permissions change. Rollback: redeploy the preceding app release; no data migration.

# Countywide F.R.O.G. Waterways — Dark (0.29.0)

Rivers and Reservoirs now start with this basemap. Other workspace defaults stay
unchanged. An explicit gallery choice is remembered independently in page memory.
No AGOL items, permissions, private records or live operational data are changed.
Experience Builder and the private EOC workspace are preserved.

## Current scope and audit

All 142,595 public USGS flowlines intersecting the app Fresno County polygon were
retrieved and validated. Named and unnamed features are included: 16,184 named
segments and 126,411 unnamed segments, with 496 normalized published names.
Every input source ID is represented in the maximum-zoom MVT cache; zero rejected
or omitted segments. Tiles are display-generalized and do not replace the source.

The snapshot includes 4,291 source-classified canals. Additional named canals
are represented by waterbody / other connectors. The source geometry is retained
in ignored resumable batches; only XY coordinates were requested. Display geometry
clips to the county envelope, retaining boundary-crossing segments. No publisher
Z/M values or hydraulic elevations are bundled. Local district inventory
completeness and current operating states remain unverified.

The network audit is deliberately separate from the map's coverage claim:
137,837 records have hydrologic sequence values, but only 290 of the 4,291
canal-classified records do; 272 have primary downstream pointers, and 3,988 have
unknown mapped direction. Catchment IDs are blank here. Attribute presence is
not validation of network topology; primary-path pointers omit other branches.
Source IDs may change across USGS releases. GNIS/mainstem IDs and the retrieval
version must accompany future cross-release reconciliation.

Read the app guide at `site/planning.html#waterway-network` and the public
`site/basemaps/frog-waterways-dark/manifest.json` for provenance, hashes,
class-by-class field population and limitations. Public sources:

- [USGS Flowline layer](https://3dhp.nationalmap.gov/arcgis/rest/services/usgs_3dhp_all/MapServer/50)
- [3DHP network derivatives](https://www.usgs.gov/3d-hydrography-program/3dhp-flow-network-derivatives)
- [Flowline specification and identifier policy](https://www.usgs.gov/ngp-standards-and-specifications/3d-hydrography-program-3dhpall-flowline)

## Cartography and behavior

Web Mercator XYZ MVT, 512 px tiles / extent 4096 / 128 buffer, source zoom 0–14
with overzoom. The 15,250 current tiles total approximately 61.5 MB; the browser
requests tiles for its view rather than downloading the 87.6 MB build GeoJSON.
The full source download remains ignored, never included in the Pages artifact.

Major waterways are emphasized in county overview views. Other named waterways,
unnamed canals, small streams and network connectors appear progressively closer
in. Solid blue channels, dashed cyan canals, dotted waterbody/network connectors,
and separate short gray-blue drainageway dashes do not encode hazard severity.
Source type 3 drainageways are not reclassified as artificial canals.

One label anchor per normalized published name, with four principal anchors near
the dam areas, avoids segment repetition. Other anchors use the longest clipped
source path. Matching names are suppressed in Esri's remaining water-area label
classes (some ditches are classified there); unmatched lake names remain. Native
collision avoidance can suppress crowded names, and an anchor can lie outside a
close-up. Labels drape on terrain in SceneView. County boundaries are subdued
behind the waterways; operational gauges and other records remain foreground.

When selected, waterways are built into the basemap. The context checkbox is
disabled with an explanation; selecting another gallery basemap restores the
independent optional overlay preference. Current publisher attributes can be
queried near a waterway, with up to five county-intersecting features displayed
from a bounded query. This is a selection tolerance, not a risk buffer. Network
fields do not show live flow, gate settings, capacity or downstream arrival times.

## Rebuild and deployment

1. Use Python with `scripts/requirements-waterways.txt`. Run
   `python scripts/acquire-waterways-county.py`; three workers download exact
   validated batches of 500 source IDs. Interrupted downloads resume from ignored
   cache files keyed to the inventory / schema / boundary. Clear the chosen cache
   explicitly when a fresh retrieval of an unchanged source inventory is needed.
   The acquisition is a recorded retrieval window, not an atomic edit snapshot.
2. Review `work/waterways-county/manifest.json` and `rejected.json`. The script
   rechecks inventory IDs and refuses incomplete or changed inventories. Then run
   `npm ci --ignore-scripts` and `npm run build:waterway-basemap`.
3. For a new snapshot release, bump `version` / `tileDirectory` in the builder
   and `WATERWAY_BASEMAP.version`, rebuild, and update application module query
   versions. Versioned tile paths prevent mixing old and new snapshots. The
   previous pilot tile files remain for older open clients; no active item points
   to them in 0.29.0.
4. Run `npm test`, `npm run check`, offline Python network / publisher checks,
   and visual acceptance in 2D/3D. Tests decode all current tiles, reconcile all
   source IDs, and verify independent workspace defaults. Standard 15-minute
   feed collectors do not rebuild hydrography.

The preview server rewrites only the public TileJSON's canonical Pages URL to its
localhost port, preserving its versioned path. The style references original Esri
fonts/sprites and preserves attribution. Official dark source style is pinned in
`scripts/basemap-dark-source.json`. No ArcGIS account or new item is required to
read these static files. A county AGOL registration can be done later.

Rollback: redeploy commit `7ae5bf00b8387f817eeb76268578e755418569b6` (0.28.0).
No operational data migration is required. A load/render failure automatically
restores Dark gray context and displays a persistent qualification.

---

The original two-area pilot record is retained below for historical context.
Its scope, defaults and paths are superseded by the countywide release above.

# F.R.O.G. Waterways — Dark pilot (0.28.0)

Choose **Map tools → Basemaps → F.R.O.G. Waterways — Dark · pilot**.
The default remains Dark gray context. Each workspace remembers its own choice
in memory. No AGOL items, memberships, private records or source data are changed.
Experience Builder and the private EOC workspace are unaffected.

## Data and scope

- Publisher: USGS 3D Hydrography Program, [flowlines and schema](https://3dhp.nationalmap.gov/arcgis/rest/services/usgs_3dhp_all/MapServer/50).
- Snapshot retrieved October 19, 2026 PDT (UTC timestamp in the manifest).
- Pilot boxes: Friant / Millerton `[-119.86,36.89,-119.50,37.16]` and
  Pine Flat / Kings River `[-119.52,36.72,-119.13,37.02]`.
- 23,997 unique downloaded features; 4,896 outside-only features excluded;
  19,101 county-intersecting features accepted, zero validation rejections.
- Full source segments are retained in ignored `work/waterway-pilot/source.json`.
  Display geometry is clipped to the pilot boxes. Border segments may extend
  outside Fresno. This is not a complete district ditch inventory.
- Background: official Esri Dark Gray Canvas, owner `esri_vector`, item
  `c11ce4f7801740b2905eb03ddc963ac8`. Its source style is saved in
  `scripts/basemap-dark-source.json`; sprite/font URLs and attribution retained.
- Public provenance, stable source IDs, counts, CRS, label rules and hashes:
  `site/basemaps/frog-waterways-dark/manifest.json`.

## Cartography and behavior

One combined vector style coordinates native background and waterway labels.
It replaces background river/canal labels, retains road/place/lake labels, and
adds one point anchor per normalized published waterway name (66 total).
Four principal names snap to published source paths near the dam areas; other
anchors use the midpoint of their longest clipped path. These are cartographic
anchors, not new operational locations or inferred network connections.
Native collision avoidance can hide names, especially at edges or crowded sites.
In SceneView, vector labels drape on terrain; they are not elevated billboards.

Solid blue = named river/stream channels; dotted blue = named waterbody centerlines.
Dashed cyan = canals/ditches or drainageways, including a published name containing
canal/ditch. Other network connectors are dotted. Source feature types remain in
the tiles and query source; display roles do not replace publisher classifications.
Names/canals begin at style zoom 11; small unnamed streams/connectors at zoom 14.
This is reference geometry, not channel-bed elevations, observations or flood extent.
No thresholds, flow routing, access determinations or dispatch rules are added.

The normal dynamic USGS geometry and display labels are suppressed only while this
basemap is selected; their workspace preference is retained. Click near a pilot
waterway to query current USGS source attributes (maximum five features, bounded
8–150 m selection tolerance). This is a reference lookup, not an exposure buffer;
current publisher attributes may differ from the cached snapshot. Original live
feature overlays return on switching back to another basemap.

Tiles are standard XYZ MVT in Web Mercator (512 px, extent 4096, 128 buffer),
maximum source zoom 14 with native overzoom. 1,219 files, approximately 7.8 MB.
They are static public files served by Pages, not a newly published AGOL service.
The SDK may request missing tiles outside this bounded cache; no USGS features
are claimed there. Esri background context continues outside the pilot.

## Rebuild (explicit reference-data maintenance)

1. Use Python with `scripts/requirements-waterways.txt` installed in a local
   environment. Run `python scripts/acquire-waterway-pilot.py` from the repository.
   Review counts/rejections and the retrieval manifest before proceeding.
2. Run `npm ci --ignore-scripts`, then `npm run build:waterway-basemap`.
   Dependencies are pinned in the lockfile. The builder reads the validated
   `work/waterway-pilot` snapshot and saved original Esri style. No secrets needed.
3. Review the manifest, update the user-facing snapshot date/version in
   `site/lib/waterway-basemap.js`, and visually inspect both pilot areas at
   multiple scales in 2D and 3D. Recheck three names/IDs against USGS.
4. Run tests and `npm run check`, then deploy the reviewed public files.
   Regular 15-minute collectors do not rebuild or silently replace these tiles.

TileJSON uses canonical absolute published URLs. The local preview server rewrites
only this public TileJSON's tile template to its own localhost port. This avoids
the SDK's service-directory treatment of relative templates. Set `STORM_TILE_LOG=1`
for local path-only MVT request logs; no query strings, credentials or private data
are logged. To relocate hosting, change `publicUrl` in the builder and rebuild.

The committed thumbnail traces actual named pilot source paths; it is a locator
preview, not imagery or an operational situation map.

## Rollback and expansion

Users can immediately choose Dark gray context. A basemap load/render failure
restores it automatically and displays a persistent qualification. Release rollback
redeploys `9a638b2b4e380104ffb7ef4f5181fcc05f4ef16b` (0.27.1); no data migration.

Countywide expansion should add approved county/irrigation-district data, validate
names and completeness, agree a refresh owner, then regenerate the bounded cache.
VTSE edits styles; it cannot supply missing waterways. County AGOL registration or
vector tile publication can follow after the pilot is reviewed, using the saved
style/provenance. No AGOL item or hosted service was created by this increment.
