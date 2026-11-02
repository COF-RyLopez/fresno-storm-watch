import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateFleet,unitName,fleetSummary,repairPriority,passTone,needsPass,passExpression} from '../site/lib/snow-fleet-model.js';
import {fleetQuestions} from '../site/lib/planning-questions-model.js';

const sample=JSON.parse(readFileSync(new URL('../site/data/snow-fleet/sample.json',import.meta.url)));
const base={schemaVersion:1,generatedAt:'2026-12-14T15:20:00Z',delayMinutes:15,source:'test',routes:[],accounting:{noGps:2}};
const unit=o=>({id:'52701',type:'plow-truck',status:'off',seen:'2026-12-14T15:00:00Z',lon:-119.3,lat:37.1,trail:[],...o});

test('the Oct 29 sample validates: 6 published, 43102 and 43103 in the shop, 4 available, 21 not reporting',()=>{
  const f=validateFleet(sample);
  assert.equal(f.sample,true);assert.equal(f.vehicles.length,6);
  assert.deepEqual(fleetSummary(f),{available:4,inShop:2,notReporting:21,byType:[{type:'plow-truck',label:'Plow truck',available:2,inShop:2},{type:'snow-blower',label:'Snow blower',available:2,inShop:0}]});
  assert.deepEqual(repairPriority(f).map(v=>v.id),['43102','43103']);
});

test('equipment IDs stay strings with their leading zeros; a bare number or empty id is rejected',()=>{
  assert.equal(validateFleet(sample).vehicles.find(v=>v.yard==='Area 11').id,'03107');
  assert.throws(()=>validateFleet({...base,vehicles:[unit({id:3107})]}),/equipment ID/);
  assert.throws(()=>validateFleet({...base,vehicles:[unit({id:''})]}),/equipment ID/);
  assert.equal(unitName({id:'03107',type:'plow-truck'}),'Plow truck 03107');
});

test('only allowed fields survive: a driver name or odometer in the file is dropped',()=>{
  const f=validateFleet({...base,vehicles:[unit({driver:'Jane Doe',odometer:12345})]});
  assert.equal(JSON.stringify(f).includes('Jane'),false);assert.equal('odometer' in f.vehicles[0],false);
});

test('the published delay is enforced: a position newer than generatedAt − delay loses its location, not its status',()=>{
  const f=validateFleet({...base,vehicles:[unit({seen:'2026-12-14T15:15:00Z'})]});
  assert.equal(f.tooRecent,1);assert.equal(f.vehicles[0].lon,null);assert.equal(f.vehicles[0].status,'off');
  assert.throws(()=>validateFleet({...base,delayMinutes:5,vehicles:[]}),/at least 15 minutes/);
  assert.throws(()=>validateFleet({...base,vehicles:[unit({type:'tank'})]}),/unknown equipment type/);
  assert.throws(()=>validateFleet({...base,vehicles:[unit(),unit()]}),/Duplicate/);
  assert.equal(validateFleet({...base,vehicles:[unit({lon:-100})]}).vehicles[0].lon,null);// outside the county: not drawn
});

test('repair priority: plows before blowers, then earliest expected return, unknown last',()=>{
  const f=validateFleet({...base,vehicles:[unit({id:'48256',type:'snow-blower',status:'in-shop',expectedBack:'2026-12-15T00:00:00Z'}),
    unit({id:'43103',status:'in-shop'}),unit({id:'03107',status:'in-shop',expectedBack:'2026-12-16T00:00:00Z'}),unit({id:'52701'})]});
  assert.deepEqual(repairPriority(f).map(v=>v.id),['03107','43103','48256']);
});

test('route last pass: tones, needs-a-pass list and a safely quoted renderer expression',()=>{
  const now=Date.parse('2026-12-14T15:00:00Z'),h=n=>new Date(now-n*3600000).toISOString();
  assert.equal(passTone(h(1),now),'fresh');assert.equal(passTone(h(3),now),'recent');assert.equal(passTone(h(9),now),'stale');assert.equal(passTone(null,now),'none');
  const routes=[{name:'AUBERRY',priority:1,lastPass:h(8)},{name:'ALVA SNOW',priority:2,lastPass:null},{name:'TOLLHOUSE',priority:1,lastPass:h(1)},{name:'ASPEN',priority:9,lastPass:null}];
  assert.deepEqual(needsPass(routes,now).map(r=>r.name),['AUBERRY','ALVA SNOW']);
  const expr=passExpression([{name:'O"BRIEN',lastPass:h(1)},{name:'X',lastPass:null}],now);
  assert.equal(expr,`Decode($feature.name, "O\\"BRIEN", "fresh", 'none')`);
  assert.equal(passExpression([],now),null);
});

test('planning asks Fleet Services about every unit in the shop',()=>{
  const q=fleetQuestions(validateFleet(sample));
  assert.deepEqual(q.map(x=>x.title),['When will plow truck 43102 be back from the shop?','When will plow truck 43103 be back from the shop?']);
  assert.match(q[0].detail,/4 of 6 reporting snow units are available/);assert.equal(q[0].owner,'County Fleet Services');
  assert.deepEqual(fleetQuestions(null),[]);
});
