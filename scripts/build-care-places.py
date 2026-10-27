"""Prepare a pinned public Overture Places reference for Fresno comparisons.

Only public Places and the public county boundary are read. No CDPH, county
assets, matching results, tokens or operational records are written here.
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import logging
import re
from pathlib import Path

from overturemaps.core import record_batch_reader
from shapely import from_wkb
from shapely.geometry import shape
import pyarrow as pa
import pyarrow.parquet as pq

LOG = logging.getLogger(__name__)


def build(root: Path, release: str) -> None:
    """Stream a county bbox, retain exact county points and account for every row."""
    if not re.fullmatch(r'\d{4}-\d{2}-\d{2}\.\d+', release):
        raise ValueError('Expected a pinned Overture release identifier.')
    boundary = json.loads((root / 'site/data/counties.geojson').read_text(encoding='utf-8'))
    county = shape(next(f['geometry'] for f in boundary['features'] if f['properties']['GEOID'] == '06019'))
    cache = root / 'work' / ('care-places-' + release)
    cache.mkdir(parents=True, exist_ok=True)
    source = cache / 'places.parquet'
    if not source.exists():
        reader = record_batch_reader('place', bbox=county.bounds, release=release, connect_timeout=20, request_timeout=90)
        if reader is None:
            raise RuntimeError('Overture Places stream is unavailable.')
        columns = [k for k in ['id', 'version', 'geometry', 'names', 'addresses', 'operating_status', 'confidence', 'basic_category', 'categories', 'taxonomy', 'sources'] if k in reader.schema.names]
        temporary = source.with_suffix('.tmp')
        count = 0
        with pq.ParquetWriter(temporary, pa.schema([reader.schema.field(k) for k in columns]), compression='zstd') as writer:
            for batch in reader:
                writer.write_batch(batch.select(columns))
                count += batch.num_rows
                LOG.info('Read %d public bbox places', count)
        temporary.replace(source)
    rows, seen = [], set()
    accounting = dict(read=0, outside=0, invalid=0, retained=0)
    for record in pq.read_table(source).to_pylist():
        accounting['read'] += 1
        point = from_wkb(record['geometry'])
        if point.is_empty or not point.is_valid or point.geom_type != 'Point':
            accounting['invalid'] += 1
            continue
        if not county.covers(point):
            accounting['outside'] += 1
            continue
        if not record.get('id') or record['id'] in seen:
            raise ValueError('Missing or duplicate Places ID.')
        seen.add(record['id'])
        rows.append(dict(id=record['id'], version=record['version'], x=point.x, y=point.y,
                         name=(record.get('names') or {}).get('primary') or '',
                         addresses=record.get('addresses') or [], status=record.get('operating_status'),
                         confidence=record.get('confidence'), category=record.get('basic_category') or (record.get('categories') or {}).get('primary'),
                         sources=sorted({s.get('dataset', 'Unknown') for s in record.get('sources') or []})))
    accounting['retained'] = len(rows)
    if accounting['read'] != sum(accounting[k] for k in ['outside', 'invalid', 'retained']) or not rows or len(rows) > 100000:
        raise ValueError('Places accounting or bounded size check failed.')
    payload = json.dumps(dict(schemaVersion=1, release=release, rows=sorted(rows, key=lambda r: r['id'])), separators=(',', ':'), ensure_ascii=False).encode('utf-8')
    compressed = gzip.compress(payload, mtime=0)
    output = root / 'site/data/care-places'
    output.mkdir(parents=True, exist_ok=True)
    (output / (release + '.json.gz')).write_bytes(compressed)
    manifest = dict(schemaVersion=1, release=release, crs='EPSG:4326', compression='gzip',
                    file=release + '.json.gz', bytes=len(compressed), decodedBytes=len(payload),
                    sha256=hashlib.sha256(compressed).hexdigest(), count=len(rows), accounting=accounting,
                    source=f'https://stac.overturemaps.org/{release}/catalog.json',
                    license='https://docs.overturemaps.org/attribution/', notices='NOTICE.txt',
                    attribution='Overture Maps Foundation and upstream Places contributors; see source attribution.',
                    note='Public reference points in Fresno County. Confidence describes place existence, not identity matching, care licensing or current operation.')
    (output / 'index.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
    LOG.info('Prepared %d places, %d compressed bytes; %s', len(rows), len(compressed), accounting)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--release', default='2026-10-21.0')
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format='%(levelname)s %(message)s')
    build(Path(__file__).resolve().parents[1], args.release)
