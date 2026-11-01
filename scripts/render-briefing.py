"""Render unaltered NWS PDF pages into small, version-addressed app previews."""
from __future__ import annotations
import hashlib
import json
import logging
import math
from pathlib import Path
import pypdfium2 as pdfium

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "site" / "data"

def render_pages(path: Path, expected_sha: str) -> list[dict[str, object]]:
    """Verify source bytes, then render at most 40 pages without changing content."""
    actual = hashlib.sha256(path.read_bytes()).hexdigest()
    if actual != expected_sha:
        raise ValueError("PDF bytes do not match the saved revision")
    target = DATA / "briefing-previews" / actual
    target.mkdir(parents=True, exist_ok=True)
    pages = []
    with pdfium.PdfDocument(str(path)) as document:
        if not 1 <= len(document) <= 40:
            raise ValueError("PDF page count exceeds the preview limit")
        for number in range(len(document)):
            page = document[number]
            try:
                width, height = page.get_width(), page.get_height()
                if not all(math.isfinite(v) and v > 0 for v in (width, height)) or not 100 <= 1200 * height / width <= 5000:
                    raise ValueError("PDF page aspect ratio exceeds the preview limit")
                bitmap = page.render(scale=1200 / width)
                try:
                    image = bitmap.to_pil().convert("RGB")
                finally:
                    bitmap.close()
            finally:
                page.close()
            if image.height > 5000:
                raise ValueError("PDF page aspect ratio exceeds the preview limit")
            destination = target / f"{number + 1}.webp"
            temporary = target / f"{number + 1}.tmp"
            image.save(temporary, format="WEBP", quality=88, method=4)
            temporary.replace(destination)
            pages.append({"path": f"./data/briefing-previews/{actual}/{number + 1}.webp", "width": image.width, "height": image.height})
    return pages

def main() -> None:
    """Refresh public preview metadata for the current public PDF."""
    metadata_path = DATA / "hanford-briefing.json"
    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    document = metadata.get("document")
    if not document:
        logging.warning("No verified public PDF available for preview")
        return
    try:
        document["previews"] = render_pages(DATA / "hanford-briefing-current.pdf", document["sha256"])
        document["previewError"] = None
        logging.info("Public briefing preview: %s pages, revision %s", len(document["previews"]), document["sha256"])
    except (ValueError, OSError, pdfium.PdfiumError) as error:
        document["previews"] = []
        document["previewError"] = "Page previews unavailable; open the original PDF."
        logging.warning("PDF preview failed: %s", error)
    temporary = metadata_path.with_suffix(".tmp")
    temporary.write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    temporary.replace(metadata_path)

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    main()
