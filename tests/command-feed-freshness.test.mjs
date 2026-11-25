import test from 'node:test';
import assert from 'node:assert/strict';
import {createCommandFeeds,riverConcerns} from '../site/lib/command-data.js';
import {planningExercise} from '../site/lib/planning-exercise.js';
import {planningPoints} from '../site/lib/planning-model.js';
import {siteJson} from '../scripts/lib/snapshot-io.mjs';
import {stubGlobals} from './helpers/dom.mjs';
const HOUR=3600000;
const [areas,gauges,reservoirSettings,associations,windSettings]=await Promise.all(['river-areas.json','river-watchlist.json','reservoir-watchlist.json','area-concerns.json','wind-watchlist.json'].map(siteJson));
const points=planningPoints(areas,gauges.stations,reservoirSettings.stations);
function fixture(now,powerRow){
 const exercise=planningExercise(gauges.stations,points,reservoirSettings,'combined',now);
 return {schemaVersion:1,generatedAt:new Date(now).toISOString(),dataId:'a'.repeat(64),input:{areas,gauges,reservoirSettings,associations,windSettings,points,entries:[...exercise.entries].map(([id,e])=>({id,...e})),rain:exercise.rain,reservoirs:exercise.reservoirs.snapshot,power:{feeds:[{id:'pge-outages',lastSuccess:new Date(now).toISOString(),rows:[powerRow]}]},wind:{sites:[]},comparisons:{points:[]},utilityFeatures:[]}};
}
function sourceGauge(g,part){
 if(!part)return {lid:g.id,name:g.name,longitude:g.longitude,latitude:g.latitude,inService:{enabled:g.inService},status:{observed:{floodCategory:g.observedStatus},forecast:{floodCategory:g.forecastStatus}},flood:{categories:g.categories,stageUnits:g.stageUnits,flowUnits:g.flowUnits}};
 const series=s=>({primaryName:s.name,primaryUnits:s.units,issuedTime:s.issued===null?null:new Date(s.issued).toISOString(),data:s.points.map(p=>({validTime:new Date(p.time).toISOString(),primary:p.value}))});
 return {observed:series(g.observed),forecast:series(g.forecast)};
}
function harness(t){
 let now=Date.parse('2026-11-15T08:00:00Z'),fail=false,latest,counter=0;
 const original=now,power={key:'exercise-outage',utility:'PG&E',feedId:'pge-outages',name:'Exercise outage',status:'outage',updated:{time:now-1000},start:{time:null},end:{time:null},restoration:{time:now+2*HOUR},issues:[],geometries:[{x:-119.7,y:36.8}],official:'https://example.org',revision:'test'};
 let bundle=fixture(now,power);const timers=new Map();
 const restore=stubGlobals({setTimeout:(fn,delay)=>{const id=++counter;timers.set(id,{fn,delay});return id;},clearTimeout:id=>timers.delete(id)});
 t.mock.method(Date,'now',()=>now);
 const feeds=createCommandFeeds({baseUrl:new URL('https://example.invalid/'),onChange:s=>latest=s,fetchImpl:async input=>{
  const url=new URL(input);
  if(url.pathname==='/data/map-pilot-latest.json')return fail?new Response('',{status:503}):Response.json(bundle);
  const gauge=/\/gauges\/([^/]+)(\/stageflow)?$/.exec(url.pathname);
  if(gauge){const g=bundle.input.entries.find(e=>e.id.toLowerCase()===gauge[1])?.gauge;return g?Response.json(sourceGauge(g,gauge[2])):new Response('',{status:404});}
  if(url.pathname.endsWith('/9/query')){
   const c=bundle.input.rain.cycle;return Response.json({features:[{attributes:{qpf:1.25,units:'Inches',product:c.product,issue_time:new Date(c.issue).toISOString(),start_time:new Date(c.start).toISOString(),end_time:new Date(c.end).toISOString()}}]});
  }
  return new Response('',{status:404});
 }});
 t.after(()=>{feeds.destroy();restore();});
 return {feeds,power,original,get latest(){return latest;},get now(){return now;},set now(value){now=value;},set fail(value){fail=value;},set bundle(value){bundle=value;},minute(){const [id,timer]=[...timers].find(([,v])=>v.delay===60000);timers.delete(id);timer.fn();}};
}
const utility=s=>s.reference.find(r=>r.kind==='power').utilityUpdate;
function assertCurrentAssessment(state,now){
 const expected=riverConcerns(state.bundle,now);
 for(const row of expected.rows.filter(r=>r.kind==='river'))assert.deepEqual(state.reference.find(r=>r.id===row.id).evidence,row.evidence,`${row.name}: retained card must age with the map`);
 for(const feature of expected.features.filter(f=>f.properties.gaugeId))assert.equal(state.features.find(f=>f.id===feature.id).properties.gaugeDisplay.current,feature.properties.gaugeDisplay.current);
}

test('minute reassessment, failed refresh and recovery keep cards, markers, timestamps and utility history consistent',async t=>{
 const h=harness(t);await h.feeds.refresh();
 assert(h.latest.features.some(f=>f.properties.gaugeDisplay?.current),'successful browser refresh must establish current gauges: '+JSON.stringify(h.latest.errors));
 h.now+=60000;h.power.updated.time=h.now;h.power.restoration.time=h.original+3*HOUR;h.bundle=fixture(h.now,h.power);await h.feeds.refresh();
 const change=structuredClone(utility(h.latest).estimateChange);assert.equal(change.type,'changed');
 const retained=structuredClone(h.latest.bundle),checked=h.latest.checked['River & reservoir evidence'];
 h.now=h.original+12*HOUR;h.minute();
 assertCurrentAssessment(h.latest,h.now);assert(h.latest.features.filter(f=>f.properties.gaugeDisplay).every(f=>!f.properties.gaugeDisplay.current));
 assert.equal(utility(h.latest).restoration.passed,true);assert.deepEqual(utility(h.latest).estimateChange,change);
 assert.deepEqual(h.latest.bundle,retained);assert.equal(h.latest.checked['River & reservoir evidence'],checked);
 h.fail=true;await h.feeds.refresh();
 assert(h.latest.errors['River & reservoir evidence']);
 for(const row of h.latest.reference.filter(r=>r.kind==='river')){
  assert.match(row.quality,/check failed/i);assert(row.evidence.every(e=>/check failed/i.test(e.quality)));
 }
 assert.deepEqual(h.latest.bundle,retained);assert.equal(h.latest.checked['River & reservoir evidence'],checked);assert.deepEqual(utility(h.latest).estimateChange,change);
 h.fail=false;h.bundle=fixture(h.now,h.power);await h.feeds.refresh();
 assert.equal(h.latest.errors['River & reservoir evidence'],undefined);assert.equal(h.latest.checked['River & reservoir evidence'],h.now);
 assertCurrentAssessment(h.latest,h.now);assert(h.latest.features.some(f=>f.properties.gaugeDisplay?.current));
 assert(h.latest.reference.filter(r=>r.kind==='river').every(r=>!r.quality.includes('check failed')));assert.deepEqual(utility(h.latest).estimateChange,change);
});

test('a failed bundle check qualifies still-recent evidence instead of leaving Observed cards beside failed markers',async t=>{
 const h=harness(t);await h.feeds.refresh();assert(h.latest.features.some(f=>f.properties.gaugeDisplay?.current),JSON.stringify(h.latest.errors));const before=structuredClone(h.latest.bundle);h.now+=60000;h.fail=true;await h.feeds.refresh();
 const gauges=h.latest.features.filter(f=>f.properties.gaugeDisplay);assert(gauges.every(f=>!f.properties.gaugeDisplay.current));
 for(const f of gauges.filter(f=>areas.areas.some(a=>a.gauges.includes(f.properties.gaugeId)))){
  const name=h.latest.bundle.input.entries.find(e=>e.id===f.properties.gaugeId).gauge.name;
  const rows=h.latest.reference.filter(r=>r.kind==='river').flatMap(r=>r.evidence).filter(e=>e.label===name);
  assert(rows.length);assert(rows.every(e=>e.quality!=='Observed'&&/check failed/i.test(e.quality)));
 }
 assert.deepEqual(h.latest.bundle,before);
});
