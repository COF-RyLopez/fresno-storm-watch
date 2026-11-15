"""Publish a small regional HRRR cloud volume for each forecast hour (Python 3.12+)."""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
import gzip
from hashlib import sha256
import json
import logging
from pathlib import Path
import re
from urllib.request import Request, urlopen

import gribberish
import numpy as np
from pyproj import Transformer
from scipy.interpolate import RegularGridInterpolator

SOURCE = "https://noaa-hrrr-bdp-pds.s3.amazonaws.com"
OUTPUT = Path(__file__).resolve().parents[1] / "site/data/hrrr-clouds"
LEVELS = (1000, 975, 950, 925, 900, 875, 850, 800, 750, 700, 650, 600,
          550, 500, 450, 400, 350, 300, 250, 200, 150)
LEVEL_NAMES = {f"{pressure} mb": pressure for pressure in LEVELS}
SHAPE = (32, 96, 104)
HEIGHT = 16_000
RADIUS = 6378137
BOUNDS = (-121.5, 35.5, -117.7, 38.65)
HOURS = range(1, 13)
MAX_MESSAGE = 4_000_000
LOG = logging.getLogger(__name__)


def read(url: str, limit: int, byte_range: tuple[int, int] | None = None) -> bytes:
    headers = {"Range": f"bytes={byte_range[0]}-{byte_range[1]}"} if byte_range else {}
    with urlopen(Request(url, headers=headers), timeout=18) as response:
        if byte_range and (response.status != 206 or
                           not response.headers.get("Content-Range", "").startswith(
                               f"bytes {byte_range[0]}-{byte_range[1]}/")):
            raise ValueError("Unexpected NOAA byte range")
        data = response.read(limit + 1)
    if len(data) > limit or (byte_range and len(data) != byte_range[1] - byte_range[0] + 1):
        raise ValueError("Unexpected NOAA response length")
    return data


def download(cycle: datetime, hour: int) -> tuple[str, dict]:
    date, clock = cycle.strftime("%Y%m%d"), cycle.strftime("%H")
    url = f"{SOURCE}/hrrr.{date}/conus/hrrr.t{clock}z.wrfprsf{hour:02d}.grib2"
    records = [line.split(":") for line in read(url + ".idx", 160_000).decode().splitlines()]
    ranges = {}
    for row, next_row in zip(records, records[1:]):
        variable, level = row[3:5]
        if variable == "CLMR":
            variable = "CLWMR"
        if ((level in LEVEL_NAMES and variable in ("HGT", "CLWMR", "CIMIXR"))
                or (level == "surface" and variable in ("HGT", "PRES"))):
            ranges[variable, level] = (int(row[1]), int(next_row[1]) - 1)
    expected = {(variable, level) for variable in ("HGT", "CLWMR", "CIMIXR") for level in LEVEL_NAMES}
    if set(ranges) != expected | {("HGT", "surface"), ("PRES", "surface")}:
        raise ValueError("HRRR cloud field inventory is incomplete")
    return url, ranges


def region_grid() -> tuple[list[float], tuple[np.ndarray, np.ndarray]]:
    west, south, east, north = BOUNDS
    project = Transformer.from_crs(4326, 3857, always_xy=True)
    xmin, ymin = project.transform(west, south)
    xmax, ymax = project.transform(east, north)
    _, rows, columns = SHAPE
    x = xmin + (np.arange(columns) + .5) * (xmax - xmin) / columns
    y = ymin + (np.arange(rows) + .5) * (ymax - ymin) / rows
    grid_x, grid_y = np.meshgrid(x, y)
    return [xmin, ymin, xmax, ymax], (grid_x, grid_y)


def density(fields: dict) -> np.ndarray:
    """Resample supported above-ground pairs to evenly spaced altitude cell centers."""
    terrain, pressure = fields["HGT", "surface"], fields["PRES", "surface"]
    if not np.isfinite(terrain).all() or not np.isfinite(pressure).all():
        raise ValueError("Regional model surface data missing")
    target = (np.arange(SHAPE[0]) + .5) * HEIGHT / SHAPE[0]
    z = target[:, None, None]
    cloud = np.zeros((SHAPE[0], *terrain.shape), dtype=np.float32)
    for lo, hi in zip(LEVEL_NAMES, tuple(LEVEL_NAMES)[1:]):
        lower, upper = fields["HGT", lo], fields["HGT", hi]
        low_mass = np.maximum(fields["CLWMR", lo], 0) + np.maximum(fields["CIMIXR", lo], 0)
        high_mass = np.maximum(fields["CLWMR", hi], 0) + np.maximum(fields["CIMIXR", hi], 0)
        valid = ((pressure >= LEVEL_NAMES[lo] * 100) & (lower >= terrain - 20)
                 & (upper > lower) & np.isfinite(low_mass) & np.isfinite(high_mass))
        mask = valid & (z >= terrain) & (z >= lower) & (z < upper)
        fraction = (z - lower) / np.where(valid, upper - lower, 1)
        cloud = np.where(mask, low_mass + fraction * (high_mass - low_mass), cloud)
    # Log-like display tone curve for condensate (kg/kg); opacity is illustrative.
    return np.rint(255 * np.clip(np.log1p(cloud * 20_000) / np.log1p(20), 0, 1)).astype("uint8")


def collect_frame(cycle: datetime, hour: int,
                  grid: tuple[np.ndarray, np.ndarray], pool: ThreadPoolExecutor) -> dict:
    url, ranges = download(cycle, hour)
    valid = cycle + timedelta(hours=hour)

    def field(key: tuple[str, str]) -> tuple[tuple[str, str], np.ndarray]:
        variable, level = key
        data = read(url, MAX_MESSAGE, ranges[key])
        meta = gribberish.parse_grib_message_metadata(data, 0)
        expected_units = {"HGT": "gpm", "PRES": "pa", "CLWMR": "kgkg-1", "CIMIXR": "kgkg-1"}
        if (meta.reference_date != cycle or meta.forecast_date != valid
                or meta.var_abbrev != variable or meta.units != expected_units[variable]
                or meta.grid_shape != (1059, 1799)
                or meta.level_value != LEVEL_NAMES.get(level, 0) * 100
                or meta.level_type != ("ground or water surface" if level == "surface" else "isobaric surface")):
            raise ValueError(f"HRRR field metadata changed for {key}")
        transform = Transformer.from_crs(3857, meta.proj, always_xy=True)
        tx, ty = transform.transform(*grid)
        x, y = meta.xy()
        values = gribberish.parse_grib_array(data, 0).reshape(meta.grid_shape)
        return key, RegularGridInterpolator((y, x), values)((ty, tx))

    cells = density(dict(pool.map(field, ranges)))
    body = gzip.compress(cells.tobytes(), mtime=0)
    checksum = sha256(body).hexdigest()
    name = f"{cycle:%Y%m%d%H}-f{hour:02d}-{checksum[:12]}.gz"
    (OUTPUT / name).write_bytes(body)
    LOG.info("HRRR %s +%dh, %s bytes, %s occupied cells", cycle, hour, len(body), np.count_nonzero(cells))
    return {"file": name, "sha256": checksum, "bytes": len(body), "lead": hour, "valid": valid.isoformat()}


def save_manifest(manifest: dict) -> None:
    temporary = OUTPUT / "latest.json.tmp"
    temporary.write_text(json.dumps(manifest), encoding="utf-8")
    temporary.replace(OUTPUT / "latest.json")


def reuse_snapshot(url: str, manifest: dict, cycle: datetime, bounds: list[float]) -> None:
    prior_bounds = manifest["bounds3857"]
    if (manifest["version"] != 1 or manifest["run"] != cycle.isoformat()
            or manifest["shape"] != list(SHAPE) or manifest["heightRange"] != [0, HEIGHT]
            or len(prior_bounds) != len(bounds)
            or not all(abs(a - b) < .1 for a, b in zip(prior_bounds, bounds))
            or [frame["lead"] for frame in manifest["frames"]] != list(HOURS)):
        raise ValueError("Prior forecast grid or run changed")
    for frame in manifest["frames"]:
        digest, lead = frame["sha256"], frame["lead"]
        if not re.fullmatch(r"[a-f0-9]{64}", digest):
            raise ValueError("Invalid prior forecast checksum")
        name = f"{cycle:%Y%m%d%H}-f{lead:02d}-{digest[:12]}.gz"
        if (frame["file"] != name
                or frame["valid"] != (cycle + timedelta(hours=lead)).isoformat()):
            raise ValueError("Invalid prior forecast record")
        body = read(url + name, 400_000)
        if len(body) != frame["bytes"] or sha256(body).hexdigest() != digest:
            raise ValueError("Prior forecast frame integrity check failed")
        (OUTPUT / name).write_bytes(body)
    save_manifest(manifest)
    LOG.info("Reused verified HRRR cloud snapshot for %s", cycle)


def collect(reuse_url: str | None) -> None:
    now = datetime.now(timezone.utc)
    cycle = (now - timedelta(hours=2)).replace(minute=0, second=0, microsecond=0)
    cycle -= timedelta(hours=cycle.hour % 3)
    OUTPUT.mkdir(parents=True, exist_ok=True)
    bounds, grid = region_grid()
    previous = None
    if reuse_url:
        try:
            previous = json.loads(read(reuse_url + "latest.json", 30_000))
        except (OSError, ValueError) as error:
            LOG.info("Prior HRRR cloud snapshot unavailable: %s", error)
    with ThreadPoolExecutor(max_workers=12) as pool:
        for candidate in (cycle, cycle - timedelta(hours=3)):
            if reuse_url and isinstance(previous, dict) and previous.get("run") == candidate.isoformat():
                try:
                    reuse_snapshot(reuse_url, previous, candidate, bounds)
                    return
                except (OSError, ValueError, KeyError, TypeError) as error:
                    LOG.info("Prior HRRR cloud snapshot did not verify: %s", error)
            try:
                frames = [collect_frame(candidate, hour, grid, pool) for hour in HOURS]
                break
            except (OSError, ValueError) as error:
                LOG.info("HRRR run %s unavailable; checking the earlier run: %s", candidate, error)
        else:
            raise ValueError("No complete recent HRRR cloud forecast")
    manifest = {"version": 1, "run": candidate.isoformat(), "shape": SHAPE,
                "bounds3857": bounds, "heightRange": [0, HEIGHT], "frames": frames}
    save_manifest(manifest)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--reuse-published", action="store_true")
    args = parser.parse_args()
    try:
        collect("https://cof-rylopez.github.io/fresno-storm-watch/data/hrrr-clouds/" if args.reuse_published else None)
    except Exception:
        LOG.exception("HRRR forecast clouds unavailable")
        raise SystemExit(1)
