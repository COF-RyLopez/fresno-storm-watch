import test from 'node:test';
import assert from 'node:assert/strict';
import {terrainBounds,terrainSnapshot,terrainAnchors,basinRoadEligible} from '../site/lib/watch-terrain-model.js';
import {powerScope} from '../site/lib/power-geometry.js';
const point=(key,x,y,kind='facility')=>({key,kind,name:key,geometry:{x,y,spatialReference:{wkid:4326}},color:'#abcdef',secret:'never copy'});
const focus={xmin:-119.34,ymin:36.82,xmax:-119.31,ymax:36.85,spatialReference:{wkid:4326}};
test('current county road segments crossing a basin are visible, while history and off-basin roads are omitted',()=>{
 const scope=powerScope({rings:[[[-120,36],[-119,36],[-119,37],[-120,37],[-120,36]]]});
 const closure={...point('closure',0,0,'road'),active:'yes',geometry:{paths:[[[-120.5,36.4],[-118.8,36.6]]],spatialReference:{wkid:4326}}};
 assert(basinRoadEligible(closure,scope,100));
 assert(!basinRoadEligible({...closure,active:'no'},scope,100));
 assert(!basinRoadEligible({...closure,end:99},scope,100));
 assert(!basinRoadEligible({...closure,geometry:{...closure.geometry,paths:[[[-120.5,37.1],[-118.8,37.2]]]}},scope,100));
 const detour={...closure,key:'detour',detour:true};
 const data=terrainSnapshot({target:focus,selected:[closure,detour,detour],roadStatus:{state:'old'}});
 assert.equal(data.roads,2);assert.equal(data.features[1].properties.detour,true);assert.equal(data.features[0].properties.color,'#a5a9ad');
});
test('terrain rejects unknown/projected CRS and malformed coordinates, preserving full bounds',()=>{
 assert.deepEqual(terrainBounds(focus),[-119.34,36.82,-119.31,36.85]);
 assert.equal(terrainBounds({...focus,spatialReference:{wkid:3857}}),null);
 assert.equal(terrainBounds({...focus,spatialReference:undefined}),null);
 assert.equal(terrainBounds({x:NaN,y:36,spatialReference:{wkid:4326}}),null);
});
test('separate parts of an outage remain visible, while duplicate parts and facility counts deduplicate',()=>{
 const a=point('outage',-119.325,36.833,'power'),b=point('outage',-119.326,36.834,'power');
 const f=point('building',-119.325,36.833),f2=point('building',-119.326,36.834);
 const data=terrainSnapshot({target:focus,selected:[a,b,a,f,f2]});
 assert.equal(data.features.length,4);assert.equal(new Set(data.features.map(f=>f.id)).size,4);assert.equal(data.facilities,1);
});
test('only the selected river owns its watchpoint proximity anchors',()=>{
 const points=[{longitude:-119.325,latitude:36.833}];
 assert.equal(terrainAnchors({type:'river',id:'a'},{id:'a'},points),points);
 assert.deepEqual(terrainAnchors({type:'river',id:'b'},{id:'a'},points),[]);
 assert.deepEqual(terrainAnchors({type:'asset',id:'a'},{id:'a'},points),[]);
});
test('large geographic outlines do not overflow bounds computation and malformed vertices reject',()=>{
 const paths=[Array.from({length:150000},(_,i)=>[-119+i/1000000,37])];
 assert.deepEqual(terrainBounds({paths,spatialReference:{wkid:4326}}),[-119,37,-118.850001,37]);
 assert.equal(terrainBounds({paths:[[null]],spatialReference:{wkid:4326}}),null);
});

import {EventEmitter} from 'node:events';
import {waitForTerrain} from '../site/lib/watch-terrain-ready.js';
test('initial tile failure cannot activate an incomplete map even if load follows',async()=>{
 const map=new EventEmitter(),loading=waitForTerrain(map,()=>assert.fail());
 const rejected=assert.rejects(loading,/Tile failed/);map.emit('error',{error:Error('Tile failed')});map.emit('load');await rejected;
});
test('a failed tile after successful startup reports runtime fallback',async()=>{
 const map=new EventEmitter(),errors=[],loading=waitForTerrain(map,e=>errors.push(e));map.emit('load');await loading;
 map.emit('webglcontextlost');assert.deepEqual(errors,['3D graphics context was lost']);
});
test('terrain context includes only nearby loaded records, deduplicates and allowlists properties',()=>{
 const selected=[point('selected',-119.325,36.833,'concern')],near=point('near',-119.326,36.834),far=point('far',-120,37);
 const data=terrainSnapshot({target:focus,selected,candidates:[near,near,far],anchors:[{longitude:-119.325,latitude:36.833}]});
 assert.deepEqual(data.features.map(f=>f.id),['selected','near']);assert.equal(data.facilities,1);
 assert(!JSON.stringify(data).includes('secret'));assert(!JSON.stringify(data).includes('never copy'));
 assert.equal(terrainSnapshot({target:focus,selected,candidates:[]}).facilities,0);
});
test('unknown geometry stays unknown; polygon boundaries retain holes without claiming a volume',()=>{
 const rings=[[[-119.33,36.83],[-119.32,36.83],[-119.32,36.84],[-119.33,36.83]],[[-119.328,36.832],[-119.327,36.832],[-119.327,36.833],[-119.328,36.832]]];
 const row={key:'footprint',kind:'facility',geometry:{rings,spatialReference:{wkid:4326}}};
 const data=terrainSnapshot({target:focus,selected:[row,{...row,key:'unknown',geometry:{...row.geometry,spatialReference:{wkid:2228}}}]});
 assert.equal(data.features.length,1);assert.deepEqual(data.features[0].geometry,{type:'MultiLineString',coordinates:rings});assert.equal(data.unknown,1);
});

import {createTerrainSession} from '../site/lib/watch-terrain-session.js';
test('clearing an in-flight terrain creation prevents late data rendering',async()=>{
 let resolve,painted=0,destroyed=0;const session=createTerrainSession({create:()=>new Promise(r=>resolve=r),activate(){painted++;},deactivate(){},failure(){}});
 const opening=session.open({bounds:[0,0,1,1]});session.clear();resolve({set(){painted++;},focus(){painted++;},destroy(){destroyed++;}});
 assert.equal(await opening,false);assert.equal(painted,0);assert.equal(destroyed,1);assert.equal(session.active,false);
});
test('renderer failure leaves a usable fallback without retaining a private payload',async()=>{
 let failures=0,restored=0;const session=createTerrainSession({create:async()=>{throw Error('WebGL unavailable');},activate(){assert.fail();},deactivate(){restored++;},failure(){failures++;}});
 assert.equal(await session.open({features:[{private:true}]}),false);assert.equal(failures,1);assert.equal(restored,1);assert.equal(session.active,false);
});
test('rapid selections sharing initialization paint only the latest request',async()=>{
 let resolve,destroyed=0;const rendered=[];const session=createTerrainSession({create:()=>new Promise(r=>resolve=r),activate(){},deactivate(){},failure(){assert.fail();}});
 const a=session.open({id:'old',bounds:[0,0,1,1]}),b=session.open({id:'new',bounds:[0,0,2,2]});
 resolve({set(d){rendered.push(d.id);},focus(){},destroy(){destroyed++;}});
 assert.equal(await a,false);assert.equal(await b,true);assert.deepEqual(rendered,['new']);assert.equal(destroyed,0);session.clear();assert.equal(destroyed,1);
});
test('clearing multiple pending selections disposes their shared renderer exactly once',async()=>{
 let resolve,destroyed=0;const session=createTerrainSession({create:()=>new Promise(r=>resolve=r),activate(){assert.fail();},deactivate(){},failure(){assert.fail();}});
 const a=session.open({bounds:[0,0,1,1]}),b=session.open({bounds:[0,0,2,2]});session.clear();
 resolve({set(){assert.fail();},focus(){assert.fail();},destroy(){destroyed++;}});
 assert.deepEqual(await Promise.all([a,b]),[false,false]);assert.equal(destroyed,1);
});
