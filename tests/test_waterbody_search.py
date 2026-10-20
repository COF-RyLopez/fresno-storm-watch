"""Full-outline identities, winding, holes and accounting; no network calls."""
import importlib.util
from pathlib import Path
import unittest
from shapely.geometry import Polygon, mapping

spec = importlib.util.spec_from_file_location('waterbody_search', Path(__file__).resolve().parents[1] / 'scripts/build-waterbody-search.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class WaterbodySearchTests(unittest.TestCase):
    def row(self, identifier, gnis, name='Twin Lake', polygon=None, kind=3):
        polygon = polygon or Polygon([(-119.8,36.8),(-119.7,36.8),(-119.7,36.9),(-119.8,36.9)])
        return {'properties': {'id3dhp': identifier, 'gnisid': gnis, 'gnisidlabel': name, 'featuretype': kind}, 'geometry': mapping(polygon)}

    def test_same_names_with_distinct_gnis_do_not_merge_but_matching_identity_keeps_all_parts(self):
        distant = Polygon([(-120.5,37),(-120.4,37),(-120.4,37.1),(-120.5,37.1)])
        entries, shapes, count = module.build_groups([self.row('1',1),self.row('2',2),self.row('3',1,polygon=distant)])
        self.assertEqual(len(entries),2)
        self.assertEqual(count['accepted'],3)
        multi = next(row for row in entries if row['identity']=='gnis:1')
        self.assertEqual(multi['sourceIds'],['1','3'])
        self.assertEqual(len(shapes[multi['key']]['rings']),2)
        self.assertEqual(multi['bounds'],[-120.5,36.8,-119.7,37.1])

    def test_holes_have_esri_winding_and_no_clipping_or_simplification_is_applied(self):
        outer=[(-119.8,36.8),(-119.7,36.8),(-119.7,36.9),(-119.8,36.9)]
        hole=[(-119.78,36.82),(-119.72,36.82),(-119.72,36.88),(-119.78,36.88)]
        polygon=Polygon(outer,[hole])
        entries,shapes,_=module.build_groups([self.row('1',1,polygon=polygon)])
        rings=shapes[entries[0]['key']]['rings']
        self.assertEqual(len(rings),2)
        self.assertFalse(Polygon(rings[0]).exterior.is_ccw)
        self.assertTrue(Polygon(rings[1]).exterior.is_ccw)
        self.assertAlmostEqual(Polygon(rings[0],rings[1:]).area,polygon.area,12)

    def test_unnamed_and_other_types_are_accounted_for_without_inventing_lake_names(self):
        rows=[self.row('1',1,name=''),self.row('2',2,kind=4),self.row('3',0),self.row('4',0)]
        entries,_,count=module.build_groups(rows)
        self.assertEqual(len(entries),2)  # Missing GNIS uses separate source identity.
        self.assertEqual(count,{'input':4,'otherFeatureType':1,'unnamed':1,'accepted':2})
        with self.assertRaises(ValueError):module.build_groups([rows[2],rows[2]])


if __name__=='__main__':unittest.main()
