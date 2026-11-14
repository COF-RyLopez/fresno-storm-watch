import test from 'node:test';
import assert from 'node:assert/strict';
import {resourceTotals} from '../site/lib/pilot-performance.js';
test('timing totals exclude earlier requests and retain zero-byte/cache/TAO uncertainty',()=>{
 assert.deepEqual(resourceTotals([{startTime:1,transferSize:1000},{startTime:5,transferSize:400},{startTime:6,transferSize:0},{startTime:7}],5),{completedRequests:3,reportedTransferBytes:400,zeroOrUnreported:2});
});
