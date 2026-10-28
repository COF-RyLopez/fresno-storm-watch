import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {normalizeSupplyFeatures,inspectionAge,correlateDwrSupplies} from '../site/lib/dwr-supply-planning-model.js';
import {planningPoints} from '../site/lib/planning-model.js';

const now=Date.parse('2026-10-28T23:00:00Z');
const geometry={x:-120,y:36.7,spatialReference:{wkid:4326}};
const feature=(a={},g=geometry)=>({attributes:{Location_ID:' 5-5 ',County:'Fresno',Location:'Test supply',Inspection_Date:1727740800000,...a},geometry:g});
const points=[{id:'near',name:'Nearby gauge',longitude:-120,latitude:36.72},{id:'far',name:'Far gauge',longitude:-120,latitude:37.7}];
const planning={points,rows:[{area:{id:'reach',name:'River reach',rainPoints:['near','far']},status:'Rain forecast — monitor',rainfall:{usable:true,maximum:0,cycle:{start:now,end:now+86400000,issue:now}}}]};
const road=(key='one',options={})=>({key,revision:'r1',name:'Test road',kind:'Road closure',active:'yes',sourceTime:now,start:now-3600000,end:now+3600000,issues:[],status:'Published active',geometry:{paths:[[[-120,36.6],[-120,36.8]]],spatialReference:{wkid:4326}},...options});
const args=(rows=[])=>({supplies:{loaded:true,rows:normalizeSupplyFeatures([feature()]),checked:now},planning,roads:{snapshot:{rows,checked:now}}});

test('DWR supply identity is stable, trimmed, Fresno-only and requires geographic point geometry',()=>{
  const [row]=normalizeSupplyFeatures([feature()]);assert.equal(row.key,'dwr-supply:5-5');assert.equal(row.availability,'unverified');assert.equal(row.inventory.burlap,null);
  for(const features of [[feature({County:'Kings'})],[feature({Location_ID:''})],[feature(),feature()],[feature({}, {...geometry,spatialReference:{wkid:3857}})],[feature({}, {rings:[]})]])assert.throws(()=>normalizeSupplyFeatures(features));
});
test('old, unknown and future inspection dates remain warnings even when the feed is fresh',()=>{
  assert(inspectionAge(1727740800000,now).days>730);assert.equal(inspectionAge(1727740800000,now).warning,true);
  assert.equal(inspectionAge(null,now).days,null);assert.match(inspectionAge(null,now).label,/unknown/);
  assert.match(inspectionAge(now+86400000,now).label,/Future/);assert.match(inspectionAge(now,now).label,/availability still unverified/);
});
test('links use nearby configured watchpoints only, preserving zero rainfall and excluding far points in the same reach',()=>{
  const result=correlateDwrSupplies(args(),now),area=result.rows[0].areas[0];
  assert.equal(result.total,1);assert.equal(area.id,'reach');assert(area.meters>2000&&area.meters<2500);assert.deepEqual(area.points.map(p=>p.id),['near']);assert.equal(area.rainfall.maximum,0);
  const missing=args();missing.planning={...planning,rows:[{...planning.rows[0],rainfall:{usable:false,maximum:9}}]};assert.equal(correlateDwrSupplies(missing,now).rows[0].areas[0].rainfall.maximum,null);
});
test('proximity considers the entire road geometry, retains elapsed active records and does not treat source inactivity as open',()=>{
  const result=correlateDwrSupplies(args([road(),road('elapsed',{end:now-1,issues:['End date elapsed; reopening not confirmed']}),road('inactive',{active:'no'}),road('unknown',{active:null}),road('future',{start:now+100000,status:'Scheduled in source'})]),now);
  const rows=result.rows[0].roads;assert.equal(rows.length,4);assert(rows[0].siteMeters<1);assert.equal(rows.find(r=>r.row.key==='elapsed').verification,true);assert.equal(rows.find(r=>r.row.key==='unknown').verification,true);assert.equal(rows.find(r=>r.row.key==='one').verification,false);assert(rows.some(r=>r.row.key==='future'));
});
test('roads near a linked gauge are distinguished from roads near the supply, and far reach points do not broaden context',()=>{
  const input=args([road('gauge',{geometry:{x:-120,y:36.76}}),road('far',{geometry:{x:-120,y:37.7}})]);
  const rows=correlateDwrSupplies(input,now).rows[0].roads;assert.equal(rows.length,1);assert.equal(rows[0].siteMeters,null);assert(rows[0].areaMeters<5000);assert.equal(rows[0].pointName,'Nearby gauge');
});
test('duplicate road revisions are counted once; conflicting revisions and invalid geometry are excluded with coverage counts',()=>{
  const input=args([road(),road(),road('conflict'),road('conflict',{revision:'r2'}),road('bad',{geometry:{x:-120,y:36,spatialReference:{wkid:3857}}})]);
  const result=correlateDwrSupplies(input,now);assert.equal(result.rows[0].roads.length,1);assert.equal(result.roadConflicts,1);assert.equal(result.roadRejected,1);
});
test('feed failure and staleness cannot confirm stock, road access or a fresh inspection',()=>{
  const input=args([road()]);input.roads.error='Unavailable';input.supplies.checked=now-500000;
  let result=correlateDwrSupplies(input,now);assert.equal(result.supplyCurrent,false);assert.equal(result.roadCurrent,false);assert.equal(result.rows[0].roads[0].verification,true);assert.equal(result.rows[0].site.availability,'unverified');
  input.supplies.error='Failed';result=correlateDwrSupplies(input,now);assert.equal(result.rows.length,0);assert.equal(result.supplyError,'Failed');
});
test('area filters do not inflate unique source counts or claim supplies absent outside coverage',()=>{
  const input=args();input.areaId='elsewhere';const result=correlateDwrSupplies(input,now);assert.equal(result.total,1);assert.equal(result.rows.length,0);
  assert.throws(()=>correlateDwrSupplies({...args(),radiusKm:999},now));
  const empty=correlateDwrSupplies({supplies:null,planning:null,roads:null},now);assert.equal(empty.loaded,false);assert.equal(empty.planningReady,false);assert.equal(empty.roadCurrent,false);
});
test('default 25 km links Fresno supply locations to the existing James Bypass, San Joaquin and Kings watchpoints',async()=>{
  const read=async name=>JSON.parse(await readFile(new URL('../site/data/'+name+'.json',import.meta.url),'utf8'));
  const [areas,gauges,reservoirs]=await Promise.all(['river-areas','river-watchlist','reservoir-watchlist'].map(read));
  const input={supplies:{loaded:true,checked:now,rows:normalizeSupplyFeatures([feature({}, {x:-120.250125,y:36.651172}),feature({Location_ID:'5-6',Location:'Sanger'}, {x:-119.537318,y:36.688532})])},planning:{rows:areas.areas.map(area=>({area})),points:planningPoints(areas,gauges.stations,reservoirs.stations)}};
  const result=correlateDwrSupplies(input,now);assert.deepEqual(result.rows[0].areas.map(a=>a.id).sort(),['james-bypass','san-joaquin-lower']);assert.deepEqual(result.rows[1].areas.map(a=>a.id),['kings-lower']);
});
