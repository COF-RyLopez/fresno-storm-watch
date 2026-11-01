/** Public-only, seven-point NWS/Dynamical collection; no county credentials. */
import {comparisonAreas} from '../site/lib/forecast-comparison-model.js';
import {collectComparisonSnapshot} from '../site/lib/forecast-review-data.js';
import {siteJson,writeAtomic} from './lib/snapshot-io.mjs';
const started=Date.now();
const [a,c,w,g]=await Promise.all(['river-areas','area-concerns','wind-watchlist','river-watchlist'].map(name=>siteJson(name+'.json')));
const areas=comparisonAreas(a.areas,c.areas,w.sites,g.stations),snapshot=await collectComparisonSnapshot(areas);
await writeAtomic(new URL('../site/data/comparison-latest.json',import.meta.url),JSON.stringify(snapshot)+'\n');
console.log(JSON.stringify({event:'forecast-comparison-collection',durationMs:Date.now()-started,points:snapshot.points.length,sourceFailures:snapshot.points.flatMap(p=>p.rows.filter(r=>r.error).map(r=>({point:p.point.id,source:r.id,error:r.error})))}));
