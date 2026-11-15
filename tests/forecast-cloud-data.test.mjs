import test from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {validateForecastClouds,loadForecastCloudHour} from '../site/lib/forecast-cloud-data.js';
import {setTimeout as sleep} from 'node:timers/promises';
import {installForecastClouds} from '../site/lib/watch-forecast-cloud-ui.js';
import {FakeElement,stubGlobals} from './helpers/dom.mjs';

const run=Date.parse('2026-11-15T09:00:00Z'),hour=3600000;
const r=6378137,x=lon=>r*lon*Math.PI/180,y=lat=>r*Math.asinh(Math.tan(lat*Math.PI/180));
const shape=[32,96,104];
const values=new Uint8Array(32*96*104);values[12]=72;
const fixture=(bytes=gzipSync(values))=>{
 const sha256=createHash('sha256').update(bytes).digest('hex');
 const frames=Array.from({length:12},(_,i)=>{
  const lead=i+1;
  return {lead,valid:new Date(run+lead*hour).toISOString(),bytes:bytes.length,sha256,
   file:`2026111509-f${String(lead).padStart(2,'0')}-${sha256.slice(0,12)}.gz`};
 });
 return {version:1,run:new Date(run).toISOString(),shape,heightRange:[0,16000],frames,
  bounds3857:[x(-121.5),y(35.5),x(-117.7),y(38.65)]};
};

test('the cloud timeline accepts one complete regional run and rejects mixed times and expired runs',()=>{
 const doc=fixture();
 const catalog=validateForecastClouds(doc,run+4*hour);
 assert.equal(catalog.frames[3].valid,run+4*hour);
 assert.throws(()=>validateForecastClouds(doc,run+13*hour),/unavailable/);
 assert.throws(()=>validateForecastClouds({...doc,frames:doc.frames.slice(0,11)},run),/unavailable/);
 doc.frames[4].valid=doc.frames[3].valid;
 assert.throws(()=>validateForecastClouds(doc,run),/forecast hour/);
});

test('volume loading checks the exact byte count, hash and inflated shape',async()=>{
 let bytes=gzipSync(values);
 const catalog=validateForecastClouds(fixture(bytes),run);
 const restore=stubGlobals({fetch:async()=>new Response(bytes)});
 const signal=new AbortController().signal;
 try{
  const frame=await loadForecastCloudHour(catalog,catalog.frames[0],signal);
  assert.equal(frame.values[12],72);assert.equal(frame.values.length,values.length);
  const corrupt=Buffer.from(bytes);corrupt[10]^=1;bytes=corrupt;
  await assert.rejects(loadForecastCloudHour(catalog,catalog.frames[0],signal),/integrity/);
  bytes=gzipSync(new Uint8Array(19));
  const short=validateForecastClouds(fixture(bytes),run);
  await assert.rejects(loadForecastCloudHour(short,short.frames[0],signal),/shape/);
 }finally{restore();}
});

test('a matched v2 hour decodes signed 10 m wind and preserves old cloud-only frames',async()=>{
 const joint=new Uint8Array(values.length+shape[1]*shape[2]*4);
 joint.set(values);
 const packed=new DataView(joint.buffer,values.length);
 packed.setInt16(0,-123,true);packed.setInt16(2,450,true);
 let bytes=gzipSync(joint);
 const doc=fixture(bytes);
 doc.version=2;
 for(const frame of doc.frames)frame.wind=true;
 const catalog=validateForecastClouds(doc,run);
 const restore=stubGlobals({fetch:async()=>new Response(bytes)});
 const signal=new AbortController().signal;
 try{
  const result=await loadForecastCloudHour(catalog,catalog.frames[0],signal);
  assert.equal(result.values[12],72);
  assert.ok(Math.abs(result.wind.vectors[0]+1.23)<.00001);
  assert.equal(result.wind.vectors[1],4.5);
  bytes=gzipSync(values);
  const legacy=validateForecastClouds(fixture(bytes),run);
  assert.equal((await loadForecastCloudHour(legacy,legacy.frames[0],signal)).wind,null);
 }finally{restore();}
});

test('resuming forecast clouds restores a selected paused hour and rearms the five-minute refresh',async t=>{
 t.mock.method(Date,'now',()=>run);
 const doc=fixture(), bytes=gzipSync(values), timers=new Map();
 let timerId=0, requests=0, shown=null;
 const document=new EventTarget();
 document.hidden=false;
 document.createElement=tag=>new FakeElement(tag);
 document.createTextNode=text=>({textContent:text});
 const restore=stubGlobals({
  document,
  fetch:async url=>{
   if(url.pathname.endsWith('/latest.json')){requests++;return Response.json(doc);}
   return new Response(bytes);
  },
  setTimeout:(callback,delay)=>{const id=++timerId;timers.set(id,{callback,delay});return id;},
  clearTimeout:id=>timers.delete(id)
 });
 const info=new FakeElement('p');
 const ui=installForecastClouds({info,items:new FakeElement('div'),visible:()=>true,
  session:{forecastClouds(next){shown=next;},forecastWind(){}},source:()=>new FakeElement('a')});
 t.after(()=>{ui.close();restore();});
 const ready=async condition=>{
  const deadline=performance.now()+3000;
  while(!condition()){assert.ok(performance.now()<deadline,'Forecast frame was not ready');await sleep(5);}
 };
 const fiveMinuteTimers=()=>[...timers].filter(([,timer])=>timer.delay===5*60_000);
 ui.open();await ready(()=>shown&&fiveMinuteTimers().length);
 const [play,scrub]=ui.controls.children;
 const initial=info.textContent;
 scrub.value='3';scrub.dispatchEvent(new Event('change'));
 await ready(()=>scrub.value==='3'&&info.textContent!==initial);
 const selected=info.textContent;
 ui.suspend();
 assert.equal(shown,null);
 assert.equal(fiveMinuteTimers().length,0);
 ui.resume();
 assert.ok(shown);
 assert.equal(info.textContent,selected);
 assert.equal(scrub.value,'3');
 assert.equal(play.textContent,'Play');
 assert.equal(requests,1);
 const scheduled=fiveMinuteTimers();
 assert.equal(scheduled.length,1);
 const [id,timer]=scheduled[0];timers.delete(id);timer.callback();
 await ready(()=>requests===2&&fiveMinuteTimers().length);
 assert.equal(info.textContent,selected);
 assert.equal(scrub.value,'3');
});
