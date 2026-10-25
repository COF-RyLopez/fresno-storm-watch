import {networkExercise} from '../site/lib/power-network-ui.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {NETWORK_SOURCES,NETWORK_MAX_AGE,normalizeNetworkFeature,validateNetworkSnapshot,matchPowerCircuit,networkGeometry,networkSymbol} from '../site/lib/power-network-model.js';
import {queryNetworkSource,collectNetwork} from '../site/lib/power-network-data.js';
import {normalizePower,deduplicatePower} from '../site/lib/power-model.js';
import {POWER_LAYERS} from '../site/lib/power-data.js';
import {WORKSPACES,workspaceDefaults} from '../site/lib/workspace-model.js';
import {createNetworkMap} from '../site/lib/power-network-map.js';
const now=Date.now(),spec=NETWORK_SOURCES.find(s=>s.id==='sce-circuits'),point={x:-119.4,y:37.1,spatialReference:{wkid:4326}},line={paths:[[[-119.45,37.08],[-119.4,37.1]]],spatialReference:{wkid:4326}};
const county={geometry:{type:'Polygon',coordinates:[[[-120,36],[-119,36],[-119,38],[-120,38],[-120,36]]]}};
const circuit=(a={})=>normalizeNetworkFeature({attributes:{objectid:1,circuit_id:'1234567',circuit_no:'00123',circt_nam:'Mountain',sub_name:'Example station',...a},geometry:line},spec,'objectid');
const station=()=>normalizeNetworkFeature({attributes:{objectid:2,subst_id:'ST1',sub_name:'Example station'},geometry:point},NETWORK_SOURCES.find(s=>s.id==='sce-substations'),'objectid');
const snapshot=()=>({schemaVersion:1,scope:'Fresno County 06019; whole intersecting features',generatedAt:new Date(now).toISOString(),sources:NETWORK_SOURCES.map(s=>({...s,features:s.id==='sce-circuits'?[circuit()]:s.id==='sce-substations'?[station()]:[],lastAttempt:new Date(now).toISOString(),lastSuccess:new Date(now).toISOString(),error:null,accounting:{selected:['sce-circuits','sce-substations'].includes(s.id)?1:0,returned:['sce-circuits','sce-substations'].includes(s.id)?1:0}}))});
const outage=(value='00123')=>normalizePower({attributes:{IncidentId:'TEST1',Status:'ACTIVE',Circuit_Number:value},geometry:point},POWER_LAYERS.find(l=>l.kind==='sce-outage'));
const psps=(name='Mountain')=>normalizePower({attributes:{GlobalID:'TEST2',CIRCUIT_NAME:name,PSPS:'Monitored'},geometry:point},POWER_LAYERS.find(l=>l.kind==='sce-psps'));

test('SCE circuit number and name match a single publisher circuit; leading zeros and punctuation remain significant',()=>{
  const d=validateNetworkSnapshot(snapshot());assert.equal(matchPowerCircuit(outage(),d,now).state,'matched');assert.equal(matchPowerCircuit(psps('  MOUNTAIN '),d,now).state,'matched');assert.equal(matchPowerCircuit(outage(),d,now).substations.length,1);
  for(const r of [outage('123'),outage(123),outage(''),psps('Mountain 12kV'),psps('Mountain-')])assert.equal(matchPowerCircuit(r,d,now).state,'unverified');
});
test('nearby geometry, inferred names and cross-utility identifiers never create a circuit connection',()=>{
  const d=snapshot();const noId={...outage(),networkCircuit:undefined};assert.equal(matchPowerCircuit(noId,d,now).state,'unverified');assert.equal(matchPowerCircuit({...outage(),utility:'PG&E'},d,now).state,'unverified');
  const c=circuit({circt_nam:null});d.sources.find(s=>s.id===spec.id).features=[c];assert.equal(matchPowerCircuit(psps(c.name),d,now).state,'unverified');
});
test('ambiguous circuit aliases, inconsistent IDs and source disagreements suppress verified highlighting',()=>{
  const d=snapshot(),s=d.sources.find(s=>s.id===spec.id);s.features.push(circuit({objectid:3,circuit_id:'OTHER'}));assert.equal(matchPowerCircuit(psps(),d,now).state,'unverified');
  s.features=[circuit(),circuit({objectid:3,circuit_no:'OTHER'})];assert.equal(matchPowerCircuit(outage(),d,now).state,'unverified');
  assert.equal(matchPowerCircuit({...outage(),issues:['Source representations differ; verify this record with the utility.']},snapshot(),now).state,'unverified');
});
test('failed or overdue references and stale outage checks cannot produce a verified match',()=>{
  for(const change of [{error:'Failed'},{lastSuccess:new Date(now-NETWORK_MAX_AGE-1).toISOString()},{lastSuccess:new Date(now+130000).toISOString()}]){const d=snapshot();Object.assign(d.sources.find(s=>s.id===spec.id),change);assert.equal(matchPowerCircuit(outage(),d,now).state,'unavailable');}
  assert.equal(matchPowerCircuit({...outage(),health:'Source overdue'},snapshot(),now).state,'unverified');assert.equal(matchPowerCircuit(outage(),null,now).state,'unavailable');
});
test('a matched circuit does not invent a missing or geographically ambiguous substation point',()=>{
  const d=snapshot(),s=d.sources.find(s=>s.id==='sce-substations');s.features.push({...station(),key:'sce-substations:3',geometry:{...point,x:point.x+.1}});assert.equal(matchPowerCircuit(outage(),d,now).substations.length,0);
  s.features=[];assert.equal(matchPowerCircuit(outage(),d,now).state,'matched');assert.equal(matchPowerCircuit(outage(),d,now).substations.length,0);
});
test('network geometry rejects wrong CRS, malformed lines and invalid coordinates without repair',()=>{
  assert.deepEqual(networkGeometry(line),line);for(const g of [null,{...line,spatialReference:{wkid:3857}},{paths:[[[1,2]]],spatialReference:{wkid:4326}},{...point,x:NaN}, {...point,x:500}])assert.throws(()=>networkGeometry(g));
  const pge=normalizeNetworkFeature({attributes:{OBJECTID:1,SAP_FUNC_LOC_NO:'T1',TLINE_NAME:'Reference line',RATEDKV:230,Last_Update_On_Map:now},geometry:line},NETWORK_SOURCES.find(s=>s.id==='pge-lines'),'OBJECTID');assert.equal(pge.name,'Reference line');assert.equal(pge.voltage,'230');assert.equal(pge.published,new Date(now).toISOString());
});
test('complete county inventory requests reconcile IDs, CRS and features and contain no credentials',async()=>{
  const calls=[];const fake=async(url,options)=>{const q=Object.fromEntries(options.body);calls.push(q);assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');assert(!('token' in q));let data;if(!url.endsWith('/query'))data={objectIdField:'objectid',geometryType:'esriGeometryPolyline',fields:spec.fields.split(',').map(name=>({name}))};else if(q.returnIdsOnly){assert.equal(q.geometryType,'esriGeometryPolygon');assert.deepEqual(JSON.parse(q.geometry).rings,[[[-120,36],[-120,38],[-119,38],[-119,36],[-120,36]]]);data={objectIds:[1]};}else data={spatialReference:{wkid:4326},features:[{attributes:{objectid:1,circuit_id:'1'},geometry:line}]};return {ok:true,json:async()=>data};};
  const d=await queryNetworkSource(spec,county,fake);assert.equal(d.features.length,1);assert.equal(calls.filter(q=>q.returnIdsOnly).length,2);assert(calls.some(q=>q.outSR==='4326'&&q.maxAllowableOffset==='0.00005'));assert.deepEqual(d.accounting,{selected:1,returned:1});
});
test('partial batches, repeated IDs, changed inventories and contradicting feature CRS are rejected',async()=>{
  for(const mode of ['partial','duplicate','changed','crs']){let n=0;const fake=async(url,o)=>{const q=Object.fromEntries(o.body);let data;if(!url.endsWith('/query'))data={objectIdField:'objectid',geometryType:'esriGeometryPolyline',fields:spec.fields.split(',').map(name=>({name}))};else if(q.returnIdsOnly)data={objectIds:mode==='duplicate'?[1,1]:mode==='changed'&&n++?[2]:[1]};else data={spatialReference:{wkid:4326},features:mode==='partial'?[]:[{attributes:{objectid:1},geometry:mode==='crs'?{...line,spatialReference:{wkid:3857}}:line}]};return {ok:true,json:async()=>data};};await assert.rejects(queryNetworkSource(spec,county,fake));}
});
test('source failure retains its last successful time and never turns missing coverage into current empty data',async()=>{
  const old=snapshot();const d=await collectNetwork({county,previous:old,now:now+1000,fetchImpl:async()=>{throw Error('offline');}});assert(d.sources.every(s=>s.error));assert.equal(d.sources[0].lastSuccess,old.sources[0].lastSuccess);assert.equal(d.sources.find(s=>s.id===spec.id).features.length,1);assert.equal(matchPowerCircuit(outage(),d,now+1000).state,'unavailable');
});
test('circuit association changes are revisions and contradictory representations stay explicit',()=>{
  assert.notEqual(deduplicatePower([outage('00123')])[0].revision,deduplicatePower([outage('00456')])[0].revision);const rows=deduplicatePower([outage('00123'),outage('00456')]);assert.equal(rows.length,1);assert(rows[0].issues.some(s=>s.startsWith('Source representations differ')));assert.equal(matchPowerCircuit(rows[0],snapshot(),now).state,'unverified');
});
test('network defaults are limited to Power and symbology never labels a line as energized or a fault',()=>{
  for(const id of Object.keys(WORKSPACES))for(const k of ['powerCircuits','powerLines','powerSubstations'])assert.equal(workspaceDefaults(id).layers[k],id==='power');
  assert.equal(networkSymbol(circuit()).style,'dash');assert.equal(networkSymbol({...circuit(),utility:'PG&E'}).style,'solid');assert.equal(networkSymbol(station()).style,'square');assert.equal(networkSymbol(circuit(),{highlight:true}).width,4);assert.notEqual(networkSymbol(circuit(),{dark:false}).color,networkSymbol(circuit()).color);
});
test('published network reconciles all sources, public geometry and stable display identities',async()=>{
  const d=validateNetworkSnapshot(JSON.parse(await readFile(new URL('../site/data/power-network.json',import.meta.url),'utf8')));assert(d.sources.every(s=>s.url.startsWith('https://')&&!s.url.includes('?')));assert(d.sources.filter(s=>s.features.length).every(s=>s.accounting.returned===s.accounting.selected));
  const broken=structuredClone(d);broken.sources[0].features.push({...broken.sources[0].features[0]});assert.throws(()=>validateNetworkSnapshot(broken));
});
test('map highlighting clears without changing references or navigating during refresh',()=>{
  const previousDocument=globalThis.document,previousWindow=globalThis.window;globalThis.document={documentElement:{dataset:{theme:'dark'}}};globalThis.window={addEventListener(){}};
  try{
    class Layer {constructor(p){Object.assign(this,p);this.graphics=[];}removeAll(){this.graphics=[];}addMany(list){this.graphics.push(...list);}}
    class Graphic {constructor(p){Object.assign(this,p);}}
    const registered=[],eligibility=new Map(),moves=[];const m=createNetworkMap({GraphicsLayer:Layer,Graphic,registerLayer:(key,layer)=>registered.push({key,layer}),setLayerEligibility:(layer,enabled)=>eligibility.set(layer,enabled),focusGeometry:g=>moves.push(g),onSelect(){}});
    const d=snapshot();m.setSnapshot(d);m.setMatch(matchPowerCircuit(outage(),d,now));const selected=registered.at(-1).layer;assert.equal(selected.graphics.length,1);assert.equal(selected.graphics[0].symbol.width,4);assert.equal(eligibility.get(selected),true);assert.equal(moves.length,0);m.clearMatch();assert.equal(selected.graphics.length,0);assert.equal(eligibility.get(selected),false);assert.equal(m.layers.circuit.graphics.length,1);m.focus([circuit().key]);assert.equal(moves[0].type,'extent');assert(moves[0].xmin<line.paths[0][0][0]);
  }finally{globalThis.document=previousDocument;globalThis.window=previousWindow;}
});

test('no-write exercise uses invented locations and a consistent station/circuit identity',()=>{
  const d=validateNetworkSnapshot(networkExercise(now)),m=matchPowerCircuit(psps('EXERCISE · mountain circuit'),d,now);assert.equal(m.state,'matched');assert.equal(m.substations.length,1);assert(m.circuits.every(f=>f.code.startsWith('EXERCISE-')));
});
