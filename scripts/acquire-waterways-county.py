"""Acquire all Fresno-intersecting USGS flowlines, with resumable public batches.

Requires requirements-waterways.txt. Does not publish or change any GIS items.
Full source geometry stays in work; the display snapshot clips only to the
county envelope so boundary-crossing channel segments remain available.
"""
from __future__ import annotations

import hashlib
import importlib.util
import json
import logging
import math
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError


ROOT = Path(__file__).resolve().parents[1]
NETWORK_FIELDS = ['mainstemid', 'flowdirection', 'flowdirectionlabel', 'waterbodyid3dhp',
                  'catchmentid3dhp', 'flowpathid3dhp', 'streamorder', 'hydrosequence',
                  'uphydrosequence', 'dnhydrosequence', 'divergence', 'divergencelabel', 'workunitid']
BATCH_SIZE = 500
LOG = logging.getLogger('county-waterways')


def present(value: Any) -> bool:
    """Distinguish usable identifiers from null/blank/zero sentinel values."""
    if isinstance(value, (int, float)):
        return math.isfinite(value) and value != 0
    return value is not None and str(value).strip().lower() not in ('', '0', 'null', 'none')


def network_audit(features: list[dict[str, Any]]) -> dict[str, Any]:
    """Count populated reference attributes; presence is not proof of topology."""
    audit = {field: {'nonNull': 0, 'nonBlankNonZero': 0} for field in NETWORK_FIELDS}
    directions: dict[str, int] = {}
    by_type: dict[str, dict[str, int]] = {}
    for feature in features:
        attrs = feature['attributes']
        for field in NETWORK_FIELDS:
            value = attrs.get(field)
            audit[field]['nonNull'] += value is not None
            audit[field]['nonBlankNonZero'] += present(value)
        direction = str(attrs.get('flowdirection'))
        directions[direction] = directions.get(direction, 0) + 1
        row = by_type.setdefault(str(attrs.get('featuretype')), {'records': 0, 'hydrosequencePopulated': 0,
            'downstreamPointerPopulated': 0, 'unknownMappedDirection': 0})
        row['records'] += 1
        row['hydrosequencePopulated'] += present(attrs.get('hydrosequence'))
        row['downstreamPointerPopulated'] += present(attrs.get('dnhydrosequence'))
        row['unknownMappedDirection'] += attrs.get('flowdirection') == 0
    return {'fields': audit, 'mappedFlowDirectionCodes': directions,
            'bySourceFeatureType': by_type,
            'interpretation': 'Population counts only. Primary upstream/downstream pointers do not include every branch. No connectivity or live operating state is inferred from visual crossings, names or null fields.',
            'idPolicy': 'id3dhp identifies features in this snapshot; USGS does not guarantee persistence across releases. Preserve retrieval version and GNIS/mainstem identifiers where supplied.'}


def acquire() -> None:
    """Download, validate and account for every feature before replacing output."""
    from shapely import from_wkb
    from shapely.geometry import box, mapping

    spec = importlib.util.spec_from_file_location('waterways', ROOT / 'scripts' / 'export-waterways.py')
    source = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(source)
    output = ROOT / 'work' / 'waterways-county'
    output.mkdir(parents=True, exist_ok=True)
    cache = output / 'batches'
    cache.mkdir(exist_ok=True)
    boundary_path = ROOT / 'site' / 'data' / 'counties.geojson'
    county, geometry = source.county_filter(boundary_path)
    started = datetime.now(timezone.utc).isoformat()

    def request(url: str, params: dict[str, Any]) -> dict[str, Any]:
        """Retry bounded transient transport errors, never bypass TLS checks."""
        for attempt in range(3):
            try:
                return source.request_json(url, params)
            except (HTTPError, URLError, TimeoutError, ConnectionError) as error:
                if attempt == 2:
                    raise RuntimeError('USGS download incomplete; rerun to resume validated batches.') from error
                LOG.warning('Retry %s after transport error: %s', attempt+1, type(error).__name__)
                time.sleep(2**attempt)
        raise AssertionError('Unreachable request retry state')

    metadata = request(source.SOURCE, {})
    oid = next(field['name'] for field in metadata['fields'] if field['type'] == 'esriFieldTypeOID')
    fields = [oid, *source.FIELDS, *NETWORK_FIELDS]
    if not set(fields).issubset({f['name'] for f in metadata['fields']}):
        raise RuntimeError('Publisher schema changed; inspect before acquiring.')
    params = {'where': '1=1', 'geometry': json.dumps(geometry), 'geometryType': 'esriGeometryPolygon',
              'inSR': 4326, 'spatialRel': 'esriSpatialRelIntersects', 'returnIdsOnly': 'true'}
    ids = sorted(request(source.SOURCE + '/query', params).get('objectIds') or [])
    if not ids or len(ids) != len(set(ids)) or len(ids) > 500_000:
        raise RuntimeError('Unexpected or duplicated county inventory; do not publish.')
    inventory_hash = hashlib.sha256(json.dumps(ids).encode()).hexdigest()
    # Cache is scoped to the inventory, schema and boundary. This is explicitly
    # a resumable retrieval window, not an atomic snapshot of an editing service.
    cache_key = hashlib.sha256((inventory_hash + ','.join(fields) + json.dumps(geometry)).encode()).hexdigest()[:16]
    LOG.info('County inventory: %s segments; %s batches', len(ids), (len(ids)+BATCH_SIZE-1)//BATCH_SIZE)

    def fetch(batch: list[int]) -> list[dict[str, Any]]:
        """Reuse only an exact validated ID batch from this retrieval inventory."""
        target = cache / f'{cache_key}-{batch[0]}.json'
        if target.exists():
            result = json.loads(target.read_text(encoding='utf-8'))
        else:
            result = request(source.SOURCE + '/query', {'objectIds': ','.join(map(str, batch)),
                'outFields': ','.join(fields), 'outSR': 4326, 'returnGeometry': 'true', 'returnZ': 'false', 'returnM': 'false'})
        features = result.get('features', [])
        if (result.get('exceededTransferLimit') or result.get('spatialReference', {}).get('wkid') != 4326
                or sorted(f['attributes'][oid] for f in features) != batch):
            raise RuntimeError(f'Incomplete batch {batch[0]}; prior public output retained.')
        if not target.exists():
            temp = target.with_suffix('.tmp')
            temp.write_text(json.dumps(result, separators=(',', ':')), encoding='utf-8')
            temp.replace(target)
        return features

    downloaded = []
    with ThreadPoolExecutor(max_workers=3) as pool:
        for index, batch in enumerate(pool.map(fetch, [ids[i:i+BATCH_SIZE] for i in range(0, len(ids), BATCH_SIZE)]), 1):
            downloaded.extend(batch)
            if index % 15 == 0:
                LOG.info('Downloaded / reused %s of %s records', len(downloaded), len(ids))
    if sorted(request(source.SOURCE + '/query', params).get('objectIds') or []) != ids:
        raise RuntimeError('County source inventory changed during acquisition; review before publishing.')
    raw_hash = hashlib.sha256()
    for feature in downloaded:
        raw_hash.update(json.dumps(feature, sort_keys=True, separators=(',', ':')).encode())
    rows, rejected = source.convert(downloaded, county, oid)
    (output / 'rejected.json').write_text(json.dumps(rejected, indent=2), encoding='utf-8')
    if rejected or len(rows) != len(ids):
        raise RuntimeError('County validation failed; inspect rejected.json. No geometry is silently discarded.')
    scope = box(*county.bounds)
    rendered, types = [], {}
    for row in rows:
        clipped = from_wkb(row['geometry']).intersection(scope)
        if clipped.is_empty or clipped.geom_type not in ('LineString', 'MultiLineString'):
            raise RuntimeError(f"Unexpected clipped geometry: {row['id3dhp']}")
        kind = str(row['featuretype'])
        types[kind] = types.get(kind, 0) + 1
        rendered.append({'type': 'Feature', 'id': row['ObjectID'],
            'properties': {'source_id': row['id3dhp'], 'name': ' '.join((row['gnisidlabel'] or '').split()), 'kind': row['featuretype']},
            'geometry': mapping(clipped)})
    audit = network_audit(downloaded)
    manifest = {'source': source.SOURCE, 'publisher': 'USGS 3D Hydrography Program',
        'retrievalStartedAt': started, 'retrievedAt': datetime.now(timezone.utc).isoformat(), 'crs': 'OGC:CRS84',
        'bounds': list(county.bounds), 'countyGeoid': '06019', 'boundarySha256': hashlib.sha256(boundary_path.read_bytes()).hexdigest(),
        'sourceSha256': raw_hash.hexdigest(), 'inventorySha256': inventory_hash,
        'downloaded': len(downloaded), 'accepted': len(rendered), 'outsideCounty': 0, 'rejected': 0, 'featureTypes': types,
        'namedSegments': sum(bool(f['properties']['name']) for f in rendered),
        'unnamedSegments': sum(not f['properties']['name'] for f in rendered),
        'scope': 'Every USGS flowline intersecting the app Fresno County polygon, including named and unnamed canals, ditches, streams and network connectors. Full intersecting segments retained within the county envelope; border-crossing parts can lie outside the county.',
        'dimensionPolicy': 'Requested XY geometry in OGC:CRS84 with returnZ=false and returnM=false for display. Original publisher Z/M values are not retained; no vertical datum or hydraulic-elevation use is implied.',
        'limitations': 'Countywide USGS reference coverage, not a complete verified irrigation-district ditch inventory. Not live flow, gate state, hydraulic routing or predicted inundation.',
        'networkAudit': audit, 'license': 'USGS public-domain federal reference data; Esri background attribution retained separately.'}
    for name, doc in [('county.geojson', {'type': 'FeatureCollection', 'features': rendered}), ('manifest.json', manifest)]:
        target = output / name
        temporary = target.with_suffix('.tmp')
        temporary.write_text(json.dumps(doc, separators=(',', ':') if name.endswith('geojson') else None, indent=None if name.endswith('geojson') else 2), encoding='utf-8')
        temporary.replace(target)
    LOG.info('Validated %s county features, zero rejected; %s named / %s unnamed', len(rows), manifest['namedSegments'], manifest['unnamedSegments'])
    print(json.dumps({'accepted': len(rows), 'types': types, 'networkAudit': audit}, indent=2))


if __name__ == '__main__':
    logging.basicConfig(level=logging.INFO, format='%(levelname)s %(message)s')
    acquire()
