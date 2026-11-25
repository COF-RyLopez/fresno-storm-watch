import test from 'node:test';
import assert from 'node:assert/strict';
import {createCommandWeather} from '../command/src/weather-controller.ts';
import {createForecastPlayback} from '../site/lib/command-weather-player.js';
import * as model from '../site/lib/command-model.js';
import {FakeElement,stubGlobals} from './helpers/dom.mjs';

const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const flush=async()=>{for(let i=0;i<12;i++)await new Promise(resolve=>setImmediate(resolve));};
class Element extends FakeElement {
  constructor(tag){super(tag);this.value='';this.type='';this.hidden=false;}
  append(...nodes){const empty=this.children.length===0;super.append(...nodes);if(this.tag==='select'&&empty)this.value=nodes[0]?.value??'';}
  querySelector(){return null;}
}
function setup(t,loadModule,{playback=createForecastPlayback}={}){
  const nodes=new Map();
  const document=Object.assign(new EventTarget(),{hidden:false,
    getElementById:id=>{if(!nodes.has(id))nodes.set(id,new Element('div'));return nodes.get(id);},
    createElement:tag=>new Element(tag),createTextNode:text=>({textContent:text}),
  });
  const phone=Object.assign(new EventTarget(),{matches:false});
  const restore=stubGlobals({document,location:{href:'https://example.test/command/'},
    matchMedia:query=>query.includes('max-width')?phone:{matches:false},Option:class extends Element{constructor(text,value){super('option');this.textContent=text;this.value=value;}}});
  const calls=[],notices=[];
  const map=new Proxy({}, {get:(_,method)=>(...args)=>calls.push([method,...args])});
  const state={view:'watch',mobile:'map'};
  let selection;
  const owner=createCommandWeather({root:new URL('https://example.test/'),moduleAt:loadModule,model,
    createForecastPlayback:playback,getMap:()=>map,ensureMap:async()=>{},getState:()=>state,getSelection:()=>selection,
    getTimeline:()=>null,updateMap:()=>{},renderEvidence:()=>{},pane:v=>state.mobile=v,
    requestFit:()=>{},notify:text=>notices.push(text),date:value=>String(value),
  });
  t.after(()=>{owner.destroy();restore();});
  return {owner,nodes,calls,notices,state,document,phone,setSelection:value=>selection=value};
}
const snowNow={IMS:'https://example.test/snow',loadSnowCover:async()=>({fileTime:1,url:'snow'})};

test('a late rejected import cannot clear the newer selected weather',async t=>{
  const old=deferred();let count=0;
  const h=setup(t,async()=>++count===1?old.promise:snowNow);
  const first=h.owner.select('gust');await flush();
  await h.owner.select('snow-now');
  old.reject(Error('old import failed'));await first;await flush();
  assert.equal(h.owner.snapshot.mode,'snow-now');
  assert.equal(h.nodes.get('weather-time').textContent,'Snow cover · source file 1');
  assert.deepEqual(h.notices,[]);
});

test('scope invalidation aborts requests and ignores their late successes',async t=>{
  const pending=deferred();let signal;
  const h=setup(t,async()=>({...snowNow,loadSnowCover:s=>{signal=s;return pending.promise;}}));
  const selected=h.owner.select('snow-now');await flush();
  h.owner.invalidateScope();assert.equal(signal.aborted,true);
  const count=h.calls.length;pending.resolve({fileTime:2});await selected;
  assert.equal(h.owner.snapshot.mode,'off');assert.equal(h.calls.length,count);
});

test('hidden initialization does not draw; resume draws retained evidence without restarting playback',async t=>{
  const pending=deferred();
  const h=setup(t,async()=>({...snowNow,loadSnowCover:()=>pending.promise}));
  const selected=h.owner.select('snow-now');await flush();
  h.document.hidden=true;h.document.dispatchEvent(new Event('visibilitychange'));
  pending.resolve({fileTime:3});await selected;
  assert.equal(h.calls.some(([m,v])=>m==='snowCover'&&v?.fileTime===3),false);
  h.document.hidden=false;h.document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(h.calls.some(([m,v])=>m==='snowCover'&&v?.fileTime===3),true);
});

test('destroy cancels pending work and unregisters visibility handling',async t=>{
  const pending=deferred();let signal;
  const h=setup(t,async()=>({...snowNow,loadSnowCover:s=>{signal=s;return pending.promise;}}));
  const selected=h.owner.select('snow-now');await flush();h.owner.destroy();
  assert.equal(signal.aborted,true);const count=h.calls.length;
  pending.resolve({fileTime:4});await selected;
  h.document.hidden=true;h.document.dispatchEvent(new Event('visibilitychange'));
  await h.owner.select('radar');
  assert.equal(h.calls.length,count);
});

test('navigation cancels an advisory lookup before it can select a product',async t=>{
  const pending=deferred();let signal;
  const h=setup(t,async()=>({snowAdvisoryCandidate:()=>true,loadSnowAdvisory:(_c,s)=>{signal=s;return pending.promise;}}));
  h.setSelection({id:'winter',kind:'alert',name:'Unclassified winter hazard'});
  h.owner.requestAutoplay('winter');h.owner.syncAdvisory();await flush();
  h.state.view='work';h.owner.suspend();h.owner.syncAdvisory();
  assert.equal(signal.aborted,true);
  pending.resolve({start:1,end:2});await flush();
  assert.equal(h.owner.snapshot.mode,'off');assert.deepEqual(h.notices,[]);
});

test('rain uses actual published frames; missing next frame stops playback, retaining the current dated map',async t=>{
  const timers=new Map();let sequence=0;
  const playback=options=>createForecastPlayback({...options,dwell:1,
    schedule:fn=>{const id=++sequence;timers.set(id,fn);return id;},cancel:id=>timers.delete(id)});
  let reads=0;
  const h=setup(t,async name=>{
    if(name==='watershed-timeline-model')return {precipitationTimeline:()=>({windows:[{layer:1,start:10,end:20}]})};
    if(name==='watch-watershed-data')return {regionalForecastBounds:[-131,28,-107,47],loadWatershedRain:async()=>{
      if(++reads>1)throw Error('missing frame');
      return {cycle:{hours:72,start:1,end:Date.now()+60000,issue:1},legend:[],blob:null};
    }};
    throw Error('Unexpected module '+name);
  },{playback});
  await h.owner.select('rain');
  const retained=h.calls.filter(([m,v])=>m==='rain'&&v).at(-1)[1];
  const play=h.nodes.get('weather-controls').children[0];
  play.onclick();await flush();
  assert.equal(play.textContent,'Play');
  assert.equal(h.nodes.get('weather-controls').children.at(-1).textContent,'Frame unavailable · playback stopped');
  assert.equal(h.calls.filter(([m,v])=>m==='rain'&&v).at(-1)[1],retained);
  assert.equal(timers.size,0);
  h.state.view='work';h.owner.suspend();
  assert.equal(h.calls.at(-1)[1],null);
  h.state.view='watch';h.owner.resume();
  assert.equal(h.calls.at(-1)[1],retained);
  assert.equal(play.textContent,'Play');
});

test('scope invalidation aborts the early-alert timeline fallback request',async t=>{
  const pending=deferred();let requestSignal;
  const h=setup(t,async name=> name==='watch-watershed-data'
    ? {regionalForecastBounds:[],loadWatershedRain:async()=>{throw Error('must not load');}}
    : {precipitationTimeline:()=>({windows:[]})});
  const restore=stubGlobals({fetch:(_url,{signal})=>{requestSignal=signal;return pending.promise;}});
  try {
    h.setSelection({id:'flood',kind:'alert',name:'Flood Advisory',alertTiming:{start:1,end:2}});
    h.owner.syncAdvisory();await flush();
    assert.ok(requestSignal);
    h.owner.invalidateScope();assert.equal(requestSignal.aborted,true);
    const count=h.calls.length;pending.resolve({ok:true,json:async()=>({})});await flush();
    assert.equal(h.calls.length,count);
  } finally {restore();}
});

test('narrowing to a hidden phone map suspends pending drawing and resumes when Map opens',async t=>{
  const pending=deferred();
  const h=setup(t,async()=>({...snowNow,loadSnowCover:()=>pending.promise}));
  h.state.mobile='attention';
  const selected=h.owner.select('snow-now');await flush();
  h.phone.matches=true;h.phone.dispatchEvent(new Event('change'));
  pending.resolve({fileTime:5});await selected;
  assert.equal(h.calls.some(([m,v])=>m==='snowCover'&&v?.fileTime===5),false);
  h.state.mobile='map';h.owner.resume();
  assert.equal(h.calls.some(([m,v])=>m==='snowCover'&&v?.fileTime===5),true);
});

test('radar has one adapter, closes when switching and does not resume after destruction',async t=>{
  const events=[];let installs=0;
  const h=setup(t,async name=>name==='command-snow'?snowNow:{installRegionalRadar:()=>{
    installs++;
    return {controls:new Element('div'),cloudButton:new Element('button'),cloudStatus:new Element('p'),cloudLegend:new Element('div'),
      open:()=>events.push('open'),close:()=>events.push('close'),suspend:()=>events.push('suspend'),
      resume:()=>events.push('resume'),viewportChanged:()=>events.push('viewport')};
  }});
  await h.owner.select('radar');h.owner.viewportChanged();
  h.owner.suspend();h.owner.resume();
  assert.deepEqual(events,['open','viewport','suspend','resume']);
  await h.owner.select('snow-now');assert.equal(events.at(-1),'close');
  await h.owner.select('radar');assert.equal(installs,1);
  h.owner.destroy();const count=events.length;
  h.document.hidden=true;h.document.dispatchEvent(new Event('visibilitychange'));
  h.owner.viewportChanged();await h.owner.select('radar');
  assert.equal(events.length,count);
});
