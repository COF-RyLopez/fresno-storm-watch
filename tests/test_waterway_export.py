"""Local conversion contract checks; requires requirements-waterways.txt."""
import importlib.util
import tempfile
import unittest
from pathlib import Path

from shapely.geometry import Polygon

spec = importlib.util.spec_from_file_location('waterway_export', Path(__file__).resolve().parents[1] / 'scripts' / 'export-waterways.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ExportTests(unittest.TestCase):
    def setUp(self):
        self.county = Polygon([(-120,36),(-119,36),(-119,37),(-120,37)])
        self.feature = {'attributes': {'OBJECTID':7,'id3dhp':'stable-7','gnisidlabel':'Test river','gnisid':'123','featuretype':1,'featuretypelabel':'River','featuredate':1234,'lengthkm':2.3}, 'geometry': {'paths': [[[-120.1,36.5],[-119.5,36.5]]]}}

    def test_boundary_crossing_segment_preserved(self):
        rows, rejected = module.convert([self.feature],self.county,'OBJECTID')
        self.assertFalse(rejected)
        self.assertEqual(module.from_wkb(rows[0]['geometry']).bounds[0],-120.1)
        self.assertEqual(rows[0]['id3dhp'],'stable-7')

    def test_duplicate_and_outside_features_are_accounted_for(self):
        rows, rejected = module.convert([self.feature,self.feature],self.county,'OBJECTID')
        self.assertEqual((len(rows),len(rejected)),(1,1))
        outside={**self.feature,'geometry':{'paths':[[[-121,35],[-120.5,35]]]}}
        self.assertEqual(len(module.convert([outside],self.county,'OBJECTID')[1]),1)

    def test_rejects_implicit_z_loss_and_invalid_coordinates(self):
        for point in [[-119.5,36.5,12],[float('nan'),36.5],[-119500,36500]]:
            feature={**self.feature,'geometry':{'paths':[[point,[-119.5,36.6]]]}}
            self.assertEqual(len(module.convert([feature],self.county,'OBJECTID')[1]),1)

    def test_roundtrip_retains_crs_ids_and_geometry(self):
        rows,_=module.convert([self.feature],self.county,'OBJECTID')
        (module.ROOT/'work').mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(dir=module.ROOT/'work') as directory:
            report=module.write_outputs(rows,Path(directory),{'source':'public test'})
            table=module.pq.read_table(Path(directory)/'fresno-named-waterways.parquet')
            geo=module.json.loads(table.schema.metadata[b'geo'])
            self.assertEqual(report['features'],1)
            self.assertEqual(geo['columns']['geometry']['crs']['id'],{'authority':'OGC','code':'CRS84'})
            self.assertEqual(table.column('geometry').to_pylist(),[rows[0]['geometry']])
            self.assertEqual(table.column('id3dhp').to_pylist(),['stable-7'])


if __name__=='__main__':
    unittest.main()
