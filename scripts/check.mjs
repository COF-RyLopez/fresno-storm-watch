import { readdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { validateCounties } from '../site/lib/model.js';
import { createHash } from 'node:crypto';
import { validateReservoirSnapshot } from '../site/lib/environment-model.js';
import { planningPoints } from '../site/lib/planning-model.js';
import {validatePowerSnapshot} from '../site/lib/power-model.js';

const root = new URL('../', import.meta.url);
for (const folder of ['site/', 'site/lib/', 'scripts/']) {
  for (const entry of await readdir(new URL(folder, root))) {
    if (!/\.(js|mjs)$/.test(entry)) continue;
    const result = spawnSync(process.execPath, ['--check', fileURLToPath(new URL(folder + entry, root))], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  }
}
const counties = JSON.parse(await readFile(new URL('site/data/counties.geojson', root), 'utf8'));
assert.equal(validateCounties(counties).length, 5);
const config = await readFile(new URL('site/config.js', root), 'utf8');
assert(!/clientSecret\s*:|password\s*:|accessToken\s*:/i.test(config), 'Public config must not contain secret settings.');
const html = await readFile(new URL('site/index.html', root), 'utf8');
assert(html.includes('https://js.arcgis.com/5.1/'), 'Pinned SDK stylesheet expected');
for (const file of ['index.html','setup.html','planning.html','terrain.html','eoc.html','eoc-guide.html']) {
  const page=await readFile(new URL(`site/${file}`,root),'utf8');
  for (const match of page.matchAll(/(?:href|src)="(\.\/[^"?#]+)"/g)) await readFile(new URL(match[1], new URL('site/', root)));
}
const watch=JSON.parse(await readFile(new URL('site/data/river-watchlist.json',root),'utf8'));
assert.equal(watch.stations.length,9);
assert.equal(new Set(watch.stations.map(s=>s.id)).size,9);
for(const s of watch.stations)assert(/^[A-Z0-9]{5}$/.test(s.id)&&s.longitude>=-125&&s.longitude<=-114&&s.latitude>=32&&s.latitude<=43&&s.note,'Invalid watchpoint metadata');
const cameras=JSON.parse(await readFile(new URL('site/data/camera-watchlist.json',root),'utf8'));
assert.equal(cameras.cameras.length,8);assert.equal(new Set(cameras.cameras.map(c=>c.id)).size,8);
const reservoirSettings=JSON.parse(await readFile(new URL('site/data/reservoir-watchlist.json',root),'utf8'));
assert.deepEqual(reservoirSettings.stations.map(s=>s.id),['MIL','PNF']);
for(const station of reservoirSettings.stations)assert(station.longitude>-121&&station.longitude<-118&&station.latitude>36&&station.latitude<38&&station.metrics.every(m=>['D','H'].includes(m.duration)&&['CFS','FEET','AF'].includes(m.units)),'Reservoir geography or metric contract changed');
validateReservoirSnapshot(JSON.parse(await readFile(new URL('site/data/reservoir-latest.json',root),'utf8')));
validatePowerSnapshot(JSON.parse(await readFile(new URL('site/data/power-latest.json',root),'utf8')));
const areaSettings=JSON.parse(await readFile(new URL('site/data/river-areas.json',root),'utf8'));
assert.equal(planningPoints(areaSettings,watch.stations,reservoirSettings.stations).length,11);
const player=await readFile(new URL('site/vendor/hls-1.7.3.light.js',root));
assert.equal(createHash('sha256').update(player).digest('hex'),'0c4f60fc126ef62dc18e8e5e7b1984cf77628aa2a230688dcf5bea7f3966e052','Pinned HLS library changed');
console.log('Syntax, county geometry, nine river watchpoints, eight cameras, two reservoir contracts/snapshot, pinned player integrity, page links and public config checks passed.');
