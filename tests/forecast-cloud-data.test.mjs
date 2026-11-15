import test from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {validateForecastClouds,loadForecastCloudHour} from '../site/lib/forecast-cloud-data.js';
import {stubGlobals} from './helpers/dom.mjs';

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
