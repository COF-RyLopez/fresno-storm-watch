import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {CONFIG} from '../site/config.js';
import {validatePilot,pilotAssessment,pilotFeatures,featureBounds,comparableRuns} from '../site/lib/pilot-model.js';
import {pilotStyle,libreStyle} from '../site/lib/pilot-map.js';
import {planningExercise} from '../site/lib/planning-exercise.js';
import {planningPoints,evaluateAreas} from '../site/lib/planning-model.js';
import {assessGauge} from '../site/lib/river-model.js';
import {chartWindow,refreshPilotSnapshot} from '../site/lib/pilot-data.js';
import {siteJson} from '../scripts/lib/snapshot-io.mjs';
const [areas,gauges,reservoirSettings,associations,windSettings]=await Promise.all(['river-areas.json','river-watchlist.json','reservoir-watchlist.json','area-concerns.json','wind-watchlist.json'].map(siteJson));
const now=Date.parse('2026-10-20T20:00:00Z'),points=planningPoints(areas,gauges.stations,reservoirSettings.stations);
function bundle(scenario='combined'){
 const f=planningExercise(gauges.stations,points,reservoirSettings,scenario,now);
 return {schemaVersion:1,generatedAt:new Date(now).toISOString(),dataId:'a'.repeat(64),input:{areas,gauges,reservoirSettings,associations,windSettings,points,entries:[...f.entries].map(([id,e])=>({id,...e})),rain:f.rain,reservoirs:f.reservoirs.snapshot,power:{feeds:[]},wind:{sites:[]},comparisons:{points:[]},utilityFeatures:[]}};
}
test('pilot rejects incomplete and mismatched station inventories before counts are shown',()=>{
 const s=bundle();assert.equal(validatePilot(s,now),s);
 for(const mutate of [s=>s.input.entries.pop(),s=>s.input.entries[0].id='WRONG',s=>s.dataId='unknown',s=>s.generatedAt=new Date(now+180000).toISOString(),s=>s.error='Collection failed']){const s=bundle();mutate(s);assert.throws(()=>validatePilot(s,now));}
});
test('pilot shares current river assessment with full app including missing and old observations',()=>{
 for(const scenario of ['combined','baseline','stale','missing','threshold']){const s=bundle(scenario),a=pilotAssessment(s,now);for(const r of a.gauges){const entry=s.input.entries.find(e=>e.id===r.station.id);assert.deepEqual(r.assessment,assessGauge(entry.gauge,CONFIG.rivers,72,now,entry.error));}}
});
test('collector chart trimming retains latest old report, forecast and current assessment semantics',()=>{
 for(const scenario of ['baseline','stale','threshold'])for(const entry of bundle(scenario).input.entries){const original=structuredClone(entry),trimmed=chartWindow(entry,now);assert.deepEqual(assessGauge(trimmed.gauge,CONFIG.rivers,72,now,trimmed.error),assessGauge(entry.gauge,CONFIG.rivers,72,now,entry.error));assert.deepEqual(trimmed.gauge.observed.points.at(-1),entry.gauge.observed.points.at(-1));assert.deepEqual(trimmed.gauge.forecast,entry.gauge.forecast);assert.deepEqual(entry,original);}
 const last={time:now-100*3600000,value:0},entry={gauge:{observed:{points:[{time:now-200*3600000,value:1},last]},forecast:{points:[]}}};assert.deepEqual(chartWindow(entry,now).gauge.observed.points,[last]);
});
test('one live check supplies shared inputs without modifying scheduled source times or original bundle',async()=>{
 const original=bundle(),copy=structuredClone(original);let rivers=0,rain=0;
 const s=await refreshPilotSnapshot(original,{now,riverFetch:async()=>{rivers++;return original.input.entries;},rainFetch:async()=>{rain++;return original.input.rain;}});
 assert.equal(rivers,1);assert.equal(rain,1);assert.equal(s.sourceBundleGeneratedAt,original.generatedAt);assert.match(s.dataId,/^[a-f0-9]{64}$/);assert.deepEqual(s.input.wind,original.input.wind);assert.deepEqual(s.input.reservoirs,original.input.reservoirs);assert.deepEqual(original,copy);assert.deepEqual(pilotAssessment(s,now),pilotAssessment(original,now));
});
test('failed live checks retain dated evidence with explicit errors, never old data as current',async()=>{
 const original=bundle(),s=await refreshPilotSnapshot(original,{now:now+1000,riverFetch:async()=>{throw Error('River unavailable');},rainFetch:async()=>{throw Error('WPC unavailable');}});
 assert(s.input.entries.every(e=>e.error==='River unavailable'));assert.equal(s.input.entries[0].gauge.fetched,original.input.entries[0].gauge.fetched);assert.deepEqual(s.input.rain.cycle,original.input.rain.cycle);const a=pilotAssessment(s,now+1000);assert(a.gauges.every(r=>!r.assessment.current));assert(a.areas.every(r=>r.rainfall.maximum===null));
});
test('partial live station failures remain isolated and change the comparison data identifier',async()=>{
 const original=bundle(),entries=structuredClone(original.input.entries);entries[0]={id:entries[0].id,error:'Station failed',gauge:null};
 const s=await refreshPilotSnapshot(original,{now,riverFetch:async()=>entries,rainFetch:async()=>original.input.rain});assert.equal(s.input.entries[0].error,'Station failed');assert.equal(s.input.entries[1].error,original.input.entries[1].error);assert.notEqual(s.dataId,original.dataId);assert.deepEqual(s.input.entries[0].gauge.observed,original.input.entries[0].gauge.observed);
});
test('pilot preserves full-app river reviews before adding existing wind/power/comparison rules',()=>{
 const s=bundle(),a=pilotAssessment(s,now),rows=evaluateAreas({areas:areas.areas,points,gaugeEntries:new Map(s.input.entries.map(e=>[e.id,e])),riverConfig:CONFIG.rivers,reservoirs:{selection:reservoirSettings,snapshot:s.input.reservoirs,checked:now,error:null},rain:s.input.rain,environmentConfig:CONFIG.environment},now);
 for(const expected of rows){const actual=a.areas.find(r=>r.area.id===expected.area.id);assert.equal(actual.riverReview,expected.review);assert.equal(actual.rainfall.maximum,expected.rainfall.maximum);assert.deepEqual(actual.releases,expected.releases);}
});
test('filtered display never changes countywide area review evaluation',()=>{
 const s=bundle(),a=pilotAssessment(s,now),count=a.areas.filter(r=>r.review).length;
 const all=pilotFeatures(s,a,'watch','all'),review=pilotFeatures(s,a,'watch','review');assert(review.features.length<all.features.length);assert.equal(a.areas.filter(r=>r.review).length,count);assert.equal(new Set(all.features.map(f=>f.id)).size,all.features.length);
 assert(all.features.every(f=>f.geometry.type==='Point')); // No invented review-area boundaries.
});
test('Rivers uses all nine gauges and two dam locations; basin filter preserves unknowns',()=>{
 const s=bundle('missing'),a=pilotAssessment(s,now),all=pilotFeatures(s,a,'rivers');assert.equal(all.features.filter(f=>f.properties.kind==='gauge').length,9);assert.equal(all.features.filter(f=>f.properties.kind==='reservoir').length,2);assert(all.features.filter(f=>f.properties.kind==='gauge').every(f=>f.properties.tone==='gap'));
 const kings=pilotFeatures(s,a,'rivers','all','Kings');assert.equal(kings.features.filter(f=>f.properties.kind==='gauge').length,2);assert.equal(kings.features.filter(f=>f.properties.kind==='reservoir').length,2);
});
test('the same GeoJSON payload works independently of the renderer, with valid county coordinates',()=>{
 const s=bundle(),a=pilotAssessment(s,now);for(const view of ['watch','rivers']){const data=pilotFeatures(s,a,view);assert.deepEqual(data,pilotFeatures(s,a,view));for(const f of data.features){const [x,y]=f.geometry.coordinates;assert(x> -121&&x< -118&&y>35&&y<38);assert.match(f.properties.color,/^#[a-f0-9]{6}$/i);}}
});
test('overdue bundle fails assessment closed without rewriting observation timestamps',()=>{
 const s=bundle(),a=pilotAssessment(s,now+46*60000);assert(a.old);assert(a.gauges.every(r=>!r.assessment.current&&!r.assessment.forecastUsable));assert(a.areas.every(r=>r.gaps.length));assert(a.areas.every(r=>r.rainfall.maximum===null));assert.equal(Date.parse(s.generatedAt),now);
});
test('extent calculation includes all polygon parts and does not manufacture empty locations',()=>{
 assert.equal(featureBounds([]),null);assert.deepEqual(featureBounds([{geometry:{type:'MultiPolygon',coordinates:[[[[-120,36],[-119,36],[-120,36]]],[[[-118.5,37],[-118,37.5],[-118.5,37]]]]}}]),[-120,36,-118,37.5]);
});
const run={engine:'maplibre',complete:true,errors:[],dataId:'x',view:'rivers',filter:'all',basin:'All',featureSignature:'same',width:960,height:540,pixelRatio:1,symbolVersion:'pilot-1',styleId:'frog'};
test('only error-free completed runs from different engines with identical contexts are comparable',()=>{
 const other={...run,engine:'arcgis'};assert(comparableRuns(run,other));assert(!comparableRuns(run,run));
 for(const [field,value] of Object.entries({complete:false,errors:['Tile failed'],dataId:'new',view:'watch',filter:'review',basin:'Kings',featureSignature:'changed',width:600,height:300,pixelRatio:2,symbolVersion:'new',styleId:'other'}))assert(!comparableRuns(run,{...other,[field]:value}),field);
});
test('watch maps use same publisher raster tile families; native ArcGIS metadata gets adapted for MapLibre',async()=>{
 const style=await pilotStyle('watch');assert.equal(style.sources.base.tileSize,256);assert.match(style.sources.base.tiles[0],/World_Dark_Gray_Base\/MapServer\/tile/);
 const source={version:8,sources:{esri:{type:'vector',url:'native-metadata'},frog:{type:'vector',url:'existing-county-tilejson'}},layers:[]};const adapted=libreStyle(source);assert.match(adapted.sources.esri.tiles[0],/tile\/\{z\}\/\{y\}\/\{x\}.pbf/);assert.deepEqual(adapted.sources.frog,source.sources.frog);assert.equal(source.sources.esri.url,'native-metadata');
});
test('pilot route is isolated, uses one pinned Calcite runtime and has no browser persistence',async()=>{
 const html=await readFile(new URL('../site/map-pilot.html',import.meta.url),'utf8'),script=await readFile(new URL('../site/map-pilot.js',import.meta.url),'utf8');assert(html.includes('calcite-components/5.2.0/index.js'));assert(!html.includes('src="https://js.arcgis.com/5.1/"'));assert(!/localStorage|sessionStorage|indexedDB|document.cookie/.test(script));assert(!/innerHTML\s*=/.test(script));assert(!script.includes('getToken'));assert(html.includes('Full app'));
});
