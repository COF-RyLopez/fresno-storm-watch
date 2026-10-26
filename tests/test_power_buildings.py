"""Synthetic address-join correctness, without connecting to any source."""
import runpy
import unittest
from pathlib import Path
from shapely.geometry import Point, box

join = runpy.run_path(str(Path(__file__).resolve().parents[1] / "scripts/build-power-buildings.py"))["contained_addresses"]


class AddressJoinTests(unittest.TestCase):
    def test_unique_containment_multiple_units_and_ambiguous_footprints(self):
        buildings = [{"geom": box(0, 0, 2, 2)}, {"geom": box(1, 1, 3, 3)}]
        rows = [{"geom": Point(.5, .5), "number": "100", "street": "Example", "unit": "A"},
                {"geom": Point(.6, .6), "number": "100", "street": "Example", "unit": "B"},
                {"geom": Point(1.5, 1.5), "number": "200", "street": "Ambiguous"},
                {"geom": Point(4, 4), "number": "300", "street": "Outside"},
                {"geom": Point(.5, .5), "street": "Incomplete"}]
        stats = join(buildings, rows)
        self.assertEqual(stats, {"matched_address_records": 2, "ambiguous_address_records": 1, "unmatched_address_records": 1, "incomplete_address": 1})
        self.assertEqual(buildings[0]["addresses"], {"100 Example · unit A", "100 Example · unit B"})
        self.assertNotIn("addresses", buildings[1])


if __name__ == "__main__":
    unittest.main()
