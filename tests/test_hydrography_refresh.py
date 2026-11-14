"""Publication guards use small synthetic public inventories; no network access."""
import copy
import json
from pathlib import Path
import runpy
import tempfile
import unittest

api = runpy.run_path(str(Path(__file__).resolve().parents[1] / 'scripts/refresh-hydrography.py'))


class RefreshTests(unittest.TestCase):
    def setUp(self):
        self.old = dict(source='public/50',countyGeoid='06019',boundarySha256='abc',crs='OGC:CRS84',bounds=[1,2,3,4],
                        accepted=100,downloaded=100,rejected=0,featureTypes={'canal':20,'river':80},
                        networkAudit={'fields':{'networkid':{'nonBlankNonZero':80}}})

    def test_inventory_gates_allow_small_complete_change(self):
        new=copy.deepcopy(self.old);new.update(accepted=105,downloaded=105)
        api['validate_inventory'](self.old,new)

    def test_scope_truncation_major_change_and_lost_attributes_rejected(self):
        for changes in [dict(source='private/50'),dict(countyGeoid='other'),dict(boundarySha256='changed'),
                        dict(crs='EPSG:3857'),dict(bounds=[0,0,1,1]),dict(accepted=0),dict(rejected=1),
                        dict(downloaded=99),dict(accepted=120,downloaded=120),dict(featureTypes={'river':100}),
                        dict(networkAudit={'fields':{'networkid':{'nonBlankNonZero':0}}})]:
            with self.subTest(changes=changes),self.assertRaises(ValueError):
                api['validate_inventory'](self.old,{**self.old,**changes})

    def test_promotion_includes_validated_archives_but_excludes_work_and_private_files(self):
        with tempfile.TemporaryDirectory() as directory:
            stage=Path(directory)/'stage';root=Path(directory)/'root'
            for name in ['site/basemaps/frog-waterways-dark/root.json','site/basemaps/frog-waterways-dark/archives/a.pmtiles',
                         'work/private.json','site/data/private.json','site/data/search/v0.31.0/index.json']:
                path=stage/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_text('{}')
            api['promote'](stage,root)
            files={p.relative_to(root).as_posix() for p in root.rglob('*') if p.is_file()}
            self.assertEqual(files,{'site/basemaps/frog-waterways-dark/root.json','site/data/search/v0.31.0/index.json',
                                   'site/basemaps/frog-waterways-dark/archives/a.pmtiles'})

    def test_failure_retains_last_success_and_changes_only_status(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);folder=root/api['BASEMAP'];folder.mkdir(parents=True)
            (folder/'root.json').write_text('old verified map')
            (folder/'refresh-status.json').write_text(json.dumps({'lastSuccessAt':'2026-10-20T00:00:00Z'}))
            api['record_failure'](root)
            status=json.loads((folder/'refresh-status.json').read_text())
            self.assertEqual(status['state'],'failed');self.assertEqual(status['lastSuccessAt'],'2026-10-20T00:00:00Z')
            self.assertEqual((folder/'root.json').read_text(),'old verified map')


if __name__ == '__main__':
    unittest.main()
