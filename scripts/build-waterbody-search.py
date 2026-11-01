"""Build named lake/reservoir search with complete publisher outlines, not points.

Uses the validated, ignored waterbody acquisition batches from 0.33.0. No new
network queries, private records or credentials. Requires requirements-waterways.txt.
"""
from __future__ import annotations

from collections import defaultdict
import hashlib
import json
import logging
from pathlib import Path
import runpy
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
VERSION = 'waterbodies-v0.34.0'
LOG = logging.getLogger('waterbody-search')


def build_groups(features: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], dict[str, Any], dict[str, int]]:
    """Group matching GNIS identities, preserving holes, multipart shapes and full extent."""
    from shapely.geometry import shape
    from shapely.geometry.polygon import orient
    from shapely.ops import unary_union
    groups: dict[str, Any] = {}
    counts = {'input': len(features), 'otherFeatureType': 0, 'unnamed': 0, 'accepted': 0}
    seen = set()
    for feature in features:
        p = feature['properties']
        source_id = p.get('id3dhp')
        if not source_id or source_id in seen:
            raise ValueError('Missing / duplicate source waterbody ID')
        seen.add(source_id)
        if p['featuretype'] != 3:  # Publisher Lake class includes mapped reservoirs.
            counts['otherFeatureType'] += 1
            continue
        name = ' '.join((p.get('gnisidlabel') or '').split())
        if not name:
            counts['unnamed'] += 1
            continue
        geom = shape(feature['geometry'])
        if geom.geom_type not in ('Polygon', 'MultiPolygon') or geom.is_empty or not geom.is_valid:
            raise ValueError('Invalid named lake polygon; no automatic repair')
        for polygon in ([geom] if geom.geom_type == 'Polygon' else geom.geoms):
            for ring in [polygon.exterior, *polygon.interiors]:
                for xy in ring.coords:
                    if len(xy) != 2 or not (-180 <= xy[0] <= 180 and -90 <= xy[1] <= 90):
                        raise ValueError('Expected WGS84 XY waterbody coordinates')
        gnis = p.get('gnisid')
        identity = 'gnis:' + str(gnis) if isinstance(gnis, int) and gnis > 0 else 'source:' + source_id
        group = groups.setdefault(identity, {'names': set(), 'ids': [], 'polygons': []})
        group['names'].add(name)
        group['ids'].append(source_id)
        group['polygons'].append(geom)
        counts['accepted'] += 1
    entries, geometries = [], {}
    for identity, group in sorted(groups.items()):
        geometry = unary_union(group['polygons'])
        if not geometry.is_valid or geometry.geom_type not in ('Polygon', 'MultiPolygon'):
            raise ValueError('Invalid combined lake outline')
        rings = []
        for polygon in ([geometry] if geometry.geom_type == 'Polygon' else geometry.geoms):
            polygon = orient(polygon, sign=-1.0)  # Esri exterior CW, holes CCW.
            rings.extend([list(polygon.exterior.coords), *[list(r.coords) for r in polygon.interiors]])
        digest = hashlib.sha256(identity.encode()).hexdigest()[:20]
        key = 'waterbody:' + digest
        name, *aliases = sorted(group['names'])
        entries.append({'key': key, 'name': name, 'kind': 'waterbody', 'aliases': [*aliases, identity.split(':', 1)[1], *([name[:-5]] if name.endswith(' Lake') else []), *([name[5:]] if name.startswith('Lake ') else [])],
                        'identity': identity, 'sourceIds': sorted(group['ids']),
                        'segments': len(group['ids']), 'bounds': list(geometry.bounds), 'shard': digest[:2] + '.json',
                        'detail': f"Full published lake / reservoir outline · {len(group['ids'])} source polygon(s)",
                        'reference': 'Complete publisher reference footprint, including all parts and holes; portions may extend outside Fresno County or the clipped basemap. Not a current shoreline, water level, flood extent or verified operating boundary. Nearby references use this footprint including its interior, not just the reporting point or shore.'})
        geometries[key] = {'rings': rings, 'spatialReference': {'wkid': 4326}}
    return entries, geometries, counts


def main() -> None:
    """Check exact raw-source hash and identity inventory before generating public shards."""
    helper = runpy.run_path(str(ROOT / 'scripts/export-waterways.py'))
    boundary = ROOT / 'site/data/counties.geojson'
    _, spatial = helper['county_filter'](boundary)
    manifest = json.loads((ROOT / 'work/waterbodies-county/manifest.json').read_text(encoding='utf-8'))
    if hashlib.sha256(boundary.read_bytes()).hexdigest() != manifest['boundarySha256']:
        raise RuntimeError('County boundary changed; reacquire waterbodies first')
    fields = ['OBJECTID', 'id3dhp', 'gnisid', 'gnisidlabel', 'featuretype', 'featuretypelabel', 'featuredate', 'areasqkm']
    cache_key = hashlib.sha256((manifest['inventorySha256'] + ','.join(fields) + json.dumps(spatial)).encode()).hexdigest()[:16]
    paths = sorted((ROOT / 'work/waterbodies-county/batches').glob(cache_key + '-*.json'), key=lambda p: int(p.stem.split('-')[-1]))
    features = [f for path in paths for f in json.loads(path.read_text(encoding='utf-8'))['features']]
    if len(features) != manifest['accepted'] or hashlib.sha256(json.dumps(features, sort_keys=True).encode()).hexdigest() != manifest['sourceSha256']:
        raise RuntimeError('Raw waterbody snapshot does not match the validated source')
    ids = sorted(row['properties']['OBJECTID'] for row in features)
    if hashlib.sha256(json.dumps(ids).encode()).hexdigest() != manifest['inventorySha256']:
        raise RuntimeError('Raw waterbody inventory differs')
    entries, geometries, counts = build_groups(features)
    stations = json.loads((ROOT / 'site/data/reservoir-watchlist.json').read_text(encoding='utf-8'))['stations']
    # These two associations already underpin the app's reservoir watchlist.
    associations = {'Millerton Lake': ('MIL', ['Millerton Reservoir', 'Friant', 'Friant Dam']),
                    'Pine Flat Lake': ('PNF', ['Pine Flat Reservoir', 'Pine Flat Dam'])}
    for entry in entries:
        if entry['name'] in associations:
            station_id, aliases = associations[entry['name']]
            station = next(s for s in stations if s['id'] == station_id)
            entry['stationId'] = station_id
            entry['aliases'].extend([*aliases, station['name'], station_id])
    output = ROOT / 'site/data/search' / VERSION
    output.mkdir(parents=True, exist_ok=True)
    shards: dict[str, dict[str, Any]] = defaultdict(dict)
    for entry in entries:
        shards[entry['shard']][entry['key']] = geometries[entry['key']]
    hashes = {}
    for shard, doc in sorted(shards.items()):
        data = (json.dumps(doc, separators=(',', ':')) + '\n').encode()
        (output / shard).write_bytes(data)
        hashes[shard] = hashlib.sha256(data).hexdigest()
    source = {'url': manifest['source'], 'publisher': manifest['publisher'], 'retrievedAt': manifest['retrievedAt']}
    index = {'version': VERSION, 'countyGeoid': '06019', 'sources': {'waterbody': source}, 'entries': entries}
    (output / 'index.json').write_text(json.dumps(index, separators=(',', ':')) + '\n', encoding='utf-8')
    result = {'version': VERSION, 'countyGeoid': '06019', 'source': source, 'sourceSha256': manifest['sourceSha256'],
              'accounting': counts, 'namedGroups': len(entries), 'geometryShardsSha256': hashes,
              'scope': 'Named publisher Lake-class features intersecting Fresno County; complete source outlines retained, including boundary-crossing portions. Not clipped or simplified. Unnamed bodies are not indexed.',
              'identityPolicy': 'Group only matching nonzero GNIS IDs; without GNIS, retain a separate source-feature identity. Equal names alone never merge different GNIS identities.',
              'geometryPolicy': 'WGS84 XY polygons with clockwise exteriors and counterclockwise holes for ArcGIS. No 3D, current shoreline, inundation, connectivity or safe-access inference.',
              'stationAssociations': associations}
    (output / 'manifest.json').write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
    LOG.info('Full-outline lake groups=%s, accounting=%s, shard bytes=%s', len(entries), counts,
             sum((output / name).stat().st_size for name in hashes))


if __name__ == '__main__':
    logging.basicConfig(level=logging.INFO, format='%(levelname)s %(message)s')
    main()
