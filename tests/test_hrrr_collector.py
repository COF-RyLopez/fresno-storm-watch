"""Offline independent rotation and missing-data checks for prepared HRRR fields."""
import runpy
from pathlib import Path
import unittest
from types import SimpleNamespace

import numpy as np
from pyproj import CRS, Transformer

collector = SimpleNamespace(**runpy.run_path(str(Path(__file__).resolve().parents[1]/"scripts"/"collect-hrrr.py")))


class HrrrCollectorTests(unittest.TestCase):
    def test_lambert_rotation_matches_analytic_convergence_and_preserves_speed(self):
        crs = CRS.from_proj4("+proj=lcc +lat_1=38.5 +lat_2=38.5 +lat_0=38.5 +lon_0=-97.5 +a=6371229 +b=6371229 +units=m")
        forward = Transformer.from_crs(4326, crs, always_xy=True)
        inverse = Transformer.from_crs(crs, 4326, always_xy=True)
        lon = np.array([-97.5, -120., -119., -118.5])
        lat = np.array([38.5, 36., 37., 37.5])
        x, y = forward.transform(lon, lat)
        u, v = np.array([1., 3., -4., 0.]), np.array([0., 4., 3., -5.])
        east, north = collector.rotate(u, v, x, y, inverse)
        gamma = np.deg2rad(np.sin(np.deg2rad(38.5))*(lon+97.5))
        np.testing.assert_allclose(east, u*np.cos(gamma)+v*np.sin(gamma), atol=1e-5)
        np.testing.assert_allclose(north, -u*np.sin(gamma)+v*np.cos(gamma), atol=1e-5)
        np.testing.assert_allclose(np.hypot(east, north), np.hypot(u, v), atol=1e-5)

    def test_serialization_keeps_nodata_distinct_from_zero(self):
        self.assertEqual(collector.numbers(np.array([[np.nan, 0., 2.345]])), [None, 0., 2.35])


if __name__ == "__main__":
    unittest.main()
