"""Read-only Fresno irrigation source audit. Requires requirements-waterways.txt.

Writes provenance and aggregate findings under work/irrigation-discovery only.
Does not publish district data or modify GIS services. FID's archive requires
authorization for reuse; optional inspection reads a locally downloaded ZIP.
"""
from __future__ import annotations

import argparse
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
import logging
from pathlib import Path
import struct
from typing import Any
import xml.etree.ElementTree as ET
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[1]
CALWATRS = 'https://cw-gis.waterboards.ca.gov/hosted/rest/services/Public/cal_watrs_gis_water_rights/FeatureServer'
OUT = ROOT / 'work' / 'irrigation-discovery'
FIELDS = ['objectid', 'globalid', 'legacy_pod_id', 'wr_id', 'name',
          'diversion_type', 'diversion_subtype', 'diversion_status',
          'data_management_status', 'water_course_name', 'last_edited_date']
LOG = logging.getLogger('irrigation-audit')


def audit_attributes(rows: list[dict[str, Any]]) -> dict[str, Any]:
    """Describe missing classifications; never equate record status with flow."""
    return {'records': len(rows),
            'uniqueNonblankIds': {field: len({r[field] for r in rows if r.get(field)})
                                 for field in ['globalid', 'legacy_pod_id', 'wr_id']},
            'categories': {field: dict(Counter(str(r.get(field)) for r in rows))
                           for field in ['diversion_type', 'diversion_subtype',
                                         'diversion_status', 'data_management_status']},
            'populated': {field: sum(r.get(field) not in (None, '') for r in rows)
                          for field in ['water_course_name', 'last_edited_date']},
            'interpretation': 'Records are regulatory references, not unique verified physical assets. Active/Inactive is data-management status, not operating state.'}


def inspect_fid(path: Path) -> dict[str, Any]:
    """Inspect DBF inventory categories and embedded terms without extracting files."""
    with ZipFile(path) as archive:
        data = archive.read('Facilities.dbf')
        metadata = ET.fromstring(archive.read('Facilities.shp.xml'))
        crs = archive.read('Facilities.prj').decode('ascii')
    count, header, row_length = struct.unpack_from('<IHH', data, 4)
    if len(data) < header + count * row_length:
        raise RuntimeError('Truncated FID DBF')
    fields, offset = [], 1
    for pos in range(32, header - 1, 32):
        if data[pos] == 13:
            break
        descriptor = data[pos:pos + 32]
        name = descriptor[:11].split(b'\0')[0].decode('ascii')
        fields.append((name, descriptor[16], offset))
        offset += descriptor[16]
    selected = {'Status', 'TYPE_FACIL', 'OWNERSHIP', 'Normal_cfs', 'Max_cfs'}
    categories = {name: Counter() for name, _, _ in fields if name in selected}
    active_rows, deleted_rows = 0, 0
    for i in range(count):
        row = data[header + i * row_length:header + (i + 1) * row_length]
        if row[:1] == b'*':
            deleted_rows += 1
            continue
        active_rows += 1
        for name, length, start in fields:
            if name in selected:
                categories[name][row[start:start + length].decode('cp1252').strip()] += 1
    terms = [e.text for e in metadata.iter() if e.text and
             any(key in e.tag.lower() for key in ['accconst', 'useconst'])]
    return {'archiveSha256': hashlib.sha256(path.read_bytes()).hexdigest(),
            'records': count, 'readRows': active_rows, 'deletedRows': deleted_rows,
            'categories': {name: dict(values) for name, values in categories.items()},
            'sourceCrsWkt': crs, 'terms': terms,
            'interpretation': 'Historical 2018 reference; zero capacity values are not verified zero capacity. Authorization/current replacement required before publication.'}


def main() -> None:
    """Audit complete county-intersecting IDs and retain aggregate evidence locally."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--fid-archive', type=Path, help='Optional local FID 2018 ZIP to inspect; never republished')
    args = parser.parse_args()
    spec = importlib.util.spec_from_file_location('waterways', ROOT / 'scripts' / 'export-waterways.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    def query(layer: int, params: dict[str, Any]) -> dict[str, Any]:
        """POST bounded read-only queries; fail on service errors instead of truncating."""
        return module.request_json(f'{CALWATRS}/{layer}/query', params, timeout=60, error=f'CalWATRS layer {layer}', headers={})

    boundary = ROOT / 'site' / 'data' / 'counties.geojson'
    _, geometry = module.county_filter(boundary)
    spatial = {'where': '1=1', 'geometry': json.dumps(geometry),
               'geometryType': 'esriGeometryPolygon', 'inSR': 4326,
               'spatialRel': 'esriSpatialRelIntersects'}
    ids_response = query(0, {**spatial, 'returnIdsOnly': 'true'})
    if ids_response.get('exceededTransferLimit') or 'objectIds' not in ids_response:
        raise RuntimeError('Incomplete CalWATRS ID inventory')
    ids = ids_response['objectIds']

    def batch(chunk: list[int]) -> list[dict[str, Any]]:
        """Reconcile every requested object ID; the service can silently lower limits."""
        result = query(0, {'objectIds': ','.join(map(str, chunk)),
                          'returnGeometry': 'false', 'outFields': ','.join(FIELDS)})
        rows = [feature['attributes'] for feature in result.get('features', [])]
        if result.get('exceededTransferLimit') or len(rows) != len(chunk) or {r['objectid'] for r in rows} != set(chunk):
            raise RuntimeError('Incomplete or duplicate CalWATRS batch')
        return rows

    rows = []
    with ThreadPoolExecutor(max_workers=3) as pool:
        for chunk in pool.map(batch, [ids[i:i + 150] for i in range(0, len(ids), 150)]):
            rows.extend(chunk)
    counts = {str(layer): query(layer, {**spatial, 'returnCountOnly': 'true'})['count']
              for layer in [0, 1, 2, 4, 5, 8]}
    current_ids = query(0, {**spatial, 'returnIdsOnly': 'true'}).get('objectIds')
    if counts['0'] != len(rows) or current_ids is None or set(current_ids) != set(ids):
        raise RuntimeError('County source inventory changed during acquisition; rerun the audit')
    report = {'checkedAt': datetime.now(timezone.utc).isoformat(), 'source': CALWATRS,
              'countyGeoid': '06019', 'boundarySha256': hashlib.sha256(boundary.read_bytes()).hexdigest(),
              'countsByLayerId': counts, 'diversionAudit': audit_attributes(rows),
              'crs': 'County query EPSG:4326; native CalWATRS EPSG:3310; attributes only, no geometry exported',
              'publishedData': False}
    if args.fid_archive:
        report['fidHistoricalAudit'] = inspect_fid(args.fid_archive)
    OUT.mkdir(parents=True, exist_ok=True)
    target = OUT / 'audit.json'
    temporary = target.with_suffix('.tmp')
    temporary.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    temporary.replace(target)
    LOG.info('CalWATRS IDs expected=%s read=%s; summary=%s', len(ids), len(rows), target)


if __name__ == '__main__':
    logging.basicConfig(level=logging.INFO, format='%(levelname)s %(message)s')
    main()
