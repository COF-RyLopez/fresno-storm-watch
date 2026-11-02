import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {validateBriefingImpacts,briefingImpacts} from '../site/lib/briefing-impact-model.js';
const register=JSON.parse(await readFile(new URL('../site/data/hanford-briefing-impacts.json',import.meta.url),'utf8'));
const snapshot=JSON.parse(await readFile(new URL('../site/data/hanford-briefing.json',import.meta.url),'utf8'));
// Fixed reviewed identity for unit cases; deployment may legitimately collect a newer PDF.
const publishedSnapshot=structuredClone(snapshot);snapshot.document.sha256=register.documents.find(d=>d.kind==='latest').sha256;
const now=Date.parse('2026-10-19T23:00:00Z'),copy=v=>structuredClone(v);
// Collection checks advance during deployment; unit freshness assertions must use fixed clocks.
snapshot.error=null;snapshot.checkedAt=snapshot.lastSuccessAt=new Date(now).toISOString();
for(const k of ['sourceUpdatedAt','collectedAt','fileModifiedAt'])snapshot.document[k]=new Date(now-3600000).toISOString();

test('Fresno summaries bind source pages to the exact public PDF',async()=>{
  validateBriefingImpacts(register);
  for(const d of register.documents){const bytes=await readFile(new URL('../site/data/hanford-briefing-current.pdf',import.meta.url));const hash=createHash('sha256').update(bytes).digest('hex');if(publishedSnapshot.document.sha256===d.sha256)assert.equal(hash,d.sha256);else{assert.equal(hash,publishedSnapshot.document.sha256);assert(briefingImpacts(register,publishedSnapshot,now).unreviewed);}}
  const result=briefingImpacts(register,snapshot,now);assert.equal(result.rows.length,2);assert.equal(result.unreviewed,false);assert(result.rows.every(r=>r.period==='upcoming'));
});
test('a new public revision withholds its old impacts',()=>{
  const s=copy(snapshot);s.document.sha256='a'.repeat(64);
  const r=briefingImpacts(register,s,now);assert(r.unreviewed);assert.equal(r.rows.length,0);
});
test('missing source identity cannot claim a current public summary',()=>{
  for(const s of [null,{document:null,error:'unavailable'}]){const r=briefingImpacts(register,s,now);assert(r.missing);assert.equal(r.rows.length,0);}
  assert.equal(briefingImpacts(null,snapshot,now).rows.length,0);
});
test('failed or overdue checks qualify retained summaries without refreshing their forecast dates',()=>{
  const failed=briefingImpacts(register,{...snapshot,error:'NWS source HTTP 503'},now);
  assert(failed.rows.filter(r=>r.document.kind==='latest').every(r=>r.qualification.includes('503')));
  const overdue=briefingImpacts(register,snapshot,now+60*60_000);assert(overdue.rows.filter(r=>r.document.kind==='latest').every(r=>r.status.includes('verify source')));
});
test('forecast windows end on Pacific calendar dates even when a document is newly downloaded',()=>{
  const fresh=copy(snapshot);for(const k of ['checkedAt','lastSuccessAt'])fresh[k]='2026-10-23T08:00:00Z';fresh.document.sourceUpdatedAt=fresh.document.collectedAt=fresh.document.fileModifiedAt=fresh.checkedAt;
  assert(briefingImpacts(register,fresh,Date.parse('2026-10-23T06:59:59Z')).rows.every(r=>r.period==='within'));
  assert(briefingImpacts(register,fresh,Date.parse('2026-10-23T07:00:00Z')).rows.every(r=>r.period==='past'&&r.status==='Past forecast period'));
});
test('invalid pages, dates, duplicate IDs and alternate source URLs fail closed',()=>{
  const changes=[r=>r.impacts[0].page=99,r=>r.impacts[0].firstDate='2026-10-32',r=>r.impacts[0].lastDate='2026-10-01',r=>r.impacts[1].id=r.impacts[0].id,r=>r.documents[0].sourcePdf='https://example.com/data.pdf',r=>r.documents[0].kind='archive',r=>r.documents.push({...r.documents[0]}),r=>r.impacts[0].confidence=''];
  for(const change of changes){const r=copy(register);change(r);assert.throws(()=>validateBriefingImpacts(r));}
});
test('confidence remains attributed and distinct from probabilities; county interpretations are separate',()=>{
  const rows=briefingImpacts(register,snapshot,now).rows;
  const snow=rows.find(r=>r.id==='fresno-high-sierra-snow');assert.match(snow.confidence,/Medium/);assert.match(snow.probability,/40%/);assert.match(snow.limitation,/outside Fresno County/);
  assert(rows.every(r=>r.planning&&r.geography&&r.limitation));
});
