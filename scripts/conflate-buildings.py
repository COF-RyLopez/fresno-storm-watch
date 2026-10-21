"""Link a bounded NSI subset to county/Overture footprints without inventing matches.

Inputs: WKB GeoParquet or RFC7946 GeoJSON, explicit source/release metadata.
Outputs stay private: GeoParquet footprints, links/unmatched, accounting and a
bounded display GeoJSON. No nearest-neighbor guess, hydraulic or damage model.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import logging
import math
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pyarrow as pa
import pyarrow.parquet as pq
from pyproj import CRS, Transformer
from shapely import STRtree, from_wkb, make_valid, to_wkb
from shapely.geometry import mapping, shape
from shapely.ops import transform

LOG = logging.getLogger(__name__)
FOOT_TO_METERS = 0.3048
MAX_PREVIEW_BUILDINGS = 25000


def finite(value: Any) -> float | None:
    """Preserve unknown; booleans and nonnumeric strings are not measurements."""
    return float(value) if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) else None


def read_geo(path: Path) -> tuple[list[dict[str, Any]], str]:
    """Read explicit CRS/WKB metadata and transform XY to WGS84."""
    if path.suffix.lower() in {".json", ".geojson"}:
        data = json.loads(path.read_text(encoding="utf-8"))
        if data.get("type") != "FeatureCollection" or data.get("crs"):
            raise ValueError("GeoJSON must be RFC7946 (WGS84, no legacy CRS override).")
        return [{**f["properties"], "geometry": shape(f["geometry"])} for f in data["features"]], "EPSG:4326"
    table = pq.read_table(path)
    geo = json.loads((table.schema.metadata or {}).get(b"geo", b"{}"))
    column = geo.get("primary_column")
    metadata = geo.get("columns", {}).get(column, {})
    if not column or metadata.get("encoding") != "WKB":
        raise ValueError("GeoParquet WKB metadata is required.")
    source = CRS.from_user_input(metadata["crs"]) if metadata.get("crs") else CRS.from_user_input("OGC:CRS84")
    if "crs" in metadata and metadata["crs"] is None:
        raise ValueError("Undefined GeoParquet CRS must be resolved first.")
    project = Transformer.from_crs(source, "EPSG:4326", always_xy=True).transform
    rows = table.to_pylist()
    for row in rows:
        row["geometry"] = transform(project, from_wkb(row.pop(column)))
    return rows, source.to_string()


def conflate(nsi: list[dict[str, Any]], overture: list[dict[str, Any]], county: list[dict[str, Any]]) -> dict[str, Any]:
    """Indexed spatial match, roughly O((N+M) log M), retaining ambiguity."""
    buildings, rejected = [], []
    for origin, rows in [("county", county), ("overture", overture)]:
        seen: set[str] = set()
        for row in rows:
            source_id = str(row.get("asset_id") if origin == "county" else row.get("id"))
            if source_id in {"None", ""} or source_id in seen:
                raise ValueError(f"Missing/duplicate {origin} footprint identifier.")
            seen.add(source_id)
            geom = row.get("geometry")
            if geom is None or geom.is_empty:
                rejected.append({"source": origin, "source_id": source_id, "reason": "empty geometry"})
                continue
            repaired = not geom.is_valid
            geom = make_valid(geom) if repaired else geom
            if geom.geom_type not in {"Polygon", "MultiPolygon"}:
                rejected.append({"source": origin, "source_id": source_id, "reason": "non-polygon after validation"})
                continue
            minx, miny, maxx, maxy = geom.bounds
            if not (-180 <= minx <= maxx <= 180 and -90 <= miny <= maxy <= 90):
                raise ValueError("XY coordinates are not WGS84 longitude/latitude.")
            height = finite(row.get("height_m") if origin == "county" else row.get("height"))
            buildings.append({"building_id": f"{origin}:{source_id}", "source_id": source_id, "source": origin,
                              "source_version": str(row.get("version", "unspecified")), "geometry": geom,
                              "geometry_repaired": repaired, "display_height_m": height if height is not None and height > 0 else None,
                              "height_quality": "source-reported" if height is not None and height > 0 else "unknown"})
    buildings.sort(key=lambda b: b["building_id"])
    tree = STRtree([b["geometry"] for b in buildings]) if buildings else None
    links, unmatched, seen_nsi = [], [], set()
    for row in nsi:
        fid = str(row.get("fd_id"))
        if fid in {"None", ""} or fid in seen_nsi:
            raise ValueError("Missing/duplicate NSI fd_id; resolve duplicates before conflation.")
        seen_nsi.add(fid)
        point = row.get("geometry")
        if point is None or point.is_empty or point.geom_type != "Point" or not point.is_valid:
            unmatched.append({"fd_id": fid, "reason": "invalid NSI point", "candidates": []})
            continue
        candidates = [buildings[int(i)] for i in tree.query(point) if buildings[int(i)]["geometry"].covers(point)] if tree is not None else []
        local = [b for b in candidates if b["source"] == "county"]
        preferred = local if local else candidates
        if len(preferred) != 1:
            unmatched.append({"fd_id": fid, "reason": "ambiguous" if preferred else "no containing footprint", "candidates": [b["building_id"] for b in preferred]})
            continue
        building = preferred[0]
        foundation_ft, ground_m = finite(row.get("found_ht")), finite(row.get("grnd_elv_m"))
        links.append({"fd_id": fid, "building_id": building["building_id"], "method": "point-in-footprint-county-first",
                      "confidence": "spatial-candidate-unreviewed", "review_status": "unreviewed",
                      "foundation_height_m": foundation_ft * FOOT_TO_METERS if foundation_ft is not None and foundation_ft >= 0 else None,
                      "ground_elevation_m": ground_m, "ground_reference": "NSI NAVD88 (modeled)" if ground_m is not None else None,
                      "nsi_footprint_id": str(row.get("ftprntid")) if row.get("ftprntid") is not None else None})
    # Suppress duplicate Overture display where any county footprint intersects.
    # Do not silently merge it: retain each suppressed geometry in the analysis file.
    locals_ = [b["geometry"] for b in buildings if b["source"] == "county"]
    local_tree = STRtree(locals_) if locals_ else None
    for building in buildings:
        building["display_preferred"] = building["source"] == "county" or local_tree is None or not any(locals_[int(i)].intersects(building["geometry"]) for i in local_tree.query(building["geometry"]))
    links.sort(key=lambda r: r["fd_id"])
    unmatched.sort(key=lambda r: r["fd_id"])
    rejected.sort(key=lambda r: (r["source"], r["source_id"]))
    assert len(links) + len(unmatched) == len(nsi)
    return {"buildings": buildings, "links": links, "unmatched": unmatched, "rejected": rejected,
            "accounting": {"nsi_input": len(nsi), "footprints_input": len(overture) + len(county), "footprints_retained": len(buildings),
                           "footprints_rejected": len(rejected), "nsi_matched": len(links), "nsi_unmatched": len(unmatched),
                           "physical_buildings_with_nsi": len({r["building_id"] for r in links}), "occupancy_records_matched": len(links)}}


def write_outputs(result: dict[str, Any], output: Path, sources: dict[str, Any]) -> None:
    """Write versioned analysis files; verify geometry/ID round trips."""
    if output.exists() and any(output.iterdir()):
        raise ValueError("Use a new, empty output directory; existing artifacts are preserved.")
    public = Path(__file__).resolve().parents[1] / "site"
    if output.resolve().is_relative_to(public):
        raise ValueError("Exposure products must not be written into the public website.")
    output.mkdir(parents=True, exist_ok=True)
    buildings = [{**b, "geometry": to_wkb(b["geometry"])} for b in result["buildings"]]
    if not buildings:
        raise ValueError("No valid footprint geometries to export.")
    table = pa.Table.from_pylist(buildings)
    metadata = dict(table.schema.metadata or {})
    metadata[b"geo"] = json.dumps({"version": "1.1.0", "primary_column": "geometry", "columns": {"geometry": {"encoding": "WKB", "geometry_types": sorted({b["geometry"].geom_type for b in result["buildings"]}), "crs": CRS.from_epsg(4326).to_json_dict()}}}).encode()
    pq.write_table(table.replace_schema_metadata(metadata), output / "footprints.parquet", compression="snappy")
    for key in ["links", "unmatched", "rejected"]:
        (output / f"{key}.json").write_text(json.dumps(result[key], indent=2, allow_nan=False), encoding="utf-8")
        if result[key]:
            pq.write_table(pa.Table.from_pylist(result[key]), output / f"{key}.parquet", compression="snappy")
    restored, _ = read_geo(output / "footprints.parquet")
    if [r["building_id"] for r in restored] != [b["building_id"] for b in result["buildings"]] or any(not a["geometry"].equals_exact(b["geometry"], 1e-10) for a, b in zip(restored, result["buildings"])):
        raise ValueError("GeoParquet round-trip did not preserve geometry/identity.")
    preview = [b for b in result["buildings"] if b["display_preferred"]]
    if len(preview) <= MAX_PREVIEW_BUILDINGS:
        (output / "building-preview.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": [{"type": "Feature", "geometry": mapping(b["geometry"]), "properties": {k: v for k, v in b.items() if k != "geometry"}} for b in preview]}, allow_nan=False), encoding="utf-8")
    receipt = {"schemaVersion": 1, "createdAt": datetime.now(timezone.utc).isoformat(), "crs": "EPSG:4326", "sources": sources,
               "accounting": result["accounting"], "classification": "unreviewed exposure linkage; not hydraulic output",
               "license_note": "Retain Overture/NSI/county attribution and applicable ODbL derivative obligations. County records retain their source access classification.",
               "preview": "bounded GeoJSON" if len(preview) <= MAX_PREVIEW_BUILDINGS else "requires vector tiling; no whole-area browser dump"}
    (output / "provenance.json").write_text(json.dumps(receipt, indent=2), encoding="utf-8")
    LOG.info("Exposure accounting: %s", result["accounting"])


def main() -> None:
    """Process explicitly supplied bounded extracts; never download private data implicitly."""
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ["nsi", "overture"]:
        parser.add_argument(f"--{name}", type=Path, required=True)
    parser.add_argument("--county", type=Path)
    parser.add_argument("--nsi-release", required=True)
    parser.add_argument("--overture-release", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    nsi, nsi_crs = read_geo(args.nsi)
    overture, overture_crs = read_geo(args.overture)
    county, county_crs = read_geo(args.county) if args.county else ([], None)
    paths = {"nsi": args.nsi, "overture": args.overture, "county": args.county}
    sources = {name: {"file": path.name, "sha256": hashlib.sha256(path.read_bytes()).hexdigest()} for name, path in paths.items() if path}
    sources.update({"nsi_release": args.nsi_release, "overture_release": args.overture_release, "input_crs": {"nsi": nsi_crs, "overture": overture_crs, "county": county_crs}})
    write_outputs(conflate(nsi, overture, county), args.output, sources)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    main()
