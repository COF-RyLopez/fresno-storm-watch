import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceHealth,sourceHealthSummary} from '../site/lib/source-health-model.js';
const now=1800000000000;
test('source checks separate failed requests, stale values, coverage and optional sources',()=>{
  const check={label:'Publisher',checked:now,maxAgeMs:60000};
  assert.equal(sourceHealth({...check,error:'HTTP 503',state:'coverage'},now).status,'failed');
  assert.equal(sourceHealth({...check,checked:now-60001},now).status,'stale');
  assert.equal(sourceHealth({...check,state:'coverage'},now).status,'coverage');
  assert.equal(sourceHealth({...check,state:'unassessed',checked:null},now).status,'unassessed');
  assert.equal(sourceHealth({...check,checked:null},now).status,'checking');
  assert.equal(sourceHealth({...check,checked:now+120001},now).status,'unknown');
  assert.equal(sourceHealth({...check,checked:NaN},now).status,'checking');
  assert.equal(sourceHealth({...check,state:'stale'},now).status,'stale','a new app check cannot renew an old source observation');
  assert.equal(sourceHealth(check,now).status,'current');
});
test('review total deduplicates a key and excludes checks not yet assessed without calling them healthy',()=>{
  const checks=new Map([['gauge',{label:'Gauge',checked:now,state:'coverage'}],['optional',{label:'Reference',state:'unassessed'}],['waiting',{label:'Waiting'}]]);
  checks.set('gauge',{label:'Gauge',checked:now,error:'failed'});
  const summary=sourceHealthSummary(checks,now);assert.equal(summary.review,1);assert.equal(summary.total,3);
  assert.equal(summary.groups.find(g=>g.id==='current').rows.length,0);assert.equal(summary.groups.find(g=>g.id==='failed').rows.length,1);
});
