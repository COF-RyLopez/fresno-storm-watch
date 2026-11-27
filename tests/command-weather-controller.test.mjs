import test from 'node:test';
import assert from 'node:assert/strict';
import {createCommandWeather} from '../command/src/weather-controller.ts';
import {createForecastPlayback} from '../site/lib/command-weather-player.js';
import * as model from '../site/lib/command-model.js';
import {createForecastTimeline} from '../site/lib/forecast-timeline.js';
import {rainForecastWindows} from '../site/lib/command-rain.js';
import {FakeElement,stubGlobals} from './helpers/dom.mjs';

const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const flush=async()=>{for(let i=0;i<12;i++)await new Promise(resolve=>setImmediate(resolve));};
class Element extends FakeElement {
  constructor(tag){super(tag);this.value='';this.type='';this.hidden=false;}
  append(...nodes){const empty=this.children.length===0;super.append(...nodes);if(this.tag==='select'&&empty)this.value=nodes[0]?.value??'';}
  querySelector(){return null;}
}
function setup(t,loadModule,{playback=createForecastPlayback,rainFactory,timelineModule=async()=>({createForecastTimeline}),mapMethods={}}={}){
  const nodes=new Map();
  const document=Object.assign(new EventTarget(),{hidden:false,
    getElementById:id=>{if(!nodes.has(id))nodes.set(id,new Element('div'));return nodes.get(id);},
    createElement:tag=>new Element(tag),createTextNode:text=>({textContent:text}),
  });
  const phone=Object.assign(new EventTarget(),{matches:false});
  const restore=stubGlobals({document,location:{href:'https://example.test/command/'},
    matchMedia:query=>query.includes('max-width')?phone:{matches:false},Option:class extends Element{constructor(text,value){super('option');this.textContent=text;this.value=value;}}});
  const calls=[],notices=[];
  const map=new Proxy({}, {get:(_,method)=>(...args)=>{calls.push([method,...args]);return mapMethods[method]?.(...args);}});
  const state={view:'watch',mobile:'map'};
  let selection;
  const moduleAt=async name=>name==='forecast-timeline'?timelineModule():name==='command-rain'?{rainForecastWindows:rainFactory?rainForecastWindows:(prepared,windows)=>prepared??windows,RAIN_REFRESH_INTERVAL:15*60000,createCommandRainDelivery:rainFactory??(async()=>{
    const source=await loadModule('watch-watershed-data');
    return {windows:null,load:(window,signal)=>source.loadWatershedRain(source.regionalForecastBounds,{window,signal}),validate:async()=>{},destroy(){}};
  })}:loadModule(name);
  const owner=createCommandWeather({root:new URL('https://example.test/'),moduleAt,model,
    createForecastPlayback:playback,getMap:()=>map,ensureMap:async()=>{},getState:()=>state,getSelection:()=>selection,
    getTimeline:()=>null,updateMap:()=>{},renderEvidence:()=>{},pane:v=>state.mobile=v,
    requestFit:()=>{},notify:text=>notices.push(text),date:value=>String(value),
  });
  t.after(()=>{owner.destroy();restore();});
  return {owner,nodes,calls,notices,state,document,phone,setSelection:value=>selection=value};
}
const snowNow={IMS:'https://example.test/snow',loadSnowCover:async()=>({fileTime:1,url:'snow'})};

test('rain waits for the map before changing time and reuses its unchanged legend DOM',async t=>{
 const gate=deferred();let delayed=true;
 const now=Date.now(),window={layer:14,issue:now-60000,start:now,end:now+6*3600000};
 const h=setup(t,async()=>({precipitationTimeline:()=>({windows:[]})}),{
  mapMethods:{rain:value=>value&&delayed?gate.promise:undefined},
  rainFactory:async()=>({windows:[window],validate:async()=>{},destroy(){},load:async w=>({
   cycle:{...window,hours:w?6:72},legend:[{value:.25,color:'rgb(1,2,3)'}],blob:null})})});
 const selected=h.owner.select('rain');await flush();
 assert.doesNotMatch(h.nodes.get('weather-time').textContent,/72-hour rain/);
 delayed=false;gate.resolve(true);await selected;
 const legend=h.nodes.get('weather-legend').children[1];
 const slider=h.nodes.get('weather-controls').children.find(n=>n.className==='forecast-timeline').children.find(n=>n.tag==='input');
 slider.value='1';slider.oninput();await flush();
 assert.match(h.nodes.get('weather-time').textContent,/6-hour rain/);
 // Different duration changes the title; selecting the same six-hour frame again does not rebuild the key.
 const sixHourLegend=h.nodes.get('weather-legend').children[1];
 slider.oninput();await flush();assert.equal(h.nodes.get('weather-legend').children[1],sixHourLegend);
 assert(legend);assert.equal(h.nodes.get('weather-controls').children.at(-1).hidden,false);
});

for(const product of ['gust','rain'])test(`late empty ${product} timeline cannot overwrite a newly selected snow product`,async t=>{
 const pending=deferred();
 const h=setup(t,async name=>name==='command-snow'?snowNow:name==='watershed-timeline-model'?{precipitationTimeline:()=>({windows:[]})}:
   {loadGustForecast:async()=>({provider:'nws',manifest:{},windows:[],snapshot:{sites:[]}})},
   {timelineModule:()=>pending.promise,rainFactory:async()=>({windows:[],load:async()=>null,validate:async()=>{},destroy(){}})});
 const restore=stubGlobals({fetch:async()=>Response.json({})});
 try{
  let task;
  if(product==='rain'){h.setSelection({id:'flood',kind:'alert',name:'Flood Advisory',alertTiming:{start:Date.now(),end:Date.now()+60000}});h.owner.syncAdvisory();}
  else task=h.owner.select('gust');
  await flush();await h.owner.select('snow-now');pending.resolve({createForecastTimeline});if(task)await task;await flush();
  assert.equal(h.nodes.get('weather-time').textContent,'Snow cover · source file 1');
  assert.equal(h.owner.snapshot.mode,'snow-now');
 }finally{restore();}
});

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
    if(name==='watershed-timeline-model')return {precipitationTimeline:()=>({windows:[{layer:1,start:10,end:20},{layer:2,start:20,end:30}]})};
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
  await flush();
  assert.equal(h.calls.at(-1)[1],retained);
  assert.equal(play.textContent,'Play');
});

test('Command uses prepared windows and retains the selected actual time when layer IDs roll at refresh',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const now=Date.now(),calls=[];let generation=0,destroys=0;
  const window={layer:14,issue:now-60000,start:now,end:now+6*3600000};
  const h=setup(t,async()=>({precipitationTimeline:()=>({windows:[]})}),{rainFactory:async()=>{
    const n=++generation;
    return {windows:[{...window,layer:n===1?14:13}],destroy(){destroys++;},validate:async()=>{},
      load:async(w)=>{calls.push(w);return {cycle:{...window,hours:w?6:72},legend:[],delivery:{method:'prepared',preparedAt:new Date(now).toISOString()}};}};
  }});
  await h.owner.select('rain');
  const slider=h.nodes.get('weather-controls').children.find(n=>n.className==='forecast-timeline').children.find(n=>n.tag==='input');
  slider.value='1';slider.oninput();await flush();
  assert.equal(calls.at(-1).start,now);
  t.mock.timers.tick(15*60000);await flush();
  assert.equal(generation,2);assert.equal(destroys,1);
  assert.equal(calls.at(-1).layer,13);assert.equal(calls.at(-1).start,now);
  assert.match(h.nodes.get('weather-source').children.map(n=>n.textContent).join(' '),/Prepared/);
  h.owner.select('off');t.mock.timers.tick(15*60000);await flush();assert.equal(generation,2);
});

test('rain source validation failure clears the previous image and legend without clearing the official alert',async t=>{
  let valid=true;
  const h=setup(t,async()=>({precipitationTimeline:()=>({windows:[]})}),{rainFactory:async()=>({windows:[],destroy(){},
    load:async()=>({cycle:{hours:72,start:1,end:Date.now()+60000,issue:1},legend:[]}),
    validate:async()=>{if(!valid)throw Error('source revised');}})});
  await h.owner.select('rain');valid=false;
  h.owner.suspend();h.owner.resume();await flush();
  assert.equal(h.calls.filter(([m])=>m==='rain').at(-1)[1],null);
  assert.equal(h.nodes.get('weather-legend').hidden,true);
  assert.match(h.nodes.get('weather-time').textContent,/unavailable|updated|current/i);
  assert.equal(h.owner.snapshot.mode,'rain');
});

test('an early flood alert fills partial prepared coverage from the independent published timeline',async t=>{
  const now=Date.now(),window={layer:14,issue:now-60000,start:now,end:now+6*3600000};
  let requested=false,loaded;
  const h=setup(t,async()=>({precipitationTimeline:snapshot=>({windows:snapshot?.windows??[]})}),{rainFactory:async()=>({
    windows:[],destroy(){},validate:async()=>{},load:async(w)=>{loaded=w;return {cycle:{...window,hours:6},legend:[]};},
  })});
  const restore=stubGlobals({fetch:async()=>{requested=true;return Response.json({windows:[window]});}});
  try {
    h.setSelection({id:'flood',kind:'alert',name:'Flood Advisory',alertTiming:{start:now,end:window.end}});
    h.owner.syncAdvisory();await flush();
    assert.equal(requested,true);assert.equal(loaded?.layer,14);
  }finally{restore();}
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

for(const product of ['rain','gust'])test(`${product} retries the selected initial frame when visibility interrupts its load`,async t=>{
  const pending=deferred();let reads=0;
  const image=product==='rain'?{cycle:{hours:72,start:1,end:Date.now()+60000,issue:1},legend:[],blob:null}:{blob:'gust'};
  const load=async()=>++reads===1?pending.promise:image;
  const h=setup(t,async name=>{
    if(name==='watershed-timeline-model')return {precipitationTimeline:()=>({windows:[]})};
    if(name==='watch-watershed-data')return {regionalForecastBounds:[],loadWatershedRain:load};
    return {loadGustForecast:async()=>({provider:'hrrr',manifest:{attribution:'NOAA',run:new Date().toISOString()},
      windows:[{start:Date.now()+60000,end:Date.now()+60000}]}),loadGustImage:load,gustLegend:[]};
  });
  const selected=h.owner.select(product);await flush();
  h.document.hidden=true;h.document.dispatchEvent(new Event('visibilitychange'));
  h.document.hidden=false;h.document.dispatchEvent(new Event('visibilitychange'));await flush();
  assert.equal(reads,2);
  assert.ok(h.calls.some(([method,value])=>method===product&&value));
  const rendered=h.calls.length;
  pending.resolve(image);await selected;
  assert.equal(h.calls.length,rendered,'aborted first request cannot repaint after the retry');
});

test('a late snow forecast cannot replace the active snow-cover redraw callback',async t=>{
  const pending=deferred();
  const first=Math.floor(Date.now()/(6*3600000))*6*3600000;
  const source={...snowNow,loadSnowForecast:async()=>[],
    loadSnowGrid:async()=>({coordinates:[[0,1],[1,1],[1,0],[0,0]],legend:[],frames:[{start:first,end:first+6*3600000,issued:first}]}),
    loadSnowGridImage:()=>pending.promise};
  const h=setup(t,async name=>name==='forecast-timeline'?{createForecastTimeline}:source);
  const selected=h.owner.select('snow-forecast');await flush();
  await h.owner.select('snow-now');pending.resolve({blob:'old-snow'});await selected;
  h.document.hidden=true;h.document.dispatchEvent(new Event('visibilitychange'));
  const count=h.calls.length;
  h.document.hidden=false;h.document.dispatchEvent(new Event('visibilitychange'));await flush();
  assert.ok(h.calls.slice(count).some(([method,value])=>method==='snowCover'&&value?.fileTime===1));
});
