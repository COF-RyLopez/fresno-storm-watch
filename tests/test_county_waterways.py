"""Offline tests for network-attribute population accounting, not topology."""
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('county_acquisition', Path(__file__).resolve().parents[1] / 'scripts' / 'acquire-waterways-county.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class NetworkAuditTests(unittest.TestCase):
    def test_zero_and_blank_fields_are_not_claimed_as_network_links(self):
        records = [{'attributes': {'featuretype': 2, 'hydrosequence': 0, 'catchmentid3dhp': '', 'flowdirection': 0}},
                   {'attributes': {'featuretype': 1, 'hydrosequence': 15, 'uphydrosequence': 0.0, 'dnhydrosequence': 14, 'mainstemid': 'public-mainstem', 'flowdirection': 1}}]
        audit = module.network_audit(records)
        self.assertEqual(audit['fields']['hydrosequence'], {'nonNull': 2, 'nonBlankNonZero': 1})
        self.assertEqual(audit['fields']['catchmentid3dhp'], {'nonNull': 1, 'nonBlankNonZero': 0})
        self.assertEqual(audit['fields']['uphydrosequence']['nonBlankNonZero'], 0)
        self.assertEqual(audit['mappedFlowDirectionCodes'], {'0': 1, '1': 1})
        self.assertEqual(audit['bySourceFeatureType']['2']['hydrosequencePopulated'], 0)
        self.assertEqual(audit['bySourceFeatureType']['1']['downstreamPointerPopulated'], 1)

    def test_unknown_nonfinite_and_missing_are_distinguished_from_populated_ids(self):
        for value in [None, '', 'null', '0', 0, 0.0, float('nan'), float('inf')]:
            self.assertFalse(module.present(value))
        self.assertTrue(module.present('abc1234'))
        self.assertEqual(module.network_audit([])['fields']['hydrosequence']['nonNull'], 0)


if __name__ == '__main__':
    unittest.main()
