"""Building footprints for the 3D flood-scenario page: NSI points joined to Overture footprints by GERS ID.

Usage:
  uv run --no-project --with pyarrow --with shapely python -I scripts/build-flood-footprints.py \\
      <scenario dir> <overture_nsi_crosswalk.csv> <building.parquet> <nsi .fs>

<scenario dir>   site/data/flood-scenarios/<id>/ with buildings.json (NSI points with the scenario's depth fields)
<crosswalk>      evac-engine/data/overture_nsi_crosswalk.csv (fd_id -> overture_id, release 2026-09-23.1)
<building.parquet> Overture buildings for that release (uvx overturemaps download --type=building -f geoparquet)
<nsi .fs>        NSI feature stream, for num_story (buildings.json does not carry it)

Writes into <scenario dir>:
  footprints.geojson     one polygon per footprint with an NSI point; attributes of the worst-affected point
                         (largest depth_max - found_ht), people and loss summed over its points, height_ft for extrusion
  footprints-unmatched.json  fd_ids of NSI points with no footprint (the page keeps them as point symbols)
"""
import csv
import json
import sys

import pyarrow.parquet as pq
import shapely

FT_PER_M = 3.28084
FT_PER_STORY = 10.0
DEFAULT_FT = 12.0
SUMMED = ('pop_night', 'pop_day', 'loss_usd')


def height_ft(overture_m, stories):
    if overture_m and overture_m > 0:
        return round(overture_m * FT_PER_M, 1)
    if stories and stories > 0:
        return stories * FT_PER_STORY
    return DEFAULT_FT


def severity(p):
    """Higher = worse: water above the first floor at peak, earlier arrival breaks ties.
    ponytail: one representative point per footprint at maximum depth; per-time worst would need every point's ramp in Arcade."""
    return ((p['depth_max'] or 0) - (p['found_ht'] or 0), -(p['arrive_hr'] if p['arrive_hr'] is not None else 1e9))


def crossing_hr(p, above):
    """First hour the ramp depth (lib/flood-scenario-model.js rampDepth) exceeds found_ht + above, or None.
    The ramp only rises, so a footprint's class at time t is fixed by these times (the 3D page filters on them)."""
    a, pk, m = p['arrive_hr'], p['peak_hr'], p['depth_max'] or 0
    target = (p['found_ht'] or 0) + above
    if a is None or m <= target:
        return None
    f = min(1, m)
    if f > target or pk is None or pk <= a:
        return round(a, 3)
    return round(a + (target - f) / (m - f) * (pk - a), 3)


def round_coords(geom, nd=6):
    return shapely.transform(geom, lambda xy: xy.round(nd))


def selfcheck():
    assert height_ft(6.0, 1) == 19.7 and height_ft(None, 2) == 20.0 and height_ft(0, 0) == DEFAULT_FT
    a = {'depth_max': 3, 'found_ht': 1, 'arrive_hr': 5}
    b = {'depth_max': 4, 'found_ht': 3, 'arrive_hr': 1}
    c = {'depth_max': 3, 'found_ht': 1, 'arrive_hr': 2}
    assert max([a, b, c], key=severity) is c
    r = {'arrive_hr': 2, 'peak_hr': 6, 'depth_max': 5, 'found_ht': 1}
    assert crossing_hr(r, 0) == 2 and crossing_hr(r, 2) == 4 and crossing_hr(r, 6) is None  # d = 1 + (t - 2) for t in [2, 6]
    return True


def main(scenario_dir, crosswalk, parquet, nsi_fs):
    selfcheck()
    bj = json.load(open(f'{scenario_dir}/buildings.json'))
    points = [dict(zip(bj['fields'], r)) for r in bj['rows']]
    wanted = {p['fd_id'] for p in points}

    gers = {}
    with open(crosswalk) as f:
        for r in csv.DictReader(f):
            if r['overture_id'] and int(r['fd_id']) in wanted:
                gers[int(r['fd_id'])] = r['overture_id']

    stories = {}
    for rec in open(nsi_fs).read().split('\x1e'):  # RFC 8142 GeoJSON text sequence
        if rec.strip():
            p = json.loads(rec)['properties']
            if p['fd_id'] in wanted:
                stories[p['fd_id']] = p.get('num_story')

    by_fp = {}
    unmatched = []
    for p in points:
        g = gers.get(p['fd_id'])
        if g:
            by_fp.setdefault(g, []).append(p)
        else:
            unmatched.append(p['fd_id'])

    t = pq.read_table(parquet, columns=['id', 'height', 'geometry'])
    ids = t.column('id').to_pylist()
    keep = [i for i, g in enumerate(ids) if g in by_fp]
    t = t.take(keep)
    geoms = shapely.from_wkb(t.column('geometry').to_pylist())
    heights = t.column('height').to_pylist()

    feats = []
    for gid, h, geom in zip(t.column('id').to_pylist(), heights, geoms):
        pts = by_fp[gid]
        worst = max(pts, key=severity)
        props = {k: round(v, 2) if isinstance(v, float) else v for k, v in worst.items() if k not in ('lon', 'lat')}
        for k in SUMMED:
            props[k] = sum(p[k] or 0 for p in pts)
        if 'd0' not in worst:  # ramp scenarios: class-change hours for the 3D page's time filters
            props.update(t_in0=crossing_hr(worst, 0), t_in2=crossing_hr(worst, 2), t_in6=crossing_hr(worst, 6))
        props['n_points'] = len(pts)
        props['height_ft'] = height_ft(h, max((stories.get(p['fd_id']) or 0) for p in pts))
        props['gers_id'] = gid
        feats.append({'type': 'Feature', 'geometry': shapely.geometry.mapping(round_coords(geom)), 'properties': props})

    missing = set(by_fp) - set(t.column('id').to_pylist())
    for gid in missing:  # crosswalk id not in this parquet: keep its points as points
        unmatched += [p['fd_id'] for p in by_fp[gid]]

    with open(f'{scenario_dir}/footprints.geojson', 'w') as f:
        json.dump({'type': 'FeatureCollection', 'overture_release': '2026-09-23.1', 'features': feats}, f, separators=(',', ':'))
    with open(f'{scenario_dir}/footprints-unmatched.json', 'w') as f:
        json.dump(sorted(unmatched), f, separators=(',', ':'))
    matched = len(points) - len(unmatched)
    print(f'{len(points)} NSI points: {matched} on {len(feats)} footprints ({100 * matched / len(points):.1f}%), '
          f'{len(unmatched)} unmatched; {len(missing)} crosswalk ids missing from parquet; '
          f'height from Overture: {sum(1 for h in heights if h)}')


if __name__ == '__main__':
    main(*sys.argv[1:5])
