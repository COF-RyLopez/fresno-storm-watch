import test from 'node:test';
import assert from 'node:assert/strict';
import {riverConcerns,roadConcerns,alertConcerns} from '../site/lib/command-data.js';
import {arcGeometry} from '../site/lib/command-model.js';
import {normalizeRoad,missingRoadRecords} from '../site/lib/roads.js';
import {planningExercise} from '../site/lib/planning-exercise.js';
import {planningPoints} from '../site/lib/planning-model.js';
import {siteJson} from '../scripts/lib/snapshot-io.mjs';

test('disjoint polygon islands and a hole keep their distinct topology',()=>{
 const a=[[0,0],[0,5],[5,5],[5,0],[0,0]],hole=[[1,1],[2,1],[2,2],[1,2],[1,1]],b=[[7,0],[7,2],[9,2],[9,0],[7,0]];
 const g=arcGeometry({rings:[hole,b,a]});assert.equal(g.type,'MultiPolygon');assert.equal(g.coordinates.length,2);assert.equal(g.coordinates[0].length,2);
});
test('NWS category and source revision survive; county filtering is fixed',()=>{
 const input={key:'a',type:'Winter Weather Advisory',category:'Advisory',counties:['Fresno'],office:'HNX',issued:10,onset:20,expires:30,signature:'revision2',sourceUrl:'https://weather.gov',geometries:[]};
 const a=alertConcerns([input,{...input,key:'b',counties:['Kings']}]);assert.equal(a.length,1);assert.equal(a[0].quality,'Official NWS Advisory');assert.equal(a[0].revision,'revision2');
});
test('elapsed road dates become one backlog item, never inferred open or current closure',()=>{
 const raw={attributes:{globalid:'A',blocknm:'Road A',active:'yes',enddate:1000},geometry:{x:-119,y:36}};
 const road=normalizeRoad(raw,1,2000),rows=roadConcerns({rows:[road]},null,2000);
 assert.equal(rows.find(r=>r.id===road.key).review,false);assert.equal(rows.find(r=>r.id==='roads:legacy-review').review,true);assert.match(rows[1].quality,/not confirmed/);
});

test('source test entries stay inspectable but cannot become current road impacts or missing-road alerts',()=>{
 const now=2000;
 const roads=['test',' TEST ','Testing Road','Unnamed county record'].map((blocknm,i)=>normalizeRoad({
   attributes:{globalid:String(i),blocknm,active:null},geometry:{x:-119.8,y:36.7},
 },1,now));
 const rows=roadConcerns({rows:roads},null,now);
 assert.deepEqual(rows.filter(r=>r.review).map(r=>r.name),['Testing Road','Unnamed county record']);
 assert.equal(rows.filter(r=>r.sourceReview).length,2);
 assert.ok(rows.filter(r=>r.sourceReview).every(r=>r.features.length===1 && /test/i.test(r.quality)));
 assert.deepEqual([...missingRoadRecords(roads,[]).keys()],roads.slice(2).map(r=>r.key));
});
test('overview gauges and dams resolve to evidence; utility timestamps are numeric',async()=>{
 const [areas,gauges,reservoirSettings,associations,windSettings]=await Promise.all(['river-areas.json','river-watchlist.json','reservoir-watchlist.json','area-concerns.json','wind-watchlist.json'].map(siteJson));
 const now=Date.parse('2026-11-15T08:00:00Z'),points=planningPoints(areas,gauges.stations,reservoirSettings.stations);
 const f=planningExercise(gauges.stations,points,reservoirSettings,'combined',now);
 const row={key:'test-outage',utility:'PG&E',feedId:'pge-outages',name:'Exercise outage',status:'outage',updated:{time:now-1000},start:{time:null},end:{time:null},restoration:{time:null},issues:[],geometries:[{x:-119.7,y:36.8}],official:'https://example.org',revision:'test'};
 const bundle={schemaVersion:1,generatedAt:new Date(now).toISOString(),dataId:'a'.repeat(64),input:{areas,gauges,reservoirSettings,associations,windSettings,points,entries:[...f.entries].map(([id,e])=>({id,...e})),rain:f.rain,reservoirs:f.reservoirs.snapshot,power:{feeds:[{id:'pge-outages',lastSuccess:new Date(now-3600000).toISOString(),rows:[row]}]},wind:{sites:[]},comparisons:{points:[]},utilityFeatures:[]}};
 row.details='Equipment issue · Crew is assessing the outage';
 const result=riverConcerns(bundle,now);
 for(const f of result.features)assert.ok(result.rows.some(r=>r.id===f.properties.id),f.properties.name+' must select a concern');
 const power=result.rows.find(r=>r.kind==='power');assert.equal(power.time,now-1000);assert.match(power.quality,/overdue/);
 assert.equal(power.utilityUpdate.publisher,'PG&E');assert.equal(power.utilityUpdate.text,row.details);assert.ok(power.details.includes(row.details));
 assert.equal(power.utilityUpdate.customers,null);assert.equal(power.utilityUpdate.restoration.label,'Not supplied');
 row.customers=0;assert.equal(riverConcerns(bundle,now).rows.find(r=>r.kind==='power').utilityUpdate.customers,0);
 row.details='';assert.match(riverConcerns(bundle,now).rows.find(r=>r.kind==='power').utilityUpdate.text,/No event details supplied/);
});
