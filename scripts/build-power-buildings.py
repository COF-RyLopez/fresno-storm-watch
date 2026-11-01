"""Build public, spatially chunked Fresno Overture footprints and contained addresses.

Run in work/exposure-env after installing scripts/building-requirements.txt.
Only public Overture inputs are read; no county assets, outages or credentials
are exported. A pinned release makes the spatial join reproducible.
"""
from __future__ import annotations

import argparse
import hashlib
import gzip
import json
import logging
import math
import runpy
from collections import defaultdict
from pathlib import Path
from typing import Any

from overturemaps.core import record_batch_reader
from shapely import STRtree, from_wkb

LOG = logging.getLogger(__name__)
CELL = 0.05


def contained_addresses(buildings: list[dict[str, Any]], addresses: list[dict[str, Any]]) -> dict[str, int]:
    """Join only uniquely containing footprints; preserve multi-address buildings.

    Indexed O((B+A) log B). No nearest-address or parcel-centroid fallback.
    Boundary/overlapping footprints remain ambiguous, never guessed.
    """
    tree = STRtree([b["geom"] for b in buildings])
    stats = defaultdict(int)
    for address in addresses:
        point = address["geom"]
        hits = [int(i) for i in tree.query(point) if buildings[int(i)]["geom"].covers(point)]
        label = " ".join(str(address.get(k) or "").strip() for k in ("number", "street")).strip()
        if not address.get("number") or not address.get("street"):
            stats["incomplete_address"] += 1
        elif len(hits) == 1:
            b = buildings[hits[0]]
            b.setdefault("addresses", set()).add(label + (" · unit " + str(address["unit"]) if address.get("unit") else ""))
            stats["matched_address_records"] += 1
        else:
            stats["ambiguous_address_records" if hits else "unmatched_address_records"] += 1
    return dict(stats)


def acquire(kind: str, release: str, bbox: tuple[float, ...], cache: Path,
            columns: tuple[str, ...] = ("id", "version", "geometry", "height", "sources", "number", "street", "unit"),
            path: Path | None = None, error: str | None = None) -> list[dict[str, Any]]:
    """Stream bbox-filtered GeoParquet (requested columns the release has); cache public rows for a repeatable rerun."""
    import pyarrow.parquet as pq
    import pyarrow as pa
    path = path or cache / (kind + ".parquet")
    if not path.exists():
        reader = record_batch_reader(kind, bbox=bbox, release=release, connect_timeout=20, request_timeout=90)
        if reader is None:
            raise RuntimeError(error or f"Overture {kind} query failed.")
        columns = [k for k in columns if k in reader.schema.names]
        schema = pa.schema([reader.schema.field(k) for k in columns])
        with pq.ParquetWriter(path.with_suffix(".tmp"), schema, compression="zstd") as writer:
            count = 0
            for batch in reader:
                writer.write_batch(batch.select(columns))
                count += batch.num_rows
                LOG.info("Read %s: %d bbox records", kind, count)
        path.with_suffix(".tmp").replace(path)
    return pq.read_table(path).to_pylist()


def build(root: Path, release: str) -> None:
    """Filter exact county geometry, join public addresses and write indexed chunks."""
    helper = runpy.run_path(str(root / "scripts/export-waterways.py"))
    county = helper["county_filter"](root / "site/data/counties.geojson")[0]
    cache = root / "work" / ("power-buildings-" + release)
    cache.mkdir(parents=True, exist_ok=True)
    buildings, seen, invalid = [], set(), 0
    for row in acquire("building", release, county.bounds, cache):
        geom = from_wkb(row.pop("geometry"))
        if geom.is_empty or not geom.is_valid or geom.geom_type not in {"Polygon", "MultiPolygon"}:
            invalid += 1
            continue
        if not county.intersects(geom):
            continue
        if not row.get("id") or row["id"] in seen:
            raise ValueError("Missing or duplicate Overture building ID.")
        seen.add(row["id"])
        buildings.append({**row, "geom": geom})
    addresses = []
    for row in acquire("address", release, county.bounds, cache):
        geom = from_wkb(row.pop("geometry"))
        if geom.geom_type == "Point" and geom.is_valid and county.covers(geom):
            addresses.append({**row, "geom": geom})
    county_addresses = [a for a in addresses if any(s.get("dataset") == "us/ca/fresno" for s in a.get("sources") or [])]
    stats = contained_addresses(buildings, county_addresses)
    stats["other_address_sources_excluded"] = len(addresses) - len(county_addresses)
    tiles = defaultdict(list)
    for b in sorted(buildings, key=lambda b: b["id"]):
        height = b.get("height")
        height = height if isinstance(height, (int, float)) and not isinstance(height, bool) and math.isfinite(height) and 0 < height <= 850 else None
        center = b["geom"].representative_point()
        key = f"{math.floor(center.x / CELL)}_{math.floor(center.y / CELL)}"
        sources = sorted({s.get("dataset", "Unknown") for s in b.get("sources") or []})
        tiles[key].append({"id": b["id"], "version": b["version"], "height": height,
                           "addresses": sorted(b.get("addresses", [])), "sources": sources,
                           "geometry": {"rings": helper["esri_rings"](b["geom"]), "spatialReference": {"wkid": 4326}}})
    output = root / "site/data/power-buildings" / release
    output.mkdir(parents=True, exist_ok=True)
    index = []
    for key, rows in sorted(tiles.items()):
        points = [p for row in rows for ring in row["geometry"]["rings"] for p in ring]
        bbox = [min(p[0] for p in points), min(p[1] for p in points), max(p[0] for p in points), max(p[1] for p in points)]
        payload = json.dumps({"schemaVersion": 1, "release": release, "rows": rows}, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
        compressed = gzip.compress(payload, mtime=0)
        (output / (key + ".json.gz")).write_bytes(compressed)
        index.append({"key": key, "bbox": bbox, "count": len(rows), "bytes": len(compressed), "decodedBytes": len(payload), "sha256": hashlib.sha256(compressed).hexdigest()})
    manifest = {"schemaVersion": 1, "release": release, "scope": "Fresno County 06019; whole intersecting building footprints", "crs": "EPSG:4326", "heightUnit": "metres", "addressMethod": "unique point-in-footprint; no nearest-address inference",
                "source": f"https://stac.overturemaps.org/{release}/catalog.json", "attribution": "© OpenStreetMap contributors, Overture Maps Foundation; Microsoft, Esri and upstream contributors. Addresses: OpenAddresses contributors via Overture.", "license": "https://docs.overturemaps.org/attribution/", "buildings": len(buildings), "withHeight": sum(bool(b.get("height") and 0 < b["height"] <= 850) for b in buildings), "withAddress": sum(bool(b.get("addresses")) for b in buildings), "invalidGeometryExcluded": invalid, "addressRecords": len(addresses), "addressAccounting": stats, "tiles": index,
                "compression": "gzip", "addressSources": ["us/ca/fresno via OpenAddresses / Overture"]}
    (root / "site/data/power-buildings/index.json").write_text(json.dumps(manifest, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
    LOG.info("Built %d county footprints (%d with address) in %d chunks; %s", len(buildings), manifest["withAddress"], len(tiles), stats)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--release", default="2026-10-21.0")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    build(Path(__file__).resolve().parents[1], args.release)
