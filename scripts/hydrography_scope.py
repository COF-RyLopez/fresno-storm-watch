"""Shared public map coverage for 3DHP acquisition and search preparation."""

import hashlib
import json
from pathlib import Path

BASINS = 'reservoir-watersheds.geojson'
SCOPE = 'Fresno County and the USGS drainage areas upstream of Millerton Lake and Pine Flat Lake.'


def reference_scope(boundary, helper):
    """Read pinned USGS polygons and union them with the existing county area."""
    from shapely.geometry import shape
    from shapely.ops import unary_union

    county, _ = helper['county_filter'](boundary)
    raw = boundary.with_name(BASINS).read_bytes()
    basins = json.loads(raw)['features']
    if sorted(feature['properties']['reservoir'] for feature in basins) != ['MIL', 'PNF']:
        raise ValueError('Expected the two pinned reservoir watersheds')
    shapes = [shape(feature['geometry']) for feature in basins]
    if any(g.is_empty or not g.is_valid or g.geom_type not in ('Polygon', 'MultiPolygon') for g in shapes):
        raise ValueError('Invalid upstream basin geometry')
    union = unary_union([county, *shapes])
    # Union introduces floating-point slivers where county and basin edges cross.
    # Reject material area loss and separately verify exact county source IDs.
    if not union.is_valid or any(g.difference(union).area > 1e-12 for g in [county, *shapes]):
        raise ValueError('Expanded scope omitted part of the county or a reservoir basin')
    spatial = {'rings': helper['esri_rings'](union), 'spatialReference': {'wkid': 4326}}
    return county, union, spatial, hashlib.sha256(raw).hexdigest()


def basin_manifest(root: Path) -> dict:
    """Public source identities carried into the tile manifests."""
    data = json.loads((root / 'site/data' / BASINS).read_text(encoding='utf-8'))
    return {feature['properties']['reservoir']: feature['properties'] for feature in data['features']}
