"""Run this file in Pro's Python window with county AGOL active; no credentials in code."""
from pathlib import Path
import runpy

storm_publisher = runpy.run_path(str(Path(__file__).with_name("provision-eoc.py")))
from arcgis.gis import GIS

storm_result = storm_publisher["provision"](GIS("pro"))
print(storm_result)
