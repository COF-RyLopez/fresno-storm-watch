"""Verify PDF source identity, repeatability and bounded page rendering."""
import hashlib
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("briefing_renderer", ROOT / "scripts" / "render-briefing.py")
renderer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(renderer)

class BriefingRendererTests(unittest.TestCase):
    def test_wrong_revision_never_renders(self):
        with patch.object(renderer.pdfium, "PdfDocument") as load:
            with self.assertRaises(ValueError):
                renderer.render_pages(ROOT / "site/data/hanford-briefing-current.pdf", "0" * 64)
            load.assert_not_called()

    def test_real_public_pages_are_repeatable_and_version_addressed(self):
        pdf = ROOT / "site/data/hanford-briefing-current.pdf"
        revision = hashlib.sha256(pdf.read_bytes()).hexdigest()
        with tempfile.TemporaryDirectory() as temporary, patch.object(renderer, "DATA", Path(temporary)):
            first = renderer.render_pages(pdf, revision)
            files = [Path(temporary) / p["path"].removeprefix("./data/") for p in first]
            hashes = [hashlib.sha256(p.read_bytes()).hexdigest() for p in files]
            second = renderer.render_pages(pdf, revision)
            self.assertEqual(first, second)
            self.assertEqual(hashes, [hashlib.sha256(p.read_bytes()).hexdigest() for p in files])
            self.assertTrue(1 <= len(first) <= 40)
            self.assertTrue(all(revision in p["path"] and 1199 <= p["width"] <= 1201 for p in first))

    def test_unbounded_page_rejected_before_pixel_allocation(self):
        class Page:
            def get_width(self): return 1
            def get_height(self): return 10000
            def render(self, **kwargs): raise AssertionError("Must reject before rendering")
            def close(self): pass
        class Document:
            def __enter__(self): return self
            def __exit__(self, *args): pass
            def __len__(self): return 1
            def __getitem__(self, index): return Page()
        with tempfile.TemporaryDirectory() as temporary, patch.object(renderer, "DATA", Path(temporary)), patch.object(renderer.pdfium, "PdfDocument", return_value=Document()):
            path = Path(temporary) / "test.pdf"
            path.write_bytes(b"bounded test input")
            with self.assertRaisesRegex(ValueError, "aspect ratio"):
                renderer.render_pages(path, hashlib.sha256(path.read_bytes()).hexdigest())

if __name__ == "__main__":
    unittest.main()
