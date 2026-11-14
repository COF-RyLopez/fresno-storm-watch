import test from 'node:test';
import assert from 'node:assert/strict';
import {hydrographyStatus} from '../site/lib/hydrography-status.js';
test('reference status distinguishes recent retrieval, failure, overdue and unknown',()=>{
 const now=Date.parse('2026-11-14T18:00:00Z'),d={lastSuccessAt:'2026-11-14T17:00:00Z',state:'current'};
 assert.match(hydrographyStatus(d,now),/^Weekly reference refresh/);
 assert.match(hydrographyStatus({...d,state:'failed'},now),/^Refresh failed; previous reference retained/);
 for(const lastSuccessAt of [null,'invalid','2026-10-14','2027-01-01'])assert.match(hydrographyStatus({...d,lastSuccessAt},now),/^Reference refresh overdue or unconfirmed/);
 assert.match(hydrographyStatus(d,now),/not a new survey date/);
 assert.match(hydrographyStatus(d,now),/not the full upstream watersheds/);
});
