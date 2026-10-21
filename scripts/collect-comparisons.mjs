/** Public-only, seven-point NWS/Dynamical collection; no county credentials. */
import {readFile,writeFile,rename} from 'node:fs/promises';
import {comparisonAreas} from '../site/lib/forecast-comparison-model.js';
import {collectComparisonSnapshot} from '../site/lib/forecast-review-data.js';
const started=Date.now(),read=async name=>JSON.parse(await readFile(new URL(`../site/data/${name}.json`,import.meta.url),'utf8'));
const [a,c,w,g]=await Promise.all(['river-areas','area-concerns','wind-watchlist','river-watchlist'].map(read));
const areas=comparisonAreas(a.areas,c.areas,w.sites,g.stations),snapshot=await collectComparisonSnapshot(areas);
const temporary=new URL('../site/data/comparison-latest.tmp',import.meta.url),output=new URL('../site/data/comparison-latest.json',import.meta.url);
await writeFile(temporary,JSON.stringify(snapshot)+'\n','utf8');await rename(temporary,output);
console.log(JSON.stringify({event:'forecast-comparison-collection',durationMs:Date.now()-started,points:snapshot.points.length,sourceFailures:snapshot.points.flatMap(p=>p.rows.filter(r=>r.error).map(r=>({point:p.point.id,source:r.id,error:r.error})))}));
