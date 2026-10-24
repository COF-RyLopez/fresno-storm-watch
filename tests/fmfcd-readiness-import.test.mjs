import test from 'node:test';
import assert from 'node:assert/strict';
import {previewFmfcdReadiness} from '../scripts/lib/fmfcd-readiness-import.mjs';
import {pumpSummaryExercise} from '../site/lib/pump-summary-exercise.js';
const now=Date.now(),p=pumpSummaryExercise(now).readinessRecords.checklists[0].payload;
function fixture(){const keys=['pumpLabel','backup','connection','fuel','runtimeHours','runtimeBasis','owner','contact','observed','validUntil','evidence'];return {now,rows:[{id:'maintained-fictional-1',rev:'r1',...Object.fromEntries(keys.map(k=>[k,typeof p[k]==='number'&&['observed','validUntil'].includes(k)?new Date(p[k]).toISOString():p[k]]))}],mapping:{schema:1,publisher:'FICTIONAL FMFCD test',schemaVersion:'test-v1',runtimeUnits:'hours',fields:{assetId:'id',sourceRevision:'rev',...Object.fromEntries(keys.map(k=>[k,k]))},values:{backup:{Unavailable:'Unavailable'},connection:{Unknown:'Unknown'},fuel:{'Confirmed available':'Confirmed available'}}},crosswalk:[{assetId:'maintained-fictional-1',binding:p.binding,reviewedBy:'Fictional reviewer',reviewedAt:new Date(now).toISOString()}]};}
test('external field mapping preview retains provenance, units and explicit unknowns without a remote write',()=>{const r=previewFmfcdReadiness(fixture());assert.equal(r.counts.accepted,1);assert.equal(r.rejected.length,0);assert(r.previewOnly);assert.equal(r.accepted[0].sourceRevision,'r1');assert.deepEqual(r.accepted[0].payload.binding,p.binding);});
test('unmapped IDs / codes, ambiguous crosswalks, undocumented units and time zones never become valid readiness',()=>{
  for(const mutate of [f=>f.rows[0].id='unknown',f=>f.rows[0].backup='maybe',f=>f.mapping.runtimeUnits='minutes',f=>f.rows[0].observed='2026-10-24T12:00:00',f=>f.rows[0].runtimeHours='12',f=>f.rows[0].validUntil=new Date(now-1).toISOString()]){const f=fixture();mutate(f);const r=previewFmfcdReadiness(f);assert.equal(r.counts.accepted,0);assert.equal(r.counts.rejected,1);}
  const f=fixture();f.crosswalk.push({...f.crosswalk[0],assetId:'another'});assert.throws(()=>previewFmfcdReadiness(f),/Ambiguous/);
});
test('duplicate source IDs quarantine all affected rows, preserving accounting and unrelated updates',()=>{const f=fixture();f.rows.push(structuredClone(f.rows[0]));const r=previewFmfcdReadiness(f);assert.equal(r.inputCount,2);assert.equal(r.counts.accepted,0);assert.equal(r.counts.rejected,2);});
