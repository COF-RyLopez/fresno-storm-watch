# 0.81.0 — common waterways reference

All nine operational workspace profiles (County Watch, Storm now, Rivers, Weather, Reservoirs, Weather Alerts, Power/PSPS, Drainage and Roads) now start with F.R.O.G. Waterways — Dark. Both comparison-pilot workspaces use the same style with either renderer; selecting PMTiles applies to both. This keeps muted roads, named waterways and waterbody outlines consistent while topic layers remain workspace-specific.

Each operational workspace still remembers its own explicit basemap choice during the session. Imagery Hybrid and the gallery remain available. Modes, source collectors, hazard symbols, private permissions and attention rules are unchanged. Reference shorelines are not present pool levels. Standalone population and scenario products retain their existing purpose-specific maps; no private data or AGOL items are changed.

The 3D pilot retains its reference terrain/hillshade. DWR/KRCD terrain availability is documented separately in terrain-source-check-2026-11-14.md; new terrain is not enabled by this release.

Validation: workspace state tests cover defaults and independent restoration. Pilot tests compare styles across both views, tile/archive source substitution, unchanged layer styling and unavailable-source failure. Browser verification and full regression results are recorded in the release PR. Earlier Area Watch performance runs used raster basemaps and cannot be compared directly to this release.

Rollback: redeploy 0.80.0 (381951f298d103efbb9c47a9ec3e37eeabd4a6eb). No data migration.
