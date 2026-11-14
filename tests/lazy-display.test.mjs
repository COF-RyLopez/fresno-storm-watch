import test from 'node:test';
import assert from 'node:assert/strict';
import {lazyDisplay} from '../site/lib/lazy-display.js';
test('optional display stays unloaded until requested, shares concurrent attempts and reuses success',async()=>{
 let calls=0;const value={},get=lazyDisplay(async()=>{calls++;return value;});
 assert.equal(calls,0);const first=get(),second=get();assert.equal(first,second);
 assert.equal(await first,value);assert.equal(await get(),value);assert.equal(calls,1);
});
test('failed optional display can retry without poisoning the next attempt',async()=>{
 let calls=0;const get=lazyDisplay(async()=>{if(++calls===1)throw Error('unavailable');return 'ready';});
 await assert.rejects(get(),/unavailable/);assert.equal(await get(),'ready');assert.equal(calls,2);
});
