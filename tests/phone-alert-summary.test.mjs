import test from 'node:test';
import assert from 'node:assert/strict';
import {phoneAlertSummary} from '../site/lib/phone-alert-summary.js';
test('phone warnings retain regional scope and failures never imply no alerts',()=>{
 assert.deepEqual(phoneAlertSummary(null),{text:'NWS · checking',tone:'neutral'});
 assert.deepEqual(phoneAlertSummary(0),{text:'NWS · 0 regional',tone:'neutral'});
 assert.deepEqual(phoneAlertSummary(3,{warnings:2}),{text:'NWS · 2 regional warnings',tone:'warning'});
 assert.deepEqual(phoneAlertSummary(1,{warnings:0}),{text:'NWS · 1 regional',tone:'neutral'});
 assert.deepEqual(phoneAlertSummary(0,{error:'offline'}),{text:'NWS · unavailable',tone:'gap'});
 assert.deepEqual(phoneAlertSummary(1,{stale:true,warnings:1}),{text:'NWS · outdated',tone:'gap'});
});
