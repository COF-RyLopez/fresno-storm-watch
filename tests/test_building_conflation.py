"""Small fictional geometry checks; no private county data are used."""
import runpy
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from shapely.geometry import Point, box

MODULE = SimpleNamespace(**runpy.run_path(str(Path(__file__).resolve().parents[1] / "scripts" / "conflate-buildings.py")))


class ConflationTests(unittest.TestCase):
    def test_county_first_and_stacked_occupancies_do_not_duplicate_physical_count(self):
        nsi = [{"fd_id": i, "geometry": Point(-119.5, 36.5), "found_ht": None} for i in [1, 2]]
        result = MODULE.conflate(nsi, [{"id": "gers1", "geometry": box(-120, 36, -119, 37)}], [{"asset_id": "county1", "geometry": box(-119.8, 36.2, -119.2, 36.8)}])
        self.assertEqual(result["accounting"]["physical_buildings_with_nsi"], 1)
        self.assertEqual(result["accounting"]["occupancy_records_matched"], 2)
        self.assertIsNone(result["links"][0]["foundation_height_m"])
        self.assertFalse(next(b for b in result["buildings"] if b["source"] == "overture")["display_preferred"])

    def test_ambiguous_unmatched_holes_boundary_and_invalid_geometry(self):
        nsi = [{"fd_id": "a", "geometry": Point(-119.5, 36.5)}, {"fd_id": "b", "geometry": Point(-118, 36)}]
        result = MODULE.conflate(nsi, [{"id": "1", "geometry": box(-120, 36, -119, 37)}, {"id": "2", "geometry": box(-120, 36, -119, 37)}], [])
        self.assertEqual(result["accounting"]["nsi_matched"], 0)
        self.assertEqual([r["reason"] for r in result["unmatched"]], ["ambiguous", "no containing footprint"])
        boundary = MODULE.conflate([{"fd_id": 1, "geometry": Point(-120, 36)}], [{"id": "1", "geometry": box(-120, 36, -119, 37)}], [])
        self.assertEqual(len(boundary["links"]), 1)

    def test_unknowns_duplicate_ids_and_round_trip(self):
        self.assertIsNone(MODULE.finite(float("nan")))
        self.assertIsNone(MODULE.finite(True))
        nsi = [{"fd_id": 1, "geometry": Point(-119.5, 36.5), "found_ht": 0}]
        with self.assertRaises(ValueError):
            MODULE.conflate(nsi * 2, [], [])
        result = MODULE.conflate(nsi, [{"id": "gers", "height": 9, "geometry": box(-120, 36, -119, 37)}], [])
        self.assertEqual(result["links"][0]["foundation_height_m"], 0)
        with tempfile.TemporaryDirectory(prefix="frog-exposure-") as root:
            MODULE.write_outputs(result, Path(root), {"nsi_release": "fixture", "overture_release": "fixture"})
            rows, _ = MODULE.read_geo(Path(root) / "footprints.parquet")
            self.assertEqual(rows[0]["display_height_m"], 9)
            with self.assertRaises(ValueError):
                MODULE.write_outputs(result, Path(root), {})


if __name__ == "__main__":
    unittest.main()
