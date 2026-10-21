"""Prepare a bounded public HRRR wind field for the static F.R.O.G. app.

Python 3.12+. Select variables, one run and a regional window before reading.
Native grid vectors are rotated to true east/north before bilinear resampling.
"""
from __future__ import annotations

import argparse
import json
import logging
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import urlopen

import dynamical_catalog
import numpy as np
from pyproj import CRS, Geod, Transformer
from scipy.interpolate import RegularGridInterpolator

PRODUCT = "noaa-hrrr-forecast-48-hour"
CATALOG = f"https://stac.dynamical.org/{PRODUCT}/collection.json"
VARIABLES = ["wind_u_10m", "wind_v_10m", "wind_gust_surface"]
# Rectangular weather context, covering Fresno and upper San Joaquin/Kings.
# This is explicitly not a delineated drainage basin or an impact polygon.
BOUNDS = [-121.25, 35.75, -118.25, 38.12]
STEP = 0.03
ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "site" / "data" / "hrrr"
LOG = logging.getLogger("hrrr")


def iso(value: np.datetime64) -> str:
    """Serialize UTC model timestamps without host timezone conversion."""
    return np.datetime_as_string(value, unit="s") + "Z"


def rotate(u: np.ndarray, v: np.ndarray, x: np.ndarray, y: np.ndarray,
           inverse: Transformer) -> tuple[np.ndarray, np.ndarray]:
    """Rotate grid x/y velocities using local geodesic basis directions."""
    lon, lat = inverse.transform(x, y)
    lon_x, lat_x = inverse.transform(x + 10, y)
    lon_y, lat_y = inverse.transform(x, y + 10)
    geod = Geod(a=6371229, b=6371229)
    ax = np.deg2rad(geod.inv(lon, lat, lon_x, lat_x)[0])
    ay = np.deg2rad(geod.inv(lon, lat, lon_y, lat_y)[0])
    return u * np.sin(ax) + v * np.sin(ay), u * np.cos(ax) + v * np.cos(ay)


def numbers(values: np.ndarray) -> list[float | None]:
    """Preserve missing pixels; round velocities to 0.01 m/s."""
    return [round(float(v), 2) if np.isfinite(v) else None for v in values.ravel()]


def collect(output: Path = OUTPUT) -> dict:
    """Publish one coherent model run; commit its manifest after all frames."""
    started = time.monotonic()
    now = datetime.now(timezone.utc)
    with urlopen(CATALOG, timeout=30) as response:
        meta = json.load(response)
    if meta["id"] != PRODUCT or meta["license"] != "CC-BY-4.0":
        raise ValueError("HRRR catalog identity or license changed")
    for key in VARIABLES:
        if meta["cube:variables"][key]["unit"] != "m s-1":
            raise ValueError(f"HRRR {key} units changed")
    ds = dynamical_catalog.open(PRODUCT, chunks=None)
    for key in VARIABLES[:2]:
        expected = "x_wind" if key == VARIABLES[0] else "y_wind"
        if ds[key].attrs.get("standard_name") != expected:
            raise ValueError("Native HRRR wind convention changed")
    crs = CRS.from_wkt(ds.spatial_ref.attrs["crs_wkt"])
    forward = Transformer.from_crs(4326, crs, always_xy=True)
    inverse = Transformer.from_crs(crs, 4326, always_xy=True)
    # Project the entire rectangle perimeter before selecting the source window.
    edge_x = np.linspace(BOUNDS[0], BOUNDS[2], 100)
    edge_y = np.linspace(BOUNDS[1], BOUNDS[3], 100)
    bx, by = forward.transform(np.r_[edge_x, edge_x, np.full(100, BOUNDS[0]), np.full(100, BOUNDS[2])],
                               np.r_[np.full(100, BOUNDS[1]), np.full(100, BOUNDS[3]), edge_y, edge_y])
    region = ds[VARIABLES].sel(x=slice(min(bx)-6000, max(bx)+6000),
                               y=slice(max(by)+6000, min(by)-6000))
    xs = np.arange(BOUNDS[0], BOUNDS[2] + STEP/2, STEP)
    ys = np.arange(BOUNDS[3], BOUNDS[1] - STEP/2, -STEP)
    lon, lat = np.meshgrid(xs, ys)
    target_x, target_y = forward.transform(lon, lat)
    candidates = []
    for index in (-1, -2, -3):
        stamp = ds.init_time.values[index]
        age = (np.datetime64(now.replace(tzinfo=None), "ns")-stamp)/np.timedelta64(1, "h")
        if 0 <= age <= 18:
            candidates.append(index)
    output.mkdir(parents=True, exist_ok=True)
    for index in candidates:
        run = region.isel(init_time=index)
        leads = run.lead_time.values/np.timedelta64(1, "h")
        if not np.array_equal(leads, np.arange(49)):
            raise ValueError("Expected hourly HRRR leads 0–48")
        # Bounded ~110x100 source cells; no full-domain reads.
        run = run.load()
        if not all(np.isfinite(run[k].values).all() for k in VARIABLES):
            LOG.warning("Run %s incomplete; checking earlier coherent run", iso(run.init_time.values))
            continue
        native_x, native_y = np.meshgrid(run.x.values, run.y.values)
        east, north = rotate(run[VARIABLES[0]].values, run[VARIABLES[1]].values,
                             native_x, native_y, inverse)
        fields = [east, north, run[VARIABLES[2]].values]
        if np.any(fields[2] < 0) or np.any(np.hypot(east, north) > 150) or np.any(fields[2] > 200):
            raise ValueError("Implausible HRRR velocities")
        run_id = iso(run.init_time.values)
        name = run_id.replace("-", "").replace(":", "")
        frames = []
        for hour in range(49):
            arrays = [RegularGridInterpolator((run.y.values, run.x.values), f[hour],
                      bounds_error=False, fill_value=np.nan)((target_y, target_x)) for f in fields]
            if not all(np.isfinite(a).all() for a in arrays):
                raise ValueError("Regional output contains unsupported/missing pixels")
            payload = {"schemaVersion": 1, "run": run_id, "leadHours": hour,
                       "valid": iso(run.init_time.values + np.timedelta64(hour, "h")),
                       "width": len(xs), "height": len(ys),
                       "u": numbers(arrays[0]), "v": numbers(arrays[1]), "gust": numbers(arrays[2])}
            file = f"{name}-f{hour:02}.json"
            temporary = output / (file + ".tmp")
            temporary.write_text(json.dumps(payload, separators=(",", ":"), allow_nan=False), encoding="utf-8")
            temporary.replace(output / file)
            frames.append({"file": file, "valid": payload["valid"], "leadHours": hour})
        manifest = {"schemaVersion": 1, "generatedAt": now.isoformat(), "run": run_id,
                    "product": PRODUCT, "catalog": CATALOG, "license": meta["license"],
                    "attribution": meta["attribution"], "units": "m/s", "vectorConvention": "earth-east-north",
                    "nativeResolutionKm": 3, "grid": {"wkid": 4326, "width": len(xs), "height": len(ys),
                    "x0": float(xs[0]), "y0": float(ys[0]), "dx": STEP, "dy": -STEP},
                    "coverageNote": "Rectangular Fresno County and upper San Joaquin/Kings weather context; not watershed boundaries.",
                    "processing": "Grid-relative winds rotated to earth east/north, then bilinearly resampled to 0.03 degree cells; hourly instantaneous model snapshots.",
                    "frames": frames, "error": None}
        temporary = output / "latest.json.tmp"
        temporary.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
        temporary.replace(output / "latest.json")
        LOG.info("%s", json.dumps({"event": "hrrr-collection", "run": run_id, "frames": len(frames),
                 "sourceCellsPerFrame": int(run.x.size*run.y.size), "outputCellsPerFrame": len(xs)*len(ys),
                 "durationSeconds": round(time.monotonic()-started, 1)}))
        return manifest
    raise ValueError("No complete HRRR run in the last 18 hours")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=OUTPUT)
    args = parser.parse_args()
    try:
        collect(args.output)
    except Exception as error:
        # CLI boundary: log the actual exception and publish explicit unavailability.
        # Optional feed failure must not block closures/alerts and other collectors.
        LOG.exception("HRRR collection failed")
        # Preserve previous files, but explicitly fail closed in the browser.
        previous = args.output / "latest.json"
        if previous.exists():
            manifest = json.loads(previous.read_text(encoding="utf-8"))
            manifest["error"] = f"Collection failed: {type(error).__name__}"
            previous.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
        else:
            args.output.mkdir(parents=True, exist_ok=True)
            previous.write_text(json.dumps({"schemaVersion": 1, "error": f"HRRR collection failed: {type(error).__name__}",
                                "generatedAt": datetime.now(timezone.utc).isoformat()}), encoding="utf-8")
        print(f"::warning title=HRRR feed unavailable::{type(error).__name__}; the app will hide the unavailable HRRR field")
