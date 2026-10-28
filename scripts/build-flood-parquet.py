"""Flood-scenario buildings.json (columnar {fields, rows}) -> buildings.parquet for the playback page's ParquetLayer.

Usage: python -I build-flood-parquet.py site/data/flood-scenarios/<id>
Run with requirements-waterways.txt (pyarrow). Writes <dir>/buildings.parquet next to buildings.json, which stays
the validated source (tests/flood-scenario.test.mjs).

lon/lat become plain longitude/latitude columns, not a GeoParquet WKB geometry: the ArcGIS Maps SDK 5.1
ParquetLayer (beta) reads longitude/latitude but returns no geometry for WKB points. Depth samples d0..dN are
rounded to 0.01 ft (buildings.json carries float32 noise such as 1.0700000524520874).
"""
import json
import sys
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq

INTEGER = {'fd_id', 'stories', 'val_struct', 'pop_night', 'pop_day', 'loss_usd', 'peak_hr'}

d = Path(sys.argv[1])
b = json.loads((d / 'buildings.json').read_text())
cols = {f: [r[i] for r in b['rows']] for i, f in enumerate(b['fields'])}
out = {'longitude': cols.pop('lon'), 'latitude': cols.pop('lat')}
for name, values in cols.items():
    if name in INTEGER:
        out[name] = pa.array(values, pa.int64())
    elif name == 'occtype':
        out[name] = pa.array(values, pa.string())
    elif name[0] == 'd' and name[1:].isdigit():
        out[name] = pa.array([None if v is None else round(v, 2) for v in values], pa.float64())
    else:
        out[name] = pa.array(values, pa.float64())
pq.write_table(pa.table(out), d / 'buildings.parquet', compression='snappy')
print(f"{d / 'buildings.parquet'}: {len(b['rows'])} buildings, {len(out)} columns")
