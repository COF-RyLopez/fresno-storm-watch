# Publishing the weather-delivery comparison

Release **0.101.0** exposes `weather-delivery.html` on the existing GitHub Pages site. It remains a **recorded-data comparison**, separate from live Command operations and operator navigation.

## Public data boundary

The bundled dataset under `site/data/weather-delivery-experiment/` contains only verified public WPC response/image assets and the public Millerton/Pine Flat watershed and gauge/reservoir reference points. Trial logs, screenshots, acquisition logs, other work files, private EOC records and credentials are not copied. The initial published recording has 3 forecast periods and 12 independently identified gauge/reservoir points.

The publisher reads a strict file allowlist, checks response/image hashes, bounds and types, and rejects token-bearing source URLs or private reference features. Staging occurs outside `site/`. A completed recording receives a content-addressed `records/<hash>/` directory; `index.json` switches only after the complete directory exists. Failure keeps the prior recording pointer intact.

## Deployment behavior

The normal verification job validates the bundled public fallback before any refresh. On main deployments, the experimental refresh runs after public map-pilot collection. It attempts a new public WPC capture and verified publication. Failed acquisition, publication or a refresh timeout must not block the main application's deployment: the explicitly dated bundled recording remains available.

The client resolves the recording relative to the module's project path, so it works under the GitHub Pages repository prefix. Benchmarking on the public page measures static recorded-response reconstruction versus prepared delivery on that host; it does **not** measure live NWS service latency. The pointer/bootstrap request is outside the per-frame comparison, as are terrain startup and GPU painting.

```text
node --use-system-ca scripts/capture-weather-replay.mjs
node scripts/publish-weather-replay.mjs
node scripts/publish-weather-replay.mjs --verify
npm run build:import-map
```

`capture-weather-replay.mjs` writes an ignored local acquisition. The publication command copies only verified public assets into the Pages tree. Keep the recorded capture timestamp visible; refreshing a deployment does not turn a recorded forecast into live planning data.

## Verification and rollback

Publisher tests cover allowlisted copying, corrupt responses, private references, token-bearing URLs, independent gauge IDs, failed refresh retention and the bundled dataset itself. Before merging, run the full JavaScript suite, Command type/build, import-map and source/data/link checks. Verify the deployed page loads both methods and changes the selected period without mismatching the map, dates or legend.

Rollback is code/data only: redeploy main's preceding release (`8c1d3ff4`, 0.100.0). No AGOL items, permissions or operational records are migrated. The comparison adds no operator alerts or automated decisions.
