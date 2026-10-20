"""Offline audit semantics; no network or ArcGIS credentials required."""
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('irrigation_audit', Path(__file__).resolve().parents[1] / 'scripts' / 'audit-irrigation-sources.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class AuditTests(unittest.TestCase):
    def test_shared_water_rights_are_not_collapsed_into_one_asset(self) -> None:
        rows = [{'globalid': 'a', 'wr_id': 'same', 'data_management_status': 'Active'},
                {'globalid': 'b', 'wr_id': 'same', 'data_management_status': 'Inactive'}]
        result = module.audit_attributes(rows)
        self.assertEqual(result['records'], 2)
        self.assertEqual(result['uniqueNonblankIds']['wr_id'], 1)
        self.assertEqual(result['categories']['diversion_status'], {'None': 2})
        self.assertIn('not operating state', result['interpretation'])

    def test_empty_records_stay_empty(self) -> None:
        result = module.audit_attributes([])
        self.assertEqual(result['records'], 0)
        self.assertEqual(result['categories']['diversion_type'], {})
        self.assertEqual(result['populated']['last_edited_date'], 0)


if __name__ == '__main__':
    unittest.main()
