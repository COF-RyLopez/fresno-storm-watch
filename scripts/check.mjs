import {validateNetworkSnapshot} from '../site/lib/power-network-model.js';
import {comparisonAreas} from '../site/lib/forecast-comparison-model.js';
import {uniqueComparisonPoints,validateComparisonSnapshot} from '../site/lib/forecast-review-model.js';
import { readdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { validateCounties } from '../site/lib/model.js';
import { createHash } from 'node:crypto';
import { validateReservoirSnapshot } from '../site/lib/environment-model.js';
import { planningPoints } from '../site/lib/planning-model.js';
import {validatePowerSnapshot} from '../site/lib/power-model.js';
import {validateWindSnapshot} from '../site/lib/weather-model.js';
import {validateAreaConcerns} from '../site/lib/area-concern-model.js';
import {siteJson} from './lib/snapshot-io.mjs';
import {validateWazeSnapshot} from '../site/lib/waze-model.js';

const root = new URL('../', import.meta.url);
for (const folder of ['site/', 'site/lib/', 'scripts/', 'scripts/lib/', 'services/scenarios/']) {
  for (const entry of await readdir(new URL(folder, root))) {
    if (!/\.(js|mjs)$/.test(entry)) continue;
    const result = spawnSync(process.execPath, ['--check', fileURLToPath(new URL(folder + entry, root))], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  }
}
const counties = await siteJson('counties.geojson');
assert.equal(validateCounties(counties).length, 5);
const config = await readFile(new URL('site/config.js', root), 'utf8');
assert(!/clientSecret\s*:|password\s*:|accessToken\s*:/i.test(config), 'Public config must not contain secret settings.');
const html = await readFile(new URL('site/index.html', root), 'utf8');
assert(html.includes('https://js.arcgis.com/5.1/'), 'Pinned SDK stylesheet expected');
for (const file of (await readdir(new URL('site/', root))).filter(name => name.endsWith('.html'))) {
  const page=await readFile(new URL(`site/${file}`,root),'utf8');
  for (const match of page.matchAll(/(?:href|src)="(\.\/[^"?#]+)"/g)) await readFile(new URL(match[1], new URL('site/', root)));
}
const watch=await siteJson('river-watchlist.json');
assert.equal(watch.stations.length,10);
assert.equal(new Set(watch.stations.map(s=>s.id)).size,10);
for(const s of watch.stations)assert(/^[A-Z0-9]{5}$/.test(s.id)&&s.longitude>=-125&&s.longitude<=-114&&s.latitude>=32&&s.latitude<=43&&s.note,'Invalid watchpoint metadata');
const cameras=await siteJson('camera-watchlist.json');
assert.equal(cameras.cameras.length,8);assert.equal(new Set(cameras.cameras.map(c=>c.id)).size,8);
const reservoirSettings=await siteJson('reservoir-watchlist.json');
assert.deepEqual(reservoirSettings.stations.map(s=>s.id),['MIL','PNF']);
for(const station of reservoirSettings.stations)assert(station.longitude>-121&&station.longitude<-118&&station.latitude>36&&station.latitude<38&&station.metrics.every(m=>['D','H'].includes(m.duration)&&['CFS','FEET','AF'].includes(m.units)),'Reservoir geography or metric contract changed');
validateReservoirSnapshot(await siteJson('reservoir-latest.json'));
validateNetworkSnapshot(await siteJson('power-network.json'));
validatePowerSnapshot(await siteJson('power-latest.json'));
validateWindSnapshot(await siteJson('wind-latest.json'));
// Optional partner snapshot: absent unless WAZE_PUBLISH is 'true' in the Pages run.
try{validateWazeSnapshot(await siteJson('waze-latest.json'));}catch(error){if(error.code!=='ENOENT')throw error;}
const areaSettings=await siteJson('river-areas.json');
assert.equal(planningPoints(areaSettings,watch.stations,reservoirSettings.stations).length,12);
const areaConcerns=await siteJson('area-concerns.json'),windSettings=await siteJson('wind-watchlist.json');
validateAreaConcerns(areaConcerns,areaSettings.areas,windSettings.sites);
const player=await readFile(new URL('site/vendor/hls-1.7.3.light.js',root));
const pilotRuntime=JSON.parse(await readFile(new URL('docs/map-pilot-runtime.json',root),'utf8'));
for(const entry of pilotRuntime.files)assert.equal(createHash('sha256').update(await readFile(new URL(entry.file,root))).digest('hex'),entry.sha256,'Pinned MapLibre runtime changed: '+entry.file);
assert.equal(createHash('sha256').update(player).digest('hex'),'0c4f60fc126ef62dc18e8e5e7b1984cf77628aa2a230688dcf5bea7f3966e052','Pinned HLS library changed');
console.log('Syntax, county geometry, ten river watchpoints, eight cameras, two reservoir contracts/snapshot, pinned player integrity, page links and public config checks passed.');

const comparisonSites=uniqueComparisonPoints(comparisonAreas(areaSettings.areas,areaConcerns.areas,windSettings.sites,watch.stations));
assert.equal(comparisonSites.length,7);
validateComparisonSnapshot(await siteJson('comparison-latest.json'),comparisonSites);
console.log('Seven public forecast-comparison points and scheduled snapshot schema checked.');

const carePlaces=await siteJson('care-places/index.json');
const careBytes=await readFile(new URL('site/data/care-places/'+carePlaces.file,root));
assert.equal(careBytes.length,carePlaces.bytes);assert.equal(createHash('sha256').update(careBytes).digest('hex'),carePlaces.sha256);
assert.equal(carePlaces.accounting.read,carePlaces.accounting.retained+carePlaces.accounting.outside+carePlaces.accounting.invalid);
assert(/care\.css\?v=[0-9a-f]{10}"/.test(html)&&html.includes('id="care-panel"'));

for(const file of ['NOTICE.txt','CDLA-Permissive-2.0.txt','Apache-2.0.txt','Foursquare-NOTICE.txt'])assert((await readFile(new URL('site/data/care-places/'+file,root),'utf8')).length>500,'Places license/notice missing: '+file);

assert(html.includes('id="care-area-watch"')&&html.includes('id="care-browse"'),'Care review and evidence controls missing');
