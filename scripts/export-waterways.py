"""Export county-intersecting USGS waterway segments to validated GeoParquet.

Default: named segments only. Full geometry is retained, including portions
outside the county; this is a reference snapshot, not live flow or clipped data.
Requires the pinned project environment in requirements-waterways.txt.
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import logging
import math
import ssl
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

import pyarrow as pa
import pyarrow.parquet as pq
from pyproj import CRS
from shapely.geometry import MultiLineString, mapping, shape
from shapely.geometry.polygon import orient
from shapely import from_wkb

SOURCE = 'https://3dhp.nationalmap.gov/arcgis/rest/services/usgs_3dhp_all/MapServer/50'
FIELDS = ['id3dhp', 'gnisidlabel', 'gnisid', 'featuretype', 'featuretypelabel', 'featuredate', 'lengthkm']
ROOT = Path(__file__).resolve().parents[1]
LOG = logging.getLogger('waterways')


HEADERS = {'User-Agent': 'FresnoStormWatch/0.16 reference-export', 'Accept-Encoding': 'gzip'}


def request_json(url: str, parameters: dict[str, Any], retries: int = 1, timeout: int = 90,
                 error: str = 'USGS error', headers: dict[str, str] = HEADERS) -> dict[str, Any]:
    """POST one public ArcGIS REST query (caller `f` wins) with verified TLS and bounded time.

    Transient transport errors retry with 1 s, 2 s... backoff; the last one is re-raised.
    Service errors are never retried."""
    for attempt in range(retries):
        try:
            req = Request(url, data=urlencode({'f': 'json', **parameters}).encode('utf-8'), headers=headers)
            with urlopen(req, timeout=timeout, context=ssl.create_default_context()) as response:
                data = response.read()
                if response.headers.get('Content-Encoding') == 'gzip':
                    data = gzip.decompress(data)
            break
        except (HTTPError, URLError, TimeoutError, ConnectionError) as failure:
            if attempt == retries - 1:
                raise
            LOG.warning('Retry %s after transport error: %s', attempt + 1, type(failure).__name__)
            time.sleep(2 ** attempt)
    result = json.loads(data)
    if result.get('error'):
        raise RuntimeError(f"{error}: {result['error']}")
    return result


def write_snapshot(output: Path, rows: list[dict[str, Any]], manifest: dict[str, Any]) -> None:
    """Replace county.geojson, then manifest.json, each via a same-directory temp + rename."""
    for name, data, layout in [('county.geojson', {'type': 'FeatureCollection', 'features': rows}, {'separators': (',', ':')}),
                               ('manifest.json', manifest, {'indent': 2})]:
        temporary = (output / name).with_suffix('.tmp')
        temporary.write_text(json.dumps(data, **layout), encoding='utf-8')
        temporary.replace(output / name)


def cached_json(path: Path, fetch: Callable[[], dict[str, Any]], check: Callable[[dict[str, Any]], Any]) -> Any:
    """Return check() of a cached work/ batch or a fresh fetch; only a checked fetch is cached, via temp + rename."""
    cached = path.exists()
    data = json.loads(path.read_text(encoding='utf-8')) if cached else fetch()
    result = check(data)
    if not cached:
        temporary = path.with_suffix('.tmp')
        temporary.write_text(json.dumps(data, separators=(',', ':')), encoding='utf-8')
        temporary.replace(path)
    return result


def county_filter(path: Path) -> tuple[Any, dict[str, Any]]:
    """Use the existing validated Fresno County boundary, in longitude/latitude."""
    doc = json.loads(path.read_text(encoding='utf-8'))
    feature = next(f for f in doc['features'] if f['properties']['GEOID'] == '06019')
    county = shape(feature['geometry'])
    if county.is_empty or not county.is_valid:
        raise ValueError('Fresno boundary is not valid; no implicit repair applied.')
    parts = [county] if county.geom_type == 'Polygon' else list(county.geoms)
    rings = []
    for polygon in parts:
        polygon = orient(polygon, sign=-1.0)  # Esri exterior clockwise; holes opposite.
        rings.extend([list(polygon.exterior.coords), *[list(r.coords) for r in polygon.interiors]])
    return county, {'rings': rings, 'spatialReference': {'wkid': 4326}}


def morton_key(x: float, y: float) -> int:
    """Deterministic coarse spatial order; no coordinate quantization in geometry."""
    a = max(0, min(65535, int((x + 180) / 360 * 65535)))
    b = max(0, min(65535, int((y + 90) / 180 * 65535)))
    return sum(((a >> i) & 1) << (2*i) | ((b >> i) & 1) << (2*i+1) for i in range(16))


def convert(features: list[dict[str, Any]], county: Any, oid: str) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Validate every feature; reject ambiguous geometry instead of dropping silently."""
    rows, rejected, identifiers = [], [], set()
    for feature in features:
        attrs = feature['attributes']
        key = attrs.get('id3dhp')
        paths = feature.get('geometry', {}).get('paths')
        reason = None
        if not key or key in identifiers:
            reason = 'Missing or duplicate stable id3dhp'
        elif not paths or any(len(p) < 2 for p in paths):
            reason = 'Empty or degenerate path'
        elif any(len(p) != 2 or not all(math.isfinite(n) for n in p) or not (-180 <= p[0] <= 180 and -90 <= p[1] <= 90) for path in paths for p in path):
            reason = 'Unexpected dimension, coordinate or CRS'
        if reason:
            rejected.append({'id3dhp': key, 'reason': reason})
            continue
        geometry = MultiLineString(paths)
        if not geometry.is_valid or geometry.is_empty or not geometry.intersects(county):
            rejected.append({'id3dhp': key, 'reason': 'Invalid geometry or server county filter disagreement'})
            continue
        identifiers.add(key)
        xmin, ymin, xmax, ymax = geometry.bounds
        rows.append({**{field: attrs.get(field) for field in FIELDS}, 'source_objectid': attrs[oid],
                     'geometry': geometry.wkb, 'bbox': {'xmin': xmin, 'ymin': ymin, 'xmax': xmax, 'ymax': ymax},
                     '_order': morton_key((xmin+xmax)/2, (ymin+ymax)/2)})
    rows.sort(key=lambda row: (row['_order'], row['id3dhp']))
    for index, row in enumerate(rows, 1):
        row.pop('_order')
        row['ObjectID'] = index  # Snapshot-local; id3dhp is the durable source identifier.
    return rows, rejected


def write_outputs(rows: list[dict[str, Any]], output: Path, provenance: dict[str, Any]) -> dict[str, Any]:
    """Write lossless WKB, explicit CRS, bounding-box covering and read-back accounting."""
    if not rows:
        raise ValueError('No output rows; refusing to replace the prior snapshot.')
    bounds = [min(r['bbox']['xmin'] for r in rows), min(r['bbox']['ymin'] for r in rows), max(r['bbox']['xmax'] for r in rows), max(r['bbox']['ymax'] for r in rows)]
    geo = {'version': '1.1.0', 'primary_column': 'geometry', 'columns': {'geometry': {
        'encoding': 'WKB', 'geometry_types': ['MultiLineString'], 'crs': CRS('OGC:CRS84').to_json_dict(),
        'edges': 'planar', 'bbox': bounds,
        'covering': {'bbox': {k: ['bbox', k] for k in ['xmin', 'ymin', 'xmax', 'ymax']}}
    }}}
    schema = pa.schema([
        pa.field('ObjectID', pa.int32(), nullable=False), pa.field('source_objectid', pa.int64()),
        pa.field('id3dhp', pa.string(), nullable=False), pa.field('gnisidlabel', pa.string()),
        pa.field('gnisid', pa.string()), pa.field('featuretype', pa.int32()), pa.field('featuretypelabel', pa.string()),
        pa.field('featuredate', pa.int64()), pa.field('lengthkm', pa.float64()),
        pa.field('geometry', pa.binary(), nullable=False),
        pa.field('bbox', pa.struct([(key, pa.float64()) for key in ['xmin', 'ymin', 'xmax', 'ymax']]))
    ], metadata={b'geo': json.dumps(geo).encode('utf-8'), b'fresno_provenance': json.dumps(provenance).encode('utf-8')})
    for row in rows:
        if row['gnisid'] is not None:
            row['gnisid'] = str(row['gnisid'])
    table = pa.Table.from_pylist(rows, schema=schema)
    target = output / 'fresno-named-waterways.parquet'
    temp = target.with_suffix('.parquet.tmp')
    pq.write_table(table, temp, compression='snappy', row_group_size=1024, write_statistics=True)
    checked = pq.read_table(temp)
    if checked.num_rows != len(rows) or checked.column('id3dhp').to_pylist() != [r['id3dhp'] for r in rows] or checked.column('geometry').to_pylist() != [r['geometry'] for r in rows]:
        raise RuntimeError('Parquet round trip changed rows, IDs or geometry.')
    temp.replace(target)
    # Same geometries/attributes form a fair serialized-size baseline; not a browser-speed benchmark.
    json_features = [{'type': 'Feature', 'properties': {k: v for k, v in r.items() if k not in ['geometry', 'bbox']}, 'geometry': mapping(from_wkb(r['geometry']))} for r in rows]
    payload = json.dumps({'type': 'FeatureCollection', 'features': json_features}, separators=(',', ':'), ensure_ascii=False).encode('utf-8')
    (output / 'fresno-named-waterways.geojson').write_bytes(payload)
    return {'features': len(rows), 'rowGroups': pq.ParquetFile(target).num_row_groups,
            'parquetBytes': target.stat().st_size, 'geojsonBytes': len(payload), 'gzipGeojsonBytes': len(gzip.compress(payload, mtime=0)),
            'parquetSha256': hashlib.sha256(target.read_bytes()).hexdigest(), 'geometryRoundTrip': 'Exact WKB bytes preserved',
            'bbox': bounds, 'geometry': 'MultiLineString', 'crs': 'OGC:CRS84', 'compression': 'snappy', 'geoParquetVersion': '1.1.0'}


def main() -> None:
    """Fetch a named reference snapshot; never publishes to AGOL or replaces app sources."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT / 'work' / 'waterways-geoparquet')
    parser.add_argument('--reuse-download', action='store_true', help='Reuse the recorded public download for deterministic conversion checks')
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    county_path = ROOT / 'site' / 'data' / 'counties.geojson'
    county, filter_geometry = county_filter(county_path)
    download = args.output / 'source-download.json'
    started = time.perf_counter()
    if args.reuse_download:
        stored = json.loads(download.read_text(encoding='utf-8'))
    else:
        metadata = request_json(SOURCE, {})
        oid = next(f['name'] for f in metadata['fields'] if f['type'] == 'esriFieldTypeOID')
        parameters = {'where': "gnisidlabel IS NOT NULL AND gnisidlabel <> ''", 'geometry': json.dumps(filter_geometry), 'geometryType': 'esriGeometryPolygon', 'inSR': 4326, 'spatialRel': 'esriSpatialRelIntersects', 'returnIdsOnly': 'true'}
        ids = request_json(SOURCE + '/query', parameters).get('objectIds')
        if not ids or len(ids) != len(set(ids)) or len(ids) > 100_000:
            raise RuntimeError('Unexpected named waterway inventory; no incomplete export allowed.')
        ids.sort()
        LOG.info('USGS named segments intersecting Fresno: %s', len(ids))
        def fetch_batch(batch: list[int]) -> list[dict[str, Any]]:
            result = request_json(SOURCE + '/query', {'objectIds': ','.join(map(str, batch)), 'outFields': ','.join([oid, *FIELDS]), 'returnGeometry': 'true', 'outSR': 4326, 'returnZ': 'false', 'returnM': 'false'})
            if result.get('exceededTransferLimit') or result.get('spatialReference', {}).get('wkid') != 4326:
                raise RuntimeError('Truncated response or unexpected output CRS.')
            features = result.get('features', [])
            if sorted(f['attributes'][oid] for f in features) != batch:
                raise RuntimeError('Batch IDs changed or records are missing.')
            LOG.info('Downloaded %s features', len(features))
            return features
        with ThreadPoolExecutor(max_workers=3) as pool:
            features = [f for batch in pool.map(fetch_batch, [ids[i:i+500] for i in range(0, len(ids), 500)]) for f in batch]
        if sorted(request_json(SOURCE + '/query', parameters).get('objectIds') or []) != ids:
            raise RuntimeError('Source inventory changed during export; retry before publishing.')
        stored = {'retrievedUtc': datetime.now(timezone.utc).isoformat(), 'source': SOURCE, 'oidField': oid, 'expectedCount': len(ids), 'features': features, 'query': {k: v for k, v in parameters.items() if k != 'geometry'}}
        download.write_text(json.dumps(stored, ensure_ascii=False), encoding='utf-8')
    rows, rejected = convert(stored['features'], county, stored['oidField'])
    (args.output / 'rejected-records.json').write_text(json.dumps(rejected, indent=2), encoding='utf-8')
    if rejected or len(rows) != stored['expectedCount']:
        raise RuntimeError('Rejected/missing features; inspect rejected-records.json. Prior output retained.')
    provenance = {'source': SOURCE, 'retrievedUtc': stored['retrievedUtc'], 'scope': 'Named USGS segments intersecting Fresno County; complete segments retained, not clipped', 'boundarySha256': hashlib.sha256(county_path.read_bytes()).hexdigest(), 'query': stored['query'], 'sourceFeatureDateUnits': 'milliseconds since Unix epoch; source edit date, not observation time', 'sourceLengthUnits': 'km, full source segment', 'license': 'USGS public data; retain attribution', 'purpose': 'Reference/analysis format trial, not live flow, terrain or flood simulation'}
    result = write_outputs(rows, args.output, provenance)
    report = {**provenance, **result, 'sourceCount': stored['expectedCount'], 'rejectedCount': len(rejected), 'elapsedSeconds': round(time.perf_counter()-started, 2), 'timingMeaning': 'Export elapsed time, not map rendering time', 'namedOnly': True, 'unconverted': 'Unnamed waterways remain in the publisher service; no assertion of a complete local hydrography export'}
    (args.output / 'manifest.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    LOG.info('Validated %s -> %s features, %s rejected', stored['expectedCount'], len(rows), len(rejected))
    print(json.dumps({k: report[k] for k in ['features', 'parquetBytes', 'geojsonBytes', 'gzipGeojsonBytes', 'rejectedCount', 'elapsedSeconds']}, indent=2))


if __name__ == '__main__':
    logging.basicConfig(level=logging.INFO, format='%(levelname)s %(message)s')
    main()
