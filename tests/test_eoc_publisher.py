"""Pure publisher contract tests; no ArcGIS connection or hosted mutation."""
import runpy
import unittest
from pathlib import Path
from types import SimpleNamespace

publisher = runpy.run_path(str(Path(__file__).resolve().parents[1] / "scripts" / "provision-eoc.py"))


class EocPublisherContract(unittest.TestCase):
    def test_unique_id_and_editor_tracking(self):
        schema = publisher["schema"]()
        publisher["validate_table"](schema)
        self.assertTrue(any(i["fields"] == "event_id" and i["isUnique"] for i in schema["indexes"]))
        self.assertEqual(set(schema["capabilities"].split(",")), {"Query", "Create"})
        self.assertEqual(next(f["length"] for f in schema["fields"] if f["name"] == "payload"), 65536)

    def test_missing_tracking_and_fields_fail(self):
        with self.assertRaises(RuntimeError):
            publisher["validate_table"]({"fields": []})
        schema = publisher["schema"]()
        schema["editFieldsInfo"] = {}
        with self.assertRaises(RuntimeError):
            publisher["validate_table"](schema)

    def test_enterprise_session_fails_closed_without_urlkey(self):
        gis = SimpleNamespace(properties={}, users=SimpleNamespace(me=SimpleNamespace(username="rylopez")))
        with self.assertRaisesRegex(RuntimeError, "No changes made"):
            publisher["preflight"](gis)

    def test_privileged_collections_have_different_groups(self):
        roles = publisher["WRITERS"]
        self.assertEqual(roles["incidents"], "recorders")
        self.assertEqual(roles["approvals"], "approvers")
        self.assertEqual(roles["verifications"], "reviewers")
        self.assertNotEqual(roles["reports"], roles["incidents"])


if __name__ == "__main__":
    unittest.main()
