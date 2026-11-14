# 0.83.0 — Refreshed 3DHP over quiet terrain

County Watch terrain and F.R.O.G. Waterways — Dark share refreshed USGS waterways and waterbody tiles. Quiet roads and places remain for orientation; this does not add a second hydrography layer. River gauges and reservoir observations retain their existing live feeds and meanings.

New weekly public-source refresh uses isolated acquisition, inventory/geometry checks, search rebuilds, full tile decoding and PMTiles round-trip verification. Only validated outputs are published; failed refreshes retain the preceding reference. Retrieval and failure status is in Map symbols & reference limits. Searches use the same acquisition, while existing street data and dates remain unchanged.

Initial refresh: 142,595 flowlines, 7,118 water bodies, zero rejected geometry, 411 named lake search groups. USGS source hashes are unchanged from the earlier retrieval. Geographic scope remains Fresno-intersecting features, not full upstream watersheds. No live-flow, current-shoreline, connectivity or travel-time inference is added.

Validation: 841 JavaScript tests, nine focused Python refresh/export tests, complete stage tile/search validation, every PMTiles tile compared to source MVT, and public configuration/syntax checks. Desktop and phone map verification accompanies publication. No private GIS items or permissions changed.

Operations and rollback: [3DHP refresh](3dhp-refresh.md).
