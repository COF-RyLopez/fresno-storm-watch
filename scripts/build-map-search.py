"""Build public named-waterway / street search references; no private assets.

Requires requirements-waterways.txt. Run acquire-waterways-county.py first.
Names are indexed locally in the browser; geometry shards load only on selection.
This display-only simplification does not establish connectivity or road access.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timezone
import hashlib
import json
import logging
import runpy
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
STREETS = 'https://gisprod10.co.fresno.ca.us/server/rest/services/PublicWorks/PublicWorks_BaseLayers/MapServer/4'
VERSION = 'v0.31.0'
FIELDS = ['OBJECTID', 'LABEL', 'PREFIX', 'NAME', 'TYPE', 'SUFFIX', 'ALIAS', 'ALIAS_XR', 'ALIAS_HWY', 'HWY_NUM', 'HWY_NUM2']
LOG = logging.getLogger('map-search-build')


def name_key(value: Any) -> str:
    """Normalize only whitespace/case for grouping; do not join connected paths."""
    return ' '.join(str(value or '').split()).casefold()


def main() -> None:
    """Acquire complete county streets and build bounded public display shards."""
    from pyproj import Transformer
    from shapely.geometry import LineString, MultiLineString, shape
    from shapely.ops import transform

    helper = runpy.run_path(str(ROOT / 'scripts' / 'export-waterways.py'))

    def request(params: dict[str, Any]) -> dict[str, Any]:
        """Query public streets with verified TLS and a bounded request timeout."""
        return helper['request_json'](STREETS + '/query', params, error='County street query failed', headers={'Accept-Encoding': 'gzip'})

    boundary = ROOT / 'site/data/counties.geojson'
    county, spatial = helper['county_filter'](boundary)
    started = datetime.now(timezone.utc)
    parameters = {'where': '1=1', 'geometry': json.dumps(spatial), 'geometryType': 'esriGeometryPolygon',
                  'inSR': 4326, 'spatialRel': 'esriSpatialRelIntersects', 'returnIdsOnly': 'true'}
    inventory = request(parameters)
    if inventory.get('exceededTransferLimit') or 'objectIds' not in inventory:
        raise RuntimeError('Incomplete county street ID inventory')
    ids = sorted(inventory['objectIds'])
    identity = hashlib.sha256(json.dumps(ids).encode()).hexdigest()
    # Version the cache contract as well as IDs; changed fields/CRS must not reuse old batches.
    contract = hashlib.sha256(json.dumps({'ids': ids, 'fields': FIELDS, 'outSR': 4326}).encode()).hexdigest()
    cache = ROOT / 'work' / 'search-build' / started.strftime('%Y-%m-%d') / contract[:16]
    cache.mkdir(parents=True, exist_ok=True)

    def batch(chunk: list[int]) -> list[dict[str, Any]]:
        """Resume exact ID batches and reject truncated, mismatched or wrong-CRS responses."""
        def check(data: dict[str, Any]) -> list[dict[str, Any]]:
            features = data.get('features', [])
            if data.get('exceededTransferLimit') or len(features) != len(chunk) or {f['attributes']['OBJECTID'] for f in features} != set(chunk):
                raise RuntimeError('Street batch object-ID accounting mismatch')
            if data.get('spatialReference', {}).get('wkid') != 4326:
                raise RuntimeError('Street query returned an unexpected CRS')
            return features
        return helper['cached_json'](cache / (str(chunk[0]) + '.json'), lambda: request({
            'objectIds': ','.join(map(str, chunk)), 'outFields': ','.join(FIELDS),
            'returnGeometry': 'true', 'outSR': 4326, 'returnZ': 'false', 'returnM': 'false'}), check)

    streets = helper['read_inventory'](ids, batch, lambda: request(parameters), 'County street inventory changed during acquisition', workers=4)
    to_local = Transformer.from_crs(4326, 26944, always_xy=True).transform
    to_geo = Transformer.from_crs(26944, 4326, always_xy=True).transform
    groups: dict[tuple[str, str], dict[str, Any]] = {}
    accounting = {'street': {'input': len(streets), 'accepted': 0, 'unnamed': 0, 'rejected': 0},
                  'waterway': {'input': 0, 'accepted': 0, 'unnamed': 0, 'rejected': 0}}
    rejects = []

    def add(kind: str, name: str, aliases: list[str], geometry: Any, source_id: str) -> None:
        """Clip for search display and simplify in meters, preserving disjoint paths."""
        if not name_key(name):
            accounting[kind]['unnamed'] += 1
            return
        if geometry.is_empty or not geometry.is_valid:
            accounting[kind]['rejected'] += 1
            rejects.append({'kind': kind, 'id': source_id, 'reason': 'Empty/invalid source geometry'})
            return
        clipped = geometry.intersection(county)
        parts = [clipped] if clipped.geom_type == 'LineString' else [p for p in getattr(clipped, 'geoms', []) if p.geom_type == 'LineString' and not p.is_empty]
        if not parts:
            accounting[kind]['rejected'] += 1
            rejects.append({'kind': kind, 'id': source_id, 'reason': 'No line portion inside county (possible boundary touch)'})
            return
        simplified = [transform(to_geo, transform(to_local, part).simplify(5, preserve_topology=True)) for part in parts]
        if any(p.is_empty or not p.is_valid for p in simplified):
            raise RuntimeError('Invalid simplified search geometry')
        key = kind, name_key(name)
        group = groups.setdefault(key, {'name': ' '.join(name.split()), 'aliases': set(), 'paths': [], 'segments': 0})
        group['aliases'].update(str(a).strip() for a in aliases if a)
        group['paths'].extend([[[round(x, 6), round(y, 6)] for x, y, *_ in part.coords] for part in simplified])
        group['segments'] += 1
        accounting[kind]['accepted'] += 1

    for row in streets:
        attrs = row['attributes']
        name = ' '.join(str(attrs.get(field) or '').strip() for field in ['PREFIX', 'NAME', 'TYPE', 'SUFFIX']).strip() or str(attrs.get('LABEL') or '')
        aliases = [attrs.get(f) for f in ['LABEL', 'ALIAS', 'ALIAS_XR', 'ALIAS_HWY']]
        aliases.extend('Highway ' + str(attrs[f]) for f in ['HWY_NUM', 'HWY_NUM2'] if attrs.get(f))
        paths = (row.get('geometry') or {}).get('paths', [])
        geometry = MultiLineString(paths) if paths else LineString()
        add('street', name, aliases, geometry, str(attrs['OBJECTID']))
    waterways_path = ROOT / 'work/waterways-county/county.geojson'
    waterways = json.loads(waterways_path.read_text(encoding='utf-8'))
    for row in waterways['features']:
        accounting['waterway']['input'] += 1
        add('waterway', row['properties']['name'], [], shape(row['geometry']), row['properties']['source_id'])
    output = ROOT / 'site/data/search' / VERSION
    output.mkdir(parents=True, exist_ok=True)
    shards: dict[str, dict[str, Any]] = defaultdict(dict)
    entries = []
    for (kind, key), group in sorted(groups.items()):
        digest = hashlib.sha256((kind + ':' + key).encode()).hexdigest()[:20]
        identifier = kind + ':' + digest
        shard = digest[:2]
        xy = [p for path in group['paths'] for p in path]
        bounds = [min(p[0] for p in xy), min(p[1] for p in xy), max(p[0] for p in xy), max(p[1] for p in xy)]
        if not (-121 < bounds[0] <= bounds[2] < -118 and 35 < bounds[1] <= bounds[3] < 38):
            raise RuntimeError('Search geometry outside expected Fresno envelope')
        entries.append({'key': identifier, 'name': group['name'], 'kind': kind,
                        'aliases': sorted(group['aliases']), 'segments': group['segments'],
                        'bounds': bounds, 'shard': shard + '.json'})
        shards[shard][identifier] = {'paths': group['paths'], 'spatialReference': {'wkid': 4326}}
    shard_hashes = {}
    for shard, data in sorted(shards.items()):
        raw = (json.dumps(data, separators=(',', ':'), ensure_ascii=False) + '\n').encode('utf-8')
        (output / (shard + '.json')).write_bytes(raw)
        shard_hashes[shard + '.json'] = hashlib.sha256(raw).hexdigest()
    water_manifest = json.loads((ROOT / 'work/waterways-county/manifest.json').read_text(encoding='utf-8'))
    retrieval_times = [path.stat().st_mtime for path in cache.glob('*.json')]
    first_retrieved = datetime.fromtimestamp(min(retrieval_times), timezone.utc).isoformat()
    last_retrieved = datetime.fromtimestamp(max(retrieval_times), timezone.utc).isoformat()
    result = {'version': VERSION, 'countyGeoid': '06019', 'generatedAt': datetime.now(timezone.utc).isoformat(),
              'sources': {'street': {'url': STREETS, 'publisher': 'Fresno County Public Works and Planning', 'retrievedAt': first_retrieved, 'retrievalCompletedAt': last_retrieved, 'inventoryCheckedAt': started.isoformat()},
                          'waterway': {'url': helper['SOURCE'], 'publisher': 'USGS 3D Hydrography Program', 'retrievedAt': water_manifest['retrievedAt']}},
              'geometryNote': 'Public reference snapshot, clipped to Fresno; 5 m display simplification in EPSG:26944, returned as EPSG:4326. Grouped names do not establish connection, travel direction, road access, current conditions or routing.',
              'entries': entries}
    (output / 'index.json').write_text(json.dumps(result, separators=(',', ':'), ensure_ascii=False) + '\n', encoding='utf-8')
    manifest = {'accounting': accounting, 'namedGroups': len(entries), 'boundarySha256': hashlib.sha256(boundary.read_bytes()).hexdigest(),
                'streetInventorySha256': identity, 'waterwaysInputSha256': hashlib.sha256(waterways_path.read_bytes()).hexdigest(),
                'geometryShardsSha256': shard_hashes, 'rejected': rejects, 'sources': result['sources'], 'geometryNote': result['geometryNote']}
    (output / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    LOG.info('Search groups=%s geometry shards=%s accounting=%s', len(entries), len(shards), accounting)


if __name__ == '__main__':
    logging.basicConfig(level=logging.INFO, format='%(levelname)s %(message)s')
    main()
