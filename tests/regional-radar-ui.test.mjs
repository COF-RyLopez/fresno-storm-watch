import test from 'node:test';
import assert from 'node:assert/strict';
import {installRegionalRadar} from '../site/lib/watch-regional-radar-ui.js';
import {FakeElement,stubGlobals} from './helpers/dom.mjs';
const settle=()=>new Promise(r=>setImmediate(r));

function harness(t,{loadCatalog,loadImage}={}){
 const restore=stubGlobals({document:{createElement:tag=>new FakeElement(tag),createTextNode:t=>t,hidden:false},matchMedia:()=>({matches:true})});
 const frames=[{time:Date.now()-10*60000},{time:Date.now()-60000}],state={draws:[],loads:[],observed:[],cloud:false,bounds:[-120,35,-118,38]},info=new FakeElement();
 const view=installRegionalRadar({session:{regionalRadar:image=>state.draws.push(image),viewBounds:()=>state.bounds},info,items:new FakeElement(),visible:()=>true,source:()=>new FakeElement(),renderColors(){},
  loadCatalog:signal=>loadCatalog?loadCatalog(signal,frames):Promise.resolve({frames,legend:[],gaps:false}),
  loadImage:async(frame,signal,options)=>{state.loads.push({...options,frame});return loadImage?loadImage(frame,signal,options):{time:frame.time};},
  cloudFactory:()=>({button:new FakeElement(),status:new FakeElement(),legend:new FakeElement(),open(){state.cloud=true;},close(){state.cloud=false;},observe:async time=>{state.observed.push(time);},cancelPending(){}})
 });
 t.after(()=>{view.close();restore();});return {view,state,frames,info};
}
test('a camera move during the first radar image load extends coverage without changing observation',async t=>{
 let release;const first=new Promise(r=>release=r);let calls=0;
 const h=harness(t,{loadImage:async frame=>{if(++calls===1)await first;return {time:frame.time};}});
 h.view.open();await settle();h.state.bounds=[-140,33,-134,41];h.view.viewportChanged();release();await settle();await settle();
 assert(h.state.loads.length>=2);assert(h.state.loads.at(-1).bounds[0]<=-140);assert.equal(h.state.draws.at(-1).time,h.frames.at(-1).time);
});

test('playback controls cannot cancel the only catalog before a player exists',async t=>{
 let release,signal;const h=harness(t,{loadCatalog:async(s,frames)=>{signal=s;await new Promise(r=>release=r);return {frames,legend:[],gaps:false};}});
 h.view.open();await settle();const [play,slider]=h.view.controls.children;
 assert.equal(play.disabled,true);assert.equal(slider.disabled,true);play.onclick();slider.oninput();assert.equal(signal.aborted,false);
 release();await settle();await settle();assert.equal(h.state.draws.at(-1).time,h.frames.at(-1).time);assert.equal(play.disabled,false);
});
test('scrubbing into replay cancels a pending follow catalog and cannot be replaced by its late result',async t=>{
 let release,calls=0,signal;
 const h=harness(t,{loadCatalog:async(s,frames)=>{if(++calls===2){signal=s;await new Promise(r=>release=r);}return {frames,legend:[],gaps:false};}});
 h.view.open();await settle();h.view.controls.children[2].onclick();await settle();
 const slider=h.view.controls.children[1];slider.value='0';slider.oninput();await settle();
 assert.equal(signal.aborted,true);release();await settle();await settle();assert.equal(h.state.draws.at(-1).time,h.frames[0].time);
});
test('replay resume retries paired clouds and expiry removes both radar and satellite imagery',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date'],now:Date.parse('2026-11-19T20:00Z')});
 const h=harness(t);h.view.open();await settle();const slider=h.view.controls.children[1];slider.value='0';slider.oninput();await settle();
 const count=h.state.observed.length;h.view.suspend();h.view.resume();await settle();assert(h.state.observed.length>count);
 t.mock.timers.tick(121*60000);assert.equal(h.state.cloud,false);assert.equal(h.state.draws.at(-1),null);
});
test('reduced motion starts at latest observation; extending map coverage retains its clock and bounded rendering',async()=>{
 const restore=stubGlobals({document:{createElement:tag=>new FakeElement(tag),createTextNode:t=>t,hidden:false},matchMedia:()=>({matches:true})});
 const info=new FakeElement(),items=new FakeElement(),draws=[],loads=[];
 const frames=[{time:Date.now()-10*60000},{time:Date.now()-60000}];let bounds=[-120,35,-118,38],catalogCalls=0;
 const view=installRegionalRadar({session:{regionalRadar:image=>draws.push(image),viewBounds:()=>bounds},info,items,visible:()=>true,source:()=>new FakeElement(),renderColors(){},
  loadCatalog:async()=>{catalogCalls++;return {frames,legend:[],gaps:false};},
  loadImage:async(frame,signal,options)=>{loads.push({frame,bounds:[...options.bounds]});return {time:frame.time};},
  cloudFactory:(_session,options)=>{assert.equal(options.allowSurface,false);return {button:new FakeElement(),status:new FakeElement(),legend:new FakeElement(),open(){},close(){},observe:async()=>{},cancelPending(){}};}
 });
 try{
  view.open({autoplay:true});await settle();await settle();assert.equal(draws.at(-1).time,frames.at(-1).time);assert.match(info.textContent,/Observed/);
  view.viewportChanged();assert.equal(loads.length,1);
  bounds=[-140,33,-134,41];view.viewportChanged();await settle();await settle();
  assert.equal(catalogCalls,1);assert.equal(loads.at(-1).frame.time,frames.at(-1).time);assert(loads.at(-1).bounds[0]<=-140);
  assert.match(info.textContent,/Observed/);view.suspend();view.close();assert.equal(draws.at(-1),null);
 }finally{view.close();restore();}
});
