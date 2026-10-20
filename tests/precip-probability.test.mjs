import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {PROBABILITY_SOURCE,PROBABILITY_BOUNDS,PROBABILITY_LEGEND,PROBABILITY_STEPS,parseProbabilityCycle,probabilityPeriods,probabilityImageUrl,validateProbabilitySnapshot,probabilityRecord} from '../site/lib/precip-probability-model.js';
import {collectProbability,probabilityPng,probabilitySourceContract} from '../scripts/collect-probability.mjs';
const now=Date.parse('2026-10-20T02:00:00Z'),cycle='2026102001';
const png=()=>{const b=Buffer.alloc(100);Buffer.from('89504e470d0a1a0a','hex').copy(b);b.write('IHDR',12);b.writeUInt32BE(2643,16);b.writeUInt32BE(1446,20);Buffer.from('49454e44ae426082','hex').copy(b,92);return b;};
const script="xmin: -124.786952, ymin: 24.530802, xmax: -95.856708, ymax: 38.002106\n'0p25': 'ige0p25'\n'0p50': 'ige0p50'\nppp_ndfd_\n"+PROBABILITY_LEGEND.map(([l,c])=>`'${l}': '${c}'`).join('\n');
const snapshot=()=>({schemaVersion:1,source:PROBABILITY_SOURCE,checkedAt:new Date(now).toISOString(),error:null,cycle,issue:'2026-10-20T01:00:00.000Z',bounds:PROBABILITY_BOUNDS,legend:PROBABILITY_LEGEND,records:probabilityPeriods(cycle,now).flatMap(p=>['0p25','0p50'].map(threshold=>({period:p.index,threshold,start:p.start,end:p.end,source:probabilityImageUrl(cycle,threshold,p.forecastHour),sha256:'a'.repeat(64),file:'probability-images/'+'a'.repeat(64)+'.png',bytes:100,width:2643,height:1446})))});
test('cycle declaration is parsed as data and rejects injection, invalid dates, future and stale cycles',()=>{
  assert.equal(parseProbabilityCycle(`window.cycle = '${cycle}';`,now).cycle,cycle);
  for(const s of [`window.cycle='${cycle}'; alert(1)`,"window.cycle='2026023001';","window.cycle='2026102004';","window.cycle='2026101901';"])assert.throws(()=>parseProbabilityCycle(s,now));
});
test('CONUS periods match publisher availability through all 24 cycle hours, including 66h/72h shifts',()=>{
  for(let hour=0;hour<24;hour++){
    const c='20261019'+String(hour).padStart(2,'0'),n=Date.parse(`2026-10-19T${String(hour).padStart(2,'0')}:30:00Z`),periods=probabilityPeriods(c,n);
    assert.equal(periods.length,[6,7,8,9,10,18,19,20,21].includes(hour)?2:3);
    assert.equal(periods[0].forecastHour,24-hour%6);
    for(const p of periods){assert.equal(Date.parse(p.end)-Date.parse(p.start),24*3_600_000);assert.equal(new Date(p.end).getUTCHours()%6,0);}
  }
});
test('thresholds keep percentage semantics, original colors, source CRS and archived-slide links',()=>{
  assert.equal(PROBABILITY_STEPS.length,6);assert.equal(PROBABILITY_STEPS[0].page,6);assert.equal(PROBABILITY_STEPS[1].page,7);
  assert.match(PROBABILITY_STEPS[0].meaning,/not a flood probability/);assert.match(PROBABILITY_STEPS[0].relationship,/dates can differ/);
  assert.equal(PROBABILITY_LEGEND[0][1],'#003200');assert.equal(PROBABILITY_BOUNDS.spatialReference.wkid,4326);
  assert.match(probabilityImageUrl(cycle,'0p25',23),/pp24ige0p25_2026102001f023_tile_0_1\.png$/);
  assert.throws(()=>probabilityImageUrl(cycle,'../../secret',23));
});
test('one coherent snapshot selects exact threshold and period without substituting unavailable windows',()=>{
  const d=snapshot();assert.equal(validateProbabilitySnapshot(d,now),d);assert.equal(probabilityRecord(d,PROBABILITY_STEPS[3],now).threshold,'0p50');
  const c='2026102006',n=Date.parse('2026-10-20T06:30Z'),short=snapshot();short.cycle=c;short.issue='2026-10-20T06:00:00.000Z';short.checkedAt=new Date(n).toISOString();short.records=probabilityPeriods(c,n).flatMap(p=>['0p25','0p50'].map(threshold=>({...d.records[0],period:p.index,threshold,start:p.start,end:p.end,source:probabilityImageUrl(c,threshold,p.forecastHour)})));
  assert.throws(()=>probabilityRecord(short,PROBABILITY_STEPS[4],n),/not available/);
});
test('mixed revisions, missing or duplicate files, changed colors/extent, wrong units-window and stale data fail closed',()=>{
  const changes=[d=>d.records.pop(),d=>d.records.push(d.records[0]),d=>d.records[0].source='https://example.com/a.png',d=>d.records[0].start=d.records[0].end,d=>d.records[0].file='../private.json',d=>d.records[0].sha256='no',d=>d.bounds={...d.bounds,xmin:-125},d=>d.legend=[['90%','#ff0000']],d=>d.checkedAt='2026-10-19T23:00Z',d=>d.error='collection failed'];
  for(const change of changes){const d=structuredClone(snapshot());change(d);assert.throws(()=>validateProbabilitySnapshot(d,now));}
});
test('PNG and source contract checks reject HTML, truncation, oversized textures and changed georeference',()=>{
  assert.deepEqual(probabilityPng(png()),{width:2643,height:1446});assert.doesNotThrow(()=>probabilitySourceContract(script));
  assert.throws(()=>probabilityPng(Buffer.from('<html>error</html>')));assert.throws(()=>probabilityPng(png().subarray(0,99)));const b=png();b.writeUInt32BE(10000,16);assert.throws(()=>probabilityPng(b));
  assert.throws(()=>probabilitySourceContract(script.replace('38.002106','38.5')));assert.throws(()=>probabilitySourceContract(script.replace('#003200','#000000')));
});
test('collector publishes complete source-hashed images, and withholds all output after partial failure or cycle rollover',async()=>{
  for(const failure of ['none','image','rollover']){
    let cycles=0,requests=0;
    const fetchImpl=async url=>{requests++;if(url.endsWith('current_cycle_co.js')){cycles++;return new Response(`window.cycle = '${failure==='rollover'&&cycles>1?'2026102002':cycle}';`);}if(url.endsWith('script.js?v=5'))return new Response(script);if(failure==='image'&&requests>4)return new Response('missing',{status:404});return new Response(png());};
    const result=await collectProbability({now,fetchImpl});
    if(failure==='none'){assert.equal(result.snapshot.error,null);assert.equal(result.snapshot.records.length,6);for(const r of result.snapshot.records)assert.equal(r.sha256,createHash('sha256').update(png()).digest('hex'));}
    else{assert(result.snapshot.error);assert.equal(result.images.size,0);assert.equal(result.snapshot.records.length,0);}
  }
});
