import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {fetchRoads,roadInCurrentView,roadConflictBacklog,ROAD_SERVICE,ROAD_QUERY_SERVICE,ROAD_ROUTE_ITEM} from '../site/lib/roads.js';

// Read-only, on-demand diagnostic. No records, credentials or user details are written.
const started=Date.now();
const snapshot=await fetchRoads();
const hash=rows=>createHash('sha256').update(JSON.stringify(rows.map(r=>[r.key,r.revision]).sort((a,b)=>a[0].localeCompare(b[0])))).digest('hex');
let upstreamComparison=null;
if(process.argv.includes('--compare-source')){
  const upstream=await fetchRoads((url,options)=>fetch(url.replace(ROAD_QUERY_SERVICE,ROAD_SERVICE),options));
  assert.equal(snapshot.rows.length,upstream.rows.length,'Public route/source record counts differ; inspect before switching routes.');
  assert.equal(hash(snapshot.rows),hash(upstream.rows),'Public route/source revisions differ; inspect before switching routes.');
  upstreamComparison='Every GlobalID, selected attribute and geometry revision matched the official public view.';
}
console.log(JSON.stringify({checkedAt:new Date(snapshot.checked).toISOString(),publisher:'County of Fresno',publisherItem:ROAD_ROUTE_ITEM,source:ROAD_SERVICE,queryService:ROAD_QUERY_SERVICE,readOnly:true,crs:'EPSG:4326',rows:snapshot.rows.length,byLayer:[0,1,2].map(layer=>({layer,count:snapshot.rows.filter(r=>r.layer===layer).length})),defaultVisible:snapshot.rows.filter(r=>roadInCurrentView(r)).length,elapsedActiveConflicts:roadConflictBacklog(snapshot.rows).length,contentSha256:hash(snapshot.rows),upstreamComparison,durationMs:Date.now()-started},null,2));
