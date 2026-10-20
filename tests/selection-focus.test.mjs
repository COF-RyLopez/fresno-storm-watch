import test from 'node:test';
import assert from 'node:assert/strict';
import {createSelectionFocus,validLocation,searchDestination} from '../site/lib/selection-focus.js';

const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
test('small and multipart lake outlines fit their full padded extent, without a point-scale cutoff',()=>{
  let expanded;
  const extent={clone:()=>({expand:n=>{expanded=n;return 'padded-full-outline';}})};
  const polygon={type:'polygon',extent};
  assert.deepEqual(searchDestination(polygon,'3d'),{target:'padded-full-outline',tilt:0,heading:0});assert.equal(expanded,1.25);
  assert.deepEqual(searchDestination(polygon,'2d'),{target:'padded-full-outline'});
  assert.equal(searchDestination({type:'point'},'2d').scale,12000);
});
function harness(overrides={}){
  const events=[],state={workspace:1,type:'2d'};
  const focus=createSelectionFocus({workspace:()=>state.workspace,ready:()=>Promise.resolve(),
    setMode:async mode=>{events.push(['mode',mode]);state.type=mode;},view:()=>({type:state.type,animation:{stop:()=>events.push(['stop'])}}),
    navigate:async target=>events.push(['navigate',target]),save:()=>events.push(['save']),missing:()=>events.push(['missing']),failed:()=>events.push(['failed']),...overrides});
  return {focus,state,events};
}
test('selection builds its destination in the active 3D view and saves after navigation',async()=>{
  const {focus,events}=harness();await focus.focus(type=>({location:'Friant',type}));
  assert.deepEqual(events,[['stop'],['mode','3d'],['navigate',{location:'Friant',type:'3d'}],['save']]);
});
test('latest selection wins when 3D initialization is deferred',async()=>{
  const mode=deferred(),h=harness({setMode:()=>mode.promise});
  const first=h.focus.focus(()=>({location:'Millerton'}));await Promise.resolve();
  const last=h.focus.focus(()=>({location:'Pine Flat'}));mode.resolve();await Promise.all([first,last]);
  assert.deepEqual(h.events.filter(e=>e[0]==='navigate'),[['navigate',{location:'Pine Flat'}]]);
});
test('workspace changes and manual cancellation invalidate delayed selections',async()=>{
  for(const change of [h=>h.state.workspace++,h=>h.focus.cancel()]){
    const ready=deferred(),h=harness({ready:()=>ready.promise}),pending=h.focus.focus(()=>({location:'old'}));
    change(h);ready.resolve();await pending;assert(!h.events.some(e=>e[0]==='navigate'||e[0]==='mode'));
  }
});
test('failed 3D initialization retains a usable 2D destination',async()=>{
  const h=harness({setMode:async()=>{}});await h.focus.focus(type=>({location:'road',...(type==='3d'?{tilt:45}:{})}));
  assert.deepEqual(h.events.find(e=>e[0]==='navigate'),['navigate',{location:'road'}]);
});
test('a withdrawn authorized location is checked again after 3D initialization',async()=>{
  const mode=deferred(),h=harness({setMode:()=>mode.promise});let authorized=true;
  const pending=h.focus.focus(()=>authorized?{location:'protected site'}:null);await Promise.resolve();
  authorized=false;mode.resolve();await pending;
  assert(h.events.some(e=>e[0]==='missing'));assert(!h.events.some(e=>e[0]==='navigate'));
});
test('missing location never switches modes or changes position; errors remain visible',async()=>{
  const h=harness();await h.focus.focus(()=>null);assert.deepEqual(h.events,[['stop'],['missing']]);
  const bad=harness({navigate:async()=>{throw new Error('view failed');}});await bad.focus.focus(()=>({location:'site'}));
  assert(bad.events.some(e=>e[0]==='failed'));assert(!bad.events.some(e=>e[0]==='save'));
  for(const value of [null,{}, {longitude:null,latitude:37},{longitude:NaN,latitude:37},{longitude:181,latitude:37}])assert(!validLocation(value));
  assert(validLocation({longitude:-119.705,latitude:37.001}));
});


test('cancelling during the layout-settle phase prevents a stale full-outline navigation',async()=>{
  const layout=deferred(),h=harness({settled:()=>layout.promise});
  const pending=h.focus.focus(()=>({location:'lake'}));await new Promise(resolve=>setImmediate(resolve));
  h.focus.cancel();layout.resolve();await pending;
  assert(!h.events.some(event=>event[0]==='navigate'||event[0]==='save'));
});
