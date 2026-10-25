"""Offline synthetic contract checks; no ArcGIS sign-in, private features or edits."""
import copy
import importlib.util
import json
import contextlib
import io
from pathlib import Path
import sys
import unittest
from types import SimpleNamespace

path = Path(__file__).parents[1] / "scripts" / "refresh-pump-inventory.py"
spec = importlib.util.spec_from_file_location("pump_worker", path)
worker = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = worker
spec.loader.exec_module(worker)
NOW = 1792880000000
PARENT = f"https://services3.arcgis.com/{worker.ORG}/arcgis/rest/services/{worker.PARENT_NAME}/FeatureServer"
VIEW = PARENT.replace("/FeatureServer", "_read/FeatureServer")
SOURCE = "https://utility.arcgis.com/usrsvcs/fictional/MapServer/0"


def original(identity, subtype=1, x=-119.7):
    return {"attributes": {"OBJECTID": identity, "DA": f"FICTIONAL-{identity}", "SUBTYPE": subtype, "MODIFIEDDATE": NOW - 60000}, "geometry": {"x": x, "y": 36.8}}


class FakeServices:
    def __init__(self):
        self.source = [original(150), original(151), original(152, 0), original(153, 2)]
        self.records, self.calls = [], []
        self.active, self.next_id = None, 1
        self.fail_add, self.lost_receipt, self.corrupt_stage, self.bad_crs, self.truncate, self.change_source = False, False, False, False, False, False
        self.source_reads = 0

    def call(self, url, p):
        self.calls.append((url, copy.deepcopy(p)))
        if url.endswith("/addFeatures"):
            if self.fail_add:
                self.fail_add = False
                raise worker.RefreshError("FAKE_ADD_FAILED")
            added = json.loads(p["features"])
            for f in added:
                f["attributes"]["OBJECTID"] = self.next_id
                self.next_id += 1
            self.records.extend(added)
            if self.lost_receipt:
                self.lost_receipt = False
                raise worker.RefreshError("FAKE_RECEIPT_LOST")
            return {"addResults": [{"success": True} for _ in added]}
        if url.endswith("/updateDefinition"):
            self.active = json.loads(p["updateDefinition"])["viewDefinitionQuery"].split("'")[1]
            return {"success": True}
        if url.endswith("/FeatureServer"):
            return {"isView": url == VIEW, "capabilities": "Query" if url == VIEW else "Query,Create,Editing"}
        if "/rest/admin/" in url:
            return {"adminLayerInfo": {"viewLayerDefinition": {"sourceServiceName": worker.PARENT_NAME, "sourceLayerId": 0}}}
        if not url.endswith("/query"):
            return {"geometryType": "esriGeometryPoint", "objectIdField": "OBJECTID", "fields": [{"name": n, "type": "esriFieldTypeOID" if n == "OBJECTID" else "esriFieldTypeString"} for n in worker.FIELDS]}
        is_source = url.startswith(SOURCE)
        if is_source:
            features = copy.deepcopy(self.source)
        elif url.startswith(VIEW):
            features = [f for f in self.records if f["attributes"]["snapshot_id"] == self.active and f["attributes"]["source_subtype"] == 1]
        else:
            features = self.records
            if p.get("where", "1=1") != "1=1":
                generation = p["where"].split("'")[1]
                features = [f for f in features if f["attributes"]["snapshot_id"] == generation]
        if p.get("returnIdsOnly"):
            return {"objectIds": [f["attributes"]["OBJECTID"] for f in features]}
        if p.get("returnCountOnly"):
            return {"count": len(features)}
        selected = [copy.deepcopy(f) for f in features if f["attributes"]["OBJECTID"] in set(map(int, p["objectIds"].split(",")))]
        if is_source:
            self.source_reads += 1
            if self.change_source and self.source_reads > 1:
                selected[0]["geometry"]["x"] -= .01
            return {"features": selected[:-1] if self.truncate else selected, "spatialReference": {"wkid": 3857 if self.bad_crs else 4326}}
        if self.corrupt_stage and selected and not url.startswith(VIEW):
            selected[0]["attributes"]["source_x"] = -119
        return {"features": selected}

    def run(self, data=None, now=NOW):
        return worker.refresh(self.call, PARENT, VIEW, SOURCE, data or {"layers": [{"id": 0}]}, now=now, enabled=True)


class PumpRefreshTests(unittest.TestCase):
    def test_existing_only_and_original_associations(self):
        api = FakeServices()
        data, summary = api.run()
        self.assertEqual(summary["source_count"], 4)
        self.assertEqual(summary["existing_count"], 2)
        self.assertEqual(summary["proposed_count"], 1)
        self.assertEqual(summary["other_count"], 1)
        self.assertEqual(data["layers"], [{"id": 0}])
        a = api.records[0]["attributes"]
        self.assertEqual(a["source_oid"], 150)
        self.assertNotEqual(a["OBJECTID"], 150)
        self.assertEqual(a["source_x"], -119.7)
        self.assertEqual(data[worker.HEALTH_KEY]["activeSnapshot"], api.active)
        self.assertFalse(any(url.startswith(SOURCE) and ("addFeatures" in url or "updateDefinition" in url) for url, _ in api.calls))

    def test_unchanged_only_updates_verification_not_features(self):
        api = FakeServices()
        data, _ = api.run()
        prior = copy.deepcopy(api.records)
        count = len(api.calls)
        data, summary = api.run(data, NOW + 3600000)
        self.assertEqual(summary["status"], "verified_unchanged")
        self.assertEqual(api.records, prior)
        self.assertFalse(any("addFeatures" in url or "updateDefinition" in url for url, _ in api.calls[count:]))
        self.assertEqual(data[worker.HEALTH_KEY]["lastSuccess"], NOW + 3600000)

    def test_lost_receipt_reuses_generation_and_unique_rows(self):
        api = FakeServices()
        api.lost_receipt = True
        with self.assertRaisesRegex(worker.RefreshError, "RECEIPT"):
            api.run()
        self.assertIsNone(api.active)
        self.assertEqual(len(api.records), 4)
        api.run(now=NOW + 3600000)
        self.assertEqual(len(api.records), 4)

    def test_failure_keeps_last_verified_view(self):
        api = FakeServices()
        data, _ = api.run()
        previous = api.active
        api.source[0]["geometry"]["x"] -= .01
        api.fail_add = True
        with self.assertRaisesRegex(worker.RefreshError, "ADD_FAILED"):
            api.run(data, NOW + 3600000)
        self.assertEqual(api.active, previous)
        self.assertEqual(data[worker.HEALTH_KEY]["lastSuccess"], NOW)

    def test_changed_identity_and_removal_switch_only_after_verification(self):
        api = FakeServices()
        data, _ = api.run()
        previous = api.active
        api.source = [original(150, x=-119.8), original(154), original(152, 0)]
        data, summary = api.run(data, NOW + 3600000)
        self.assertNotEqual(api.active, previous)
        self.assertEqual(summary["added_records"], 1)
        self.assertEqual(summary["removed_records"], 2)
        self.assertEqual(summary["existing_count"], 2)
        self.assertEqual(len(api.records), 7)

    def test_bad_source_crs_partial_batches_and_mid_read_changes_fail_closed(self):
        for attr in ["bad_crs", "truncate", "change_source"]:
            api = FakeServices()
            setattr(api, attr, True)
            with self.assertRaises(worker.RefreshError):
                api.run()
            self.assertIsNone(api.active)
            self.assertEqual(api.records, [])

    def test_tampered_staged_content_does_not_become_active(self):
        api = FakeServices()
        api.corrupt_stage = True
        with self.assertRaisesRegex(worker.RefreshError, "CONTENT_MISMATCH"):
            api.run()
        self.assertIsNone(api.active)

    def test_source_proxy_and_destination_access_are_pinned(self):
        source = {"owner": worker.OWNER, "access": "private", "type": "Map Service", "url": SOURCE[:-2]}
        self.assertEqual(worker.source_proxy(source, source["url"]), SOURCE)
        for extra in [{"access": "shared"}, {"owner": "other"}, {"url": "https://utility.arcgis.com:444/usrsvcs/fake/MapServer"}, {"url": "https://utility.arcgis.com/usrsvcs/fake/MapServer?token=NEVER"}]:
            with self.assertRaises(worker.RefreshError):
                item = {**source, **extra}
                worker.source_proxy(item, item["url"])
        item = {"owner": worker.OWNER, "access": "shared", "type": "Feature Service", "tags": [worker.TAG], "url": PARENT}
        with self.assertRaises(worker.RefreshError):
            worker.service_url(item, worker.PARENT_NAME, view=False)

    def test_disabled_and_unconfigured_notebooks_do_not_even_sign_in(self):
        with self.assertRaisesRegex(worker.RefreshError, "ACTIVATION_PENDING"):
            worker.run_notebook(worker.RefreshConfig())
        with self.assertRaisesRegex(worker.RefreshError, "SOURCE_CONNECTION_SETUP_PENDING"):
            worker.run_notebook(worker.RefreshConfig(enabled=True))

    def test_invalid_ids_and_proposed_only_inventory_are_not_a_verified_empty_copy(self):
        api = FakeServices()
        api.source = [original(150, 0)]
        with self.assertRaisesRegex(worker.RefreshError, "NO_EXISTING"):
            api.run()
        with self.assertRaises(worker.RefreshError):
            worker.ids_from({"objectIds": [1, 1]}, lambda: {"count": 2})
        with self.assertRaises(worker.RefreshError):
            worker.ids_from({"objectIds": None}, lambda: {"count": 4})

    def test_generated_notebook_matches_worker_and_runs_inactive_without_arcgis(self):
        notebook_path = path.parents[1] / "notebooks" / "fmfcd-pump-inventory-refresh.ipynb"
        notebook = json.loads(notebook_path.read_text(encoding="utf-8"))
        self.assertEqual(notebook["nbformat"], 4)
        worker_cell = "".join(notebook["cells"][4]["source"])
        expected = path.read_text(encoding="utf-8").split('\nif __name__ == "__main__":')[0]
        self.assertEqual(worker_cell, expected)
        namespace = {"__name__": "__main__"}
        with contextlib.redirect_stdout(io.StringIO()) as output:
            for cell in notebook["cells"]:
                if cell["cell_type"] == "code":
                    self.assertEqual(cell["outputs"], [])
                    exec(compile("".join(cell["source"]), "prepared_notebook", "exec"), namespace)
        self.assertIn("activation_pending", output.getvalue())
        self.assertFalse(namespace["ENABLE_REFRESH"])
        self.assertEqual(namespace["SOURCE_ITEM_ID"], "")

    def test_managed_runtime_auth_and_private_health_reconcile_without_credentials_in_code(self):
        api = FakeServices()

        class Item(dict):
            def __init__(self, values, groups=()):
                super().__init__(values)
                self.data = {"layers": [{"id": 0}]}
                self.sharing = SimpleNamespace(groups=SimpleNamespace(list=lambda: [SimpleNamespace(id=g) for g in groups]))

            def get_data(self):
                return copy.deepcopy(self.data)

            def update(self, *, data):
                self.data = copy.deepcopy(data)
                return True

        common = {"owner": worker.OWNER, "type": "Feature Service", "tags": [worker.TAG]}
        parent = Item({**common, "url": PARENT, "access": "private"})
        view = Item({**common, "url": VIEW, "access": "shared"}, [worker.VIEWERS])
        source = Item({"owner": worker.OWNER, "type": "Map Service", "url": SOURCE[:-2], "access": "private"})
        items = {worker.PARENT_ID: parent, worker.VIEW_ID: view, "c" * 32: source}

        def post(url, *, data, timeout, allow_redirects):
            self.assertFalse(allow_redirects)
            self.assertLessEqual(timeout, 25)
            self.assertNotIn("token", data)
            response = api.call(url, {k: {"true": True, "false": False}.get(v, v) if isinstance(v, str) else v for k, v in data.items()})
            return SimpleNamespace(status_code=200, json=lambda: response)

        gis = SimpleNamespace(properties=SimpleNamespace(id=worker.ORG), users=SimpleNamespace(me=SimpleNamespace(username=worker.OWNER)), content=SimpleNamespace(get=lambda i: items[i]), session=SimpleNamespace(post=post))
        with contextlib.redirect_stdout(io.StringIO()):
            result = worker.run_notebook(worker.RefreshConfig(source_item_id="c" * 32, approved_proxy_url=SOURCE[:-2], enabled=True, scheduled=True), gis=gis)
        self.assertEqual(result["existing_count"], 2)
        old_success = view.data[worker.HEALTH_KEY]["lastSuccess"]
        old_generation = api.active
        gis.session.post = lambda *args, **kwargs: SimpleNamespace(status_code=200, json=lambda: {"error": {"message": "PRIVATE_SECRET_MUST_NOT_BE_LOGGED"}})
        with contextlib.redirect_stdout(io.StringIO()) as output:
            with self.assertRaisesRegex(worker.RefreshError, "SERVICE_REQUEST_FAILED"):
                worker.run_notebook(worker.RefreshConfig(source_item_id="c" * 32, approved_proxy_url=SOURCE[:-2], enabled=True, scheduled=True), gis=gis)
        self.assertEqual(api.active, old_generation)
        self.assertEqual(view.data[worker.HEALTH_KEY]["lastSuccess"], old_success)
        self.assertEqual(view.data[worker.HEALTH_KEY]["state"], "failed")
        self.assertNotIn("PRIVATE_SECRET", output.getvalue())


if __name__ == "__main__":
    unittest.main()
