import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {collectBriefing} from '../scripts/collect-briefing.mjs';
import {parseBriefingDate,validateBriefingSnapshot,briefingState,HNX_BRIEFING_PAGE,HNX_BRIEFING_PDF} from '../site/lib/briefing-model.js';
const now=Date.parse('2026-10-19T18:00:00Z'),pdf=Buffer.from('%PDF-1.7\n'+'.'.repeat(160)+'\n%%EOF');
const page=`<h4>Last Update: Mon Oct 19 02:40:02 PDT 2026</h4><a href="${HNX_BRIEFING_PDF}">Partner Email in PDF</a>`;
const fetcher=(html=page,bytes=pdf)=>async(url,options)=>{assert.equal(options.redirect,'error');assert([HNX_BRIEFING_PAGE,HNX_BRIEFING_PDF].includes(url));return new Response(url===HNX_BRIEFING_PAGE?html:bytes,{headers:{'Last-Modified':'Mon, 19 Oct 2026 09:40:02 GMT'}});};
test('Hanford publisher time uses explicit Pacific offset and rejects invalid calendar values',()=>{
  assert.equal(new Date(parseBriefingDate('Mon Oct 19 02:40:02 PDT 2026')).toISOString(),'2026-10-19T09:40:02.000Z');
  assert.equal(new Date(parseBriefingDate('Mon Dec 21 06:00:00 PST 2026')).toISOString(),'2026-12-21T14:00:00.000Z');
  for(const v of ['Monday October 19 2026','Mon Feb 30 06:00:00 PST 2026','Mon Oct 19 25:00:00 PDT 2026','Mon Oct 19 02:40:02 XYZ 2026'])assert.throws(()=>parseBriefingDate(v));
});
test('public collector binds publication time and revision to the exact validated PDF',async()=>{
  const r=await collectBriefing({fetchImpl:fetcher(),now});assert.equal(r.snapshot.error,null);assert.equal(r.snapshot.document.sha256,createHash('sha256').update(pdf).digest('hex'));assert.equal(r.snapshot.document.sourceUpdatedAt,'2026-10-19T09:40:02.000Z');assert.equal(r.snapshot.document.collectedAt,new Date(now).toISOString());assert.deepEqual(r.pdf,pdf);assert.equal(briefingState(r.snapshot,now).tone,'current');
});
test('failed collection retains the old file and its successful times without freshening them',async()=>{
  const first=await collectBriefing({fetchImpl:fetcher(),now});const later=now+60*60_000;
  const failed=await collectBriefing({previous:first.snapshot,previousPdf:pdf,fetchImpl:async()=>new Response('unavailable',{status:503}),now:later});
  assert.equal(failed.snapshot.document.collectedAt,first.snapshot.document.collectedAt);assert.equal(failed.snapshot.checkedAt,new Date(later).toISOString());assert.equal(failed.pdf,pdf);assert.match(failed.snapshot.error,/503/);assert.equal(briefingState(failed.snapshot,later).tone,'gap');
});
test('unchanged-source checks preserve file retrieval time while advancing only successful verification',async()=>{
  const first=await collectBriefing({fetchImpl:fetcher(),now}),later=now+15*60_000;
  const unchanged=await collectBriefing({previous:first.snapshot,previousPdf:pdf,now:later,fetchImpl:async(url,options)=>{if(url===HNX_BRIEFING_PAGE)return new Response(page);assert.equal(options.headers['If-Modified-Since'],'Mon, 19 Oct 2026 09:40:02 GMT');return new Response(null,{status:304});}});
  assert.equal(unchanged.snapshot.document.collectedAt,first.snapshot.document.collectedAt);assert.equal(unchanged.snapshot.lastSuccessAt,new Date(later).toISOString());assert.equal(unchanged.pdf,pdf);assert.equal(briefingState(unchanged.snapshot,later).tone,'current');
});
test('changed public PDFs get new identities and cannot inherit another revision\'s previews',async()=>{
  const first=await collectBriefing({fetchImpl:fetcher(),now}),d=first.snapshot.document;
  d.previews=[{path:`./data/briefing-previews/${d.sha256}/1.webp`,width:1200,height:900}];
  const changed=Buffer.from('%PDF-1.7\n'+'.'.repeat(161)+'\n%%EOF');
  const second=await collectBriefing({previous:first.snapshot,previousPdf:pdf,fetchImpl:fetcher(page,changed),now:now+60_000});
  assert.notEqual(second.snapshot.document.sha256,d.sha256);assert.equal(second.snapshot.document.previews,undefined);assert.equal(second.pdf.length,changed.length);
});
test('missing products, future dates, HTML and truncated PDFs remain explicit failures',async()=>{
  const cases=[[page.replace(HNX_BRIEFING_PDF,'https://example.com/file.pdf'),pdf],[page.replace('Oct 19','Oct 20'),pdf],['<html>Removed product</html>',pdf],[page,Buffer.from('<html>Proxy error</html>')],[page,Buffer.from('%PDF-1.7\n'+'.'.repeat(160))]];
  for(const [html,bytes]of cases){const r=await collectBriefing({fetchImpl:fetcher(html,bytes),now});assert(r.snapshot.error);assert.equal(r.snapshot.document,null);assert.equal(briefingState(r.snapshot,now).usable,false);}
});
test('wrong prior content and oversized source responses cannot be silently republished',async()=>{
  const first=await collectBriefing({fetchImpl:fetcher(),now});await assert.rejects(()=>collectBriefing({previous:first.snapshot,previousPdf:Buffer.from('wrong'),now}),/does not match/);
  const large=await collectBriefing({fetchImpl:fetcher('x'.repeat(2_000_001)),now});assert.match(large.snapshot.error,/size limit/);
});
test('fresh collection does not renew an old briefing and a stale collection stays qualified',async()=>{
  const r=await collectBriefing({fetchImpl:fetcher(),now});const old={...r.snapshot,document:{...r.snapshot.document,sourceUpdatedAt:new Date(now-37*3600_000).toISOString()}};
  assert.match(briefingState(old,now).label,/Older briefing/);assert.match(briefingState(r.snapshot,now+46*60_000).label,/Retained/);assert.equal(briefingState(null,now).usable,false);
  const oldFile={...r.snapshot,document:{...r.snapshot.document,sourceUpdatedAt:new Date(now).toISOString(),fileModifiedAt:new Date(now-37*3600_000).toISOString()}};assert.match(briefingState(oldFile,now).label,/Older briefing/);
  assert.throws(()=>validateBriefingSnapshot({...r.snapshot,sourcePdf:HNX_BRIEFING_PDF+'?token=not-allowed'}));
});
test('deployed current PDF and dated partner deck match their published provenance',async()=>{
  const s=validateBriefingSnapshot(JSON.parse(await readFile(new URL('../site/data/hanford-briefing.json',import.meta.url),'utf8'))),bytes=await readFile(new URL('../site/data/hanford-briefing-current.pdf',import.meta.url));assert.equal(createHash('sha256').update(bytes).digest('hex'),s.document.sha256);assert.equal(bytes.length,s.document.bytes);
  const archive=await readFile(new URL('../site/data/briefings/nws-hanford-2026-10-19.pdf',import.meta.url));assert.equal(createHash('sha256').update(archive).digest('hex'),'28b42dc4cfc6c0e8890d2fe9e3c0466aec01fe469f00404eb4d35f46c3b8d5b4');
  assert(s.document.previews.length>0&&s.document.previews.length<=40);for(const p of s.document.previews){const im=await readFile(new URL('../site/'+p.path.slice(2),import.meta.url));assert.equal(im.subarray(0,4).toString(),'RIFF');assert.equal(im.subarray(8,12).toString(),'WEBP');}
  for(let i=1;i<=19;i++){const im=await readFile(new URL(`../site/data/briefing-previews/28b42dc4cfc6c0e8890d2fe9e3c0466aec01fe469f00404eb4d35f46c3b8d5b4/${i}.webp`,import.meta.url));assert.equal(im.subarray(8,12).toString(),'WEBP');}
  assert.throws(()=>validateBriefingSnapshot({...s,document:{...s.document,previews:[{path:'https://example.com/image.svg',width:1200,height:900}]}}));
});
