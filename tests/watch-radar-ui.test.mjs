import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as sleep} from 'node:timers/promises';
import {installWatchRadar} from '../site/lib/watch-radar-ui.js';
import {buildRadarVolume,sha256} from '../scripts/lib/radar-volume.mjs';
import {FakeElement,stubGlobals} from './helpers/dom.mjs';

const NOW=Date.parse('2026-11-15T08:10:00Z');
const click=element=>element.dispatchEvent(new Event('click'));
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};

function scan(time,end,dbz){
 const samples=new Float32Array([-119.7,36.8,2500,dbz]),bytes=Buffer.alloc(16);
 samples.forEach((value,index)=>bytes.writeFloatLE(value,index*4));
 const file=`KHNX20261115_${time}_V06.bin`;
 const frame={file,sha256:sha256(bytes),start:Date.parse(`2026-11-15T${time.slice(0,2)}:${time.slice(2,4)}:${time.slice(4)}Z`),
  end:Date.parse(`2026-11-15T${end}Z`),count:1,bytes:16,
  source:`https://unidata-nexrad-level2.s3.amazonaws.com/2026/11/15/KHNX/${file.slice(0,-4)}`};
 const volume=buildRadarVolume(frame,samples);
 const record={...frame,url:`${volume.directory}/`,metadataSha256:volume.metadataSha256,
  bytes:volume.bytes,sourceCount:1,occupiedVoxels:1};
 return {frame,bytes,volume,record};
}
const first=scan('080000','08:04:00',35),second=scan('080500','08:09:00',45);

async function until(predicate,message){
 const deadline=performance.now()+3000;
 while(!predicate()){
  assert.ok(performance.now()<deadline,`Timed out: ${message}`);
  await sleep(5);
 }
}

// Keep the real controller, playback, timeline validation, checksums and decoding.
// Only the DOM, clock, scheduled callbacks, HTTP transport and map boundary are doubled.
function harness(t){
 t.mock.method(Date,'now',()=>NOW);
 const document=new EventTarget();document.hidden=false;
 document.createElement=tag=>new FakeElement(tag);
 document.createTextNode=text=>({textContent:text});
 const state={patches:null,cube:null,volumeWrites:[],failure:null};
 const config={patches:[first.frame],volumes:[first.record],failedPatches:new Set(),failedVolumes:new Set(),hold:null};
 const requests=[],timers=new Map(),links=new Map();let timerId=0;
 const fetch=async(input,options)=>{
  const url=new URL(input);requests.push(url.pathname);
  if(url.pathname.endsWith('/khnx-v1/manifest.json'))
   return Response.json({kind:'live-observation',station:'KHNX',checkedAt:new Date(NOW).toISOString(),frames:config.patches});
  if(url.pathname.endsWith('/radar-volume/manifest.json'))
   return Response.json({version:1,kind:'sampled-radar-volume',station:'KHNX',generatedAt:NOW,checkedAt:NOW,frames:config.volumes,errors:[]});
  for(const sample of [first,second]){
   if(url.pathname.endsWith(`/${sample.frame.file}`))
    return config.failedPatches.has(sample.frame.file)?new Response('',{status:503}):new Response(sample.bytes);
   if(!url.pathname.includes(`/${sample.volume.directory}/`))continue;
   if(config.failedVolumes.has(sample.frame.file))return new Response('',{status:503});
   if(url.pathname.endsWith('/zarr.json')){
    if(config.hold?.file===sample.frame.file){
     config.hold.signal=options.signal;config.hold.started.resolve();
     // Deliberately ignore cancellation until released: late HTTP completions must be harmless.
     await config.hold.release.promise;
    }
    return new Response(sample.volume.metadataBytes);
   }
   const chunk=sample.volume.chunks.find(chunk=>url.pathname.endsWith(`/${chunk.key}`));
   if(chunk)return new Response(chunk.data);
  }
  throw Error(`Unexpected test request: ${url}`);
 };
 const restore=stubGlobals({document,fetch,
  setTimeout:(callback,delay)=>{const id=++timerId;timers.set(id,{callback,delay});return id;},
  clearTimeout:id=>timers.delete(id)});
 const info=new FakeElement('p');
 const session={
  radar(values){state.patches=values;},
  radarVolume(grid,_minimum,onFailure){state.cube=grid;if(grid)state.volumeWrites.push(grid);if(onFailure)state.failure=onFailure;},
  cloud(){},cloudTops(){}
 };
 const ui=installWatchRadar({session,info,items:new FakeElement(),renderColors(){},visible:()=>true,
  source(label,url){const link=new FakeElement('a');link.textContent=label;link.href=url;links.set(label,link);return link;}});
 // Cloud pairing has its own tests; use the actual off control before opening radar.
 click(ui.cloudButton);
 t.after(()=>{ui.close();restore();});
 return {ui,info,state,config,requests,timers,scanLink:links.get('NOAA scan file'),
  async open(){ui.open();await until(()=>state.patches!==null,'initial echo patches');},
  async volume(){click(ui.volumeButton);await until(()=>state.cube!==null,'experimental volume');},
  refresh(){const entry=[...timers].find(([,timer])=>timer.delay===60000);assert.ok(entry,'live refresh is scheduled');timers.delete(entry[0]);entry[1].callback();},
  failGPU(){assert.equal(typeof state.failure,'function');state.cube=null;state.failure();},
  holdVolume(sample=second){const hold={file:sample.frame.file,started:deferred(),release:deferred()};config.hold=hold;return hold;}
 };
}

test('an empty volume catalog keeps dated echo patches and explains the fallback',async t=>{
 const h=harness(t);await h.open();
 h.config.volumes=[];click(h.ui.volumeButton);
 await until(()=>h.info.textContent.includes('Volume unavailable'),'empty-catalog fallback');
 assert.equal(h.state.cube,null);
 assert.equal(h.state.patches[3],35);
 assert.equal(h.scanLink.href,first.frame.source);
 assert.match(h.info.textContent,/echo patches shown/);
 assert.match(h.ui.controls.children[1].attributes.get('aria-valuetext'),/Nov 15.*12:04.*PST/);
 assert.equal(h.requests.filter(path=>path.endsWith('/khnx-v1/manifest.json')).length,2,
  'The empty cube catalog must still read the direct radar timeline.');
});

test('failed replacement cube and patches preserve the earlier rendered cube and its date',async t=>{
 const h=harness(t);await h.open();await h.volume();
 const previous=h.state.cube,previousStatus=h.info.textContent,previousTime=h.ui.controls.children[1].attributes.get('aria-valuetext');
 assert.equal(previous.values.filter(value=>value!==-999)[0],35);
 h.config.volumes=[second.record];h.config.failedVolumes.add(second.frame.file);h.config.failedPatches.add(second.frame.file);
 h.refresh();await until(()=>h.info.textContent.includes('Update unavailable'),'failed replacement status');
 assert.ok(h.state.cube===previous,'A failed fetch must not remove the last successfully displayed cube.');
 assert.equal(h.state.patches,null);
 assert.equal(h.scanLink.href,first.frame.source);
 assert.equal(h.ui.controls.children[1].attributes.get('aria-valuetext'),previousTime);
 assert.equal(h.info.textContent,`${previousStatus} · Update unavailable`);
});

test('switching back to patches invalidates an in-flight cube even if its response arrives late',async t=>{
 const h=harness(t);await h.open();h.config.volumes=[second.record];
 const hold=h.holdVolume();click(h.ui.volumeButton);await hold.started.promise;
 click(h.ui.volumeButton);await until(()=>h.state.patches!==null,'patches after mode switch');
 assert.equal(hold.signal.aborted,true);
 const status=h.info.textContent,link=h.scanLink.href;
 hold.release.resolve();await sleep(25);
 assert.equal(h.state.cube,null);assert.equal(h.state.volumeWrites.length,0);
 assert.equal(h.state.patches[3],35);assert.equal(h.info.textContent,status);assert.equal(h.scanLink.href,link);
 assert.equal(h.ui.volumeButton.attributes.get('aria-pressed'),'false');
});

test('closing radar invalidates an in-flight cube without repainting or restarting refresh',async t=>{
 const h=harness(t);await h.open();h.config.volumes=[second.record];
 const hold=h.holdVolume();click(h.ui.volumeButton);await hold.started.promise;
 h.ui.close();assert.equal(hold.signal.aborted,true);
 hold.release.resolve();await sleep(25);
 assert.equal(h.state.cube,null);assert.equal(h.state.patches,null);assert.equal(h.state.volumeWrites.length,0);
 assert.equal(h.ui.controls.hidden,true);assert.equal(h.ui.volumeButton.hidden,true);
 assert.equal(h.timers.size,0,'Late completion must not restart a closed panel.');
});

test('a GPU failure falls back to the same observed scan and stops retrying the volume renderer',async t=>{
 const h=harness(t);await h.open();h.config.volumes=[second.record];await h.volume();
 const observedTime=h.ui.controls.children[1].attributes.get('aria-valuetext');
 h.failGPU();await until(()=>h.info.textContent.includes('echo patches shown'),'GPU echo-patch fallback');
 assert.equal(h.state.cube,null);assert.equal(h.state.patches[3],45);
 assert.equal(h.scanLink.href,second.frame.source);
 assert.equal(h.ui.controls.children[1].attributes.get('aria-valuetext'),observedTime);
 const before=h.requests.length;h.refresh();await until(()=>h.requests.length>before,'refresh after GPU failure');await sleep(25);
 assert.equal(h.state.cube,null);assert.equal(h.state.volumeWrites.length,1);
 assert.match(h.info.textContent,/Volume unavailable; echo patches shown/);
});

test('a GPU failure followed by missing patches reports unavailable instead of retaining a phantom volume',async t=>{
 const h=harness(t);await h.open();h.config.volumes=[second.record];await h.volume();
 h.config.failedPatches.add(second.frame.file);h.failGPU();
 await until(()=>h.info.textContent==='Hanford radar unavailable','failed GPU fallback status');
 assert.equal(h.state.cube,null);assert.equal(h.state.patches,null);assert.equal(h.scanLink.hidden,true);
 assert.equal(h.ui.controls.children[1].attributes.get('aria-valuetext'),'No scan selected');
});
