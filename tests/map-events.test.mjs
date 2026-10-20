import test from 'node:test';
import assert from 'node:assert/strict';
import {viewEventData,isMapLoadCancellation} from '../site/lib/map-events.js';
test('map selection handles SDK CustomEvent payloads and legacy view events without confusing MouseEvent click counts',()=>{
  const data={x:12,y:34,mapPoint:{longitude:-120,latitude:37}};
  assert.equal(viewEventData({detail:data}),data);assert.equal(viewEventData(data),data);
  const mouse={detail:1,x:12,y:34};assert.equal(viewEventData(mouse),mouse);
  const failure={layer:{id:'county-waterways'},error:new Error('failed')};assert.equal(viewEventData({detail:failure}),failure);
});

test('workspace/view cancellation does not trigger basemap failure, while actual source failures still do',()=>{
  for(const error of [{name:'AbortError'},{code:'AbortError'},new Error('Aborted'),new Error('aborted.')])assert.equal(isMapLoadCancellation(error),true);
  for(const error of [new Error('HTTP 503'),new Error('Unable to load tile source'),null])assert.equal(isMapLoadCancellation(error),false);
});
