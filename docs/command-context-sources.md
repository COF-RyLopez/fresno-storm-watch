# Command reference boundaries

`node --use-system-ca scripts/collect-command-context.mjs` refreshes `site/data/command-context.json`. The guarded module exports its collector and validators for offline tests. `--published` can reuse a validated public Pages snapshot younger than 24 hours, preserving its original timestamp. A fresh collection failure retains the complete validated local snapshot and its source timestamps, with an explicit warning. It never publishes a successful timestamp for partial source results.

The verified November 19, 2026 acquisition contains **16 incorporated-place features and 50 fire perimeter features**: 46 CAL FIRE historical records and four NIFC 2026 records. Counts are acquisition results, not expected constants. The initial uncompressed JSON is about 1.50 MB.

## Selection and display geometry

All three polygon queries use the existing `site/data/reported-locations/county.geojson` boundary, `geometryType=esriGeometryPolygon`, `inSR=4326`, and `spatialRel=esriSpatialRelIntersects`. Selection retains each whole source polygon; it does not clip polygons or allocate acreage to Fresno County. WGS84 output is requested with `outSR=4326`, `maxAllowableOffset=0.0003` (roughly 30 m), and `geometryPrecision=5`. This is display generalization, unsuitable for parcel or engineering measurements.

If the service generalization returns collapsed/invalid rings, the collector rejects that response and reacquires the complete layer without the generalization offset, at seven decimal places. The November 19 CAL FIRE request needed this fallback after a FIRESTONE ring collapsed. The bundle warning records this; no rings or fire records were silently dropped. CRS, nonempty coverage, finite coordinate bounds, closed/nonzero rings, stable identifiers, source dates and query transfer limits are checked. These structural checks do not constitute a survey or a complete polygon-topology certification.

## Public sources

| Source | Layer and selection | Coverage and limits |
| --- | --- | --- |
| U.S. Census Bureau | [TIGERweb Incorporated Places, layer 4](https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Places_CouSub_ConCity_SubMCD/MapServer/4), `STATE='06'` plus county intersection | Service metadata: **January 1, 2026 vintage**. Sixteen polygons intersect the county boundary, including **Avenal** as neighboring context. This is not a claim that all selected incorporated places belong to Fresno County. Names use `BASENAME` with `NAME` fallback; identifiers use `GEOID`. |
| CAL FIRE FRAP | [California Historical Fire Perimeters, layer 0](https://services1.arcgis.com/jUJYIo9tSA7EHvfZ/arcgis/rest/services/California_Historic_Fire_Perimeters/FeatureServer/0), `YEAR_ >= 2024` plus county intersection | [Authoritative CAL FIRE item](https://www.arcgis.com/home/item.html?id=c3c10388e3b24cec8a954ba10458039d), `firep25_1`, released April 2026, covering fires through 2025. Returns 46 records from 2024–25. Historical inventory is incomplete and uses minimum collection criteria. A perimeter may include unburned islands; it is not burn severity or debris-flow inundation. |
| National Interagency Fire Center | [WFIGS 2026 Interagency Fire Perimeters to Date, layer 0](https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Interagency_Perimeters_YearToDate/FeatureServer/0), `attr_IncidentTypeCategory='WF'` plus county intersection | [Authoritative NIFC item](https://www.arcgis.com/home/item.html?id=7c81ab78d8464e5c9771e49b64e834e9), owner `NIFC_Authoritative`. Service selects 2026 discovery dates, valid/unquarantined IRWIN incidents and public/approved/visible polygons. No falloff rule. Refreshed every five minutes; source changes can take 15 minutes. **Perimeters are unavailable for some incidents.** Returns STONEY CREEK RD TOLLHOUSE, O30, HOG and NORTH. Daily perimeters are provisional; even a final perimeter is reference geometry. |
| U.S. Geological Survey | [Postfire assessment locations, layer 0](https://earthquake.usgs.gov/arcgis/rest/services/ls/pwfdf/MapServer/0), separate `Fire_ID='bas2024'` and `Fire_ID='Garnet_2025-08-24_v1.0'` queries | Historical assessment metadata only, attached to Basin and Garnet fire polygons. No modeled basin/stream polygons are bundled. See limitations below. |

Each source entry records publisher, exact layer URL, coverage, and ISO `checkedAt`. Feature IDs prefer source IRWIN incident IDs, then GlobalID, normalized for braces/case. Repeated identities within a provider reject the collection. A shared incident ID across providers is retained once with a warning; unrelated incidents sharing a name remain separate.

CAL FIRE `ALARM_DATE` becomes `discovered`; its `CONT_DATE` becomes `updated` as a historical containment date, not a recent geometry edit. NIFC uses `attr_FireDiscoveryDateTime` and `poly_DateCurrent`. Missing dates remain null.

Source calendar dates are displayed in UTC to preserve dates encoded at midnight UTC. Historical containment dates are explicitly labeled as containment dates. Gauge observations and forecasts retain their actual timestamps and Pacific time zone.

## Historical assessment context

- **Basin:** `bas2024`, v1.0, assessment July 29, 2024. Selected design storm **30 mm/h peak 15-minute intensity**, equivalent to 7.5 mm accumulated over 15 minutes. [ScienceBase archive](https://www.sciencebase.gov/catalog/item/68c492d1d4be021a00d8cc38).
- **Garnet:** `Garnet_2025-08-24_v1.0`, v1.0, assessment September 24, 2025. Selected design storm **34 mm/h peak 15-minute intensity**, equivalent to 8.5 mm accumulated over 15 minutes. [ScienceBase archive](https://www.sciencebase.gov/catalog/item/68d406ced4be023091a48085).

These differ in rainfall scenario and must not be represented as uniform hazard conditions. The assessment note is **“Historical immediate-postfire model, not current danger.”** USGS states that [hazard assessments describe immediate postfire conditions](https://www.usgs.gov/programs/landslide-hazards/hazard-assessment-faq-frequently-asked-questions), and susceptibility changes as soil and vegetation recover. They do not map downstream runout or inundation. Hourly/daily rainfall totals cannot establish that a modeled 15-minute intensity has been reached.

Metadata conflicts are preserved as source qualifications: the Basin USGS archive gives a June 24, 2024 start date while CAL FIRE gives June 26; the Garnet ScienceBase title/metadata says August 4, 2025 while the live USGS incident identifier/start date and CAL FIRE incident agree on August 24. Display fire dates use the perimeter source rather than silently substituting archive dates.

No private email, attachment, partner impact matrix, tier, or event-specific threshold is included. A focused search of public NWS Hanford pages did not locate a public equivalent of the November 19 partner briefing; this does not establish that none exists. Current warnings and forecasts remain separate live products.

## Verification

`node --test tests/command-context-collector.test.mjs` checks offline fixtures for valid normalization, CRS and geometry rejection, duplicate IDs, missing dates, empty/incomplete responses, provider failure, whole-snapshot fallback, source vintage/scenario identity, and explicit precision fallback. Live output is validated before atomic replacement. No source permission or server setting is modified.
