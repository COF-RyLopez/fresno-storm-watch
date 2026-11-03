"""Build site/data/planning/questions.json: open planning questions derived from public data, by place.

Python 3.12+ with scripts/exposure-requirements.txt (shapely, pyproj). Runs in the Pages workflow with --published:
the deployed copy is reused while under a day old, otherwise rebuilt (~1 minute, ~150 public ArcGIS queries); a failed
rebuild keeps the last good copy. Live river-gauge and snow-equipment questions are added in the browser.

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
from shapely.geometry import LinearRing, Point, mapping, shape
from shapely.geometry.polygon import orient
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
YARDS = f'{G}/CY_FRESNO/RDYARD/MapServer/0'
LEVEES = 'https://services2.arcgis.com/FiaPA4ga0iQKduv3/arcgis/rest/services/NLD2_PUBLIC_v1/FeatureServer/14'
INUNDATION = 'https://services.arcgis.com/BLN4oKB0N1YSgvY8/arcgis/rest/services/DSOD_Approved_Inundation_Boundaries_View/FeatureServer/0'
PUBLISHED = 'https://cof-rylopez.github.io/fresno-storm-watch/data/planning/questions.json'
REBUILD_AFTER_S = 24 * 3600
MILE, ACRE = 1609.344, 4046.86
SANDBAG_REACH_MI, MIN_PARCELS, MIN_POCKET_ACRES = 1.5, 20, 5
# 24/7 County operations by building description; anything else is an office that can close in a storm.
CRITICAL = re.compile(r'jail|juvenile|jjc|psychiatric|crisis|sheriff|coroner|animal control|ems\b|dispatch|communications|data center|itsd|central kitchen|public health lab', re.I)
NOT_CRITICAL = re.compile(r'rental|cottage|civil|\bsid\b|court|garage|storage|modular', re.I)
# Sites offered as nearby sandbag options: County buildings minus secure or 24/7 care sites the public cannot use.
NOT_A_SITE = re.compile(r'^area \d|jail|court|juvenile|jjc|psychiatric|crisis|coroner|detention|sheriff|modular|storage|plant|garage|annex', re.I)
NEARBY_MI = 1.5
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


def pocket_parcels(g) -> dict[str, list]:
    """Parcels touching a metric polygon: {apn: rings} in lon/lat, rounded to ~1 m and simplified for display. The shapes ship
    with the question so the browser never queries the County server (County networks can block that from a public page)."""
    g4 = transform(to_ll, g.simplify(10))
    rings = [list(map(list, p.exterior.coords)) for p in getattr(g4, 'geoms', [g4])]
    r = get(f'{PARCELS}/query', {'where': '1=1', 'geometry': json.dumps({'rings': rings, 'spatialReference': {'wkid': 4326}}),
                                 'geometryType': 'esriGeometryPolygon', 'inSR': 4326, 'spatialRel': 'esriSpatialRelIntersects',
                                 'outFields': 'apn', 'returnGeometry': 'true', 'outSR': 4326, 'f': 'json'})
    if r.get('exceededTransferLimit'):
        raise RuntimeError('Flood pocket has more parcels than one parcel query returns')
    out: dict[str, list] = {}
    for f in r['features']:
        apn = f['attributes'].get('apn')
        if apn:
            out.setdefault(str(apn), []).extend(compact_ring(ring) for ring in (f.get('geometry') or {}).get('rings', []))
    return dict(sorted(out.items()))


def compact_ring(ring: list) -> list:
    """A ring rounded to 5 decimals (~1 m) and simplified within ~1 m; tiny rings are kept as they are."""
    small = LinearRing(ring).simplify(0.000008)
    coords = list(small.coords) if len(small.coords) >= 4 else ring
    return [[round(x, 5), round(y, 5)] for x, y, *_ in coords]


def dump(data: dict) -> str:
    return json.dumps(data, separators=(',', ':')) + '\n'  # compact: parcel shapes would triple the file indented


def pocket_id(city: str, apns: list[str], previous: list[dict], taken: set[str]) -> str:
    """Keep a flood pocket's id while it is mostly the same parcels (an answer stays attached when FEMA or parcel edits
    move its edge); a new pocket is named by its lowest APN."""
    mine = set(apns)
    best = max((q for q in previous if q['id'] not in taken and q.get('apns')),
               key=lambda q: len(mine & set(q['apns'])) / len(mine | set(q['apns'])), default=None)
    if best and len(mine & set(best['apns'])) / len(mine | set(best['apns'])) >= 0.5:
        return best['id']
    return f'sandbags:{norm(city)}:{apns[0]}'


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


def rings(g) -> dict:
    """ArcGIS polygon JSON in WGS84 (outer rings clockwise), simplified to ~15 m and rounded to ~1 m."""
    out = []
    for poly in getattr(g.simplify(15), 'geoms', [g.simplify(15)]):
        if poly.is_empty or poly.geom_type != 'Polygon':
            continue
        poly = orient(transform(to_ll, poly), sign=-1.0)
        out += [[[round(x, 5), round(y, 5)] for x, y in ring.coords] for ring in [poly.exterior, *poly.interiors]]
    return {'rings': out}


def nearby_candidates(buildings: list[dict], fire_rows: list[dict]) -> list[tuple]:
    """(name, kind, address, metric point) for County buildings the public can use, road yards and fire stations."""
    out, seen = [], set()
    for b in buildings:
        a = b['properties']
        desc, addr = (a.get('buildingDescription') or '').strip(), (a.get('addressLine1') or '').strip()
        if not desc or NOT_A_SITE.search(desc) or addr.upper() in seen:
            continue
        seen.add(addr.upper())
        out.append((ACRONYMS.sub(lambda m: m[1].upper(), desc.title()), 'County building', f"{addr}, {a.get('city') or ''}".strip(', '), metric(b).representative_point()))
    for f in query(YARDS, outFields='RDYARD_NM,RDYARD_ADDR1'):
        a = f['properties']
        out.append((a['RDYARD_NM'].title(), 'County road yard', a.get('RDYARD_ADDR1') or '', Point(to_m(*shape(f['geometry']).coords[0]))))
    for f in fire_rows:
        a = f['properties']
        juris = (a.get('jurisdicti') or '').strip()
        city_owned = (a.get('facility') or '').strip().upper() == 'CITY'  # CITY / CO (county district) / VOL (volunteer)
        out.append((f"Fire Station {a.get('station_id') or ''} · {juris}".strip(), 'Fire station (City-owned)' if city_owned else 'Fire station', '', Point(to_m(*shape(f['geometry']).coords[0]))))
    return out


def nearby(g, candidates: list[tuple]) -> list[dict]:
    """Closest options to a flood pocket, a few of each kind so fire stations and yards are not crowded out by offices:
    up to 5 County buildings and 2 fire stations within NEARBY_MI, and the nearest road yard within 3 mi; never fewer than 3."""
    ranked = sorted(((g.distance(pt) / MILE, name, kind, addr, pt) for name, kind, addr, pt in candidates), key=lambda r: r[0])
    quota = {'County building': (5, NEARBY_MI), 'County road yard': (1, 3.0), 'Fire station': (2, NEARBY_MI)}
    keep, used = [], {}
    for r in ranked:
        group = 'Fire station' if r[2].startswith('Fire station') else r[2]
        cap, reach = quota[group]
        if r[0] <= reach and used.get(group, 0) < cap:
            keep.append(r); used[group] = used.get(group, 0) + 1
    if len(keep) < 3:
        keep = ranked[:3]
    return [{'name': name, 'kind': kind, 'address': addr, 'miles': round(d, 2), **ll(pt)} for d, name, kind, addr, pt in sorted(keep, key=lambda r: r[0])]


def ll(pt) -> dict:
    lon, lat = to_ll(pt.x, pt.y)
    return {'lon': round(lon, 5), 'lat': round(lat, 5)}


def main(previous: dict | None = None) -> None:
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
    fire_rows = [f for f in query(FIRE, outFields='name,station_id,jurisdicti,facility') if f.get('geometry')]
    fire = [Point(to_m(*shape(f['geometry']).coords[0])) for f in fire_rows]
    buildings = [f for f in query(COUNTY_BUILDINGS, where='isInactive=0', outFields='buildingDescription,addressLine1,city,APN') if f.get('geometry')]

    questions: list[dict] = []
    exposure: dict[str, dict] = {}
    candidates = nearby_candidates(buildings, fire_rows)
    old_pockets = [q for q in (previous or {}).get('questions', []) if q.get('kind') == 'sandbags']
    taken: set[str] = set()

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
            shapes = pocket_parcels(dry)
            apns, n = list(shapes), len(shapes)
            parcels_total += n
            if n < MIN_PARCELS:
                continue
            name, addr, site = min(bag_pts, key=lambda b: p.distance(b[2]))
            miles = p.distance(site) / MILE
            if miles <= SANDBAG_REACH_MI:
                continue
            at = p.representative_point()
            near = reverse(**{k: v for k, v in zip(('lon', 'lat'), to_ll(at.x, at.y))})
            qid = pocket_id(city, apns, old_pockets, taken)
            taken.add(qid)
            questions.append({
                'id': qid, 'kind': 'sandbags', 'place': city, 'apns': apns,
                'title': f'Where will residents near {near} ({city}) get sandbags?' if near else f'Where will residents of a {n}-parcel flood pocket in {city} get sandbags?',
                'detail': f'{n} parcels touch the FEMA 1% annual-chance zone here ({round(p.area / ACRE)} acres, outside ponding basins). '
                          f'Nearest active County sandbag site: {name.title()}, {miles:.1f} mi.',
                'owner': f'County OES with {city}', 'source': 'FEMA NFHL · County parcels · County sandbag sites', **ll(at), 'parcels': n,
                # The pocket itself (outside ponding basins), so the panel can highlight its parcels, and the closest options.
                'geometry': rings(dry), 'nearby': nearby(dry, candidates), 'parcelRings': list(shapes.values())})
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
    counts = {k: sum(q['kind'] == k for q in questions) for k in ('dams', 'levees', 'sandbags', 'power')}
    # A source that silently returns nothing would quietly drop a whole topic; treat it as a failed build instead.
    empty = [k for k in ('dams', 'levees', 'power') if not counts[k]]
    if empty:
        raise RuntimeError(f'No {", ".join(empty)} questions built; a source probably returned nothing')
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(dump(payload), encoding='utf-8')
    print(f'{len(questions)} questions {counts} → {OUT.relative_to(ROOT)}', file=sys.stderr)


def usable(data, now: float) -> float | None:
    """Age in seconds of a questions file that can be served as is, else None (wrong shape, empty, or future-dated)."""
    try:
        built = datetime.fromisoformat(data['generatedAt']).timestamp()
    except (KeyError, TypeError, ValueError):
        return None
    if data.get('schemaVersion') != 1 or not data.get('questions') or built > now + 120:
        return None
    return now - built


def published() -> dict | None:
    try:
        with urllib.request.urlopen(f'{PUBLISHED}?check={int(datetime.now().timestamp())}', timeout=30) as r:
            return json.load(r)
    except Exception as error:  # first deploy, or Pages unreachable: rebuild instead
        print(f'Published planning questions unavailable: {error}', file=sys.stderr)
        return None


def run(argv: list[str], fetch=published, build=main, now: float | None = None) -> str:
    """--published: serve the newer of the deployed and committed copies while it is under a day old; otherwise rebuild,
    keeping the newest good copy on failure. Newest wins so a freshly committed build (new fields) is never replaced by an
    older deployed one."""
    now = now if now is not None else datetime.now(timezone.utc).timestamp()
    prior = fetch() if '--published' in argv else None
    local = json.loads(OUT.read_text(encoding='utf-8')) if OUT.exists() else None
    fresh = [d for d in (prior, local) if d and (age := usable(d, now)) is not None and age < REBUILD_AFTER_S]
    if '--published' in argv and fresh:
        best = max(fresh, key=lambda d: d['generatedAt'])
        OUT.write_text(dump(best), encoding='utf-8')
        print(f'Reused {"published" if best is prior else "committed"} planning questions ({usable(best, now) / 3600:.1f} h old)', file=sys.stderr)
        return 'reused'
    try:
        build(prior or local)  # the last copy carries the flood-pocket ids answers are attached to
        return 'built'
    except Exception as error:
        # Optional feed: serve the newest good copy (published, else the committed one) and say so in the run.
        keep = max((d for d in (prior, local) if d and usable(d, now) is not None), key=lambda d: d['generatedAt'], default=None)
        if keep:
            OUT.write_text(dump(keep), encoding='utf-8')
        print(f'::warning title=Planning questions not rebuilt::{type(error).__name__}: {error}; serving the copy built {keep["generatedAt"] if keep else "never"}')
        return 'kept'


if __name__ == '__main__':
    run(sys.argv)
