import test from 'node:test';
import assert from 'node:assert/strict';
import {radarTimelineForDisplay} from '../site/lib/watch-radar-ui.js';

test('an empty or failed volume catalog still loads the direct Hanford timeline',async()=>{
 const patches={frames:[{file:'direct'}]};let calls=0;
 for(const loadVolumes of [async()=>({frames:[]}),async()=>{throw Error('offline');}]){
  const result=await radarTimelineForDisplay({volumeWanted:true,loadVolumes,loadPatches:async()=>{calls++;return patches;}});
  assert.equal(result.timeline,patches);assert.equal(result.volumeIssue,true);
 }
 assert.equal(calls,2);
});
test('a complete volume catalog has its own scan list and cancelled switching cannot load fallback',async()=>{
 const volume={frames:[{file:'volume'}]};
 const result=await radarTimelineForDisplay({volumeWanted:true,loadVolumes:async()=>volume,loadPatches:async()=>assert.fail()});
 assert.equal(result.timeline,volume);assert.equal(result.volumeIssue,false);
 const control=new AbortController();control.abort();
 await assert.rejects(radarTimelineForDisplay({volumeWanted:true,signal:control.signal,loadVolumes:async()=>{throw Error('aborted');},loadPatches:async()=>assert.fail()}),/aborted/);
});
