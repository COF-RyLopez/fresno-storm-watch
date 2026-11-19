import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {setTimeout as sleep} from 'node:timers/promises';
import {installWatchClouds} from '../site/lib/watch-cloud-ui.js';
import {cloudMapRequest} from '../site/lib/watch-cloud-data.js';
import {FakeElement,stubGlobals} from './helpers/dom.mjs';

const now=Date.parse('2026-11-15T05:26:00Z'),minute=60000;
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
const click=element=>element.dispatchEvent(new Event('click'));
async function until(check){for(let n=0;n<200;n++){if(check())return;await sleep(5);}assert.fail('Cloud operation timed out');}
function harness(t,options){
 t.mock.method(Date,'now',()=>now);
 const frames=[10,20].map((end,i)=>{
  const body=new Float32Array([-119.5,36.7,5500+i*500,-119.4,36.7,6000,-119.5,36.8,5750]);
  return {body,record:{file:`goes18-${end}.bin`,start:`2026-11-15T05:${end-2}:00Z`,end:`2026-11-15T05:${end}:00Z`,resolutionKm:2,count:3,
   sha256:createHash('sha256').update(Buffer.from(body.buffer)).digest('hex'),
   source:`https://noaa-goes18.s3.amazonaws.com/ABI-L2-ACHA2KMC/2026/319/05/OR_ABI-L2-ACHA2KMC-M6_G18_s20263190518000_e20263190520000_c20263190523000.nc`}};
 });
 frames[0].record.start='2026-11-15T05:08:00Z';
 const state={writes:[],ir:[],fail:false,hold:null,fade:null,requests:[]};
 const fetch=async(input,{signal}={})=>{
  const url=new URL(input);state.requests.push(url);
  if(url.pathname.endsWith('manifest.json'))return Response.json({schemaVersion:1,product:'ABI-L2-ACHA2KMC',satellite:'GOES-18',generatedAt:new Date(now).toISOString(),frames:frames.map(f=>f.record)});
  const frame=frames.find(f=>url.pathname.endsWith(f.record.file));
  if(frame){if(state.hold){state.hold.signal=signal;await state.hold.promise;}return new Response(frame.body);}
  if(url.searchParams.get('request')==='GetCapabilities')return new Response('capabilities');
  if(url.searchParams.get('request')==='GetMap')return new Response(new Uint8Array([1]),{headers:{'content-type':'image/png'}});
  throw Error('Unexpected request');
 };
 const document={createElement:tag=>new FakeElement(tag)};
 // XML parsing and PNG decoding are browser boundaries; time selection/HTTP/checksums are real.
 class DOMParser{parseFromString(){return {querySelector:()=>null,getElementsByTagNameNS:(_ns,tag)=>tag==='Layer'?[{children:[
  {localName:'Name',textContent:'goes_longwave_imagery'},
  {localName:'Dimension',getAttribute:()=> 'time',textContent:'2026-11-15T05:10:00Z,2026-11-15T05:20:00Z'}]}]:[]};}}
 const restore=stubGlobals({document,fetch,DOMParser,createImageBitmap:async()=>({...cloudMapRequest(now),close(){}})});
 const ui=installWatchClouds({cloudTops(vertices,options){if(vertices&&state.fail)throw Error('GPU allocation failed');state.writes.push({vertices,options});return options?.durationMs?state.fade?.promise:Promise.resolve();},cloud(image){state.ir.push(image);}},options);
 t.after(()=>{ui.close();restore();});
 return {ui,state,frames};
}

test('lookahead never paints, and both GOES times stay visible until the actual fade completes',async t=>{
 const {ui,state}=harness(t);ui.open();await until(()=>ui.status.textContent.includes('hover/tap'));
 await ui.observe(now-15*minute);const before=state.writes.length;
 await ui.prepare(now);assert.equal(state.writes.length,before);
 state.fade=deferred();const painting=ui.observe(now,{durationMs:400});
 await until(()=>ui.status.textContent.includes('transition'));
 assert.match(ui.status.textContent,/9:10.*9:20/);assert.equal(ui.legend.hidden,false);
 await ui.observe(now);assert.match(ui.status.textContent,/transition/,'Repeated refresh must not prematurely relabel a blend.');
 state.fade.resolve();await painting;assert.match(ui.status.textContent,/9:20 PM PST.*hover\/tap/);
});

test('Command infrared uses no height mesh and expires on its own observation clock',async t=>{
 const {ui,state}=harness(t,{allowSurface:false});
 t.mock.timers.enable({apis:['setTimeout'],now});ui.open();
 for(let i=0;i<50&&!state.ir.length;i++)await new Promise(r=>setImmediate(r));
 assert.ok(state.ir.at(-1)?.blob);assert.equal(state.writes.length,0);assert.match(ui.status.textContent,/infrared.*observed/);
 t.mock.timers.tick(120*minute);assert.equal(state.ir.at(-1),null);assert.match(ui.status.textContent,/expired/);
});

test('a failed cloud surface uses dated infrared and removes the altitude key',async t=>{
 const {ui,state}=harness(t);state.fail=true;ui.open();
 await until(()=>ui.status.textContent.includes('2D IR'));
 assert.equal(ui.legend.hidden,true);assert.ok(state.ir.at(-1)?.blob);
 assert.match(ui.status.textContent,/height unavailable/);
});

test('cloud off aborts pending retrieval and cannot paint a late completion',async t=>{
 const {ui,state}=harness(t);state.hold=deferred();ui.open();
 await until(()=>state.hold.signal);click(ui.button);
 assert.equal(state.hold.signal.aborted,true);state.hold.resolve();await sleep(25);
 assert.equal(state.writes.filter(w=>w.vertices).length,0);assert.equal(ui.legend.hidden,true);
});

test('a later GPU draw failure falls back to infrared without repeatedly trying the failed surface',async t=>{
 const {ui,state}=harness(t);ui.open();await until(()=>ui.status.textContent.includes('hover/tap'));
 state.writes.at(-1).options.onFailure();await until(()=>ui.status.textContent.includes('2D IR'));
 const count=state.writes.filter(w=>w.vertices).length;await ui.observe(now-15*minute);
 assert.equal(state.writes.filter(w=>w.vertices).length,count);assert.equal(ui.legend.hidden,true);
});
