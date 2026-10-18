# Public power source contract

Checked 2026-10-18. Official publishers: PG&E and Southern California Edison.
Source discovery, fields and cadence are in [source-provenance.json](source-provenance.json)
and [operating notes](../planning.html#power). The `power-latest.json` snapshot
contains acquisition timestamps, source URLs, stable record keys and query accounting.

| Source | Public GIS endpoint | Selected layers |
| --- | --- | --- |
| PG&E PSPS | https://ags.pge.esriemcs.com/arcgis/rest/services/43/psps_public/MapServer | 1 |
| PG&E current outages | https://ags.pge.esriemcs.com/arcgis/rest/services/43/outages/MapServer | 2, 3, 4, 5, 7, 8 |
| SCE PSPS | https://sce-outage-ags.esriemcs.com/arcgis/rest/services/43/psps/MapServer | 0, 1 |
| SCE current outages | https://sce-outage-ags.esriemcs.com/arcgis/rest/services/43/outage/MapServer | 0 |

Public map data; utility copyright and website terms apply. No separate open-data
license or service-level guarantee was identified. Official utility map links
remain with every record. This app does not claim ownership of utility data.

Queries: `where=1=1`, county envelope in EPSG:4326, `esriSpatialRelIntersects`,
`returnIdsOnly=true`, then batches of 100 IDs with an explicit field allowlist,
`returnGeometry=true`, `outSR=4326`. Actual county intersection is checked locally
against the existing county boundary, including holes and boundary touches.
The collector rejects incomplete inventories or invalid geometry instead of
silently dropping records. Feed-level error retains the preceding dated snapshot.

No customer-account, Medical Baseline, meter, street-address lookup, subscription,
utility employee or partner-only fields are requested. Customer estimates are
record-level and are not summed as Fresno County totals.
