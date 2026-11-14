# Terrain source check — 14 November 2026

## What is available now

The DWR [2021 San Joaquin Valley Zone 4 image service](https://gis.water.ca.gov/arcgisimg/rest/services/elevation/SanJoaquinValley_Zone4_2021_LIDAR/ImageServer) is a candidate for detailed local terrain. Its JSON metadata reports one-US-survey-foot cells, NAD83(2011) California State Plane IV (US feet), and NAVD88 / Geoid18 elevations in US feet. Cell size is not vertical accuracy.

Four live identify queries on 14 November 2026 used longitude/latitude inputs (EPSG:4326), rasterFunction=None and returnCatalogItems=true:

| Test location | Longitude, latitude | Response |
|---|---|---|
| Friant / Millerton vicinity | -119.705, 37.001 | Terrain value; primary tile s63550w22475 |
| San Joaquin near Highway 41 | -119.791, 36.863 | Terrain value; primary tile s63300w21975 |
| Pine Flat Dam | -119.325, 36.833 | NoData; no catalog tile |
| Kings River near Piedra | -119.418, 36.808 | NoData; no catalog tile |

These are point checks, not coverage certification for a reservoir or watershed. Terrain samples are not measured water levels. NoData is unknown, never zero elevation. Public request/result evidence is in `docs/terrain-coverage-2026-11-14.json`.

The current [DWR elevation service directory](https://gis.water.ca.gov/arcgisimg/rest/services/elevation) does not establish a newer publicly delivered Fresno-wide dataset. A newer service publication date would not by itself establish a newer acquisition date.

## Newer Kings River work to request

KRCD's [September 2025 topobathymetric LiDAR RFP](https://krcd.org/wp-content/uploads/2025/09/RFP_LiDAR_FINAL_2025-09-04.pdf) proposes coverage from Pine Flat Dam along the Kings River system toward Mendota Pool and Empire Weir No. 2. Expected products include classified LAS, bare-earth DEM, DSM and survey metadata. The target completion date is not proof of delivery. No public deliverable link was found in the current KRCD resources, documents, RFP and annual-report pages checked.

The RFP names Sonja Thiede, GISP, sthiede@krcd.org, as the GIS contact. The general [KRCD contact page](https://krcd.org/contact/) provides an alternative routing point. DWR's published elevation-service contact is gis@water.ca.gov.

### Draft request — not sent

Subject: Fresno County F.R.O.G. terrain data request — Kings River / Friant

Hello,

Fresno County is evaluating terrain for its F.R.O.G. emergency planning maps, initially around Pine Flat and Millerton and their downstream river corridors.

Could you confirm whether the Kings River topobathymetric survey commissioned in 2025 has been delivered, and the most recent DWR terrain available for these reaches? Please provide a download or approved data-sharing route for the bare-earth DEM, classified point cloud, bathymetry and breaklines where available, with footprint/tile indexes and metadata.

We need acquisition dates, horizontal and vertical references and units, geoid model, accuracy/quality reports, water and NoData masks, limitations, and permitted public-display/derived-tile use. Please distinguish preliminary products from accepted deliveries and identify any gaps near Pine Flat Dam and Piedra.

Our initial use is terrain reference in an emergency planning application. Any hydraulic model use would undergo separate technical validation. Thank you for directing us to the responsible data steward if necessary.

## Integration decision

Do not replace the operational terrain with unverified mosaics. First obtain coverage and metadata, inspect terrain along dam/levee/bridge controls, preserve water/NoData gaps, transform units and vertical references explicitly, and verify samples against source elevations. Publish a versioned numeric COG for analysis and a derived tiled terrain product for rendering, retaining provenance. Any mixed-source coverage must identify its boundaries and dates.

The present MapLibre 3D pilot continues using attributed Mapzen/Tilezen Terrarium reference terrain. This basemap consistency release does not add DWR/KRCD elevation, infer bathymetry, animate pool height or model floodwater.
