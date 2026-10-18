"""Pure publisher contract tests; no ArcGIS connection or hosted mutation."""
import runpy
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

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

    def test_append_only_accepts_arcgis_derived_labels(self):
        for capabilities in (
            "Query,Create", "Create,Query,Editing", "Create,Query,Uploads,Editing",
            " Create, Query, Editing, Uploads ", "Query,Create,Query",
        ):
            with self.subTest(capabilities=capabilities):
                publisher["validate_capabilities"]({"capabilities": capabilities}, "Query,Create", "parent")

    def test_append_only_rejects_mutation_sync_and_unknown_operations(self):
        for extra in ("Update", "Delete", "Append", "Sync", "Extract", "ChangeTracking", "FutureCapability"):
            with self.subTest(extra=extra):
                with self.assertRaisesRegex(RuntimeError, "unexpected: " + extra):
                    publisher["validate_capabilities"](
                        {"capabilities": "Create,Query,Editing,Uploads," + extra}, "Query,Create", "write view"
                    )

    def test_read_view_must_remain_query_only(self):
        publisher["validate_capabilities"]({"capabilities": " Query "}, "Query", "read view")
        for extra in ("Create", "Update", "Delete", "Editing", "Uploads", "Sync"):
            with self.subTest(extra=extra):
                with self.assertRaisesRegex(RuntimeError, "read view capabilities"):
                    publisher["validate_capabilities"]({"capabilities": "Query," + extra}, "Query", "read view")

    def test_missing_explicit_permissions_fail(self):
        for capabilities in (None, "", "  ", ["Query", "Create"], "Query", "Create", "Editing,Uploads"):
            with self.subTest(capabilities=capabilities):
                with self.assertRaises(RuntimeError):
                    publisher["validate_capabilities"]({"capabilities": capabilities}, "Query,Create", "parent")

    def test_table_override_cannot_expand_service_permissions(self):
        for expected, extra in (("Query", "Create"), ("Query,Create", "Update"), ("Query,Create", "Delete")):
            with self.subTest(expected=expected, extra=extra):
                collection = SimpleNamespace(
                    properties={"capabilities": expected},
                    tables=[SimpleNamespace(properties={"id": 0, "capabilities": expected + "," + extra})],
                )
                with self.assertRaisesRegex(RuntimeError, "table 0 capabilities"):
                    publisher["validate_collection_capabilities"](collection, expected, "exercise")

    def test_service_permissions_cannot_exceed_table_permissions(self):
        collection = SimpleNamespace(
            properties={"capabilities": "Create,Query,Update"},
            tables=[SimpleNamespace(properties={"id": 0, "capabilities": "Create,Query"})],
        )
        with self.assertRaisesRegex(RuntimeError, "service capabilities"):
            publisher["validate_collection_capabilities"](collection, "Query,Create", "exercise")

    def test_service_and_table_can_return_different_derived_labels(self):
        collection = SimpleNamespace(
            properties={"capabilities": "Create,Query,Editing,Uploads"},
            tables=[SimpleNamespace(properties={"id": 0, "capabilities": "Create,Query,Editing"})],
        )
        publisher["validate_collection_capabilities"](collection, "Query,Create", "exercise")

    def test_unsupported_expected_policy_is_a_programming_error(self):
        with self.assertRaises(ValueError):
            publisher["validate_capabilities"]({"capabilities": "Query,Update"}, "Query,Update", "parent")

    def test_ready_view_returns_without_waiting(self):
        view = SimpleNamespace(properties={"isView": True}, tables=[SimpleNamespace(properties=publisher["schema"]())], layers=[])
        load, pause, report = Mock(return_value=view), Mock(), Mock()
        result = publisher["wait_for_table_view"](load, "report view", pause=pause, report=report)
        self.assertIs(result, view)
        load.assert_called_once()
        pause.assert_not_called()
        report.assert_not_called()

    def test_async_view_reloads_until_the_table_and_schema_are_ready(self):
        empty = SimpleNamespace(properties={"isView": True}, tables=[], layers=[])
        partial = SimpleNamespace(properties={"isView": True}, tables=[SimpleNamespace(properties={"fields": []})], layers=[])
        ready = SimpleNamespace(properties={"isView": True}, tables=[SimpleNamespace(properties=publisher["schema"]())], layers=[])
        load, pause, report = Mock(side_effect=[empty, partial, ready]), Mock(), Mock()
        result = publisher["wait_for_table_view"](load, "report view", delays=(0, 1, 2), pause=pause, report=report)
        self.assertIs(result, ready)
        self.assertEqual(load.call_count, 3)
        self.assertEqual([call.args[0] for call in pause.call_args_list], [1, 2])
        report.assert_called_once()

    def test_view_timeout_preserves_the_existing_item_and_has_diagnostics(self):
        empty = SimpleNamespace(properties={"isView": True}, tables=[], layers=[])
        load, pause = Mock(return_value=empty), Mock()
        with self.assertRaisesRegex(RuntimeError, r"reports read .*tables=0.*No duplicate"):
            publisher["wait_for_table_view"](load, "reports read (existing-id)", delays=(0, 1, 2), pause=pause, report=Mock())
        self.assertEqual(load.call_count, 3)
        self.assertEqual(pause.call_count, 2)

    def test_wrong_view_shape_fails_immediately(self):
        table = SimpleNamespace(properties=publisher["schema"]())
        cases = (
            SimpleNamespace(properties={"isView": True}, tables=[table], layers=[object()]),
            SimpleNamespace(properties={"isView": True}, tables=[table, table], layers=[]),
            SimpleNamespace(properties={"isView": False}, tables=[table], layers=[]),
        )
        for view in cases:
            with self.subTest(properties=view.properties, tables=len(view.tables), layers=len(view.layers)):
                load, pause = Mock(return_value=view), Mock()
                with self.assertRaisesRegex(RuntimeError, "unexpected service shape"):
                    publisher["wait_for_table_view"](load, "report view", pause=pause, report=Mock())
                load.assert_called_once()
                pause.assert_not_called()

    def test_auth_or_network_failure_is_not_hidden_as_pending_creation(self):
        load, pause = Mock(side_effect=RuntimeError("sign-in expired")), Mock()
        with self.assertRaisesRegex(RuntimeError, "sign-in expired"):
            publisher["wait_for_table_view"](load, "report view", pause=pause, report=Mock())
        load.assert_called_once()
        pause.assert_not_called()

    def test_default_view_retry_budget_is_bounded(self):
        delays = publisher["VIEW_READY_DELAYS"]
        self.assertEqual(delays[0], 0)
        self.assertLessEqual(sum(delays), 60)
        self.assertTrue(all(delay >= 0 for delay in delays))


if __name__ == "__main__":
    unittest.main()
