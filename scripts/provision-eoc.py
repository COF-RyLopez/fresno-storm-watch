"""Provision isolated, empty AGOL EXERCISE datasets using an existing signed-in session.

Default is a local dry run. No memberships, existing pilot items, organization
settings or production records are changed. Run inside Pro with runpy when its
licensed sign-in cannot be used from a standalone Python process.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any
from urllib.request import urlopen
from urllib.error import HTTPError
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
OWNER = "rylopez_cofgisonline"
HOST = "cofgisonline.maps.arcgis.com"
FOLDER = "FROG EOC Exercise 2026-27"
TAG = "frog-eoc-exercise-v1"
GROUPS = ["viewers", "reporters", "reviewers", "coordinators", "recorders", "approvers"]
WRITERS = {"incidents": "recorders", "periods": "coordinators", "reports": "reporters", "verifications": "reviewers", "coordination": "coordinators", "checklists": "coordinators", "staging": "reviewers", "briefings": "coordinators", "approvals": "approvers", "references": "coordinators", "reviews": "reporters"}
TRACK = {"creatorField": "created_user", "creationDateField": "created_date", "editorField": "last_edited_user", "editDateField": "last_edited_date"}
REDIRECTS = ["https://cof-rylopez.github.io/fresno-storm-watch/", "https://cof-rylopez.github.io/fresno-storm-watch/index.html", "https://cof-rylopez.github.io/fresno-storm-watch/eoc.html", "http://127.0.0.1:8777/", "http://127.0.0.1:8777/eoc.html"]


def schema() -> dict[str, Any]:
    """A common append-only envelope; domain payloads are validated by the app."""
    fields = [{"name": "OBJECTID", "alias": "Object ID", "type": "esriFieldTypeOID", "nullable": False, "editable": False}, {"name": "GlobalID", "alias": "Global ID", "type": "esriFieldTypeGlobalID", "nullable": False, "editable": False}]
    for name, size in [("event_id", 80), ("entity_id", 80), ("incident_id", 80), ("supersedes", 4000), ("payload", 65536)]:
        fields.append({"name": name, "alias": name, "type": "esriFieldTypeString", "length": size, "nullable": False, "editable": True})
    for name in TRACK.values():
        field = {"name": name, "alias": name, "type": "esriFieldTypeDate" if name.endswith("date") else "esriFieldTypeString", "nullable": True, "editable": False}
        if field["type"] == "esriFieldTypeString":
            field["length"] = 255
        fields.append(field)
    return {"id": 0, "name": "Records", "type": "Table", "objectIdField": "OBJECTID", "globalIdField": "GlobalID", "displayField": "entity_id", "fields": fields, "editFieldsInfo": TRACK, "capabilities": "Query,Create", "indexes": [{"name": "event_id_unique", "fields": "event_id", "isAscending": True, "isUnique": True}, {"name": "incident_idx", "fields": "incident_id", "isAscending": True, "isUnique": False}]}


def require_success(result: Any, operation: str) -> None:
    """Stop on an uncertain mutation; never print connection objects or tokens."""
    if result is None or result is False or isinstance(result, dict) and (result.get("error") or result.get("success") is False):
        raise RuntimeError(f"{operation} was not confirmed. Inspect the recorded private item before retrying.")


def validate_table(properties: Any) -> None:
    """Require the schema and server editor tracking before any view is shared."""
    names = {f["name"] for f in properties.get("fields", [])}
    if not {"event_id", "entity_id", "incident_id", "supersedes", "payload"}.issubset(names):
        raise RuntimeError("Required record fields are missing; no duplicate service will be created.")
    tracking = properties.get("editFieldsInfo", {})
    if not all(tracking.get(k) for k in TRACK):
        raise RuntimeError("Server editor tracking is incomplete.")


def anonymous_denied(url: str) -> bool:
    """Make a separate unauthenticated request; no signed-in session is reused."""
    try:
        with urlopen(url + "/query?f=json&where=1%3D1&returnCountOnly=true", timeout=25) as response:
            payload = json.load(response)
        return payload.get("error", {}).get("code") in (403, 498, 499)
    except HTTPError as error:
        return error.code in (401, 403, 498, 499)


def preflight(gis: Any) -> dict[str, Any]:
    """Verify the exact organization and author before making any change."""
    user = gis.users.me
    properties = gis.properties
    host = f"{properties.get('urlKey', '')}.{properties.get('customBaseUrl', '')}".lower()
    if user is None or host != HOST or user.username != OWNER:
        actual = urlsplit(getattr(gis, "url", "")).hostname or "unknown portal"
        actual_user = getattr(user, "username", "not signed in")
        raise RuntimeError(f"Session is {actual} as {actual_user}. Use ArcGIS Pro signed in to {HOST} as {OWNER}. No changes made.")
    required = {"portal:user:createItem", "portal:publisher:publishFeatures", "portal:user:createGroup"}
    if user.get("role") != "org_admin" and not required.issubset(set(user.get("privileges", []))):
        raise RuntimeError("The builder needs content, hosted feature publishing and group creation privileges.")
    return {"owner": user.username, "orgId": gis.properties.id, "host": host}


def provision(gis: Any) -> dict[str, Any]:
    """Create private empty datasets/views; journal IDs before dependent changes."""
    from arcgis.features import FeatureLayerCollection

    identity = preflight(gis)
    work = ROOT / "work"
    work.mkdir(exist_ok=True)
    journal = work / "eoc-provisioning.json"
    state = json.loads(journal.read_text(encoding="utf-8")) if journal.exists() else {**identity, "groups": {}, "items": {}}
    if any(state.get(k) != identity[k] for k in identity):
        raise RuntimeError("Provisioning journal belongs to another account or organization.")

    def save() -> None:
        temporary = journal.with_suffix(".tmp")
        temporary.write_text(json.dumps(state, indent=2), encoding="utf-8")
        temporary.replace(journal)

    def item(key: str, create: Any) -> Any:
        marker = f"{TAG}-{key}"
        if key in state["items"]:
            found = gis.content.get(state["items"][key])
            if found is None:
                raise RuntimeError(f"Recorded item {key} is missing; restore or inspect before retrying.")
        else:
            candidates = [i for i in gis.content.search(query=f'owner:{OWNER} AND tags:"{marker}"', max_items=100) if marker in i.tags and i.owner == OWNER]
            if len(candidates) > 1:
                raise RuntimeError(f"Duplicate provisioning marker for {key}.")
            # Resolve a possible create-without-journal result by its deterministic service name.
            service_name = f"frog_eoc_exercise_2026_27_{key}"
            if not candidates:
                candidates = [i for i in gis.content.search(query=f'owner:{OWNER} AND title:"{service_name}"', max_items=100) if i.title == service_name and i.owner == OWNER]
            if len(candidates) > 1:
                raise RuntimeError(f"Ambiguous service name for {key}.")
            found = candidates[0] if candidates else create(service_name, marker)
            state["items"][key] = found.id
            save()
        if found.owner != OWNER or found.access in ("public", "org"):
            raise RuntimeError(f"Unexpected ownership or sharing for {key}; stopped without widening access.")
        return found

    folder = gis.content.folders.get(FOLDER) or gis.content.folders.create(folder=FOLDER)
    for role in GROUPS:
        marker = f"{TAG}-group-{role}"
        if role in state["groups"]:
            group = gis.groups.get(state["groups"][role])
            if group is None:
                raise RuntimeError(f"Recorded group {role} is missing.")
        else:
            matches = [g for g in gis.groups.search(f'owner:{OWNER} AND tags:"{marker}"', max_groups=100) if marker in g.tags and g.owner == OWNER]
            if len(matches) > 1:
                raise RuntimeError(f"Duplicate group marker: {role}")
            group = matches[0] if matches else gis.groups.create(title=f"FROG EOC EXERCISE 2026-27 - {role}", tags=[marker], access="private", is_invitation_only=True, is_view_only=False, description="Separate exercise access only. County administrator assigns eligible named accounts. Ordinary group; no shared item update access.")
            state["groups"][role] = group.id
            save()
        if group.owner != OWNER or group.access != "private" or "updateitemcontrol" in (group.get("capabilities", []) or []):
            raise RuntimeError(f"Group {role} has unexpected ownership/access.")

    config = {"enabled": False, "environment": "exercise", "owner": OWNER, "orgId": identity["orgId"], "teamLabel": "F.R.O.G. EOC exercise team", "groups": state["groups"], "collections": {}, "pollMs": 60000}
    for name, role in WRITERS.items():
        def create_parent(service_name: str, marker: str) -> Any:
            created = gis.content.create_service(name=service_name, service_type="featureService", folder=FOLDER, create_params={"name": service_name, "hasStaticData": False, "capabilities": "Query,Create", "allowGeometryUpdates": False, "editorTrackingInfo": {"enableEditorTracking": True, "enableOwnershipAccessControl": False}})
            require_success(created.update({"tags": [marker], "snippet": "PRIVATE EXERCISE ONLY. Append-only records; parent not shared."}), "tag private parent")
            return created
        parent = item(name + "_parent", create_parent)
        if parent.access != "private":
            raise RuntimeError("Parent dataset must remain owner-private.")
        collection = FeatureLayerCollection.fromitem(parent)
        if not collection.tables and not collection.layers:
            require_success(collection.manager.add_to_definition({"tables": [schema()]}), "create record schema")
            collection = FeatureLayerCollection.fromitem(gis.content.get(parent.id))
        if len(collection.tables) != 1 or collection.layers:
            raise RuntimeError("Expected one nonspatial record table.")
        table = collection.tables[0]
        validate_table(table.properties)
        indexes = table.properties.get("indexes", [])
        if not any(i.get("isUnique") and i.get("fields", "").lower() == "event_id" for i in indexes):
            raise RuntimeError("Unique event_id index missing; idempotent submissions are not safe.")
        if set(collection.properties.capabilities.split(",")) != {"Query", "Create"}:
            raise RuntimeError("Parent capabilities must be Query,Create only.")
        config["collections"][name] = {}
        for mode, capabilities, group_role in [("read", "Query", "viewers"), ("write", "Query,Create", role)]:
            def create_view(service_name: str, marker: str) -> Any:
                return collection.manager.create_view(name=service_name, view_layers=[], view_tables=[table], capabilities=capabilities, allow_schema_changes=False, tags=marker, folder=FOLDER)
            view = item(name + "_" + mode, create_view)
            view_collection = FeatureLayerCollection.fromitem(view)
            if not view_collection.properties.get("isView") or len(view_collection.tables) != 1:
                raise RuntimeError("Expected a nonspatial hosted table view.")
            validate_table(view_collection.tables[0].properties)
            definition = view_collection.tables[0].manager.properties.get("adminLayerInfo", {}).get("viewLayerDefinition", {})
            if definition.get("sourceServiceName") != parent.url.rstrip("/").split("/")[-2] or definition.get("sourceLayerId") != table.properties.id:
                raise RuntimeError("View source does not match the recorded private parent.")
            if set(view_collection.properties.capabilities.split(",")) != set(capabilities.split(",")):
                raise RuntimeError(f"Unexpected {mode} view editing capabilities.")
            # New groups contain only the owner; this does not grant access to any operator.
            permitted_group = state["groups"][group_role]
            shared_groups = {g.id for g in view.sharing.groups.list()}
            if shared_groups - {permitted_group}:
                raise RuntimeError("View has unexpected group sharing. Inspect it before continuing.")
            if permitted_group not in shared_groups:
                require_success(view.sharing.groups.add(permitted_group), "share exercise view to its empty access group")
            if not anonymous_denied(view_collection.tables[0].url):
                raise RuntimeError("Anonymous query was not denied; keep the workspace disabled and investigate sharing.")
            config["collections"][name][mode] = view_collection.tables[0].url
        print(f"Verified private exercise collection: {name}")

    # Register USER OAuth only; no app-only grants or secrets are stored or printed.
    def create_app(service_name: str, marker: str) -> Any:
        return folder.add(item_properties={"title": service_name, "type": "Web Mapping Application", "tags": [marker], "url": "https://cof-rylopez.github.io/fresno-storm-watch/eoc.html", "snippet": "FROG private exercise workspace; named-account user authentication."}).result()
    app = item("oauth", create_app)
    app_groups = {g.id for g in app.sharing.groups.list()}
    if app_groups - {state["groups"]["viewers"]}:
        raise RuntimeError("OAuth item has unexpected sharing.")
    if state["groups"]["viewers"] not in app_groups:
        require_success(app.sharing.groups.add(state["groups"]["viewers"]), "share OAuth item to the empty exercise viewer group")
    app_info = app.app_info if "Registered App" in app.typeKeywords else app.register(app_type="browser", redirect_uris=REDIRECTS)
    client_id = app_info.get("client_id")
    if not client_id:
        raise RuntimeError("OAuth registration has no public Client ID.")
    output = {"clientId": client_id, "oauthItemId": app.id, "redirectUris": REDIRECTS, "config": config, "remaining": ["Administrator assigns eligible named accounts to viewer and appropriate writer groups", "Two-account and anonymous acceptance exercise", "Enable config only after permission validation; retain EXERCISE label", "County OES approves operating practice before any production rollout"]}
    (work / "eoc-public-config.json").write_text(json.dumps(output, indent=2), encoding="utf-8")
    state["status"] = "private_exercise_storage_created_memberships_and_acceptance_pending"
    save()
    return {"status": state["status"], "collection_count": len(WRITERS), "group_count": len(GROUPS), "config_file": str(work / "eoc-public-config.json"), "memberships_changed": False}


def main() -> None:
    """Dry run by default; explicit apply/check flags use an existing Pro session."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--check-session", action="store_true")
    args = parser.parse_args()
    if not args.apply and not args.check_session:
        print(json.dumps({"mode": "dry-run", "organization": HOST, "owner": OWNER, "folder": FOLDER, "collections": WRITERS, "creates": "11 empty private services, 22 restricted views, 6 empty ordinary groups and one user-OAuth app", "unchanged": ["existing Experience Builder pilot", "existing memberships", "production data", "organization settings"], "no_private_records_in_github": True}, indent=2))
        return
    from arcgis.gis import GIS
    gis = GIS("pro")
    result = provision(gis) if args.apply else preflight(gis)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
