"""Pack each scenario's footprints.geojson (scripts/build-flood-footprints.py) into footprints-3js.bin for flood-scenario-3js.

The geojson is not committed (23 MB for Big Dry Creek); the three.js page needs only the outer rings and the class hours, so
this writes a gzip of fixed little-endian arrays (layout in site/lib/flood-three-model.js parseFootprints):
  b'FP3J' uint32 version=1 uint32 n uint32 nv float64 ox float64 oy  (32-byte header; origin = scenario extent centre, EPSG:3857)
  uint32 ring_start[n+1] | float32 xy[2 nv] (metres from origin) | float32 attr[5 n] (arrive_hr t_in0 t_in2 t_in6 height_ft, NaN
  = never) | int32 fd_id[n]
ponytail: outer rings only (a few dozen footprints have courtyards); keep holes if close-up views need them.

Usage: python3 scripts/build-flood-footprints-3js.py [--src DIR]   (DIR holds <scenario>/footprints.geojson; default site/data/flood-scenarios)
"""
import argparse, gzip, json, math, struct
from array import array
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / 'site/data/flood-scenarios'
R = 6378137.0


def mercator(lon, lat):
    return R * math.radians(lon), R * math.log(math.tan(math.pi / 4 + math.radians(lat) / 2))


def pack(geojson, extent):
    ox, oy = (extent['xmin'] + extent['xmax']) / 2, (extent['ymin'] + extent['ymax']) / 2
    start, xy, attr, fd = array('I', [0]), array('f'), array('f'), array('i')
    for f in geojson['features']:
        g, p = f['geometry'], f['properties']
        polys = [g['coordinates']] if g['type'] == 'Polygon' else g['coordinates']
        ring = max((poly[0] for poly in polys), key=len)  # MultiPolygon: the largest part
        if ring[0] == ring[-1]: ring = ring[:-1]
        if len(ring) < 3: continue
        for lon, lat in ring:
            x, y = mercator(lon, lat)
            xy.extend((x - ox, y - oy))
        start.append(len(xy) // 2)
        attr.extend(math.nan if p.get(k) is None else p[k] for k in ('arrive_hr', 't_in0', 't_in2', 't_in6', 'height_ft'))
        fd.append(p['fd_id'])
    n = len(fd)
    head = b'FP3J' + struct.pack('<III', 1, n, len(xy) // 2) + struct.pack('<dd', ox, oy)
    for a in (start, xy, attr, fd):
        if a.itemsize != 4: raise SystemExit('unexpected array item size')
    return gzip.compress(head + start.tobytes() + xy.tobytes() + attr.tobytes() + fd.tobytes(), 9, mtime=0), n


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--src', type=Path, default=ROOT)
    src = ap.parse_args().src
    for sid in [s['id'] for s in json.loads((ROOT / 'index.json').read_text())['scenarios']]:
        geo = src / sid / 'footprints.geojson'
        if not geo.exists():
            print(f'{sid}: no footprints.geojson, skipped'); continue
        blob, n = pack(json.loads(geo.read_text()), json.loads((ROOT / sid / 'scenario.json').read_text())['extent'])
        (ROOT / sid / 'footprints-3js.bin').write_bytes(blob)
        print(f'{sid}: {n} footprints, {len(blob) / 1e6:.2f} MB')


if __name__ == '__main__':
    main()
