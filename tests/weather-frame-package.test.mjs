import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {validateWeatherReplay,createPreparedWeather,frameFingerprint} from '../site/lib/weather-frame-package.js';

const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGfoAAAAASUVORK5CYII=','base64');
const hash=createHash('sha256').update(png).digest('hex');
const fixture=()=>({schemaVersion:1,kind:'recorded-wpc-display-replay',capturedAt:'2026-11-24T22:00:00Z',
  clock:Date.parse('2026-11-24T22:00:00Z'),publisher:'NOAA WPC',source:'https://mapservices.weather.noaa.gov/vector/rest/services/precip/wpc_qpf/MapServer',
  rasterCrs:'EPSG:3857',coordinateCrs:'EPSG:4326',bounds:[-131,28,-107.5,47],frames:[{
    id:'qpf-9',window:null,cycle:{issue:Date.parse('2026-11-24T21:00:00Z'),start:Date.parse('2026-11-25T00:00:00Z'),end:Date.parse('2026-11-28T00:00:00Z'),hours:72,units:'in',product:'72-hour QPF'},
    coordinates:[[-131,47],[-107.5,47],[-107.5,28],[-131,28]],legend:[{value:0.25,color:'rgb(1,2,3)'}],
    image:{file:`images/${hash}.png`,sha256:hash,bytes:png.length,width:1,height:1},
  }]});

test('recorded frame contract keeps dates, legend, units, CRS and geometry together',()=>{
  assert.equal(validateWeatherReplay(fixture()).frames.length,1);
  for(const mutate of [p=>p.kind='live',p=>p.rasterCrs='EPSG:4326',p=>p.frames[0].cycle.units='mm',
    p=>p.frames[0].cycle.end++,p=>p.frames[0].coordinates[0][0]=999,p=>p.frames[0].image.file='../private.png',
    p=>p.frames[0].image.bytes=90_000_000,p=>p.frames.push(p.frames[0]),
    p=>p.frames[0].image=null]){
    const p=fixture();mutate(p);assert.throws(()=>validateWeatherReplay(p));
  }
});

test('prepared delivery returns exact image bytes, frozen metadata and a bounded reusable frame',async()=>{
  let reads=0;const p=fixture();
  const store=createPreparedWeather(p,new URL('https://example.test/replay/'),{fetchImpl:async()=>{reads++;return new Response(png,{headers:{'content-type':'image/png'}});}});
  const a=await store.load('qpf-9');const b=await store.load('qpf-9');
  assert.deepEqual(Buffer.from(await a.blob.arrayBuffer()),png);assert.equal(a,b);assert.equal(reads,1);
  assert.deepEqual(a.cycle,p.frames[0].cycle);assert.deepEqual(a.legend,p.frames[0].legend);
  p.frames[0].cycle.hours=6;assert.equal(a.cycle.hours,72);
  await assert.rejects(store.load('missing'),/Unknown/);
  store.destroy();await assert.rejects(store.load('qpf-9'),/closed/);
});

test('corrupt or substituted images cannot appear with trusted dates and legends',async()=>{
  const store=createPreparedWeather(fixture(),new URL('https://example.test/'),{fetchImpl:async()=>new Response(new Uint8Array(png.length),{headers:{'content-type':'image/png'}})});
  await assert.rejects(store.load('qpf-9'),/integrity|PNG/);store.destroy();
});

test('verified no-contour result stays distinct from a missing frame',async()=>{
  const p=fixture();p.frames[0].legend=[];p.frames[0].image=null;
  const store=createPreparedWeather(p,new URL('https://example.test/'),{fetchImpl:async()=>{throw Error('must not fetch');}});
  assert.equal((await store.load('qpf-9')).blob,null);store.destroy();
});

test('a corrected legend, date or image changes the evidence fingerprint',async()=>{
  const f=fixture().frames[0];const a=await frameFingerprint(f);
  for(const edit of [x=>x.cycle.issue++,x=>x.legend[0].value=0.5,x=>x.image.sha256='a'.repeat(64)]){
    const revised=structuredClone(f);edit(revised);assert.notEqual(await frameFingerprint(revised),a);
  }
});
