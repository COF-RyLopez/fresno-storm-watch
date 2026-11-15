import test from 'node:test';
import assert from 'node:assert/strict';
import {createHoverPreview,mapFeatureName} from '../site/lib/map-hover.js';

const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function harness(overrides={}){
  const tasks=new Map(),shown=[],queries=[];let id=0,hidden=0,active=true;
  const controller=createHoverPreview({hitTest:event=>{queries.push(event);return Promise.resolve({results:[{graphic:{attributes:{name:event.name}}}]});},label:result=>mapFeatureName(result.results[0]?.graphic),show:(name,event)=>shown.push([name,event.x]),hide:()=>hidden++,active:()=>active,
    schedule:fn=>{tasks.set(++id,fn);return id;},cancelSchedule:id=>tasks.delete(id),...overrides});
  return {controller,shown,queries,tasks,get hidden(){return hidden;},setActive:value=>active=value,flush:async()=>{const list=[...tasks.values()];tasks.clear();for(const fn of list)await fn();}};
}

test('hover waits for a stable pointer, reads the latest visible feature, and does not navigate',async()=>{
  const h=harness();h.controller.move({x:10,y:20,name:'Millerton'});h.controller.move({x:30,y:20,name:'Pine Flat'});
  assert.equal(h.queries.length,0);assert.equal(h.tasks.size,1);
  await h.flush();assert.deepEqual(h.shown,[['Pine Flat',30]]);assert.equal(h.queries.length,1);
});

test('superseded hit tests cannot display stale names after pointer movement or leaving',async()=>{
  const pending=deferred(),h=harness({hitTest:()=>pending.promise});
  h.controller.move({x:10,y:10});const first=h.flush();
  h.controller.move({x:20,y:20});h.controller.cancel();pending.resolve({results:[{graphic:{attributes:{name:'Old reservoir'}}}]});await first;
  assert.equal(h.tasks.size,0);assert.deepEqual(h.shown,[]);
});

test('touch, dragging, inactive views and rejected hit tests leave normal click access intact',async()=>{
  const h=harness();for(const event of [{pointerType:'touch'},{native:{pointerType:'touch'}},{buttons:1}])h.controller.move({x:10,y:10,...event});
  assert.equal(h.tasks.size,0);h.setActive(false);h.controller.move({x:10,y:10});assert.equal(h.tasks.size,0);
  const bad=harness({hitTest:()=>Promise.reject(Error('view changed'))});bad.controller.move({x:1,y:1});await bad.flush();assert.deepEqual(bad.shown,[]);assert(bad.hidden>0);
});

test('view changes while a hit test is in flight clear the tooltip',async()=>{
  const pending=deferred(),h=harness({hitTest:()=>pending.promise});h.controller.move({x:1,y:1});const result=h.flush();h.setActive(false);pending.resolve({results:[{graphic:{attributes:{name:'Old view'}}}]});await result;assert.deepEqual(h.shown,[]);
});

test('feature names use plain publisher fields and resolved titles without evaluating templates',()=>{
  assert.equal(mapFeatureName({attributes:{NAME:'Pine Flat Dam'},popupTemplate:{title:'{NAME} · dam'}}),'Pine Flat Dam · dam');
  assert.equal(mapFeatureName({attributes:{name:'Millerton Lake',river:'San Joaquin'},popupTemplate:{title:'{name}'}}),'Millerton Lake');
  assert.equal(mapFeatureName({attributes:{terrainName:'Road 400 closure'}}),'Road 400 closure');
  assert.equal(mapFeatureName({attributes:{station:'Friant'},layer:{displayField:'station'}}),'Friant');
  assert.equal(mapFeatureName({attributes:{},popupTemplate:{title:'{missing} · dam'}}),'');
  assert.equal(mapFeatureName({visible:false,attributes:{name:'Hidden'}}),'');
  assert.equal(mapFeatureName({attributes:{name:'Label duplicate'},symbol:{type:'text'}}),'');
  assert.equal(mapFeatureName({attributes:{name:'<img src=x>'}}),'<img src=x>','Caller must render textContent, never publisher HTML.');
});
