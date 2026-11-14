"""Stage and validate a fresh public 3DHP reference before updating tracked outputs.

No credentials or private services. Each run has a new acquisition cache. GitHub
publishes only after all validation succeeds; failed runs retain the last commit.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import logging
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
BASEMAP = Path('site/basemaps/frog-waterways-dark')
SEARCH = [Path('site/data/search/v0.31.0'), Path('site/data/search/waterbodies-v0.34.0')]
LOG = logging.getLogger('hydrography-refresh')


def read(path: Path) -> dict:
    """Read a UTF-8 JSON contract."""
    return json.loads(path.read_text(encoding='utf-8'))


def validate_inventory(previous: dict, current: dict) -> None:
    """Reject scope changes, dropped records and major changes requiring review."""
    for field in ('source', 'countyGeoid', 'boundarySha256', 'crs', 'bounds'):
        if current.get(field) != previous.get(field):
            raise ValueError(f'Changed {field}; review the reference contract first')
    count = current.get('accepted', 0)
    if not count or current.get('rejected') != 0 or current.get('downloaded') != count:
        raise ValueError('Incomplete source inventory; prior map retained')
    if abs(count / previous['accepted'] - 1) > .10:
        raise ValueError('Source count changed by more than 10%; technical review required')
    if any(n and not current.get('featureTypes', {}).get(k) for k, n in previous.get('featureTypes', {}).items()):
        raise ValueError('A previously mapped feature class disappeared; review required')
    for field, values in previous.get('networkAudit', {}).get('fields', {}).items():
        if values.get('nonBlankNonZero', 0) and not current.get('networkAudit', {}).get('fields', {}).get(field, {}).get('nonBlankNonZero', 0):
            raise ValueError(f'Network attribute coverage disappeared: {field}')


def promote(stage: Path, root: Path) -> None:
    """Copy only allowlisted public outputs after validation. Git is the publication boundary."""
    for relative in [BASEMAP, *SEARCH]:
        source, destination = stage / relative, root / relative
        for path in source.rglob('*'):
            if not path.is_file():
                continue
            out = destination / path.relative_to(source)
            out.parent.mkdir(parents=True, exist_ok=True)
            if not out.exists() or path.read_bytes() != out.read_bytes():
                shutil.copy2(path, out)


def record_failure(root: Path = ROOT) -> None:
    """Write only public status, never exception text, credentials or partial outputs."""
    path = root / BASEMAP / 'refresh-status.json'
    status = read(path) if path.exists() else {'schemaVersion': 1, 'lastSuccessAt': None}
    status.update(state='failed', lastAttemptAt=datetime.now(timezone.utc).isoformat(),
                  message='Refresh failed validation or acquisition; previous published reference retained.')
    path.write_text(json.dumps(status, indent=2) + '\n', encoding='utf-8')


def refresh(apply: bool = False) -> Path:
    """Acquire both sources, build and validate in isolation, optionally apply outputs."""
    (ROOT / 'work').mkdir(exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix='hydrography-refresh-', dir=ROOT / 'work'))
    LOG.info('Isolated staging directory: %s', stage)
    # Never copy work/batches or credentials. Keeping the previous public tiles
    # in staging lets the ordinary builders/tests preserve their existing contracts.
    shutil.copytree(ROOT / 'scripts', stage / 'scripts')
    shutil.copytree(ROOT / 'site/lib', stage / 'site/lib')
    shutil.copytree(ROOT / 'tests', stage / 'tests')
    for relative in [BASEMAP, *SEARCH]:
        shutil.copytree(ROOT / relative, stage / relative, ignore=shutil.ignore_patterns('archives'))
    for name in ('counties.geojson', 'reservoir-watchlist.json'):
        shutil.copy2(ROOT / 'site/data' / name, stage / 'site/data' / name)
    shutil.copy2(ROOT / 'package.json', stage / 'package.json')

    def run(*args: str) -> None:
        LOG.info('Running %s', ' '.join(args))
        subprocess.run(args, cwd=stage, check=True, timeout=1200)

    run(sys.executable, 'scripts/acquire-waterways-county.py')
    run(sys.executable, 'scripts/acquire-waterbodies-county.py')
    for folder, manifest in [('waterways-county', 'manifest.json'), ('waterbodies-county', 'waterbodies-manifest.json')]:
        validate_inventory(read(ROOT / BASEMAP / manifest), read(stage / 'work' / folder / 'manifest.json'))
    run(sys.executable, 'scripts/build-map-search.py', '--waterways-only')
    run(sys.executable, 'scripts/build-waterbody-search.py')
    run('node', 'scripts/build-waterway-basemap.mjs')
    run('node', 'scripts/build-waterbody-basemap.mjs')
    run('node', '--test', 'tests/waterway-basemap.test.mjs', 'tests/waterbodies.test.mjs', 'tests/waterbody-search.test.mjs', 'tests/map-search.test.mjs')
    run('node', 'scripts/pack-waterway-archives.mjs')
    status = {'schemaVersion': 1, 'state': 'current', 'lastAttemptAt': datetime.now(timezone.utc).isoformat(),
              'lastSuccessAt': datetime.now(timezone.utc).isoformat(), 'schedule': 'Weekly, Sunday 12:30 UTC',
              'message': 'Both USGS sources freshly retrieved, geometry and tiles validated. Retrieval is not a new survey date.',
              'flowlines': read(stage / BASEMAP / 'manifest.json')['accepted'],
              'waterbodies': read(stage / BASEMAP / 'waterbodies-manifest.json')['accepted']}
    (stage / BASEMAP / 'refresh-status.json').write_text(json.dumps(status, indent=2) + '\n', encoding='utf-8')
    if apply:
        promote(stage, ROOT)
    LOG.info('Validated reference %s; applied=%s', stage, apply)
    return stage


if __name__ == '__main__':
    logging.basicConfig(level=logging.INFO, format='%(levelname)s %(message)s')
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true', help='Apply validated public outputs; does not push or deploy')
    parser.add_argument('--record-failure', action='store_true', help='Write public failure status only')
    args = parser.parse_args()
    if args.record_failure:
        record_failure()
    else:
        refresh(args.apply)
