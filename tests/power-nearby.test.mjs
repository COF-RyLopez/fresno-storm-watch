import {test} from 'node:test';
import assert from 'node:assert/strict';
import {networkVicinityGeometry,powerNearbyCandidates,pumpInventoryProblem} from '../site/lib/power-nearby-model.js';
import {createPumpVicinityInventory} from '../site/lib/power-nearby-data.js';
const sr={wkid:4326},point={x:-119.7,y:36.92,spatialReference:sr};

test('vicinity uses full multipart network geometry and rejects partial or ambiguous CRS',()=>{
  const first={geometry:{paths:[[[-119.8,36.9],[-119.7,36.95]]],spatialReference:sr}},second={geometry:{paths:[[[-119.6,37],[-119.5,37.1]]],spatialReference:sr}};
  assert.deepEqual(networkVicinityGeometry([first,second]).paths,[...first.geometry.paths,...second.geometry.paths]);
  assert.deepEqual(networkVicinityGeometry([{geometry:point}]).x,point.x);
  assert.throws(()=>networkVicinityGeometry([first,{geometry:{...second.geometry,spatialReference:{wkid:3857}}}]));
  assert.throws(()=>networkVicinityGeometry([]));
});

test('private candidates exclude proposed pumps, retain source distinctions and quarantine conflicting duplicate IDs',()=>{
  const site={key:'site1',name:'A',geometry:point},pump={key:'pump1',name:'B',kind:'pump',category:'existing',geometry:point};
  const data=powerNearbyCandidates({sites:[{site},{site}]},{rows:[pump,{...pump,key:'future',category:'proposed'}]});
  assert.equal(data.entries.length,2);assert.equal(data.conflicts,0);assert.deepEqual(data.entries.map(r=>r.category),['facility','pump']);
  const bad=powerNearbyCandidates({sites:[{site},{site:{...site,geometry:{...point,x:-119.8}}}]},{rows:[pump]});
  assert.equal(bad.conflicts,1);assert.equal(bad.entries.length,1);assert.equal(bad.entries[0].category,'pump');
});

test('fresh retrieval never hides an overdue, failed or future source verification',()=>{
  const now=Date.now(),state={connected:true,checked:now,sourceChecked:now-1000,maxSourceAgeMs:60000};
  assert.equal(pumpInventoryProblem(state,now),null);
  assert.match(pumpInventoryProblem({...state,sourceChecked:now-120000},now),/Source inventory/);
  assert.match(pumpInventoryProblem({...state,refreshState:'failed'},now),/failure/);
  assert.match(pumpInventoryProblem({...state,checked:now+120000},now),/overdue/);
  assert.match(pumpInventoryProblem({connected:false},now),/not loaded/);
});

test('sign-out discards a late private read and closes its connection',async()=>{
  let resolveRead,closed=0;const states=[],controller=createPumpVicinityInventory({onChange:s=>states.push(s),open:async()=>({read:()=>new Promise(resolve=>{resolveRead=resolve;}),close:()=>closed++})});
  controller.setSession({username:'tester'});const request=controller.load();await new Promise(resolve=>setImmediate(resolve));
  controller.setSession(null);resolveRead({rows:[{key:'private-pump'}],sourceChecked:Date.now()});await request;
  assert.equal(closed,1);assert.deepEqual(controller.getState().rows,[]);assert.equal(controller.getState().connected,false);assert.equal(states.at(-1).rows.length,0);
});

test('late authorization after an account change is closed before reading private rows',async()=>{
  let resolveOpen,closed=0,reads=0;const controller=createPumpVicinityInventory({open:()=>new Promise(resolve=>{resolveOpen=resolve;})});
  controller.setSession({username:'first'});const request=controller.load();controller.setSession({username:'second'});
  resolveOpen({read:async()=>{reads++;return {rows:[]};},close:()=>closed++});await request;
  assert.equal(reads,0);assert.equal(closed,1);assert.deepEqual(controller.getState().rows,[]);
});

test('failed private refresh clears old rows instead of reusing them as current coverage',async()=>{
  let fail=false,closed=0;const controller=createPumpVicinityInventory({open:async()=>({read:async()=>{if(fail)throw Error('denied');return {rows:[{key:'private-pump'}],sourceChecked:Date.now()};},close:()=>closed++})});
  controller.setSession({username:'tester'});await controller.load();assert.equal(controller.getState().rows.length,1);
  fail=true;await controller.load();assert.equal(closed,1);assert.equal(controller.getState().connected,false);assert.deepEqual(controller.getState().rows,[]);assert.match(controller.getState().error,/could not be read/);
});
