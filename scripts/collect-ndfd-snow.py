"""Render official NDFD six-hour snowfall totals for the central Sierra."""

import argparse
import contextlib
import hashlib
import json
import os
from pathlib import Path
import re
import time
from urllib.request import Request, urlopen

import numpy as np
from PIL import Image
import rasterio
from rasterio.io import MemoryFile
from rasterio.transform import from_bounds
from rasterio.warp import Resampling, reproject, transform_bounds

SOURCE = "https://tgftp.nws.noaa.gov/SL.us008001/ST.opnl/DF.gr2/DC.ndfd/AR.conus/VP.001-003/ds.snow.bin"
BOUNDS = (-125, 32, -113, 42.5)
SIZE = (1000, 1100)
PERIOD = 6 * 3600
MAX_BYTES = 24 * 1024 * 1024
BANDS = [
    (0, "Trace to <0.5", "#bdebf7"),
    (0.5, "0.5–<1", "#80c8fa"),
    (1, "1–<2", "#508de6"),
    (2, "2–<4", "#865fe2"),
    (4, "4–<8", "#cd6bd9"),
    (8, "8+", "#ff9bdb"),
]


def window(tags: dict[str, str]) -> tuple[int, int, int] | None:
    """Read the six-hour accumulation contract from GRIB product definition 4.8."""
    if (tags.get("GRIB_ELEMENT"), tags.get("GRIB_UNIT"), tags.get("GRIB_PDS_PDTN")) != ("SnowAmt", "[m]", "8"):
        return None
    fields = tags.get("GRIB_PDS_TEMPLATE_ASSEMBLED_VALUES", "").split()
    # One statistical time range, accumulation (1), length six hours (1 = hours).
    if len(fields) != 29 or fields[21] != "1" or fields[23:28] != ["1", "2", "1", "6", "1"]:
        return None
    try:
        end, issued = int(tags["GRIB_VALID_TIME"]), int(tags["GRIB_REF_TIME"])
    except (KeyError, ValueError):
        return None
    return end - PERIOD, end, issued


def render(source: rasterio.DatasetReader, band: int, extent: tuple[float, ...]) -> tuple[Image.Image, int, int]:
    """Warp to the image extent with nearest resampling and preserve nodata."""
    width, height = SIZE
    dest = np.full((height, width), np.nan, dtype=np.float32)
    metres = source.read(band, masked=True).astype(np.float32).filled(np.nan)
    reproject(metres, dest, src_transform=source.transform, src_crs=source.crs, src_nodata=np.nan,
              dst_transform=from_bounds(*extent, width, height), dst_crs="EPSG:3857",
              dst_nodata=np.nan, resampling=Resampling.nearest)
    inches = dest / 0.0254
    valid = np.isfinite(inches) & (inches >= 0)
    rgba = np.zeros((height, width, 4), dtype=np.uint8)
    rgba[valid & (inches == 0)] = (55, 97, 119, 80)
    for lower, _, color in BANDS:
        rgb = bytes.fromhex(color[1:])
        rgba[valid & (inches > 0) & (inches >= lower)] = (*rgb, 220)
    return Image.fromarray(rgba), int(valid.sum()), int((valid & (inches > 0)).sum())


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, help="Captured official GRIB file for local verification")
    parser.add_argument("--output", type=Path, default=Path("site/data/ndfd-snow"))
    args = parser.parse_args()
    output = args.output
    with contextlib.ExitStack() as stack:
        if args.input:
            source = stack.enter_context(rasterio.open(args.input))
        else:
            request = Request(SOURCE, headers={"User-Agent": "Fresno-Storm-Watch/1.0"})
            with urlopen(request, timeout=40) as response:
                payload = response.read(MAX_BYTES + 1)
            # Operational files may start with a WMO bulletin header.
            if len(payload) > MAX_BYTES or b"GRIB" not in payload[:4096]:
                raise ValueError("Invalid NDFD payload")
            source = stack.enter_context(stack.enter_context(MemoryFile(payload)).open())
        extent = transform_bounds("EPSG:4326", "EPSG:3857", *BOUNDS)
        now = int(time.time())
        selected = {}
        for band in range(1, source.count + 1):
            period = window(source.tags(band))
            if period is None:
                continue
            start, end, issued = period
            if not (now < end <= now + 4 * 86400 and now - 12 * 3600 <= issued <= min(end, now + 900)):
                continue
            if end not in selected or issued > selected[end][1]:
                selected[end] = band, issued, start
        if not selected:
            raise ValueError("No recent six-hour snowfall forecast windows")
        output.mkdir(parents=True, exist_ok=True)
        frames = []
        for end, (band, issued, start) in sorted(selected.items()):
            image, valid, snowy = render(source, band, extent)
            if not valid:
                continue
            temp = output / "frame.tmp"
            image.save(temp, format="PNG", optimize=True)
            fingerprint = hashlib.sha256(temp.read_bytes()).hexdigest()[:16]
            name = f"{end}-{fingerprint}.png"
            os.replace(temp, output / name)
            frames.append({"start": start * 1000, "end": end * 1000, "issued": issued * 1000,
                           "file": name, "validCells": valid, "snowCells": snowy})
    if not frames:
        raise ValueError("NDFD forecast has no valid cells in the map extent")
    manifest = {"schemaVersion": 1, "source": SOURCE, "bounds": BOUNDS, "units": "in",
                "frames": frames, "legend": [{"label": b[1], "color": b[2]} for b in BANDS]}
    temp = output / "manifest.tmp"
    temp.write_text(json.dumps(manifest, ensure_ascii=False), encoding="utf-8")
    os.replace(temp, output / "manifest.json")
    retained = {frame["file"] for frame in frames}
    for old in output.glob("*.png"):
        if re.fullmatch(r"\d+-[a-f0-9]{16}\.png", old.name) and old.name not in retained:
            old.unlink()
    print(f"NDFD snowfall: {len(frames)} six-hour frames, {sum(f['snowCells'] > 0 for f in frames)} with snow.")


if __name__ == "__main__":
    main()
