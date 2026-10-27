import test from 'node:test';
import assert from 'node:assert/strict';
import {assessCareReviews,careRoadVicinity,freezeCareReview,careIdentity} from '../site/lib/care-review-model.js';
import {careReviewExercise} from '../site/lib/care-review-exercise.js';
import {careBox} from '../site/lib/care-model.js';
import {createCareMap} from '../site/lib/care-map.js';
const now=Date.parse('2026-10-27T18:00:00Z');
function fixture(kind='overlap'){const d=careReviewExercise(kind,now),f=d.facilities.rows[0];return {...d,sourceErrors:d.errors,vicinity:new Map([[f.key,{identity:careIdentity(f),checked:d.roads.snapshot.checked,unknown:0,rows:d.roads.snapshot.rows.map(record=>({key:record.key,record,distanceMeters:200}))}]])};}
const assess=f=>assessCareReviews(f,now),first=f=>assess(f)[0];
function clear(f){f.zones.rows=[];f.power.rows=[];f.vicinity=new Map();return f;}

test('care review keeps evacuation, outage, PSPS and road cues separate without inferring occupants or power loss',()=>{
 const f=fixture(),r=first(f);assert(r.evacuationReview&&r.powerReview&&r.roadReview);assert.equal(r.powerReviews.length,2);assert.equal(r.zones[0].status,'Warn');assert.equal(r.facility.beds,null);assert(!('evacuate' in r));assert(!('powerLost' in r));assert(!('occupants' in r));
 const frozen=freezeCareReview(r,now);assert.equal(frozen.zoneIssueTime,null);assert.equal(frozen.roadRadiusMeters,1609.344);assert.equal(frozen.power[0].revision,r.powerReviews[0].row.revision);r.reasons.push('changed');assert(!frozen.reasons.includes('changed'));
});
test('repeated facility, zone representation and utility rows never multiply record review counts',()=>{
 const f=fixture();f.facilities.rows.push(structuredClone(f.facilities.rows[0]));f.power.rows.push(structuredClone(f.power.rows[0]));f.power.rows[0].geometries.push(structuredClone(f.power.rows[0].geometries[0]));
 const rows=assess(f);assert.equal(rows.length,1);assert.equal(rows[0].powerReviews.length,2);
});
test('facility containment respects polygon holes and does not buffer point-only utility incidents',()=>{
 const f=fixture(),p=f.facilities.rows[0].geometry;f.vicinity=new Map();f.zones.rows=[];
 f.power.rows=f.power.rows.slice(0,1);f.power.rows[0].geometries=[{...careBox(p,1000),rings:[careBox(p,1000).rings[0],careBox(p,50).rings[0]]}];assert.equal(first(f).powerReview,false);
 f.power.rows[0].geometries=[p];assert.equal(first(f).powerReview,false);assert.equal(first(f).power.pointOnly,1);
 f.power.rows[0].geometries=[careBox(p,1000)];assert(first(f).powerReview);
});
test('source failures and old checks retain qualified spatial cues and never become current evidence',()=>{
 const r=first(fixture('failure'));assert(r.review);assert(!r.zoneCurrent&&!r.facilitiesCurrent&&!r.roadCurrent);assert(r.powerReviews.every(m=>!m.eligible&&m.problem));assert(r.gaps.some(g=>/County zone/.test(g)));assert(r.gaps.some(g=>/road check/.test(g)));
});
test('changed, removed and restored utility or zone concerns remain tab-only follow-ups; changed facility location resets associations',()=>{
 const initial=fixture(),previous=new Map(assess(initial).map(r=>[r.key,r]));
 const revised=fixture('revised');revised.previous=previous;let r=first(revised);assert(r.powerReview);assert(r.powerReviews.every(m=>m.followup&&!m.returned));assert.equal(r.zoneFollowups[0].status,'Lifted');assert(r.evacuationReview);
 const restored=fixture();restored.previous=previous;restored.power.rows=restored.power.rows.map(row=>({...row,status:'restored',revision:row.revision+'-restored'}));r=first(restored);assert(r.powerReviews.every(m=>m.row.status==='restored'&&m.followup&&m.returned));
 revised.facilities.rows[0].geometry.x+=.1;r=first(revised);assert.equal(r.powerReview,false);assert.equal(r.zoneFollowups.length,0);
 assert.equal(first(fixture('revised')).powerReview,false);
});
test('historical elapsed-date active roads remain context, not current review counts; nearby detours remain qualified',()=>{
 const f=fixture(),near=f.vicinity.get(f.facilities.rows[0].key);f.zones.rows=[];f.power.rows=[];near.rows[0].record.end=now-1;let r=first(f);assert.equal(r.review,false);assert.equal(r.backlog.length,1);assert.equal(r.roads.length,0);
 near.rows[0].record.end=now+1000;r=first(f);assert(r.roadReview);assert.equal(r.roads.length,1);
});
test('unknown county codes, lifted zones, empty sources, missing road lookup and future utility windows keep their distinct meanings',()=>{
 assert.deepEqual(assessCareReviews({facilities:null},now),[]);
 const f=fixture('revised');f.vicinity=null;let r=first(f);assert(!r.review);assert(r.gaps.some(g=>/not ready/.test(g)));
 f.zones.rows[0].status='unknown';f.zones.rows[0].rawStatus='NEW_CODE';r=first(f);assert(r.evacuationReview);assert(!r.order&&!r.warning);
 const p=clear(fixture());p.power=fixture().power;p.power.rows.forEach(m=>{m.start.time=now+74*3600000;m.end.time=now+80*3600000;});r=first(p);assert(!r.powerReview);assert(r.power.matches.every(m=>m.outside));
});
test('nearby road lookup passes full geometries, metric radius, exclusions and cancellation to the shared backend',async()=>{
 const f=fixture(),calls=[];const query=async(point,entries,options)=>{calls.push({point,entries,options});return {'road-record':{rows:[],unknown:0}};};
 const result=await careRoadVicinity(f.facilities.rows,f.roads,query,{yieldTask:async()=>{}});assert.equal(result.size,1);assert.equal(calls[0].options.miles,1);assert.equal(calls[0].options.history,false);assert(calls[0].entries[0].geometry.paths);assert.equal(calls[0].entries[0].geometry.spatialReference.wkid,4326);
 assert.equal(await careRoadVicinity(f.facilities.rows,f.roads,query,{current:()=>false}),null);assert.equal(await careRoadVicinity(f.facilities.rows,null,query),null);let live=true;assert.equal(await careRoadVicinity(f.facilities.rows,f.roads,async()=>{live=false;return {'road-record':{rows:[],unknown:0}};},{current:()=>live}),null);
});
test('care review map uses only requested records by default and highlights returned utility polygons and nearby road geometry',async()=>{
 class Layer{constructor(p){Object.assign(this,p);this.graphics=[];}add(g){this.graphics.push(g);}removeAll(){this.graphics=[];}}class Graphic{constructor(p){Object.assign(this,p);}}
 const registered=[];const map=await createCareMap({registerLayer:(key,layer)=>registered.push({key,layer}),onViewChanged(){},getViewMode:()=> '2d',clearSearchSelection(){}},async()=>({import:async()=>[Layer,Graphic]}));
 const r=first(fixture());map.setSites([r.facility],[]);assert.equal(registered[0].layer.graphics.length,0);map.setSites([r.facility],[r]);assert.equal(registered[0].layer.graphics.length,1);assert.equal(registered[0].layer.graphics[0].attributes.careKey,r.key);
 map.setReview(r);const support=registered.at(-1).layer;assert(support.graphics.some(g=>g.geometry.type==='polyline'));assert(support.graphics.some(g=>g.geometry.type==='polygon'));map.clearSelection();assert.equal(support.graphics.length,0);
});


test('a previously nearby road is retained for verification when removed, or when its end date elapses; initial historical backlog alone does not flag resources',()=>{
 const original=fixture();const previous=new Map(assess(original).map(r=>[r.key,r]));
 const missing=fixture();missing.previous=previous;missing.vicinity.get(missing.facilities.rows[0].key).rows=[];let row=first(missing);assert.equal(row.roadFollowups.length,1);assert(row.roadReview);
 const pending=fixture();pending.previous=previous;pending.vicinity=null;const retained=new Map(assess(pending).map(r=>[r.key,r]));missing.previous=retained;row=first(missing);assert.equal(row.roadFollowups.length,1);
 const elapsed=fixture();elapsed.previous=previous;elapsed.vicinity.get(elapsed.facilities.rows[0].key).rows[0].record.end=now-1;row=first(elapsed);assert.equal(row.roadFollowups.length,1);
 elapsed.previous=new Map();row=first(elapsed);assert.equal(row.roadFollowups.length,0);
});
