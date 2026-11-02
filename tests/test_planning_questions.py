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
        def boom():
            raise RuntimeError('source down')
        with tempfile.TemporaryDirectory() as tmp:
            bpq.OUT = Path(tmp) / 'questions.json'
            self.assertEqual(bpq.run(['--published'], fetch=lambda: file(2), build=boom, now=NOW), 'reused')
            built = []
            self.assertEqual(bpq.run(['--published'], fetch=lambda: file(30), build=lambda: built.append(1), now=NOW), 'built')
            self.assertEqual(built, [1])
            bpq.OUT.write_text(json.dumps(file(40, tag='committed')))
            self.assertEqual(bpq.run(['--published'], fetch=lambda: file(30, tag='published'), build=boom, now=NOW), 'kept')
            self.assertEqual(json.loads(bpq.OUT.read_text())['tag'], 'published')  # the newer of the two
            self.assertEqual(bpq.run(['--published'], fetch=lambda: None, build=boom, now=NOW), 'kept')
            self.assertEqual(json.loads(bpq.OUT.read_text())['tag'], 'published')  # untouched when nothing better


if __name__ == '__main__':
    unittest.main()
