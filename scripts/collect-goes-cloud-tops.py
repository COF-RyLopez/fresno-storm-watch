"""Collect NOAA GOES-18 CONUS Level 2 cloud-top height triangles (Python 3.11+).

HT is geopotential height at cloud top, in meters; it is NOT geometric altitude
above an ellipsoid or height above local terrain. Positions use the nominal ABI
fixed grid on the reference ellipsoid, without cloud parallax correction. Raised
clouds can consequently be displaced horizontally by kilometers. This preview
does not establish cloud bases, thickness, storm volume, or precise cloud edges.

Only DQF=0 (good_quality_qf) and valid scaled HT values enter the mesh. A cell is
drawn only when ALL native grid samples within it are valid; stride never bridges
a missing retrieval. Stride reduces detail, does not average or invent heights.
The reported resolutionKm is nominal nadir spacing, not local ground resolution.

References checked 2026-11-15:
https://www.ncei.noaa.gov/access/metadata/landing-page/bin/iso?id=gov.noaa.ncdc:C01505
https://www.star.nesdis.noaa.gov/atmospheric-composition-training/satellite_data_goes_imager_projection.php
Native HT/DQF/projection attributes are checked on every downloaded frame.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import logging
import re
import tempfile
import time
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, urlopen

import numpy as np
from netCDF4 import Dataset
from pyproj import CRS, Transformer

PRODUCT = "ABI-L2-ACHA2KMC"
ORIGIN = "https://noaa-goes18.s3.amazonaws.com/"
BOUNDS = (-122.5, 34.75, -116.5, 39.6)
MAX_VERTICES = 300_000
MAX_FRAMES = 20
MAX_AGE = timedelta(minutes=90)
ROOT = Path(__file__).resolve().parents[1]
KEY = re.compile(r"ABI-L2-ACHA2KMC/(\d{4})/(\d{3})/(\d{2})/OR_ABI-L2-ACHA2KMC-M[36]_G18_s(\d{14})_e(\d{14})_c(\d{14})\.nc")
SAFE_FILE = re.compile(r"g18-[a-f0-9]{32}\.bin")
LOG = logging.getLogger("goes-cloud-tops")


def iso(value: datetime) -> str:
    """Format an aware instant consistently, retaining NOAA tenths of seconds."""
    return value.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def instant(value: str) -> datetime:
    """Require an explicitly UTC timestamp."""
    if not isinstance(value, str) or not value.endswith("Z"):
        raise ValueError("Expected UTC source time")
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def source_frame(key: str) -> dict:
    """Derive safe artifact identity and source times from a NOAA object key."""
    match = KEY.fullmatch(key)
    if not match:
        raise ValueError("Unexpected GOES source key")
    year, day, hour, start_text, end_text, created_text = match.groups()
    def stamp(text: str) -> datetime:
        return datetime.strptime(text[:13], "%Y%j%H%M%S").replace(tzinfo=timezone.utc) + timedelta(milliseconds=int(text[13]) * 100)
    start, end, created = map(stamp, (start_text, end_text, created_text))
    if start.strftime("%Y/%j/%H") != f"{year}/{day}/{hour}" or not start < end <= created or end - start > timedelta(minutes=10):
        raise ValueError("Invalid source scan interval")
    return dict(start=iso(start), end=iso(end), source=ORIGIN + key,
                file="g18-" + hashlib.sha256(key.encode("ascii")).hexdigest()[:32] + ".bin")


def transformers(projection: dict) -> tuple[Transformer, Transformer]:
    """Use CF ABI projection parameters; reject a different platform/projection."""
    if (projection.get("grid_mapping_name") != "geostationary" or projection.get("sweep_angle_axis") != "x"
            or projection.get("latitude_of_projection_origin") != 0
            or not -138 <= float(projection.get("longitude_of_projection_origin", 0)) <= -136):
        raise ValueError("Unexpected GOES-West fixed-grid projection")
    h, a, b = (float(projection[name]) for name in ("perspective_point_height", "semi_major_axis", "semi_minor_axis"))
    if not (35_700_000 < h < 35_900_000 and 6_370_000 < a < 6_390_000 and 6_350_000 < b < a):
        raise ValueError("Invalid ABI ellipsoid or satellite height")
    crs = CRS.from_proj4(f"+proj=geos +h={h} +a={a} +b={b} +lon_0={projection['longitude_of_projection_origin']} +sweep=x +units=m")
    geographic = crs.geodetic_crs
    return Transformer.from_crs(geographic, crs, always_xy=True), Transformer.from_crs(crs, geographic, always_xy=True)


def project_grid(x: np.ndarray, y: np.ndarray, projection: dict) -> tuple[np.ndarray, np.ndarray]:
    """Convert ABI radian scan angles into nominal ellipsoidal lon/lat centers."""
    _, inverse = transformers(projection)
    xx, yy = np.meshgrid(x, y)
    h = float(projection["perspective_point_height"])
    return inverse.transform(xx * h, yy * h)


def mesh(lon: np.ndarray, lat: np.ndarray, height: np.ndarray, quality: np.ndarray,
         max_vertices: int = MAX_VERTICES) -> tuple[np.ndarray, int]:
    """Emit bounded triangle lists; every covered native pixel must be valid."""
    height = np.ma.asarray(height, dtype="f8").filled(np.nan)
    quality = np.ma.asarray(quality, dtype="f8").filled(np.nan)
    if not (lon.shape == lat.shape == height.shape == quality.shape) or height.ndim != 2:
        raise ValueError("Mismatched native grid arrays")
    if not 6 <= max_vertices <= MAX_VERTICES:
        raise ValueError("Invalid mesh size limit")
    west, south, east, north = BOUNDS
    valid = (np.isfinite(height) & (height >= 0) & (height <= 20_000) & (quality == 0)
             & np.isfinite(lon) & np.isfinite(lat) & (lon >= west) & (lon <= east) & (lat >= south) & (lat <= north))
    rows, cols = height.shape
    stride = 1
    # Integral invalid-pixel counts prove that *interior* samples of a coarse
    # rectangle are valid too, not merely its four retained corners.
    invalid = np.pad((~valid).astype("i4"), ((1, 0), (1, 0))).cumsum(0).cumsum(1)
    while True:
        rr, cc = np.meshgrid(np.arange(0, max(0, rows - stride), stride), np.arange(0, max(0, cols - stride), stride), indexing="ij")
        r1, c1 = rr + stride, cc + stride
        count = invalid[r1 + 1, c1 + 1] - invalid[rr, c1 + 1] - invalid[r1 + 1, cc] + invalid[rr, cc]
        r0, c0, r1, c1 = rr[count == 0], cc[count == 0], r1[count == 0], c1[count == 0]
        if len(r0) * 6 <= max_vertices:
            break
        stride += 1
    grid = np.stack([lon, lat, height], axis=-1)
    a, b, c, d = grid[r0, c0], grid[r0, c1], grid[r1, c1], grid[r1, c0]
    vertices = np.stack([a, b, c, a, c, d], axis=1).reshape(-1, 3).astype("<f4")
    if len(vertices) > max_vertices:
        raise ValueError("Mesh exceeded its vertex budget")
    return vertices, stride


def decode_frame(path: Path, key: str) -> tuple[dict, bytes]:
    """Validate native metadata and decode only a geographic crop of scaled HT."""
    row = source_frame(key)
    with Dataset(path) as ds:
        if ds.platform_ID != "G18" or ds.title != "ABI L2 Cloud Top Height" or ds.spatial_resolution != "2.0km at nadir":
            raise ValueError("Unexpected satellite/product/resolution")
        for field, attribute in (("start", "time_coverage_start"), ("end", "time_coverage_end")):
            if instant(row[field]) != instant(getattr(ds, attribute)):
                raise ValueError("Source key and native scan time disagree")
        ht, dqf = ds["HT"], ds["DQF"]
        if ht.units != "m" or ht.standard_name != "geopotential_height_at_cloud_top" or ht.grid_mapping != "goes_imager_projection":
            raise ValueError("Unexpected cloud height reference or units")
        flags = dict(zip(map(int, dqf.flag_values), dqf.flag_meanings.split(), strict=True))
        if flags.get(0) != "good_quality_qf" or ht.dimensions != ("y", "x") or dqf.dimensions != ht.dimensions:
            raise ValueError("Unexpected cloud quality or dimensions")
        projection = {name: ds["goes_imager_projection"].getncattr(name) for name in ds["goes_imager_projection"].ncattrs()}
        forward, _ = transformers(projection)
        x, y = np.asarray(ds["x"][:], dtype="f8"), np.asarray(ds["y"][:], dtype="f8")
        if ds["x"].units != "rad" or ds["y"].units != "rad" or not np.all(np.isfinite(x)) or not np.all(np.isfinite(y)):
            raise ValueError("Invalid fixed-grid coordinates")
        if not (np.all(np.diff(x) > 0) and np.all(np.diff(y) < 0)):
            raise ValueError("Unexpected fixed-grid axis order")
        # Densified boundary encloses the projected curved ROI. The final
        # native-pixel mask still applies the exact geographic bounds.
        west, south, east, north = BOUNDS
        lons, lats = np.linspace(west, east, 257), np.linspace(south, north, 257)
        px, py = forward.transform(np.r_[lons, lons, np.full(257, west), np.full(257, east)],
                                   np.r_[np.full(257, south), np.full(257, north), lats, lats])
        h = float(projection["perspective_point_height"])
        cols = np.flatnonzero((x >= min(px) / h - .000056) & (x <= max(px) / h + .000056))
        rows = np.flatnonzero((y >= min(py) / h - .000056) & (y <= max(py) / h + .000056))
        if not len(cols) or not len(rows):
            raise ValueError("Native grid misses requested region")
        xs, ys = slice(cols[0], cols[-1] + 1), slice(rows[0], rows[-1] + 1)
        lon, lat = project_grid(x[xs], y[ys], projection)
        # netCDF4 automatically applies scale/offset AND masks fill/valid_range.
        heights, quality = ht[ys, xs], dqf[ys, xs]
        vertices, stride = mesh(lon, lat, heights, quality)
        good = (~np.ma.getmaskarray(heights) & ~np.ma.getmaskarray(quality) & (np.asarray(quality) == 0)).sum()
        LOG.info("%s: crop %sx%s; %s good retrievals; stride %s; %s vertices", row["start"], *heights.shape, good, stride, len(vertices))
    blob = vertices.tobytes()
    row.update(count=len(vertices), sha256=hashlib.sha256(blob).hexdigest(), resolutionKm=2 * stride,
               nativeResolutionKm=2, gridStride=stride)
    return row, blob


def valid_artifact(row: dict, blob: bytes, now: datetime) -> bool:
    """Check cached bytes, source-derived identity, geography and 90-minute age."""
    try:
        source = row["source"]
        if not isinstance(source, str) or not source.startswith(ORIGIN):
            return False
        identity = source_frame(source[len(ORIGIN):])
        if any(row.get(name) != value for name, value in identity.items()):
            return False
        end = instant(row["end"])
        if not now - MAX_AGE <= end <= now or instant(row["start"]) > now:
            return False
        count, resolution = row["count"], row["resolutionKm"]
        if type(count) is not int or not 0 <= count <= MAX_VERTICES or count % 3 or len(blob) != count * 12:
            return False
        if type(resolution) not in (float, int) or not 2 <= resolution <= 32 or resolution % 2:
            return False
        if hashlib.sha256(blob).hexdigest() != row["sha256"]:
            return False
        vertices = np.frombuffer(blob, dtype="<f4").reshape(-1, 3)
        return bool(np.isfinite(vertices).all() and ((vertices[:, 0] >= BOUNDS[0]) & (vertices[:, 0] <= BOUNDS[2])
                    & (vertices[:, 1] >= BOUNDS[1]) & (vertices[:, 1] <= BOUNDS[3] + .00001)
                    & (vertices[:, 2] >= 0) & (vertices[:, 2] <= 20_000)).all())
    except (ValueError, KeyError, TypeError, OverflowError):
        return False


def download(url: str, maximum: int = 16_000_000) -> bytes:
    """Bound each anonymous HTTPS transfer in time and size."""
    parts = urlsplit(url)
    if parts.scheme != "https" or parts.username or parts.password:
        raise ValueError("Only public HTTPS sources are supported")
    request = Request(url, headers={"User-Agent": "FROG-public-GOES-collector/1", "Cache-Control": "no-cache"})
    with urlopen(request, timeout=30) as response:
        result = response.read(maximum + 1)
    if len(result) > maximum:
        raise ValueError("Source exceeds transfer limit")
    return result


def inventory(now: datetime) -> list[str]:
    """List every intersecting UTC hour, refusing partial/truncated inventories."""
    current = (now - MAX_AGE - timedelta(minutes=10)).replace(minute=0, second=0, microsecond=0)
    keys = set()
    while current <= now:
        prefix = current.strftime(PRODUCT + "/%Y/%j/%H/")
        root = ET.fromstring(download(ORIGIN + "?" + urlencode({"list-type": 2, "prefix": prefix}), 1_000_000))
        if root.findtext("{*}IsTruncated") != "false":
            raise ValueError("GOES inventory is missing or truncated")
        for node in root.findall("{*}Contents"):
            key = node.findtext("{*}Key", "")
            row = source_frame(key)
            if now - MAX_AGE <= instant(row["end"]) <= now:
                keys.add(key)
        current += timedelta(hours=1)
    # Prefer the last NOAA processing revision for each actual scan.
    scans = {}
    for key in sorted(keys):
        scans[source_frame(key)["start"]] = key
    return sorted(scans.values(), key=lambda key: source_frame(key)["start"])[-MAX_FRAMES:]


def cached_frames(output: Path, now: datetime, reuse_url: str | None) -> dict[str, tuple[dict, bytes]]:
    """Reuse only SHA-verified local/published artifacts, never trust a path in JSON."""
    result = {}
    sources = [None] + ([reuse_url.rstrip("/") + "/"] if reuse_url else [])
    for base in sources:
        try:
            raw = download(base + "manifest.json", 200_000) if base else (output / "manifest.json").read_bytes()
            manifest = json.loads(raw)
            if not isinstance(manifest, dict) or manifest.get("schemaVersion") != 1 or manifest.get("product") != PRODUCT or manifest.get("satellite") != "GOES-18":
                raise ValueError("Unexpected cached product")
            rows = manifest["frames"]
            if not isinstance(rows, list) or len(rows) > MAX_FRAMES:
                raise ValueError("Unbounded cached inventory")
        except (OSError, ValueError, KeyError) as error:
            LOG.info("Cache unavailable (%s): %s", base or output, error)
            continue
        for row in rows:
            try:
                name = row["file"]
                if not isinstance(name, str) or not SAFE_FILE.fullmatch(name) or name in result or not now - MAX_AGE <= instant(row["end"]) <= now:
                    continue
                blob = download(base + name, MAX_VERTICES * 12) if base else (output / name).read_bytes()
                if valid_artifact(row, blob, now):
                    result[name] = row, blob
            except (OSError, ValueError, KeyError, TypeError) as error:
                LOG.warning("Ignoring invalid cached artifact: %s", error)
    # Local and published copies may contain different processing revisions of
    # the same scan. Keep the newest *verified* artifact, not two replay stops.
    scans = {}
    for pair in sorted(result.values(), key=lambda pair: KEY.fullmatch(pair[0]["source"][len(ORIGIN):]).group(6)):
        scans[pair[0]["start"]] = pair
    return {row["file"]: (row, blob) for row, blob in scans.values()}


def atomic_write(path: Path, blob: bytes) -> None:
    """Replace one completed file on its own filesystem."""
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_bytes(blob)
    temporary.replace(path)


def publish(output: Path, frames: list[tuple[dict, bytes]], now: datetime) -> None:
    """Validate all payloads first, write artifacts, then atomically expose manifest."""
    if not frames or len(frames) > MAX_FRAMES or any(not valid_artifact(row, blob, now) for row, blob in frames):
        raise ValueError("No valid complete frame inventory to publish")
    frames = sorted(frames, key=lambda pair: pair[0]["start"])
    if len({row["file"] for row, _ in frames}) != len(frames):
        raise ValueError("Duplicate artifact identity")
    manifest = dict(schemaVersion=1, product=PRODUCT, satellite="GOES-18", generatedAt=iso(now),
                    heightReference="geopotential meters at cloud top; not height above terrain",
                    geolocation="nominal ABI fixed grid; cloud parallax uncorrected",
                    mesh="native grid centers; good-quality DQF=0 only; all covered native pixels valid; no gap filling",
                    resolutionMeaning="nominal nadir spacing times grid stride; local ground spacing is larger",
                    bounds=list(BOUNDS), frames=[row for row, _ in frames])
    output.mkdir(parents=True, exist_ok=True)
    for row, blob in frames:
        path = output / row["file"]
        if not path.exists() or hashlib.sha256(path.read_bytes()).hexdigest() != row["sha256"]:
            atomic_write(path, blob)
    atomic_write(output / "manifest.json", (json.dumps(manifest, indent=2) + "\n").encode("utf-8"))


def collect(output: Path, reuse_url: str | None = None) -> None:
    """Build a bounded recent inventory; retain verified prior frames on failure."""
    now = datetime.now(timezone.utc)
    frames = cached_frames(output, now, reuse_url)
    try:
        keys = inventory(now)
        if not keys:
            raise ValueError("NOAA returned no completed scan in the last 90 minutes")
    except (OSError, ValueError, ET.ParseError) as error:
        if not frames:
            raise
        LOG.warning("Inventory failed; preserving dated verified frames: %s", error)
        keys = []
    with tempfile.TemporaryDirectory(prefix="goes-cloud-tops-") as directory:
        native = Path(directory) / "frame.nc"
        for key in keys:
            row = source_frame(key)
            if row["file"] in frames:
                continue
            try:
                native.write_bytes(download(row["source"]))
                decoded, blob = decode_frame(native, key)
                if not valid_artifact(decoded, blob, now):
                    raise ValueError("Decoded frame failed final artifact validation")
                # A new processing revision replaces only the matching scan.
                frames = {name: pair for name, pair in frames.items() if pair[0]["start"] != decoded["start"]}
                frames[decoded["file"]] = decoded, blob
            except (OSError, ValueError, KeyError, AttributeError, RuntimeError) as error:
                LOG.warning("Frame failed; retaining previous valid scans: %s: %s", row["source"], error)
    recent = [pair for pair in frames.values() if valid_artifact(*pair, datetime.now(timezone.utc))]
    publish(output, sorted(recent, key=lambda pair: pair[0]["start"])[-MAX_FRAMES:], datetime.now(timezone.utc))
    LOG.info("Published %s verified cloud-top scans", len(recent))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "site/data/goes-cloud-tops")
    parser.add_argument("--reuse-url", help="Published HTTPS directory containing manifest.json and binary frames")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    started = time.monotonic()
    collect(args.output, args.reuse_url)
    LOG.info("Completed in %.1f seconds", time.monotonic() - started)


if __name__ == "__main__":
    main()
