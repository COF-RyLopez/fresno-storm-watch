"""Offline check of the planning-questions refresh rule (no network)."""
import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('bpq', Path(__file__).resolve().parents[1] / 'scripts' / 'build-planning-questions.py')
bpq = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bpq)
NOW = 1_800_000_000.0


def file(hours_old, **extra):
    from datetime import datetime, timezone
    return {'schemaVersion': 1, 'generatedAt': datetime.fromtimestamp(NOW - hours_old * 3600, timezone.utc).isoformat(), 'questions': [{}], **extra}


class Refresh(unittest.TestCase):
    def test_age_of_a_usable_copy(self):
        self.assertAlmostEqual(bpq.usable(file(3), NOW), 3 * 3600)
        self.assertGreater(bpq.usable(file(30), NOW), bpq.REBUILD_AFTER_S)  # old: rebuild, but still a valid fallback

    def test_unusable_copies(self):
        self.assertIsNone(bpq.usable(file(1, schemaVersion=2), NOW))
        self.assertIsNone(bpq.usable(file(1, questions=[]), NOW))
        self.assertIsNone(bpq.usable(file(-1), NOW))  # future-dated
        self.assertIsNone(bpq.usable({'schemaVersion': 1}, NOW))

    def test_run_reuses_fresh_rebuilds_stale_and_keeps_newest_on_failure(self):
        import json, tempfile
        def boom(_previous):
            raise RuntimeError('source down')
        with tempfile.TemporaryDirectory() as tmp:
            bpq.OUT = Path(tmp) / 'questions.json'
            self.assertEqual(bpq.run(['--published'], fetch=lambda: file(2), build=boom, now=NOW), 'reused')
            bpq.OUT.write_text(json.dumps(file(1, tag='committed')))  # a PR committed a newer build (new fields)
            self.assertEqual(bpq.run(['--published'], fetch=lambda: file(2, tag='published'), build=boom, now=NOW), 'reused')
            self.assertEqual(json.loads(bpq.OUT.read_text())['tag'], 'committed')  # never replaced by the older deployed copy
            bpq.OUT.unlink()
            built = []
            self.assertEqual(bpq.run(['--published'], fetch=lambda: file(30, tag='published'), build=lambda previous: built.append(previous['tag']), now=NOW), 'built')
            self.assertEqual(built, ['published'])  # the build sees the last copy, for stable flood-pocket ids
            bpq.OUT.write_text(json.dumps(file(40, tag='committed')))
            self.assertEqual(bpq.run(['--published'], fetch=lambda: file(30, tag='published'), build=boom, now=NOW), 'kept')
            self.assertEqual(json.loads(bpq.OUT.read_text())['tag'], 'published')  # the newer of the two
            self.assertEqual(bpq.run(['--published'], fetch=lambda: None, build=boom, now=NOW), 'kept')
            self.assertEqual(json.loads(bpq.OUT.read_text())['tag'], 'published')  # untouched when nothing better

    def test_flood_pocket_keeps_its_id_while_mostly_the_same_parcels(self):
        old = [{'id': 'sandbags:fresno:A', 'apns': ['1', '2', '3', '4']}, {'id': 'sandbags:fresno:B', 'apns': ['8', '9']}]
        self.assertEqual(bpq.pocket_id('Fresno', ['1', '2', '3', '5'], old, set()), 'sandbags:fresno:A')  # 3 of 5 shared
        self.assertEqual(bpq.pocket_id('Fresno', ['1', '5', '6'], old, set()), 'sandbags:fresno:1')  # mostly new parcels
        self.assertEqual(bpq.pocket_id('Fresno', ['1', '2', '3', '4'], old, {'sandbags:fresno:A'}), 'sandbags:fresno:1')  # never reused twice


if __name__ == '__main__':
    unittest.main()
