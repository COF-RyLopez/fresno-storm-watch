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
