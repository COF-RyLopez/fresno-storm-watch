"""Build a self-contained, inactive Notebook from the reviewed worker source.

Authoring dependency: nbformat==5.10.4. No live ArcGIS calls or credentials.
"""
from pathlib import Path
import hashlib
import nbformat


def build() -> Path:
    """Keep deployment source identical to the tested worker; strip only CLI notice."""
    root = Path(__file__).resolve().parents[1]
    source = (root / "scripts" / "refresh-pump-inventory.py").read_text(encoding="utf-8")
    code = source.split('\nif __name__ == "__main__":')[0]
    notebook = nbformat.v4.new_notebook(cells=[
        nbformat.v4.new_markdown_cell("# F.R.O.G. FMFCD pump inventory — scheduled refresh\n\n**Activation pending county IT setup.** No task, credentials or live collection is configured by this file. The current private form remains usable with its existing copy.\n\nThis notebook checks the complete FMFCD pump inventory twice, retains proposed classifications separately, and advances the existing-only AGOL view only after validation. It never edits FMFCD, readiness confirmations, assignments, permissions or group memberships."),
        nbformat.v4.new_markdown_cell("## County setup\n\nUse an approved **Standard** ArcGIS Notebook runtime as `rylopez_cofgisonline`. An administrator must enable **Create and edit notebooks** and **Schedule notebooks** and approve scheduled-compute credits. Create an owner-private stored-credential AGOL connection to the FMFCD service using an approved read-only Enterprise identity. Enter credentials only in Esri's connection UI; none belong in this notebook or task parameters.\n\nConfigure only the connection item ID and its approved `https://utility.arcgis.com/usrsvcs/…/MapServer` URL below. See the [county IT setup guide](https://cof-rylopez.github.io/fresno-storm-watch/pump-refresh-setup.html). The existing destination parent/view IDs and EOC read group are pinned in the worker."),
        nbformat.v4.new_code_cell('SOURCE_ITEM_ID = ""\nAPPROVED_PROXY_URL = ""\nENABLE_REFRESH = False\nINTERVAL_MINUTES = 60\nRUN_CONTEXT = "manual"\n', metadata={"tags": ["parameters", "injected-parameters"]}),
        nbformat.v4.new_markdown_cell("## Reviewed worker\n\nSelf-contained copy of the versioned worker; no code is downloaded at run time. Runtime/API validation in county AGOL remains required after the connection and privileges are enabled.\n\nSource SHA-256: `" + hashlib.sha256(source.encode("utf-8")).hexdigest() + "`"),
        nbformat.v4.new_code_cell(code, metadata={"jupyter": {"source_hidden": True}}),
        nbformat.v4.new_markdown_cell("## Verify, then schedule\n\nWith `ENABLE_REFRESH = False`, Run All only reports activation pending. After IT approves and tests the connection, set it to `True` and Run All with `RUN_CONTEXT = \"manual\"` for a single live verification. Reconcile source counts and the form before scheduling.\n\nCreate **one hourly task**, Standard runtime, maximum **5 minutes**, workspace off, with the task parameter `RUN_CONTEXT` set to the string `scheduled`. Do not save task parameters back to the notebook. Only a successful scheduled invocation marks automatic refresh healthy. An unchanged source only renews the private verification time; it does not append another pump snapshot.\n\nFailed runs preserve the previous verified data and raise a safe error code. Monitor failed/overdue tasks; AGOL stops a task after five failures. The form flags failed checks and blocks saving after three missed hourly verification periods. Pause the task before manual maintenance. This is inventory synchronization, not live pump telemetry or an operational readiness confirmation."),
        nbformat.v4.new_code_cell('if not ENABLE_REFRESH:\n    print(json.dumps({"status": "activation_pending", "missing": ["approved source connection", "notebook privileges", "credit approval and scheduled-task acceptance"]}))\nelse:\n    try:\n        result = run_notebook(RefreshConfig(source_item_id=SOURCE_ITEM_ID, approved_proxy_url=APPROVED_PROXY_URL, interval_minutes=INTERVAL_MINUTES, enabled=True, scheduled=RUN_CONTEXT == "scheduled"))\n    except RefreshError as error:\n        raise RuntimeError("FROG_REFRESH_FAILED: " + str(error)) from None\n'),
    ], metadata={"kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"}, "language_info": {"name": "python", "version": "3.11"}})
    for index, cell in enumerate(notebook.cells):
        cell.id = f"pump-refresh-{index}"
    nbformat.validate(notebook)
    destination = root / "notebooks" / "fmfcd-pump-inventory-refresh.ipynb"
    destination.parent.mkdir(exist_ok=True)
    nbformat.write(notebook, destination)
    return destination


if __name__ == "__main__":
    print(build())
