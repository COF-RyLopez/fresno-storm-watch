import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {collectPreparedWeather} from '../scripts/collect-prepared-weather.mjs';
import {createPreparedWeather,validateCurrentWeather} from '../site/lib/weather-frame-package.js';
import {rainRasterGeometry,regionalForecastBounds} from '../site/lib/watch-watershed-data.js';

const now=Date.parse('2026-11-25T12:00:00Z'),HOUR=3600000;
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGfoAAAAASUVORK5CYII=','base64');
const cycle=({id})=>({issue:now-HOUR,start:now+(id===9?0:(id-13)*6*HOUR),
  end:now+(id===9?72:(id-12)*6)*HOUR,hours:id===9?72:6,units:'in',product:id===9?'72-hour QPF':'6-hour QPF'});
async function setup(t){const dir=await mkdtemp(join(tmpdir(),'frog-weather-'));t.after(()=>rm(dir,{recursive:true,force:true}));return pathToFileURL(dir+'/');}
const rain=async(_bounds,{window})=>({cycle:cycle({id:window?.layer??9}),
  coordinates:rainRasterGeometry(regionalForecastBounds).coordinates,legend:[{value:.25,color:'rgb(1,2,3)'}],blob:new Blob([png],{type:'image/png'})});

test('prepares the overview and all thirteen supported six-hour windows, with independently verified bytes',async t=>{
  const output=await setup(t),result=await collectPreparedWeather({output,clock:()=>now,getCycle:async period=>cycle(period),loadRain:rain});
  assert.equal(result.prepared,14);assert.equal(result.failed.length,0);
  const p=validateCurrentWeather(JSON.parse(await readFile(new URL('manifest.json',output),'utf8')));
  assert.equal(p.frames.length,14);
  const store=createPreparedWeather(p,output,{fetchImpl:async url=>new Response(await readFile(url),{headers:{'content-type':'image/png'}})});
  for(const f of p.frames)assert.deepEqual(Buffer.from(await (await store.load(f.id)).blob.arrayBuffer()),png);
  store.destroy();
});

test('partial errors preserve explicit gaps; failed windows never become dry results',async t=>{
  const output=await setup(t),result=await collectPreparedWeather({output,clock:()=>now,getCycle:async p=>cycle(p),
    loadRain:async(bounds,options)=>{if(options.window?.layer===14)throw Error('source down');return rain(bounds,options);}});
  assert.deepEqual(result.failed,[14]);assert.equal(result.prepared,13);
  const p=JSON.parse(await readFile(new URL('manifest.json',output),'utf8'));
  assert.equal(p.frames.some(f=>f.id==='qpf-14'),false);
});

test('total failure leaves the old manifest intact rather than publishing an empty/current result',async t=>{
  const output=await setup(t);await writeFile(new URL('manifest.json',output),'previous','utf8');
  await assert.rejects(collectPreparedWeather({output,clock:()=>now,getCycle:async()=>{throw Error('down');},loadRain:async()=>{throw Error('down');}}),/No current/);
  assert.equal(await readFile(new URL('manifest.json',output),'utf8'),'previous');
});

test('a corrupt PNG never replaces the last good manifest',async t=>{
  const output=await setup(t);await writeFile(new URL('manifest.json',output),'previous','utf8');
  await assert.rejects(collectPreparedWeather({output,clock:()=>now,getCycle:async p=>cycle(p),
    loadRain:async(...args)=>({...await rain(...args),blob:new Blob([new Uint8Array(60)],{type:'image/png'})})}),/No current/);
  assert.equal(await readFile(new URL('manifest.json',output),'utf8'),'previous');
});
