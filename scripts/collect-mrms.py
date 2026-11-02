"""Prepare the last 24 hours of NOAA MRMS observed rainfall for the static F.R.O.G. app.

Python 3.12+, same environment as collect-hrrr.py. MRMS is a radar + rain-gauge analysis
(Dynamical's precipitation_surface: MultiSensor pass 2 with fallbacks), ~1 km, hourly, about
an hour behind real time. Output uses the HRRR display grid so the browser shares one raster path.
"""
from __future__ import annotations

import json
import logging
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import urlopen

import dynamical_catalog
import numpy as np
from scipy.interpolate import RegularGridInterpolator

PRODUCT = "noaa-mrms-conus-analysis-hourly"
CATALOG = f"https://stac.dynamical.org/{PRODUCT}/collection.json"
VARIABLE = "precipitation_surface"
# Same rectangle and 0.03 degree display grid as the HRRR fields (101 x 80 cells).
BOUNDS = [-121.25, 35.75, -118.25, 38.12]
STEP = 0.03
HOURS = 24
IN_PER_HOUR = 3600 / 25.4
ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "site" / "data" / "mrms"
LOG = logging.getLogger("mrms")


def iso(value: np.datetime64) -> str:
    return np.datetime_as_string(value, unit="s") + "Z"


def numbers(values: np.ndarray) -> list[float | None]:
    """Missing stays null (no radar coverage), distinct from a measured 0; 0.001 in resolution."""
    return [round(float(v), 3) if np.isfinite(v) else None for v in values.ravel()]


def latest_complete(filled: list[bool]) -> int:
    """Index of the newest hour whose regional field is filled; MRMS can lag by one or two hours."""
    for index in range(len(filled) - 1, -1, -1):
        if filled[index]:
            return index
    raise ValueError("No filled MRMS hour in the window")


def total(frames: list[np.ndarray]) -> np.ndarray:
    """24-hour total in inches: sum of hourly rates (in/h x 1 h); a cell missing in any hour is unknown."""
    return np.sum(frames, axis=0)


def collect(output: Path = OUTPUT) -> dict:
    started = time.monotonic()
    now = datetime.now(timezone.utc)
    with urlopen(CATALOG, timeout=30) as response:
        meta = json.load(response)
    if meta["id"] != PRODUCT or meta["license"] != "CC-BY-4.0":
        raise ValueError("MRMS catalog identity or license changed")
    if meta["cube:variables"][VARIABLE]["unit"] != "kg m-2 s-1":
        raise ValueError("MRMS precipitation units changed")
    ds = dynamical_catalog.open(PRODUCT, chunks=None)
    lat_desc = ds.latitude.values[0] > ds.latitude.values[-1]
    region = ds[VARIABLE].sel(latitude=slice(BOUNDS[3] + .02, BOUNDS[1] - .02) if lat_desc else slice(BOUNDS[1] - .02, BOUNDS[3] + .02),
                              longitude=slice(BOUNDS[0] - .02, BOUNDS[2] + .02))
    # Look a little further back than 24 h so a lagging newest hour still leaves a full day.
    window = region.isel(time=slice(-(HOURS + 4), None)).load()
    rates = window.values * IN_PER_HOUR
    filled = [bool(np.isfinite(r).mean() > .5) for r in rates]
    end = latest_complete(filled)
    if end + 1 < HOURS:
        raise ValueError("Fewer than 24 MRMS hours available")
    hours = range(end + 1 - HOURS, end + 1)
    if np.nanmin(rates[list(hours)]) < 0 or np.nanmax(rates[list(hours)]) > 20:
        raise ValueError("Implausible MRMS rain rate")
    lat = window.latitude.values[::-1] if lat_desc else window.latitude.values
    xs = np.arange(BOUNDS[0], BOUNDS[2] + STEP/2, STEP)
    ys = np.arange(BOUNDS[3], BOUNDS[1] - STEP/2, -STEP)
    target = np.stack(np.meshgrid(ys, xs, indexing="ij"), axis=-1)
    output.mkdir(parents=True, exist_ok=True)
    frames, grids = [], []
    for index in hours:
        field = rates[index][::-1] if lat_desc else rates[index]
        grid = RegularGridInterpolator((lat, window.longitude.values), field, bounds_error=False, fill_value=np.nan)(target)
        grid = np.where(grid < 0, 0, grid)  # bilinear rounding can dip a hair below zero
        grids.append(grid)
        valid = iso(window.time.values[index])  # Dynamical stamps MRMS at the end of the hour the rate covers
        file = "mrms-" + valid.replace("-", "").replace(":", "") + ".json"
        payload = {"schemaVersion": 1, "valid": valid, "width": len(xs), "height": len(ys), "rain": numbers(grid)}
        temporary = output / (file + ".tmp")
        temporary.write_text(json.dumps(payload, separators=(",", ":"), allow_nan=False), encoding="utf-8")
        temporary.replace(output / file)
        frames.append({"file": file, "valid": valid})
    totals = {"schemaVersion": 1, "valid": frames[-1]["valid"], "hours": HOURS, "width": len(xs), "height": len(ys),
              "rain": numbers(total(grids))}
    (output / "total-24h.json.tmp").write_text(json.dumps(totals, separators=(",", ":"), allow_nan=False), encoding="utf-8")
    (output / "total-24h.json.tmp").replace(output / "total-24h.json")
    manifest = {"schemaVersion": 1, "generatedAt": now.isoformat(), "product": PRODUCT, "catalog": CATALOG,
                "license": meta["license"], "attribution": meta["attribution"], "hourlyUnits": "in/h", "totalUnits": "in",
                "grid": {"wkid": 4326, "width": len(xs), "height": len(ys), "x0": float(xs[0]), "y0": float(ys[0]), "dx": STEP, "dy": -STEP},
                "processing": "MRMS MultiSensor QPE (radar + gauges), hourly rate for the hour ending at each time, bilinearly resampled from ~1 km to 0.03 degree cells; total is the sum of the 24 hours.",
                "frames": frames, "total": "total-24h.json", "error": None}
    (output / "latest.json.tmp").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    (output / "latest.json.tmp").replace(output / "latest.json")
    LOG.info("%s", json.dumps({"event": "mrms-collection", "latest": frames[-1]["valid"], "frames": len(frames),
             "maxTotalIn": round(float(np.nanmax(total(grids))), 2), "durationSeconds": round(time.monotonic()-started, 1)}))
    return manifest


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    try:
        collect()
    except Exception as error:
        # Optional feed: log it, keep older files, and tell the browser it is unavailable.
        LOG.exception("MRMS collection failed")
        previous = OUTPUT / "latest.json"
        if previous.exists():
            manifest = json.loads(previous.read_text(encoding="utf-8"))
            manifest["error"] = f"Collection failed: {type(error).__name__}"
            previous.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
        else:
            OUTPUT.mkdir(parents=True, exist_ok=True)
            previous.write_text(json.dumps({"schemaVersion": 1, "error": f"MRMS collection failed: {type(error).__name__}",
                                "generatedAt": datetime.now(timezone.utc).isoformat()}), encoding="utf-8")
        print(f"::warning title=MRMS feed unavailable::{type(error).__name__}; the app will hide observed rainfall")
