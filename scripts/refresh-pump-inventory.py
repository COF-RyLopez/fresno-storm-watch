"""Private AGOL Notebook worker. No source credentials, private rows or files are logged.

Python 3.11+. ArcGIS Standard Notebook supplies arcgis; offline tests use a fake
transport. This worker updates existing items only, never creates/shares/deletes.
"""
from __future__ import annotations

import hashlib
import json
import math
import re
import time
import uuid
from dataclasses import dataclass
from typing import Any, Callable
from urllib.parse import urlsplit

PORTAL = "https://cofgisonline.maps.arcgis.com"
ORG = "ibgDyuD2DLBge82s"
OWNER = "rylopez_cofgisonline"
PARENT_ID = "11f74b6cc94e40e3a61261cfe20bd320"
VIEW_ID = "20f479bb3708429d84bb8ab5a217e269"
VIEWERS = "a0b72040c524401d8a455e2bfaa25f0d"
PARENT_NAME = "frog_fmfcd_pumps_exercise_2026_27"
TAG = "frog-fmfcd-pumps-copy-v1"
HEALTH_KEY = "frogPumpRefresh"
SCHEMA = "frog-pump-refresh-v1"
LIMIT = 5000
FIELDS = {"OBJECTID", "DA", "SUBTYPE", "MODIFIEDDATE"}
Json = dict[str, Any]
Call = Callable[[str, Json], Json]


class RefreshError(RuntimeError):
    """A safe diagnostic code, never an upstream error body or credential."""


def require(condition: bool, code: str) -> None:
    """Stop before another mutation if an invariant fails."""
    if not condition:
        raise RefreshError(code)


def finite(value: Any) -> bool:
    """JSON finite number, excluding booleans."""
    return type(value) in (int, float) and math.isfinite(value)


def canonical(value: Any) -> str:
    """Deterministic JSON for bounded source fields; integral floats normalize to int."""
    if isinstance(value, dict):
        return "{" + ",".join(json.dumps(k) + ":" + canonical(value[k]) for k in sorted(value)) + "}"
    if isinstance(value, list):
        return "[" + ",".join(canonical(v) for v in value) + "]"
    if type(value) is float:
        require(math.isfinite(value), "NONFINITE_VALUE")
        if value.is_integer():
            value = int(value)
    return json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":"))


def digest(rows: list[Json]) -> str:
    """Hash sorted normalized records, excluding hosted geometry and hosted IDs."""
    return hashlib.sha256(canonical(sorted(rows, key=lambda r: r["id"])).encode("utf-8")).hexdigest()


def source_row(feature: Json, oid: str = "OBJECTID") -> Json:
    """Normalize one original FMFCD source point without rounding its coordinates."""
    a, g = feature.get("attributes", {}), feature.get("geometry", {})
    identity, subtype, code, modified = a.get(oid), a.get("SUBTYPE"), a.get("DA"), a.get("MODIFIEDDATE")
    require(type(identity) is int and 0 < identity < 2**53, "SOURCE_ID_INVALID")
    require(subtype is None or type(subtype) is int, "SOURCE_CLASSIFICATION_INVALID")
    require(code is None or isinstance(code, str), "SOURCE_CODE_INVALID")
    require(modified is None or finite(modified), "SOURCE_DATE_INVALID")
    require(finite(g.get("x")) and finite(g.get("y")) and -125 <= g["x"] <= -114 and 32 <= g["y"] <= 43, "SOURCE_GEOMETRY_INVALID")
    require(len((code or "").strip()) <= 255, "SOURCE_CODE_TOO_LONG")
    return {"id": identity, "code": (code or "").strip(), "subtype": subtype, "modified": modified, "x": g["x"], "y": g["y"]}


def copied_row(feature: Json) -> Json:
    """Restore the exact original association from source attributes, never hosted XY."""
    a = feature["attributes"]
    return source_row({"attributes": {"OBJECTID": a.get("source_oid"), "DA": a.get("source_code"), "SUBTYPE": a.get("source_subtype"), "MODIFIEDDATE": a.get("source_modified")}, "geometry": {"x": a.get("source_x"), "y": a.get("source_y")}})


def ids_from(result: Json, empty_count: Callable[[], Json]) -> list[int]:
    """Check IDs and separately verify null-as-empty responses."""
    ids = result.get("objectIds")
    if ids is None:
        require(empty_count().get("count") == 0, "EMPTY_INVENTORY_UNVERIFIED")
        ids = []
    require(isinstance(ids, list) and len(ids) <= LIMIT and not result.get("exceededTransferLimit"), "ID_INVENTORY_INCOMPLETE")
    require(all(type(v) is int and 0 < v < 2**53 for v in ids) and len(set(ids)) == len(ids), "ID_INVENTORY_INVALID")
    return sorted(ids)


def query_features(call: Call, url: str, where: str = "1=1", *, source: bool = False) -> list[Json]:
    """Read complete bounded batches; detect row loss, CRS drift and changed IDs."""
    meta = call(url, {})
    fields = meta.get("fields", [])
    oid = meta.get("objectIdField") or next((f["name"] for f in fields if f.get("type") == "esriFieldTypeOID"), None)
    require(oid is not None and meta.get("geometryType") == "esriGeometryPoint", "POINT_SCHEMA_INVALID")
    if source:
        require(FIELDS <= {f["name"] for f in fields}, "SOURCE_SCHEMA_CHANGED")
    inventory = lambda: ids_from(call(url + "/query", {"where": where, "returnIdsOnly": True}), lambda: call(url + "/query", {"where": where, "returnCountOnly": True}))
    ids, features = inventory(), []
    for offset in range(0, len(ids), 100):
        batch = ids[offset:offset + 100]
        result = call(url + "/query", {"objectIds": ",".join(map(str, batch)), "outFields": ",".join(sorted(FIELDS)) if source else "*", "returnGeometry": source, **({"outSR": 4326} if source else {})})
        found = result.get("features")
        require(isinstance(found, list) and len(found) == len(batch) and not result.get("exceededTransferLimit"), "FEATURE_BATCH_INCOMPLETE")
        require(sorted(f.get("attributes", {}).get(oid, -1) for f in found) == batch, "FEATURE_BATCH_IDS_CHANGED")
        if source:
            sr = result.get("spatialReference", {})
            require((sr.get("latestWkid") or sr.get("wkid")) == 4326, "SOURCE_CRS_CHANGED")
        features.extend(found)
    require(inventory() == ids, "SOURCE_INVENTORY_CHANGED_DURING_READ")
    return features


def validate_generation(features: list[Json], snapshot_id: str | None = None) -> Json:
    """Check metadata consistency and original associations in one complete generation."""
    require(bool(features), "COPY_EMPTY")
    first = features[0]["attributes"]
    generation = first.get("snapshot_id")
    require(isinstance(generation, str) and re.fullmatch(r"[a-f0-9-]{36}", generation) is not None and (snapshot_id is None or generation == snapshot_id), "COPY_GENERATION_INVALID")
    keys = ["snapshot_id", "source_checked", "source_count", "existing_count", "source_digest"]
    require(finite(first.get("source_checked")) and first["source_checked"] > 0 and isinstance(first.get("source_digest"), str) and re.fullmatch(r"[a-f0-9]{64}", first["source_digest"]) is not None, "COPY_PROVENANCE_INVALID")
    rows = []
    for feature in features:
        a = feature["attributes"]
        require(all(a.get(k) == first.get(k) for k in keys), "COPY_MIXED_GENERATIONS")
        row = copied_row(feature)
        require(a.get("row_key") == f"{generation}:{row['id']}", "COPY_ASSOCIATION_CHANGED")
        rows.append(row)
    require(len({r["id"] for r in rows}) == len(rows), "COPY_DUPLICATE_SOURCE_IDS")
    return {"id": generation, "checked": first["source_checked"], "total": first["source_count"], "existing": first["existing_count"], "hash": first["source_digest"], "rows": sorted(rows, key=lambda r: r["id"])}


def feature_for(row: Json, generation: str, checked: int, total: int, existing: int, hash_value: str) -> Json:
    """Create a source-copy row compatible with the existing private form schema."""
    return {"geometry": {"x": row["x"], "y": row["y"], "spatialReference": {"wkid": 4326}}, "attributes": {"source_oid": row["id"], "source_code": row["code"], "source_subtype": row["subtype"], "source_modified": row["modified"], "source_x": row["x"], "source_y": row["y"], "snapshot_id": generation, "source_checked": checked, "source_count": total, "existing_count": existing, "source_digest": hash_value, "row_key": f"{generation}:{row['id']}"}}


def service_url(item: Json, name: str, *, view: bool) -> str:
    """Pin the existing county service, owner, copy tag and private access."""
    require(item.get("owner") == OWNER and item.get("type") == "Feature Service" and TAG in item.get("tags", []), "DESTINATION_OWNER_OR_TYPE_CHANGED")
    require(item.get("access") in (["private", "shared"] if view else ["private"]), "DESTINATION_SHARING_CHANGED")
    url = item.get("url", "")
    require(re.fullmatch(rf"https://services[0-9]*\.arcgis\.com/{ORG}/arcgis/rest/services/{name}/FeatureServer", url) is not None, "DESTINATION_URL_CHANGED")
    return url


def source_proxy(item: Json, approved_url: str) -> str:
    """Only the approved owner-private stored-credential proxy is an input."""
    require(item.get("owner") == OWNER and item.get("access") == "private" and item.get("type") == "Map Service", "SOURCE_CONNECTION_NOT_OWNER_PRIVATE")
    url = item.get("url", "")
    parsed = urlsplit(url)
    require(url == approved_url and parsed.scheme == "https" and parsed.netloc == "utility.arcgis.com" and parsed.path.startswith("/usrsvcs/") and parsed.path.endswith("/MapServer") and not parsed.query and not parsed.fragment and not parsed.username, "APPROVED_SOURCE_PROXY_REQUIRED")
    return url + "/0"


@dataclass(frozen=True)
class RefreshConfig:
    """Identifiers only; actual source credentials remain in an owner-private AGOL item."""
    source_item_id: str = ""
    approved_proxy_url: str = ""
    interval_minutes: int = 60
    enabled: bool = False
    scheduled: bool = False


def refresh(call: Call, parent: str, view: str, source: str, data: Json, *, now: int, enabled: bool, interval_minutes: int = 60) -> tuple[Json, Json]:
    """Validate full source twice, stage changed content, then advance a verified view.

    Unchanged data only renews private verification metadata. Deterministic
    generation IDs reconcile interrupted writes without accumulating duplicates.
    The scheduler must run a single task; pause it before manual maintenance.
    """
    require(type(interval_minutes) is int and 15 <= interval_minutes <= 1440, "SCHEDULE_INTERVAL_INVALID")
    require(finite(now) and now > 0, "CHECK_TIME_INVALID")
    for url, is_view in [(parent, False), (view, True)]:
        meta = call(url, {})
        caps = {v.strip().lower() for v in meta.get("capabilities", "").split(",") if v.strip()}
        require(bool(meta.get("isView")) == is_view and "query" in caps and (caps == {"query"} if is_view else caps <= {"query", "create", "editing"}), "DESTINATION_CAPABILITIES_CHANGED")
    definition = call(view.replace("/rest/services/", "/rest/admin/services/") + "/0", {})
    source_definition = definition.get("adminLayerInfo", {}).get("viewLayerDefinition", {})
    require(source_definition.get("sourceServiceName") == PARENT_NAME and source_definition.get("sourceLayerId") == 0, "FORM_VIEW_SOURCE_CHANGED")
    initial_features = query_features(call, view + "/0")
    initial = validate_generation(initial_features) if initial_features else None
    if initial:
        require(initial["existing"] == len(initial_features) and all(r["subtype"] == 1 for r in initial["rows"]) and initial["checked"] <= now + 60000, "FORM_VIEW_NOT_EXISTING_ONLY")
    rows = sorted([source_row(f) for f in query_features(call, source, source=True)], key=lambda r: r["id"])
    require(rows and any(r["subtype"] == 1 for r in rows), "NO_EXISTING_SOURCE_PUMPS")
    repeat = sorted([source_row(f) for f in query_features(call, source, source=True)], key=lambda r: r["id"])
    require(canonical(rows) == canonical(repeat), "SOURCE_CHANGED_DURING_READ")
    existing_count = sum(r["subtype"] == 1 for r in rows)
    current_rows = []
    if initial:
        current = validate_generation(query_features(call, parent + "/0", f"snapshot_id = '{initial['id']}'"), initial["id"])
        require(current["total"] == len(current["rows"]) and current["existing"] == sum(r["subtype"] == 1 for r in current["rows"]), "ACTIVE_GENERATION_INCOMPLETE")
        current_rows = current["rows"]
    changed = canonical(rows) != canonical(current_rows)
    if changed:
        hash_value = digest(rows)
        generation = str(uuid.uuid5(uuid.NAMESPACE_URL, PARENT_ID + ":" + hash_value))
        staged = query_features(call, parent + "/0", f"snapshot_id = '{generation}'")
        checked = validate_generation(staged, generation)["checked"] if staged else now
        expected = [feature_for(r, generation, checked, len(rows), existing_count, hash_value) for r in rows]
        by_key = {f["attributes"]["row_key"]: f for f in staged}
        expected_keys = {f["attributes"]["row_key"] for f in expected}
        require(len(by_key) == len(staged) and set(by_key) <= expected_keys, "STAGING_KEYS_INVALID")
        missing = [f for f in expected if f["attributes"]["row_key"] not in by_key]
        for offset in range(0, len(missing), 100):
            batch = missing[offset:offset + 100]
            result = call(parent + "/0/addFeatures", {"features": json.dumps(batch, separators=(",", ":")), "rollbackOnFailure": True})
            receipts = result.get("addResults", [])
            require(len(receipts) == len(batch) and all(r.get("success") for r in receipts), "COPY_BATCH_NOT_CONFIRMED")
        verified = validate_generation(query_features(call, parent + "/0", f"snapshot_id = '{generation}'"), generation)
        require(verified["total"] == len(rows) and verified["existing"] == existing_count and verified["hash"] == hash_value and canonical(verified["rows"]) == canonical(rows), "STAGED_COPY_CONTENT_MISMATCH")
        # An unexpected writer must not be silently overwritten.
        active = query_features(call, view + "/0")
        active_id = validate_generation(active)["id"] if active else None
        require(active_id in {initial["id"] if initial else None, generation}, "CONCURRENT_REFRESH_DETECTED")
        query = f"snapshot_id = '{generation}' AND source_subtype = 1"
        result = call(view.replace("/rest/services/", "/rest/admin/services/") + "/0/updateDefinition", {"updateDefinition": json.dumps({"viewDefinitionQuery": query}), "async": False})
        require(result.get("success") is True, "VIEW_SWITCH_NOT_CONFIRMED")
    else:
        generation = initial["id"]
    final = validate_generation(query_features(call, view + "/0"), generation)
    require(final["existing"] == existing_count == len(final["rows"]) and all(r["subtype"] == 1 for r in final["rows"]), "FINAL_VIEW_INCOMPLETE")
    old_ids, new_ids = {r["id"] for r in current_rows}, {r["id"] for r in rows}
    summary = {"status": "changed" if changed else "verified_unchanged", "source_count": len(rows), "existing_count": existing_count, "proposed_count": sum(r["subtype"] == 0 for r in rows), "other_count": sum(r["subtype"] not in (0, 1) for r in rows), "added_records": len(new_ids - old_ids), "removed_records": len(old_ids - new_ids)}
    health = {"schema": SCHEMA, "enabled": enabled, "state": "healthy", "intervalMinutes": interval_minutes, "maxLagMs": interval_minutes * 3 * 60000, "activeSnapshot": final["id"], "activeDigest": final["hash"], "lastAttempt": now, "lastSuccess": now, "reasonCode": None, "summary": summary}
    return {**data, HEALTH_KEY: health}, summary


def run_notebook(config: RefreshConfig, *, gis: Any = None) -> Json:
    """Use the Notebook owner's managed AGOL identity and a stored source connection."""
    require(config.enabled, "ACTIVATION_PENDING")
    require(re.fullmatch(r"[a-f0-9]{32}", config.source_item_id) is not None, "SOURCE_CONNECTION_SETUP_PENDING")
    if gis is None:
        from arcgis.gis import GIS
        gis = GIS("home")
    require(gis.properties.id == ORG and gis.users.me.username == OWNER, "COUNTY_OWNER_REQUIRED")
    parent_item, view_item, source_item = (gis.content.get(i) for i in (PARENT_ID, VIEW_ID, config.source_item_id))
    require(all(i is not None for i in (parent_item, view_item, source_item)), "PRIVATE_ITEMS_UNAVAILABLE")
    require(not parent_item.sharing.groups.list() and not source_item.sharing.groups.list() and {g.id for g in view_item.sharing.groups.list()} == {VIEWERS}, "PRIVATE_ITEM_SHARING_CHANGED")
    parent = service_url(dict(parent_item), PARENT_NAME, view=False)
    view = service_url(dict(view_item), PARENT_NAME + "_read", view=True)
    source = source_proxy(dict(source_item), config.approved_proxy_url)
    started, deadline, now = time.monotonic(), time.monotonic() + 270, int(time.time() * 1000)

    def call(url: str, parameters: Json) -> Json:
        """POST only to three approved service roots with managed authentication."""
        remaining = deadline - time.monotonic()
        require(remaining > 1, "RUN_TIME_LIMIT")
        allowed = [parent, view, view.replace("/rest/services/", "/rest/admin/services/"), source]
        require(any(url == base or url.startswith(base + "/") for base in allowed), "UNAPPROVED_DESTINATION")
        try:
            response = gis.session.post(url, data={"f": "json", **{k: json.dumps(v) if isinstance(v, bool) else v for k, v in parameters.items()}}, timeout=min(25, remaining), allow_redirects=False)
            require(response.status_code == 200, "HTTP_REQUEST_FAILED")
            result = response.json()
            require(isinstance(result, dict) and "error" not in result, "SERVICE_REQUEST_FAILED")
            return result
        except RefreshError:
            raise
        except Exception:
            raise RefreshError("NETWORK_OR_AUTH_FAILED") from None

    data = view_item.get_data() or {}
    require(isinstance(data, dict), "VIEW_ITEM_DATA_INVALID")
    try:
        updated, summary = refresh(call, parent, view, source, data, now=now, enabled=config.scheduled, interval_minutes=config.interval_minutes)
        require(view_item.update(data=updated), "VERIFICATION_METADATA_NOT_SAVED")
        summary["duration_seconds"] = round(time.monotonic() - started, 2)
        print(json.dumps(summary, separators=(",", ":")))
        return summary
    except Exception as error:
        code = str(error) if isinstance(error, RefreshError) else "UNEXPECTED_REFRESH_FAILURE"
        prior = data.get(HEALTH_KEY, {})
        if isinstance(prior, dict) and prior.get("schema") == SCHEMA:
            try:
                view_item.update(data={**data, HEALTH_KEY: {**prior, "state": "failed", "lastAttempt": now, "reasonCode": code}})
            except Exception:
                print(json.dumps({"status": "failed", "health_metadata": "not_confirmed", "reason_code": code}))
        raise RefreshError(code) from None


if __name__ == "__main__":
    print(json.dumps({"status": "setup_pending", "next_step": "Use the generated private ArcGIS Notebook; county source connection and notebook privileges are required."}))
