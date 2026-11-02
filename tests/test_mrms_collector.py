"""Offline checks for the MRMS observed-rainfall collector."""
import runpy
from pathlib import Path
import unittest
from types import SimpleNamespace

import numpy as np

collector = SimpleNamespace(**runpy.run_path(str(Path(__file__).resolve().parents[1]/"scripts"/"collect-mrms.py")))


class MrmsCollectorTests(unittest.TestCase):
    def test_newest_filled_hour_skips_a_lagging_tail(self):
        self.assertEqual(collector.latest_complete([True, True, True, False, False]), 2)
        with self.assertRaises(ValueError):
            collector.latest_complete([False, False])

    def test_total_sums_hourly_rates_and_a_gap_in_any_hour_stays_unknown(self):
        hours = [np.array([0.1, 0.0, np.nan]), np.array([0.2, 0.0, 0.3])]
        self.assertEqual(collector.numbers(collector.total(hours)), [0.3, 0.0, None])

    def test_rate_converts_mm_per_second_to_inches_per_hour(self):
        self.assertEqual(collector.numbers(np.array([25.4/3600, 0.])*collector.IN_PER_HOUR), [1.0, 0.0])


if __name__ == "__main__":
    unittest.main()
