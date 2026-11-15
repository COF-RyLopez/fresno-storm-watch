import test from 'node:test';
import assert from 'node:assert/strict';
import {createWatershedPlayback} from '../site/lib/watershed-playback.js';

test('forecast playback waits for each frame to settle and stops at the end',async()=>{
 const changes=[],frames=[];
 let settle,next;
 const playback=createWatershedPlayback({advance:()=>new Promise(resolve=>{frames.push(frames.length+1);settle=resolve;}),
  changed:value=>changes.push(value),canAdvance:()=>true,schedule:callback=>{next=callback;},cancel:()=>{next=null;}});
 playback.play();playback.play();
 assert.deepEqual(frames,[1]);assert.equal(next,undefined);
 settle(true);await Promise.resolve();
 next();
 assert.deepEqual(frames,[1,2]);
 settle(false);await Promise.resolve();
 assert.equal(next,null);assert.deepEqual(changes,[true,false]);
});

test('pausing and restarting cannot let an older pending frame advance the timeline',async()=>{
 const resolvers=[],timers=[];
 const playback=createWatershedPlayback({advance:()=>new Promise(resolve=>resolvers.push(resolve)),
  changed:()=>{},canAdvance:()=>true,schedule:callback=>timers.push(callback)});
 playback.play();playback.pause();playback.play();
 resolvers[0](true);await Promise.resolve();
 assert.equal(timers.length,0);
 resolvers[1](true);await Promise.resolve();
 assert.equal(timers.length,1);
});
