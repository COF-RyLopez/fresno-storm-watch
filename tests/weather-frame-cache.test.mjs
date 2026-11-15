import test from 'node:test';
import assert from 'node:assert/strict';
import {createWeatherFrameCache} from '../site/lib/weather-frame-cache.js';

test('pause cancels pending downloads but retains completed lookahead',async()=>{
 const cache=createWeatherFrameCache(3);await cache.get('ready',()=>42);
 let signal;void cache.get('pending',s=>{signal=s;return new Promise(()=>{});});await Promise.resolve();
 cache.cancelPending();assert.equal(signal.aborted,true);
 assert.equal(await cache.get('ready',()=>99),42);assert.equal(await cache.get('pending',()=>7),7);
});

test('lookahead and display share one fetch, and a failed frame can be retried',async()=>{
 const cache=createWeatherFrameCache(3);let calls=0,release;
 const load=()=>{calls++;return new Promise(resolve=>{release=resolve;});};
 const ahead=cache.get('a',load),display=cache.get('a',load);
 await Promise.resolve();release(42);
 assert.deepEqual(await Promise.all([ahead,display]),[42,42]);assert.equal(calls,1);
 await assert.rejects(cache.get('b',()=>Promise.reject(Error('missing'))),/missing/);
 assert.equal(await cache.get('b',()=>7),7);
});

test('eviction and close abort pending work and late responses cannot poison a replacement',async()=>{
 const cache=createWeatherFrameCache(2);let firstSignal,release;
 const first=cache.get('a',signal=>{firstSignal=signal;return new Promise(resolve=>{release=resolve;});});
 await Promise.resolve();await cache.get('b',()=>2);await cache.get('c',()=>3);
 assert.equal(firstSignal.aborted,true);
 const replacement=cache.get('a',()=>4);release(1);await first;
 assert.equal(await replacement,4);assert.equal(await cache.get('a',()=>99),4);
 let closingSignal;const pending=cache.get('d',signal=>{closingSignal=signal;return new Promise(()=>{});});
 void pending;await Promise.resolve();cache.clear();assert.equal(closingSignal.aborted,true);
 assert.equal(await cache.get('a',()=>5),5);
});
