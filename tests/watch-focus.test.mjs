import test from 'node:test';
import assert from 'node:assert/strict';
import {watchFocusPoints,watchFocusMotion} from '../site/lib/watch-focus.js';
test('watch focus uses valid source locations, keeps reservoir and gauge distinct, and deduplicates locations',()=>{
 const points=watchFocusPoints([{id:'PNF',longitude:-119.325,latitude:36.832},{id:'PFQC1',longitude:-119.336,latitude:36.831},{id:'PNF',longitude:-119.325,latitude:36.832},{id:'bad',longitude:null,latitude:37}]);
 assert.equal(points.length,2);assert.equal(points[0].label,'Pine Flat · pool / release');assert.equal(points[1].label,'PFQC1 · below-dam stage');
 assert(!points.some(p=>'travelTime' in p||'path' in p));assert.deepEqual(watchFocusPoints([]),[]);
});
test('watch camera motion is bounded and respects reduced motion',()=>{
 assert.equal(watchFocusMotion(true).animate,false);assert.equal(watchFocusMotion(false).animate,true);assert(watchFocusMotion(false).duration<=1000);
});
test('co-located wind samples do not replace the reservoir source label',()=>{
 const points=watchFocusPoints([{id:'PNF',longitude:-119.325,latitude:36.833},{id:'PINEFLAT',longitude:-119.325,latitude:36.833}]);
 assert.equal(points.length,1);assert.equal(points[0].id,'PNF');
});
