"""Geometry-contract tests using the pinned Shapely / PROJ environment."""
import runpy
from pathlib import Path
import unittest
from types import SimpleNamespace
from shapely.geometry import box, shape

module = SimpleNamespace(**runpy.run_path(str(Path(__file__).resolve().parents[1] / 'scripts' / 'acquire-waterbodies-county.py')))


class WaterbodyExportTests(unittest.TestCase):
    def fixture(self, key='lake-1', coordinates=None):
        return {'type': 'Feature', 'properties': {'OBJECTID': 1, 'id3dhp': key, 'gnisidlabel': '  Test   Lake ', 'featuretype': 3, 'featuretypelabel': 'Lake'},
                'geometry': {'type': 'Polygon', 'coordinates': coordinates or [[[-119.8, 36.8], [-119.7, 36.8], [-119.7, 36.9], [-119.8, 36.9], [-119.8, 36.8]]]}}

    def test_preserves_holes_and_uses_interior_anchor_projected_area(self):
        feature = self.fixture()
        feature['geometry']['coordinates'].append([[-119.78, 36.82], [-119.78, 36.88], [-119.72, 36.88], [-119.72, 36.82], [-119.78, 36.82]])
        rows, rejected = module.convert([feature], box(-120, 36, -119, 37), 'OBJECTID')
        self.assertEqual(rejected, [])
        geom = shape(rows[0]['geometry'])
        self.assertEqual(len(geom.interiors), 1)
        self.assertTrue(geom.contains(shape({'type': 'Point', 'coordinates': rows[0]['properties']['label_point']})))
        self.assertEqual(rows[0]['properties']['name'], 'Test Lake')
        self.assertGreater(rows[0]['properties']['display_area_sqkm'], 50)
        self.assertLess(rows[0]['properties']['display_area_sqkm'], 70)

    def test_duplicate_bad_dimension_and_outside_records_are_explicitly_rejected(self):
        good = self.fixture()
        outside = self.fixture('outside', [[[-118, 36], [-117, 36], [-117, 37], [-118, 36]]])
        bad = self.fixture('z-values', [[[-119.8, 36.8, 1], [-119.7, 36.8, 1], [-119.7, 36.9, 1], [-119.8, 36.8, 1]]])
        rows, rejected = module.convert([good, good, outside, bad], box(-120, 36, -119, 37), 'OBJECTID')
        self.assertEqual(len(rows), 1)
        self.assertEqual(len(rejected), 3)
        self.assertEqual(len(rows) + len(rejected), 4)


if __name__ == '__main__':
    unittest.main()
