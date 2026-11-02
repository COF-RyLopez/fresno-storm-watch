"""Build site/data/planning/questions.json: open planning questions derived from public data, by place.

Python 3.12+ with scripts/exposure-requirements.txt (shapely, pyproj). Run by hand when the sources change
(a few minutes; ~150 public ArcGIS queries). Live river-gauge questions are added in the browser.

Generators (each question names the data that raised it and the agency that can answer it):
  dams      high-hazard dams with no public Emergency Action Plan record, or no state-approved failure map
  levees    levee systems FEMA does not accredit (what is behind them, who answers for them)
  sandbags  FEMA 1% flood pockets inside a city, 20+ parcels, no active County sandbag site within 1.5 miles
  power     24/7 County facilities: backup power and fuel (generator records are private, so it asks)
Exposure: per city and county-wide counts used by the Planning panel's exposure sheet.
"""
from __future__ import annotations

import gzip
import json
import re
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from pyproj import Transformer
from shapely.geometry import Point, mapping, shape
from shapely.ops import transform, unary_union

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'site' / 'data' / 'planning' / 'questions.json'
G = 'https://gisprod10.co.fresno.ca.us/server/rest/services'
CITY_LIMITS = f'{G}/Parks_Status_MIL1/MapServer/6'
PARCELS = f'{G}/Hosted/Parcels/FeatureServer/0'
FIRE = f'{G}/Hosted/geoprod_CY_PWP_FIRESTATIONS/FeatureServer/11'
COUNTY_BUILDINGS = 'https://services3.arcgis.com/ibgDyuD2DLBge82s/arcgis/rest/services/County_Building_Footprints_Reader_View_V2/FeatureServer/0'
FEMA = 'https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/USA_Flood_Hazard_Reduced_Set_gdb/FeatureServer/0'
BASINS = 'https://services.arcgis.com/Z7HrzLV55ji5SaOw/arcgis/rest/services/FMFCD_Layers/FeatureServer/11'
DAMS = 'https://services2.arcgis.com/FiaPA4ga0iQKduv3/arcgis/rest/services/NID_v1/FeatureServer/0'
LEVEES = 'https://services2.arcgis.com/FiaPA4ga0iQKduv3/arcgis/rest/services/NLD2_PUBLIC_v1/FeatureServer/14'
INUNDATION = 'https://services.arcgis.com/BLN4oKB0N1YSgvY8/arcgis/rest/services/DSOD_Approved_Inundation_Boundaries_View/FeatureServer/0'
MILE, ACRE = 1609.344, 4046.86
SANDBAG_REACH_MI, MIN_PARCELS, MIN_POCKET_ACRES = 1.5, 20, 5
# 24/7 County operations by building description; anything else is an office that can close in a storm.
CRITICAL = re.compile(r'jail|juvenile|jjc|psychiatric|crisis|sheriff|coroner|animal control|ems\b|dispatch|communications|data center|itsd|central kitchen|public health lab', re.I)
NOT_CRITICAL = re.compile(r'rental|cottage|civil|\bsid\b|court|garage|storage|modular', re.I)
ACRONYMS = re.compile(r'\b(Jjc|Ems|Dbh|Itsd|Dss|Pw)\b')

to_m = Transformer.from_crs(4326, 32611, always_xy=True).transform
to_ll = Transformer.from_crs(32611, 4326, always_xy=True).transform


def get(url: str, data: dict | None = None) -> dict:
    body = urllib.parse.urlencode(data).encode() if data else None
    with urllib.request.urlopen(url, data=body, timeout=90) as r:
        out = json.load(r)
    if 'error' in out:
        raise RuntimeError(f'{url}: {out["error"]}')
    return out


def query(url: str, **params) -> list[dict]:
    """All features as GeoJSON in WGS84, paging past the service's record limit."""
    params = {'f': 'geojson', 'outSR': 4326, 'outFields': '*', 'where': '1=1', **params}
    feats: list[dict] = []
    while True:
        page = get(f'{url}/query', {**params, 'resultOffset': len(feats)})
        feats += page['features']
        if not (page.get('properties', {}).get('exceededTransferLimit') or page.get('exceededTransferLimit')):
            return feats


def metric(f: dict):
    return transform(to_m, shape(f['geometry'])).buffer(0)


def envelope(geom_ll) -> dict:
    x0, y0, x1, y1 = geom_ll.bounds
    return {'geometry': json.dumps({'xmin': x0, 'ymin': y0, 'xmax': x1, 'ymax': y1, 'spatialReference': {'wkid': 4326}}),
            'geometryType': 'esriGeometryEnvelope', 'spatialRel': 'esriSpatialRelIntersects', 'inSR': 4326}


def parcel_count(g) -> int:
    """Parcels touching a metric polygon (simplified to keep the request small)."""
    g4 = transform(to_ll, g.simplify(10))
    rings = [list(map(list, p.exterior.coords)) for p in getattr(g4, 'geoms', [g4])]
    return get(f'{PARCELS}/query', {'where': '1=1', 'geometry': json.dumps({'rings': rings, 'spatialReference': {'wkid': 4326}}),
                                    'geometryType': 'esriGeometryPolygon', 'inSR': 4326, 'spatialRel': 'esriSpatialRelIntersects',
                                    'returnCountOnly': 'true', 'f': 'json'})['count']


def reverse(lon: float, lat: float) -> str:
    url = 'https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/reverseGeocode?' + urllib.parse.urlencode(
        {'location': f'{lon},{lat}', 'f': 'json', 'featureTypes': 'StreetInt'})
    try:
        a = get(url).get('address', {})
    except Exception:  # a name is a convenience; coordinates still place the question
        return ''
    text = (a.get('Match_addr') or a.get('Address') or '').split(', ')[0]
    if text and not text.startswith('Exit '):
        return text
    try:  # freeway ramps and empty answers: fall back to the nearest street name
        street = get(url.replace('StreetInt', 'StreetAddress')).get('address', {}).get('Address', '')
    except Exception:
        return ''
    return re.sub(r'^\d+[-\d]*\s+', '', street)


def norm(name: str) -> str:
    return re.sub(r'[^a-z0-9]', '', re.sub(r'\b(dam|detention|basin|reservoir)\b', '', str(name or '').lower()))


def ll(pt) -> dict:
    lon, lat = to_ll(pt.x, pt.y)
    return {'lon': round(lon, 5), 'lat': round(lat, 5)}


def main() -> None:
    limits = query(CITY_LIMITS, outFields='AGENCY_NAME')
    county_m = unary_union([metric(f) for f in limits])  # the 'County of Fresno' polygon is unincorporated land only
    cities: dict[str, object] = {}
    for f in limits:
        name = f['properties']['AGENCY_NAME']
        if name != 'County of Fresno':
            cities[name] = unary_union([cities[name], metric(f)]) if name in cities else metric(f)
    county_ll = transform(to_ll, county_m)
    print(f'{len(cities)} cities', file=sys.stderr)

    place_of = lambda p: next((n for n, g in cities.items() if g.contains(p)), None)  # noqa: E731
    sandbags = [r for r in json.loads((ROOT / 'site/data/county-sandbags-latest.json').read_text())['rows'] if r.get('geometry') and r['state'] == 'active']
    bag_pts = [(r['name'], r['address'], Point(to_m(r['geometry']['x'], r['geometry']['y']))) for r in sandbags]
    fire = [Point(to_m(*shape(f['geometry']).coords[0])) for f in query(FIRE, outFields='name') if f.get('geometry')]
    buildings = [f for f in query(COUNTY_BUILDINGS, where='isInactive=0', outFields='buildingDescription,addressLine1,city,APN') if f.get('geometry')]

    questions: list[dict] = []
    exposure: dict[str, dict] = {}

    # --- Flood zones inside cities, and sandbag coverage --------------------------------------------
    sfha_all, mod_all = [], []
    for city, g in sorted(cities.items()):
        g_ll = transform(to_ll, g)
        flood = query(FEMA, where="SFHA_TF = 'T' OR ZONE_SUBTY LIKE '%0.2%'", outFields='SFHA_TF', **envelope(g_ll))
        sfha = unary_union([metric(f) for f in flood if f['properties']['SFHA_TF'] == 'T'] or [Point(0, 0).buffer(0)]).intersection(g)
        mod = unary_union([metric(f) for f in flood if f['properties']['SFHA_TF'] != 'T'] or [Point(0, 0).buffer(0)]).intersection(g)
        sfha_all.append(sfha); mod_all.append(mod)
        basins = unary_union([metric(f) for f in query(BASINS, outFields='OBJECTID', **envelope(g_ll)) if f.get('geometry')] or [Point(0, 0).buffer(0)])
        pockets = [p for p in getattr(sfha, 'geoms', [sfha]) if p.area >= MIN_POCKET_ACRES * ACRE]
        parcels_total = 0
        for p in sorted(pockets, key=lambda p: -p.area):
            dry = p.difference(basins)
            if dry.area < 0.5 * p.area:
                continue  # mostly a ponding basin: built to hold water
            n = parcel_count(dry)
            parcels_total += n
            if n < MIN_PARCELS:
                continue
            name, addr, site = min(bag_pts, key=lambda b: p.distance(b[2]))
            miles = p.distance(site) / MILE
            if miles <= SANDBAG_REACH_MI:
                continue
            at = p.representative_point()
            near = reverse(**{k: v for k, v in zip(('lon', 'lat'), to_ll(at.x, at.y))})
            questions.append({
                'id': f'sandbags:{norm(city)}:{round(at.x)}:{round(at.y)}', 'kind': 'sandbags', 'place': city,
                'title': f'Where will residents near {near} ({city}) get sandbags?' if near else f'Where will residents of a {n}-parcel flood pocket in {city} get sandbags?',
                'detail': f'{n} parcels touch the FEMA 1% annual-chance zone here ({round(p.area / ACRE)} acres, outside ponding basins). '
                          f'Nearest active County sandbag site: {name.title()}, {miles:.1f} mi.',
                'owner': f'County OES with {city}', 'source': 'FEMA NFHL · County parcels · County sandbag sites', **ll(at), 'parcels': n})
        exposure[city] = {
            'sqMi': round(g.area / MILE**2, 1), 'sfhaSqMi': round(sfha.area / MILE**2, 2), 'moderateSqMi': round(mod.area / MILE**2, 1),
            'sfhaParcels': parcels_total, 'sandbagSites': sum(g.contains(b[2]) for b in bag_pts), 'fireStations': sum(g.contains(p) for p in fire),
            'countyBuildingsInSfha': sum(sfha.contains(metric(b).representative_point()) for b in buildings),
        }
        print(f'{city}: {exposure[city]}', file=sys.stderr)
    sfha_cities = unary_union(sfha_all)

    # --- Dams ---------------------------------------------------------------------------------------
    dams = query(DAMS, where="STATE='California' AND COUNTYSTATE LIKE 'Fresno%'",
                 outFields='NAME,FEDERAL_ID,HAZARD_POTENTIAL,EAP_PREPARED,EAP_LAST_REV_DATE,FED_AGENCY_OWNERS,FED_AGENCY_OPERATIONS,PRIMARY_OWNER_TYPE')
    mapped = {norm(f['properties'].get('DamName')) for f in query(INUNDATION, outFields='DamName', returnGeometry='false', **envelope(county_ll))}
    for f in dams:
        a = f['properties']
        if a['HAZARD_POTENTIAL'] != 'High' or not f.get('geometry'):
            continue
        at = Point(to_m(*shape(f['geometry']).coords[0]))
        fed = (a.get('FED_AGENCY_OPERATIONS') or a.get('FED_AGENCY_OWNERS') or '').strip()
        owner = fed or f'Dam owner ({a.get("PRIMARY_OWNER_TYPE") or "type not listed"}) · Cal DWR Division of Safety of Dams'
        dam = a['NAME'].title() if re.search(r'\b(dam|dike|dikes)\b', a['NAME'], re.I) else a['NAME'].title() + ' Dam'
        base = {'kind': 'dams', 'place': place_of(at) or 'Fresno County', 'owner': owner, 'source': 'USACE National Inventory of Dams · Cal OES DSOD inundation maps',
                **ll(at), 'dam': a['NAME'], 'nid': a['FEDERAL_ID'],
                # the browser names the operator with water-operators.js damOperator (federal operator or hydro licensee)
                'nidAttributes': {k: a.get(k) for k in ('NAME', 'FED_AGENCY_OPERATIONS', 'PRIMARY_OWNER_TYPE')}}
        if a.get('EAP_PREPARED') != 'Yes':
            questions.append({**base, 'id': f'dams:eap:{a["FEDERAL_ID"]}', 'title': f'Does the County hold the current Emergency Action Plan for {dam}?',
                              'detail': 'High hazard potential (failure would likely cost lives). The public dam inventory does not report an Emergency Action Plan; '
                                        'confirm one exists, its revision date, and who calls the County if the dam is in trouble.'})
        if norm(a['NAME']) not in mapped:
            questions.append({**base, 'id': f'dams:map:{a["FEDERAL_ID"]}', 'title': f'Where would water go if {dam} failed?',
                              'detail': ('Federal dam: not in the state-approved inundation layer. Request the failure inundation map from ' + fed + '.') if fed else
                                        'High hazard potential and no state-approved inundation map found under this name. Confirm the map with the owner or DSOD.'})

    # --- Levees -------------------------------------------------------------------------------------
    for f in query(LEVEES, where="COUNTIES LIKE '%Fresno%'", outFields='SYSTEM_ID,SYSTEM_NAME,SPONSORS,RESPONSIBLE_ORGANIZATION,FEMA_ACCREDITATION_RATING,FLOOD_SOURCES'):
        a = f['properties']
        if a['FEMA_ACCREDITATION_RATING'] == 'Accredited Levee System' or not f.get('geometry'):
            continue
        line = transform(to_m, shape(f['geometry']))
        line = max(getattr(line, 'geoms', [line]), key=lambda g: g.length)  # longest part of a multi-part system
        at = line.interpolate(0.5, normalized=True)
        sponsors = [s.strip() for s in str(a.get('SPONSORS') or '').split(',') if s.strip() and s.strip().lower() not in ('undefined', 'unknown')]
        source = (a.get('FLOOD_SOURCES') or '').strip()
        q = {'kind': 'levees', 'place': place_of(at) or 'Fresno County', 'source': 'USACE National Levee Database', **ll(at), 'levee': a['SYSTEM_NAME']}
        if sponsors:
            questions.append({**q, 'id': f'levees:behind:{a["SYSTEM_ID"]}', 'owner': ', '.join(sponsors),
                              'title': f'What does {a["SYSTEM_NAME"]} protect, and who patrols it in high water?',
                              'detail': f'FEMA does not accredit this levee system, so maps treat land behind it as unprotected. '
                                        f'Flood source: {source or "not listed"}. Responsible organization: {a.get("RESPONSIBLE_ORGANIZATION") or "not listed"}.'})
        else:
            questions.append({**q, 'id': f'levees:who:{a["SYSTEM_ID"]}', 'owner': a.get('RESPONSIBLE_ORGANIZATION') or 'Not listed',
                              'title': f'Who answers for {a["SYSTEM_NAME"]}?',
                              'detail': f'The levee database lists no sponsor, and FEMA does not accredit it. Flood source: {source or "not listed"}. '
                                        'Find the owner and who to call when water rises against it.'})

    # --- Power: 24/7 County facilities --------------------------------------------------------------
    seen: set[str] = set()
    for b in buildings:
        a = b['properties']
        desc = a.get('buildingDescription') or ''
        site_key = (a.get('addressLine1') or desc).upper().strip()
        if not CRITICAL.search(desc) or NOT_CRITICAL.search(desc) or site_key in seen:
            continue
        seen.add(site_key)
        at = metric(b).representative_point()
        if not county_m.contains(at):
            continue
        zone = ' It sits in the FEMA 1% flood zone.' if sfha_cities.contains(at) else ''
        questions.append({'id': f'power:{norm(site_key)}', 'kind': 'power', 'place': place_of(at) or 'Fresno County',
                          'title': f'Can {ACRONYMS.sub(lambda m: m[1].upper(), desc.title())} run 72 hours without grid power?',
                          'detail': f'24/7 County operation at {a.get("addressLine1")}, {a.get("city")}. Generator and fuel records are private; '
                                    f'confirm backup power, fuel on hand and who refuels it during a storm or shutoff.{zone}',
                          'owner': 'County General Services · Facility Services', 'source': 'County Buildings inventory', **ll(at)})

    county_sfha = sum(e['sfhaSqMi'] for e in exposure.values())
    exposure['Fresno County'] = {
        'sqMi': round(county_m.area / MILE**2), 'sfhaSqMi': round(county_sfha, 2), 'moderateSqMi': round(sum(e['moderateSqMi'] for e in exposure.values()), 1),
        'sfhaParcels': sum(e['sfhaParcels'] for e in exposure.values()), 'sandbagSites': len(bag_pts), 'fireStations': len(fire),
        'countyBuildingsInSfha': sum(e['countyBuildingsInSfha'] for e in exposure.values()),
        'highHazardDams': sum(f['properties']['HAZARD_POTENTIAL'] == 'High' for f in dams),
        'leveeSystems': sum(1 for q in questions if q['kind'] == 'levees'), 'note': 'Flood-zone figures cover incorporated cities only.'}
    payload = {'schemaVersion': 1, 'generatedAt': datetime.now(timezone.utc).isoformat(timespec='seconds'),
               'places': ['Fresno County', *sorted(cities)], 'exposure': exposure, 'questions': questions,
               'rules': {'sandbagReachMiles': SANDBAG_REACH_MI, 'minParcels': MIN_PARCELS, 'minPocketAcres': MIN_POCKET_ACRES}}
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, indent=1) + '\n', encoding='utf-8')
    counts = {k: sum(q['kind'] == k for q in questions) for k in ('dams', 'levees', 'sandbags', 'power')}
    print(f'{len(questions)} questions {counts} → {OUT.relative_to(ROOT)}', file=sys.stderr)


if __name__ == '__main__':
    main()
