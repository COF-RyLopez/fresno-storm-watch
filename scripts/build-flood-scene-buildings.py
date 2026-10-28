"""One 3D-object (multipatch) building layer for every flood scenario, to publish as an ArcGIS Online hosted scene layer.

Usage: uv run --no-project --with shapely python -I scripts/build-flood-scene-buildings.py <out dir>
Reads site/data/flood-scenarios/*/footprints.geojson (scripts/build-flood-footprints.py). Writes into <out dir>:
  storm-watch-buildings.gdb(.zip)  multipatch feature class: closed solids of triangles, lon/lat and metres above NAVD88
                                   (via a temporary GeoJSON sequence and ogr2ogr -nlt TINZ, GDAL >= 3.6, on PATH)
  ground-cache.json                ground height per GERS ID, so reruns do not query 3DEP again
Publish: ArcGIS Online > Content > New item > the .gdb.zip > "Add and create a hosted scene layer" (3D object).

Each Overture footprint appears once (GERS ID), drawn from the ground to its height. Ground is USGS 3DEP 1 m
(elevation.nationalmap.gov getSamples, bilinear) at the mean of the footprint's outer-ring vertices; it matched the
3D page's world-elevation ground within 0.04 m at test points. Per scenario <sid> (scenario id, '-' -> '_'):
  <sid>_arr   hour water reaches the footprint (worst NSI point; null = not in that scenario)
  <sid>_t0/2/6  hour water passes 0 / 2 / 6 ft above its first floor (null = never)
  <sid>_fd    NSI fd_id of that point, for the page's popup (buildings.json)
The 3D page colours the layer with one renderer expression of the clock over these fields; a scene layer applies a
new renderer in ~50 ms (no geometry rebuild), where the client-side footprint layer took 0.15-5 s.
"""
import json
import math
import os
import shutil
import subprocess
import sys
import urllib.parse
import urllib.request

import shapely
import shapely.geometry

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'site', 'data', 'flood-scenarios')
NAME = 'storm-watch-buildings'
DEP = 'https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/getSamples'
FT = 0.3048


def signed_area(ring):
    return sum(x0 * y1 - x1 * y0 for (x0, y0, *_), (x1, y1, *_) in zip(ring, ring[1:])) / 2


def solid(geometry, z0, z1):
    """Closed solid of an extruded GeoJSON (Multi)Polygon from z0 to z1, as triangles (each a closed ring): top facing
    up, bottom facing down, two per wall edge facing out. ArcGIS Online keeps triangle multipatches but drops the shape
    of ones written as ring faces (GDAL's OuterRing parts), at least for file geodatabases."""
    out = []
    valid = shapely.make_valid(shapely.geometry.shape(geometry))
    for poly in [p for q in shapely.get_parts(valid) for p in shapely.get_parts(q) if p.geom_type == 'Polygon']:
        poly = shapely.geometry.polygon.orient(poly)  # outer CCW, holes CW
        for t in shapely.get_parts(shapely.constrained_delaunay_triangles(poly)):
            a, b, c = t.exterior.coords[:3]
            if signed_area([a, b, c, a]) < 0:
                b, c = c, b
            out.append([[*a, z1], [*b, z1], [*c, z1], [*a, z1]])
            out.append([[*a, z0], [*c, z0], [*b, z0], [*a, z0]])
        for ring in [poly.exterior, *poly.interiors]:
            for (ax, ay), (bx, by) in zip(ring.coords, ring.coords[1:]):
                out.append([[ax, ay, z0], [bx, by, z0], [bx, by, z1], [ax, ay, z0]])
                out.append([[ax, ay, z0], [bx, by, z1], [ax, ay, z1], [ax, ay, z0]])
    return out


def ground(points):
    """3DEP heights (m) for [(lon, lat)], 200 per request."""
    out = []
    for i in range(0, len(points), 200):
        q = urllib.parse.urlencode({'geometry': json.dumps({'points': points[i:i + 200], 'spatialReference': {'wkid': 4326}}),
                                    'geometryType': 'esriGeometryMultipoint', 'returnFirstValueOnly': 'true',
                                    'interpolation': 'RSP_BilinearInterpolation', 'f': 'json'})
        r = json.load(urllib.request.urlopen(urllib.request.Request(DEP, q.encode()), timeout=120))
        if 'samples' not in r:
            raise RuntimeError(f'3DEP: {r}')
        by_id = {s['locationId']: float(s['value']) for s in r['samples']}
        out += [by_id.get(k) for k in range(len(points[i:i + 200]))]
        print(f'\r3DEP ground: {len(out)} of {len(points)}', end='', file=sys.stderr)
    print(file=sys.stderr)
    return out


def selfcheck():
    square = {'type': 'Polygon', 'coordinates': [[[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]]]}  # clockwise on purpose
    f = solid(square, 100, 110)
    assert len(f) == 12 and all(len(t) == 4 and t[0] == t[3] for t in f)  # 2 top, 2 bottom, 2 per wall, closed
    assert f[0][0][2] == 110 and f[1][0][2] == 100
    assert signed_area([p[:2] for p in f[0]]) > 0 > signed_area([p[:2] for p in f[1]])  # top up, bottom down
    n = [((b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]), (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]))
         for a, b, c, _ in f[4:]]
    mid = [((a[0] + b[0] + c[0]) / 3 - 0.5, (a[1] + b[1] + c[1]) / 3 - 0.5) for a, b, c, _ in f[4:]]
    assert all(nx * mx + ny * my > 0 for (nx, ny), (mx, my) in zip(n, mid))  # walls face away from the centre
    return True


def main(out):
    selfcheck()
    os.makedirs(out, exist_ok=True)
    index = json.load(open(os.path.join(ROOT, 'index.json')))
    sids, buildings = [], {}
    for s in index['scenarios']:
        path = os.path.join(ROOT, s['id'], 'footprints.geojson')
        if not os.path.exists(path):
            continue
        sid = s['id'].replace('-', '_')
        sids.append(sid)
        for f in json.load(open(path))['features']:
            p = f['properties']
            b = buildings.setdefault(p['gers_id'], {'geometry': f['geometry'], 'height_ft': 0, 'scen': {}})
            b['height_ft'] = max(b['height_ft'], p['height_ft'])
            b['scen'][sid] = {'arr': p.get('arrive_hr'), 't0': p.get('t_in0'), 't2': p.get('t_in2'), 't6': p.get('t_in6'), 'fd': p['fd_id']}
    print(f'{len(buildings)} footprints across {len(sids)} scenarios', file=sys.stderr)

    cache_path = os.path.join(out, 'ground-cache.json')
    cache = json.load(open(cache_path)) if os.path.exists(cache_path) else {}
    polys = lambda g: [g['coordinates']] if g['type'] == 'Polygon' else g['coordinates']
    todo = [gid for gid in buildings if gid not in cache]
    centres = []
    for gid in todo:
        ring = polys(buildings[gid]['geometry'])[0][0][:-1]
        centres.append([round(sum(p[0] for p in ring) / len(ring), 7), round(sum(p[1] for p in ring) / len(ring), 7)])
    if todo:
        cache.update(zip(todo, ground(centres)))
        json.dump(cache, open(cache_path, 'w'))
    missing = [gid for gid in buildings if cache.get(gid) is None or not math.isfinite(cache[gid])]
    if missing:
        raise RuntimeError(f'{len(missing)} footprints without 3DEP ground, e.g. {missing[:3]}')

    seq = os.path.join(out, f'{NAME}.geojsonl')
    with open(seq, 'w') as f:
        for gid, b in buildings.items():
            z0 = round(cache[gid], 2)
            props = {'gers_id': gid, 'height_ft': b['height_ft'], 'ground_m': z0}
            for sid in sids:
                v = b['scen'].get(sid, {})
                props.update({f'{sid}_arr': v.get('arr'), f'{sid}_t0': v.get('t0'), f'{sid}_t2': v.get('t2'), f'{sid}_t6': v.get('t6'), f'{sid}_fd': v.get('fd')})
            geom = {'type': 'MultiPolygon', 'coordinates': [[t] for t in solid(b['geometry'], z0, round(z0 + b['height_ft'] * FT, 2))]}
            f.write(json.dumps({'type': 'Feature', 'geometry': geom, 'properties': props}, separators=(',', ':')) + '\n')

    gdb = os.path.join(out, f'{NAME}.gdb')
    shutil.rmtree(gdb, ignore_errors=True)
    types = ','.join([f'{sid}_{k}=esriFieldTypeDouble' for sid in sids for k in ('arr', 't0', 't2', 't6')] + [f'{sid}_fd=esriFieldTypeInteger' for sid in sids])
    subprocess.run(['ogr2ogr', '-f', 'OpenFileGDB', gdb, seq, '-nln', NAME.replace('-', '_'), '-nlt', 'TINZ', '-a_srs', 'EPSG:4326+5703',
                    '-lco', 'CREATE_MULTIPATCH=YES', '-lco', f'COLUMN_TYPES={types}'], check=True)
    os.remove(seq)
    shutil.make_archive(gdb, 'zip', out, os.path.basename(gdb))
    print(f'{gdb}.zip: {os.path.getsize(gdb + ".zip") / 1e6:.1f} MB; fields per scenario: <sid>_arr/_t0/_t2/_t6/_fd for {", ".join(sids)}')


if __name__ == '__main__':
    main(sys.argv[1])
