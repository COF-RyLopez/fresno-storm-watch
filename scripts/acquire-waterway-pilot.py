"""Acquire bounded USGS reference geometry; no operational data or publishing.

Run with requirements-waterways.txt. Source IDs and source geometry are kept in
work; display geometry is clipped only to the explicitly documented pilot boxes.
"""
from __future__ import annotations

import hashlib
import importlib.util
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from shapely import from_wkb
from shapely.geometry import box, mapping
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parents[1]
AREAS = [
    {'id': 'friant-millerton', 'name': 'Friant / Millerton', 'bounds': [-119.86, 36.89, -119.50, 37.16]},
    {'id': 'pine-flat', 'name': 'Pine Flat / Kings River', 'bounds': [-119.52, 36.72, -119.13, 37.02]},
]


def acquire() -> None:
    """Validate and account for all downloaded features before writing the pilot."""
    spec = importlib.util.spec_from_file_location('waterways', ROOT / 'scripts' / 'export-waterways.py')
    source = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(source)
    output = ROOT / 'work' / 'waterway-pilot'
    output.mkdir(parents=True, exist_ok=True)
    county, _ = source.county_filter(ROOT / 'site' / 'data' / 'counties.geojson')
    meta = source.request_json(source.SOURCE, {})
    oid = next(f['name'] for f in meta['fields'] if f['type'] == 'esriFieldTypeOID')
    features: dict[int, Any] = {}
    for area in AREAS:
        params = {'where': '1=1', 'geometry': ','.join(map(str, area['bounds'])),
                  'geometryType': 'esriGeometryEnvelope', 'inSR': 4326,
                  'spatialRel': 'esriSpatialRelIntersects'}
        ids = source.request_json(source.SOURCE + '/query', {**params, 'returnIdsOnly': 'true'})['objectIds']
        for offset in range(0, len(ids), 200):
            result = source.request_json(source.SOURCE + '/query', {
                'objectIds': ','.join(map(str, ids[offset:offset+200])),
                'outFields': ','.join([oid, *source.FIELDS]), 'outSR': 4326,
                'returnGeometry': 'true', 'returnZ': 'false', 'returnM': 'false'})
            if result.get('exceededTransferLimit') or len(result['features']) != len(ids[offset:offset+200]):
                raise RuntimeError('Incomplete USGS response; prior pilot unchanged.')
            for feature in result['features']:
                features[feature['attributes'][oid]] = feature
        print(f"Downloaded {area['name']}: {len(ids)} source records")
    downloaded = sorted(features.values(), key=lambda f: f['attributes'][oid])
    raw = json.dumps(downloaded, separators=(',', ':')).encode('utf-8')
    (output / 'source.json').write_bytes(raw)
    # Border segments are retained if they intersect Fresno; outside-only records
    # are counted separately rather than described as invalid source data.
    inside = [f for f in downloaded if source.MultiLineString(f['geometry']['paths']).intersects(county)]
    rows, rejected = source.convert(inside, county, oid)
    if rejected:
        (output / 'rejected.json').write_text(json.dumps(rejected, indent=2), encoding='utf-8')
        raise RuntimeError('USGS records failed validation; inspect rejected.json.')
    scope = unary_union([box(*area['bounds']) for area in AREAS])
    rendered = []
    types: dict[str, int] = {}
    for row in rows:
        geometry = from_wkb(row['geometry']).intersection(scope)
        if geometry.is_empty or geometry.geom_type not in ('LineString', 'MultiLineString'):
            raise RuntimeError(f"Unexpected clipped geometry for {row['id3dhp']}")
        types[str(row['featuretype'])] = types.get(str(row['featuretype']), 0) + 1
        rendered.append({'type': 'Feature', 'id': row['ObjectID'],
                         'properties': {'source_id': row['id3dhp'], 'name': ' '.join((row['gnisidlabel'] or '').split()),
                                        'kind': row['featuretype']}, 'geometry': mapping(geometry)})
    if not rendered or len(rows) != len(inside):
        raise RuntimeError('Unexplained source accounting difference; no output.')
    manifest = {'source': source.SOURCE, 'publisher': 'USGS 3D Hydrography Program',
                'retrievedAt': datetime.now(timezone.utc).isoformat(), 'crs': 'OGC:CRS84',
                'areas': AREAS, 'sourceSha256': hashlib.sha256(raw).hexdigest(),
                'downloaded': len(downloaded), 'outsideCounty': len(downloaded)-len(inside),
                'accepted': len(rendered), 'rejected': len(rejected), 'featureTypes': types,
                'scope': 'County-intersecting source segments clipped to pilot boxes. Border segments may extend outside Fresno County.',
                'limitations': 'Reference snapshot, not live flow or a complete ditch inventory. County/district additions and local names require review.',
                'license': 'USGS public-domain federal reference data; Esri background attribution retained separately.'}
    (output / 'pilot.geojson').write_text(json.dumps({'type': 'FeatureCollection', 'features': rendered}, separators=(',', ':')), encoding='utf-8')
    (output / 'manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
    print(json.dumps(manifest, indent=2))


if __name__ == '__main__':
    acquire()
