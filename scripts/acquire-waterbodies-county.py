"""Acquire public Fresno-intersecting USGS waterbody polygons for display tiles.

Uses the pinned requirements-waterways.txt environment. No private GIS access.
Raw responses stay in ignored work; public geometry is XY only and is clipped
to the county envelope to retain boundary-crossing lake/reservoir context.
"""
from __future__ import annotations

import hashlib
import json
import logging
import math
import runpy
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
SOURCE = 'https://3dhp.nationalmap.gov/arcgis/rest/services/usgs_3dhp_all/MapServer/60'
FIELDS = ['id3dhp', 'gnisid', 'gnisidlabel', 'featuretype', 'featuretypelabel', 'featuredate', 'areasqkm']
LOG = logging.getLogger('county-waterbodies')


def convert(features: list[dict[str, Any]], county: Any, oid: str) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Validate IDs, WGS84 polygon geometry and county scope; never silently omit."""
    from shapely.geometry import box, mapping, shape
    from shapely.ops import transform
    from pyproj import Transformer
    project = Transformer.from_crs(4326, 26944, always_xy=True).transform
    rows, rejected, seen = [], [], set()
    for feature in features:
        attrs = feature.get('properties') or {}
        key = attrs.get('id3dhp')
        geometry = feature.get('geometry') or {}
        reason = None
        if not key or key in seen:
            reason = 'Missing or duplicated source id3dhp'
        elif geometry.get('type') not in ('Polygon', 'MultiPolygon'):
            reason = 'Expected a polygon / multipolygon'
        else:
            polygon = shape(geometry)
            coords = [xy for p in ([polygon] if polygon.geom_type == 'Polygon' else polygon.geoms)
                      for ring in [p.exterior, *p.interiors] for xy in ring.coords]
            if not coords or any(len(xy) != 2 or not all(math.isfinite(n) for n in xy)
                                 or not (-180 <= xy[0] <= 180 and -90 <= xy[1] <= 90) for xy in coords):
                reason = 'Unexpected dimension / WGS84 coordinate'
            elif polygon.is_empty or not polygon.is_valid:
                reason = 'Empty or invalid source polygon; no automatic repair'
            elif not polygon.intersects(county):
                reason = 'Publisher county filter disagreement'
        if reason:
            rejected.append({'source_id': key, 'reason': reason})
            continue
        seen.add(key)
        clipped = polygon.intersection(box(*county.bounds))
        if clipped.is_empty or clipped.geom_type not in ('Polygon', 'MultiPolygon') or not clipped.is_valid:
            raise RuntimeError(f'Unexpected clipped waterbody: {key}')
        rows.append({'type': 'Feature', 'id': attrs[oid], 'properties': {
            'source_id': key, 'name': ' '.join((attrs.get('gnisidlabel') or '').split()),
            'gnis_id': attrs.get('gnisid'), 'kind': attrs.get('featuretype'),
            'kind_label': attrs.get('featuretypelabel') or 'Unspecified waterbody',
            'source_area_sqkm': attrs.get('areasqkm'), 'source_date': attrs.get('featuredate'),
            'display_area_sqkm': transform(project, clipped).area / 1_000_000,
            'label_point': list(clipped.representative_point().coords)[0]},
            'geometry': mapping(clipped)})
    rows.sort(key=lambda row: row['properties']['source_id'])
    return rows, rejected


def acquire() -> None:
    """Download an enumerated, resumable inventory; replace output only after validation."""
    source = runpy.run_path(str(ROOT / 'scripts' / 'export-waterways.py'))

    def request(params: dict[str, Any], url: str = SOURCE + '/query') -> dict[str, Any]:
        """Retry bounded public REST requests; preserve errors and verify TLS."""
        return source['request_json'](url, params, retries=3, error='USGS waterbody service error')

    boundary = ROOT / 'site' / 'data' / 'counties.geojson'
    county, filter_geometry = source['county_filter'](boundary)
    output = ROOT / 'work' / 'waterbodies-county'
    cache = output / 'batches'
    cache.mkdir(parents=True, exist_ok=True)
    started = datetime.now(timezone.utc).isoformat()
    metadata = request({}, SOURCE)
    if metadata['geometryType'] != 'esriGeometryPolygon':
        raise RuntimeError('Waterbody publisher geometry contract changed')
    oid = next(field['name'] for field in metadata['fields'] if field['type'] == 'esriFieldTypeOID')
    fields = [oid, *FIELDS]
    if not set(fields).issubset({f['name'] for f in metadata['fields']}):
        raise RuntimeError('Publisher waterbody schema changed')
    params = {'where': '1=1', 'geometry': json.dumps(filter_geometry), 'geometryType': 'esriGeometryPolygon',
              'inSR': 4326, 'spatialRel': 'esriSpatialRelIntersects', 'returnIdsOnly': 'true'}
    ids = sorted(request(params).get('objectIds') or [])
    if not ids or len(ids) > 100_000 or len(ids) != len(set(ids)):
        raise RuntimeError('Unexpected waterbody inventory')
    inventory_hash = hashlib.sha256(json.dumps(ids).encode()).hexdigest()
    key = hashlib.sha256((inventory_hash + ','.join(fields) + json.dumps(filter_geometry)).encode()).hexdigest()[:16]
    LOG.info('Inventory: %s Fresno-intersecting waterbodies', len(ids))

    def batch(part: list[int]) -> list[dict[str, Any]]:
        """GeoJSON is requested in RFC7946 WGS84 XY with Z/M disabled."""
        def check(data: dict[str, Any]) -> list[dict[str, Any]]:
            features = data.get('features') or []
            if data.get('exceededTransferLimit') or sorted(f['properties'][oid] for f in features) != part:
                raise RuntimeError('Waterbody query truncated or inventory changed')
            return features
        return source['cached_json'](cache / f'{key}-{part[0]}.json', lambda: request({
            'f': 'geojson', 'objectIds': ','.join(map(str, part)), 'outFields': ','.join(fields),
            'outSR': 4326, 'returnGeometry': 'true', 'returnZ': 'false', 'returnM': 'false'}), check)

    features = source['read_inventory'](ids, batch, lambda: request(params), 'Waterbody inventory changed during acquisition', workers=2)
    rows, rejected = convert(features, county, oid)
    (output / 'rejected.json').write_text(json.dumps(rejected, indent=2), encoding='utf-8')
    if rejected or len(rows) != len(ids):
        raise RuntimeError('Waterbody validation failed; inspect rejected.json. Prior public output retained.')
    kinds = dict(Counter(row['properties']['kind_label'] for row in rows))
    manifest = {'source': SOURCE, 'publisher': 'USGS 3D Hydrography Program', 'countyGeoid': '06019',
        'retrievalStartedAt': min(started, datetime.fromtimestamp(min(p.stat().st_mtime for p in cache.glob(key + '-*.json')), timezone.utc).isoformat()),
        'retrievedAt': datetime.now(timezone.utc).isoformat(),
        'retrievalPolicy': 'Validated resumable batches for the same ID inventory, fields and county filter; not an atomic editing-service snapshot. Cached batch modification times retained as the beginning of the retrieval window.',
        'crs': 'OGC:CRS84', 'bounds': list(county.bounds), 'downloaded': len(ids), 'accepted': len(rows), 'rejected': 0,
        'named': sum(bool(r['properties']['name']) for r in rows), 'featureTypes': kinds,
        'boundarySha256': hashlib.sha256(boundary.read_bytes()).hexdigest(), 'inventorySha256': inventory_hash,
        'sourceSha256': hashlib.sha256(json.dumps(features, sort_keys=True).encode()).hexdigest(),
        'scope': 'All publisher waterbody polygons intersecting Fresno County, including unnamed features. Geometry clipped to the county envelope; boundary-crossing lake/reservoir parts may lie outside the county.',
        'limitations': 'Published reference footprints, not current shorelines, observed water levels, flood extents, predicted inundation or a complete local pond/basin inventory. Feature types remain publisher classifications.',
        'dimensionPolicy': 'Requested RFC7946 WGS84 XY with outSR=4326, returnZ=false and returnM=false; no vertical datum or elevation use.',
        'license': 'USGS open, non-proprietary federal reference data; acknowledgment retained.'}
    source['write_snapshot'](output, rows, manifest)
    LOG.info('Validated %s waterbodies; types: %s', len(rows), kinds)


if __name__ == '__main__':
    logging.basicConfig(level=logging.INFO, format='%(levelname)s %(message)s')
    acquire()
