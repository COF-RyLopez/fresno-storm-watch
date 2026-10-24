import test from 'node:test';
import assert from 'node:assert/strict';
import {pumpFormChoices,pumpFormCurrent,pumpFormLink} from '../site/lib/pump-form-model.js';
import {pumpSummaryExercise} from '../site/lib/pump-summary-exercise.js';
import {openDrainage} from '../site/lib/drainage-data.js';
import {DRAINAGE_LAYERS} from '../site/lib/drainage-model.js';
const now=Date.now(),data=pumpSummaryExercise(now),pump=data.snapshot.rows.find(r=>r.key==='fictional-pump');
test('standalone picker contains existing pumps only, retains ambiguous names by retrieval ID and filters codes',()=>{
  const rows=pumpFormChoices(data.snapshot.rows);assert.equal(rows.length,3);assert(rows.every(r=>r.kind==='pump'&&r.category==='existing'));assert.equal(pumpFormChoices(data.snapshot.rows,'EXERCISE-B')[0].name,'Fictional pump B');assert.equal(pumpFormChoices([...data.snapshot.rows,pump]).length,3);
  assert.throws(()=>pumpFormChoices([pump,{...pump,geometry:{...pump.geometry,x:pump.geometry.x+.001}}]),/Conflicting/);
});
test('expired, failed or rematched inventory prevents submitting to a stale selected pump',()=>{
  assert(pumpFormCurrent(pump,data.snapshot,now));
  for(const extra of [{checked:now-600001},{checked:now+61000},{connected:false},{error:'denied'},{rows:[]},{rows:[{...pump,key:'new-id'}]},{rows:[{...pump,code:'changed'}]},{rows:[{...pump,geometry:{...pump.geometry,x:pump.geometry.x+.00001}}]}])assert.equal(pumpFormCurrent(pump,{...data.snapshot,...extra},now),false);
  assert.equal(pumpFormCurrent(null,data.snapshot,now),false);
});
test('share links remove sign-in parameters, pump identity, contacts and fragments',()=>{
  const base='https://cof-rylopez.github.io/fresno-storm-watch/pump-readiness.html?code=PRIVATE&pump=private-pump&contact=private#selected';
  assert.equal(pumpFormLink(base),'https://cof-rylopez.github.io/fresno-storm-watch/pump-readiness.html');
  assert.equal(new URL(pumpFormLink(base,{exercise:true})).search,'?exercise=1');assert.equal(new URL(pumpFormLink(base,{acceptance:true})).search,'?acceptance=1');assert.throws(()=>pumpFormLink('https://person:secret@example.com/'));
});
test('standalone inventory reads only the fixed pump layer with authenticated POST and no edits',async()=>{
  const calls=[],spec=DRAINAGE_LAYERS.find(s=>s.kind==='pump'),config={enabled:true,orgId:'county',owner:'owner',groups:{viewers:'viewers'}},session={username:'owner',portal:{id:'county',user:{fetchGroups:async()=>[]}}};
  const request=async(url,options)=>{calls.push({url,options});if(!url.endsWith('/query'))return {data:{geometryType:spec.geometry,fields:[{name:'OBJECTID',type:'esriFieldTypeOID'},...spec.fields.map(name=>({name,type:'esriFieldTypeString'}))]}};if(options.query.returnIdsOnly)return {data:{objectIds:[1]}};return {data:{spatialReference:{wkid:4326},features:[{attributes:{OBJECTID:1,SUBTYPE:1,DA:'FICTIONAL'},geometry:{x:-119.7,y:36.9}}]}};};
  const adapter=await openDrainage(config,session,async()=>({import:async()=>[request]}));const rows=await adapter.readPumps();assert.equal(rows.length,1);assert(calls.every(c=>/MapServer\/0(?:\/query)?$/.test(c.url)&&c.options.method==='post'));assert(!calls.some(c=>/applyEdits/.test(c.url)));adapter.close();await assert.rejects(adapter.readPumps());
});
