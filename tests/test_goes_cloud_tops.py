"""Cloud-top source, grid and publication contracts; run with unittest."""
import hashlib
import importlib.util
import json
import tempfile
import unittest
from unittest.mock import patch
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from netCDF4 import Dataset

MODULE = Path(__file__).resolve().parents[1] / "scripts" / "collect-goes-cloud-tops.py"
spec = importlib.util.spec_from_file_location("cloud_tops", MODULE)
cloud = importlib.util.module_from_spec(spec)
if MODULE.exists():
    spec.loader.exec_module(cloud)

KEY = "ABI-L2-ACHA2KMC/2026/319/05/OR_ABI-L2-ACHA2KMC-M6_G18_s20263190521179_e20263190523552_c20263190525357.nc"
NOW = datetime(2026, 11, 15, 5, 30, tzinfo=timezone.utc)
PROJECTION = dict(perspective_point_height=35786023., semi_major_axis=6378137.,
                  semi_minor_axis=6356752.31414, longitude_of_projection_origin=-137.,
                  latitude_of_projection_origin=0., sweep_angle_axis="x",
                  grid_mapping_name="geostationary")


class CloudTopTests(unittest.TestCase):
    def grid(self, size=5):
        lon, lat = np.meshgrid(np.linspace(-120, -119, size), np.linspace(36, 37, size))
        return lon, lat, np.full((size, size), 2500.), np.zeros((size, size), dtype="u1")

    def test_projection_uses_radians_height_and_west_satellite_origin(self):
        # Nadir and independently checked NOAA fixed-grid inverse results.
        lon, lat = cloud.project_grid(np.array([0., .03]), np.array([0., .09]), PROJECTION)
        self.assertAlmostEqual(lon[0, 0], -137., places=6)
        self.assertAlmostEqual(lat[0, 0], 0., places=6)
        self.assertAlmostEqual(lon[1, 1], -125.2169080142, places=6)
        self.assertAlmostEqual(lat[1, 1], 31.6219878693, places=6)

    def test_only_good_quality_finite_in_bounds_heights_make_triangles(self):
        lon, lat, height, quality = self.grid(2)
        vertices, stride = cloud.mesh(lon, lat, height, quality)
        self.assertEqual((len(vertices), stride), (6, 1))
        np.testing.assert_array_equal(vertices[:, 2], np.full(6, 2500.))
        for bad in (1, 2, 3, 4, 255):
            quality[0, 0] = bad
            self.assertEqual(len(cloud.mesh(lon, lat, height, quality)[0]), 0)
        quality[0, 0] = 0
        for bad in (np.nan, -1., 20001.):
            height[0, 0] = bad
            self.assertEqual(len(cloud.mesh(lon, lat, height, quality)[0]), 0)
        height[0, 0] = 2500.
        lon[0, 0] = -130.
        self.assertEqual(len(cloud.mesh(lon, lat, height, quality)[0]), 0)

    def test_striding_never_bridges_a_missing_native_pixel(self):
        lon, lat, height, quality = self.grid()
        vertices, stride = cloud.mesh(lon, lat, height, quality, max_vertices=30)
        self.assertEqual((len(vertices), stride), (24, 2))
        quality[2, 2] = 3
        vertices, stride = cloud.mesh(lon, lat, height, quality, max_vertices=30)
        self.assertEqual(stride, 2)
        self.assertEqual(len(vertices), 0)

    def test_masked_height_is_never_restored_as_valid_by_array_conversion(self):
        lon, lat, height, quality = self.grid(2)
        height = np.ma.array(height, mask=[[True, False], [False, False]])
        self.assertEqual(len(cloud.mesh(lon, lat, height, quality)[0]), 0)

    def test_sparse_native_mesh_is_not_coarsened_unnecessarily(self):
        lon, lat, height, quality = self.grid(10)
        quality[:] = 3
        quality[:2, :2] = 0
        vertices, stride = cloud.mesh(lon, lat, height, quality, max_vertices=30)
        self.assertEqual((len(vertices), stride), (6, 1))

    def test_source_identity_safe_file_and_reuse_integrity(self):
        row = cloud.source_frame(KEY)
        self.assertRegex(row["file"], r"^g18-[a-f0-9]{32}\.bin$")
        self.assertEqual(row["start"], "2026-11-15T05:21:17.900Z")
        self.assertEqual(row["end"], "2026-11-15T05:23:55.200Z")
        payload = np.array([[-120, 36, 2500]] * 3, dtype="<f4").tobytes()
        row.update(count=3, sha256=hashlib.sha256(payload).hexdigest(), resolutionKm=2)
        self.assertTrue(cloud.valid_artifact(row, payload, NOW))
        self.assertFalse(cloud.valid_artifact(row, payload[:-1], NOW))
        self.assertFalse(cloud.valid_artifact(dict(row, file="../other.bin"), payload, NOW))
        self.assertFalse(cloud.valid_artifact(dict(row, count=2), payload, NOW))
        self.assertFalse(cloud.valid_artifact(dict(row, end="2026-11-15T05:29:00Z"), payload, NOW))
        self.assertFalse(cloud.valid_artifact(row, payload, datetime(2026, 11, 15, 8, tzinfo=timezone.utc)))
        self.assertFalse(cloud.valid_artifact(dict(row, source=row["source"].replace("G18", "G19")), payload, NOW))

    def test_empty_valid_frame_is_reusable(self):
        row = cloud.source_frame(KEY)
        row.update(count=0, sha256=hashlib.sha256(b"").hexdigest(), resolutionKm=2)
        self.assertTrue(cloud.valid_artifact(row, b"", NOW))

    def test_atomic_publication_preserves_dated_previous_manifest_on_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            row = cloud.source_frame(KEY)
            row.update(count=0, sha256=hashlib.sha256(b"").hexdigest(), resolutionKm=2)
            cloud.publish(output, [(row, b"")], NOW)
            before = (output / "manifest.json").read_bytes()
            with self.assertRaises(ValueError):
                cloud.publish(output, [(dict(row, count=6), b"bad")], NOW)
            self.assertEqual((output / "manifest.json").read_bytes(), before)

    def test_decode_applies_native_scale_and_never_fills_bad_retrieval(self):
        with tempfile.TemporaryDirectory() as directory:
            native = Path(directory) / "native.nc"
            with Dataset(native, "w") as ds:
                ds.setncatts(dict(platform_ID="G18", title="ABI L2 Cloud Top Height", spatial_resolution="2.0km at nadir",
                                 time_coverage_start="2026-11-15T05:21:17.9Z", time_coverage_end="2026-11-15T05:23:55.2Z"))
                ds.createDimension("x", 2)
                ds.createDimension("y", 2)
                x, y = ds.createVariable("x", "f8", ("x",)), ds.createVariable("y", "f8", ("y",))
                x.units = y.units = "rad"
                x[:] = [.04, .040056]
                y[:] = [.10, .099944]
                ds.createVariable("goes_imager_projection", "i4").setncatts(PROJECTION)
                ht = ds.createVariable("HT", "u2", ("y", "x"), fill_value=65535)
                ht.setncatts(dict(units="m", standard_name="geopotential_height_at_cloud_top", grid_mapping="goes_imager_projection",
                                  scale_factor=.5, add_offset=100., valid_range=np.array([0, 65530], dtype="u2")))
                ht.set_auto_maskandscale(False)
                ht[:] = np.full((2, 2), 1800, dtype="u2")
                dqf = ds.createVariable("DQF", "u1", ("y", "x"), fill_value=255)
                dqf.flag_values = np.array([0, 1], dtype="u1")
                dqf.flag_meanings = "good_quality_qf marginal_quality_qf"
                dqf[:] = 0
            row, payload = cloud.decode_frame(native, KEY)
            self.assertEqual(row["count"], 6)
            np.testing.assert_array_equal(np.frombuffer(payload, dtype="<f4").reshape(-1, 3)[:, 2], np.full(6, 1000.))
            with Dataset(native, "a") as ds:
                ds["DQF"][0, 0] = 1
            row, payload = cloud.decode_frame(native, KEY)
            self.assertEqual((row["count"], payload), (0, b""))
            with Dataset(native, "a") as ds:
                ds["DQF"][0, 0] = 0
                ds["HT"].set_auto_maskandscale(False)
                ds["HT"][0, 0] = 65535
            self.assertEqual(cloud.decode_frame(native, KEY)[1], b"")

    def test_cache_reuses_only_verified_bytes_and_rejects_corruption(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            row = cloud.source_frame(KEY)
            row.update(count=0, sha256=hashlib.sha256(b"").hexdigest(), resolutionKm=2)
            cloud.publish(output, [(row, b"")], NOW)
            self.assertEqual(len(cloud.cached_frames(output, NOW, None)), 1)
            (output / row["file"]).write_bytes(b"incomplete")
            self.assertEqual(cloud.cached_frames(output, NOW, None), {})

    def test_source_outage_retains_prior_verified_source_dates(self):
        class FixedDatetime(datetime):
            @classmethod
            def now(cls, tz=None):
                return NOW
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            row = cloud.source_frame(KEY)
            row.update(count=0, sha256=hashlib.sha256(b"").hexdigest(), resolutionKm=2)
            cloud.publish(output, [(row, b"")], NOW)
            with patch.object(cloud, "datetime", FixedDatetime), patch.object(cloud, "inventory", side_effect=OSError("source offline")):
                cloud.collect(output)
            retained = cloud.cached_frames(output, NOW, None)[row["file"]][0]
            self.assertEqual(retained["start"], "2026-11-15T05:21:17.900Z")
            self.assertEqual(retained["end"], "2026-11-15T05:23:55.200Z")

    def test_remote_cache_cannot_duplicate_or_downgrade_a_reprocessed_scan(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            old = cloud.source_frame(KEY)
            new = cloud.source_frame(KEY.replace("c20263190525357", "c20263190526357"))
            for row in (old, new):
                row.update(count=0, sha256=hashlib.sha256(b"").hexdigest(), resolutionKm=2)
            cloud.publish(output, [(new, b"")], NOW)
            remote = dict(schemaVersion=1, product="ABI-L2-ACHA2KMC", satellite="GOES-18", frames=[old])
            with patch.object(cloud, "download", side_effect=lambda url, limit: json.dumps(remote).encode() if url.endswith("manifest.json") else b""):
                cached = cloud.cached_frames(output, NOW, "https://example.test/clouds/")
            self.assertEqual(list(cached), [new["file"]])

    def test_malformed_remote_manifest_does_not_discard_valid_local_cache(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            row = cloud.source_frame(KEY)
            row.update(count=0, sha256=hashlib.sha256(b"").hexdigest(), resolutionKm=2)
            cloud.publish(output, [(row, b"")], NOW)
            with patch.object(cloud, "download", return_value=b"null"):
                cached = cloud.cached_frames(output, NOW, "https://example.test/clouds/")
            self.assertEqual(list(cached), [row["file"]])


if __name__ == "__main__":
    unittest.main()
