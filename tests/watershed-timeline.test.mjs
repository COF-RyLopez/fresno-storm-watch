import test from 'node:test';
import assert from 'node:assert/strict';
import {HOUR} from '../site/lib/river-model.js';
import {precipitationTimeline,riseOutletReports} from '../site/lib/watershed-timeline-model.js';

const now=Date.parse('2026-11-15T01:00:00Z');
const window=(layer,hours,mil,pnf)=>({layer,issue:now-3*HOUR,start:now+hours*HOUR,end:now+(hours+6)*HOUR,max:{MIL:mil,PNF:pnf}});
const snapshot=windows=>({schemaVersion:1,generatedAt:new Date(now).toISOString(),windows});

test('basin timings rank separately, preserve ties and distinguish dry coverage from missing windows',()=>{
 const intervals=[window(14,-1,null,.01),window(15,5,.25,.05),window(16,11,.25,.75)];
 const result=precipitationTimeline(snapshot(intervals),now);
 assert.equal(result.windows[0].max.MIL,null);
 assert.deepEqual(result.peaks.MIL,intervals.slice(1));
 assert.deepEqual(result.peaks.PNF,intervals.slice(2));
 assert.equal(result.continuous,false);
 assert.equal(precipitationTimeline(snapshot(intervals),now+2*HOUR).windows.length,0);
});

test('overlapping publication windows are withheld and completeness requires a contiguous horizon',()=>{
 const complete=Array.from({length:12},(_,index)=>window(14+index,index*6-1,.1,.05));
 assert(precipitationTimeline(snapshot(complete),now).continuous);
 const overlap=[complete[0],window(15,4,.4,.6),complete[2]];
 assert.deepEqual(precipitationTimeline(snapshot(overlap),now).windows,[complete[2]]);
});

test('RISE accepts only the provisional Millerton outlet item with a distinct valid report date',()=>{
 const outlet={itemId:10810,locationId:413,parameterId:15,sourceCode:'har',dateTime:'2026-11-13T08:00:00+00:00',result:416,status:null,modelRunId:null};
 const payload=attributes=>({data:[{attributes}],meta:{totalItems:1}});
 assert.deepEqual(riseOutletReports(payload(outlet),now),[{date:'2026-11-13',time:Date.parse(outlet.dateTime),value:416}]);
 for(const changes of [{itemId:10805},{locationId:414},{dateTime:'2026-02-30T08:00:00+00:00'},{dateTime:'2026-11-17T08:00:00+00:00'},{modelRunId:5},{result:null}])
  assert.throws(()=>riseOutletReports(payload({...outlet,...changes}),now));
 assert.throws(()=>riseOutletReports({data:[{attributes:outlet},{attributes:outlet}],meta:{totalItems:2}},now));
});
