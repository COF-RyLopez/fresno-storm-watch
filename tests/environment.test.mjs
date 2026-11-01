import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { realNumber,sourceTime,radarFrames,qpfCycle,qpfPlanningTime,cdecSeries,reservoirMetricState,validateReservoirSnapshot,upstreamStorage,QPF_PERIODS } from '../site/lib/environment-model.js';
import { fetchQpfCycle,fetchRadarFrames } from '../site/lib/environment-data.js';
import { collectReservoirs,collectUpstream } from '../scripts/collect-reservoirs.mjs';

const now=Date.parse('2026-10-17T21:00:00Z');
const metric={key:'outflow',label:'Outflow',sensor:23,duration:'H',units:'CFS',maxAgeHours:3};
const row=(changes={})=>({stationId:'PNF',durCode:'H',SENSOR_NUM:23,obsDate:'2026-10-17 12:00',date:'2026-10-17 12:00',value:252,units:'CFS',dataFlag:' ',...changes});
const cycle=(changes={})=>({product:'72-hour QPF',units:'Inches',issue_time:'2026-10-17 18:00:00',start_time:'2026-10-18 00:00:00',end_time:'2026-10-21 00:00:00',...changes});
const feature=a=>({attributes:a});
const selection={stations:[{id:'MIL',metrics:[{...metric,duration:'D'}]},{id:'PNF',metrics:[metric]}]};

test('CDEC fixed PST and NOAA UTC parsing are independent of browser daylight saving',()=>{
  assert.equal(sourceTime('2026-10-17 12:00','-08:00'),Date.parse('2026-10-17T20:00:00Z'));
  assert.equal(sourceTime('2026-10-18 5:00','-08:00'),Date.parse('2026-10-18T13:00:00Z'));
  assert.equal(sourceTime('2026-9-7 0:00','-08:00'),Date.parse('2026-09-07T08:00:00Z'));
  assert.equal(sourceTime('2026-10-17 18:00:00'),Date.parse('2026-10-17T18:00:00Z'));
  for(const s of ['2026-02-30 12:00','2026-10-17 24:00','yesterday',''])assert.equal(sourceTime(s),null);
});
test('real numeric zero survives while sentinel, blank and boolean values stay unknown',()=>{
  assert.equal(realNumber(0),0);assert.equal(realNumber('0'),0);
  for(const n of [null,undefined,'',true,NaN,Infinity,-9999,'-999'])assert.equal(realNumber(n),null);
});
test('radar timestamps come from CONUS, not the newer Guam frame; duplicates are deterministic',()=>{
  const f=(id,time,subset='CONUS')=>feature({objectid:id,idp_validtime:time,idp_subset:subset});
  const frames=radarFrames({features:[f(1,now-600000),f(2,now-300000),f(3,now-300000),f(4,now,'GUAM'),f(5,now+999999)]},now);
  assert.deepEqual(frames.map(f=>f.id),[3,1]);
  assert.throws(()=>radarFrames({features:[f(1,now)],exceededTransferLimit:true},now),/incomplete/);
  assert.throws(()=>radarFrames({features:[f(1,now-6*3600000)]},now),/No recent/);
});
test('QPF has one coherent fixed forecast window across all polygon bands',()=>{
  const result=qpfCycle({features:[feature(cycle()),feature(cycle())]},72,now);
  assert.equal(result.start,Date.parse('2026-10-18T00:00:00Z'));assert.equal(result.hours,72);
  assert.throws(()=>qpfCycle({features:[feature(cycle()),feature(cycle({issue_time:'2026-10-17 12:00:00'}))]},72,now),/mixed/);
  assert.throws(()=>qpfCycle({features:[feature(cycle())],exceededTransferLimit:true},72,now),/incomplete/);
});
test('QPF rejects unexpected units, future issuance and a wrong accumulation length',()=>{
  for(const a of [cycle({units:'mm'}),cycle({issue_time:'2026-10-18 06:00:00'}),cycle({end_time:'2026-10-20 00:00:00'})])assert.throws(()=>qpfCycle({features:[feature(a)]},72,now),/times or units/);
});
test('a forecast update during its valid window is legitimate and keeps that fixed window',()=>{
  const result=qpfCycle({features:[feature(cycle({start_time:'2026-10-17 00:00:00',end_time:'2026-10-20 00:00:00'}))]},72,now);
  assert(result.issue>result.start);assert.equal(result.end-result.start,72*3600000);
});
test('explicit rainfall preview enters a valid window and preserves an already eligible planning time',()=>{
  const forecast=qpfCycle({features:[feature(cycle())]},72,now),maxAge=24*3600000;
  assert.equal(qpfPlanningTime(forecast,now,now,maxAge),forecast.start);
  assert.equal(qpfPlanningTime(forecast,forecast.start+3600000,now,maxAge),forecast.start+3600000);
  assert.equal(qpfPlanningTime(forecast,forecast.end,now,maxAge),forecast.start);
  const updated=qpfCycle({features:[feature(cycle({start_time:'2026-10-17 00:00:00',end_time:'2026-10-20 00:00:00'}))]},72,now);
  assert.equal(qpfPlanningTime(updated,updated.start,now,maxAge),now);
});
test('rainfall preview cannot choose an expired, stale, malformed or unavailable cycle',()=>{
  const forecast=qpfCycle({features:[feature(cycle())]},72,now);
  for(const bad of [null,{...forecast,end:now},{...forecast,issue:now-48*3600000},{...forecast,issue:NaN},{...forecast,issue:now+3600000},{...forecast,start:forecast.end}])assert.equal(qpfPlanningTime(bad,now,now,24*3600000),null);
});
test('CDEC values retain source identity and units; an hourly posting delay is normal, a real gap or flag is explicit',()=>{
  const result=cdecSeries([row(),row({obsDate:'2026-10-17 13:00',value:-9999}),row({stationId:'MIL',value:999})],'PNF',metric,now);
  assert.equal(result.lastValid.value,252);assert.equal(result.latest.value,null);assert.equal(result.input,2);
  // One blank hour after the last reading: CDEC has not posted it yet.
  assert.deepEqual([reservoirMetricState(result,metric,now).tone,reservoirMetricState(result,metric,now).label],['normal','Recent hourly report · newest hour not posted yet']);
  const wide={...metric,maxAgeHours:6},late=cdecSeries([row({obsDate:'2026-10-17 08:30'}),row({obsDate:'2026-10-17 12:00',value:-9999})],'PNF',wide,now);
  assert.match(reservoirMetricState(late,wide,now).label,/Newer record missing/,'blank for more than 3 h is a gap');
  const flagged=cdecSeries([row(),row({obsDate:'2026-10-17 13:00',value:260,dataFlag:'r'})],'PNF',metric,now);
  assert.match(reservoirMetricState(flagged,metric,now).label,/Newer record missing or flagged/,'a flagged newer value stays a warning');
  const daily={...metric,duration:'D',maxAgeHours:72},dayRow=(date,value)=>row({durCode:'D',obsDate:`${date} 00:00`,value});
  assert.equal(reservoirMetricState(cdecSeries([dayRow('2026-10-15',252),dayRow('2026-10-16',-9999)],'PNF',daily,now),daily,now).label,'Daily report · newest day not posted yet');
  const slow={...daily,maxAgeHours:120};assert.match(reservoirMetricState(cdecSeries([dayRow('2026-10-14',252),dayRow('2026-10-16',-9999)],'PNF',slow,now),slow,now).label,/Newer record missing/,'two days behind is a gap');
});

const up={basin:'San Joaquin above Millerton',maxAgeDays:4,metric:{key:'storage',sensor:15,duration:'D',units:'AF'},stations:[{id:'SHV',name:'Shaver Lake'},{id:'MPL',name:'Mammoth Pool'}]};
const day=(id,date,value)=>({stationId:id,durCode:'D',SENSOR_NUM:15,obsDate:`${date} 00:00`,date:`${date} 00:00`,value,units:'AF',dataFlag:' '});
test('upstream storage: one CDEC request, 1- and 7-day change, totals only when every reservoir reports',async()=>{
  const rows=[...['2026-10-09','2026-10-15','2026-10-16'].map((d,i)=>day('SHV',d,[60000,67000,67500][i])),day('MPL','2026-10-15',25000),day('MPL','2026-10-16',25800),day('MPL','2026-10-17',-9999)];
  let asked;const block=await collectUpstream({upstream:up,old:null,now,start:'2026-10-09',fetchImpl:async u=>{asked=String(u);return new Response(JSON.stringify(rows));}});
  assert.match(asked,/Stations=SHV%2CMPL&SensorNums=15&dur_code=D/);assert.equal(block.error,null);
  const s=upstreamStorage({upstream:block},up,now),[shv,mpl]=s.rows;
  assert.deepEqual([shv.value,shv.change1d,shv.change7d,shv.old],[67500,500,7500,false]);
  assert.deepEqual([mpl.value,mpl.change1d,mpl.change7d],[25800,800,null]);
  assert.deepEqual(s.total,{value:93300,change1d:1300,change7d:null});
  const failed=await collectUpstream({upstream:up,old:block,now,start:'2026-10-09',fetchImpl:async()=>new Response('[{"stationId":"XXX"}]')});
  assert.match(failed.error,/Unexpected station/);assert.deepEqual(failed.series,block.series,'previous values retained');
  assert.equal(upstreamStorage(null,up,now).rows.every(r=>r.value===null&&r.old),true);
});
test('zero release is a measured zero; negative inflow is allowed only for an inflow contract',()=>{
  assert.equal(cdecSeries([row({value:0})],'PNF',metric,now).lastValid.value,0);
  assert.equal(cdecSeries([row({value:-4})],'PNF',metric,now).lastValid,null);
  assert.equal(cdecSeries([row({value:-4})],'PNF',{...metric,allowNegative:true},now).lastValid.value,-4);
});
test('flagged/wrong-unit values, future samples and conflicting duplicates cannot look current',()=>{
  for(const a of [row({dataFlag:'M'}),row({units:'CMS'}),row({obsDate:'2026-10-18 12:00'})])assert.equal(cdecSeries([a],'PNF',metric,now).lastValid,null);
  const conflict=cdecSeries([row(),row({value:253})],'PNF',metric,now);
  assert.equal(conflict.lastValid,null);assert.equal(conflict.conflicts,1);assert.equal(conflict.latest.flag,'CONFLICT');
  const deduplicated=cdecSeries([row(),row(),row({obsDate:'2026-10-18 12:00'})],'PNF',metric,now);
  assert.equal(deduplicated.duplicates,1);assert.equal(deduplicated.input,deduplicated.accepted+deduplicated.rejected+deduplicated.duplicates);
});
test('historical duplicate conflicts do not freeze later valid readings and are order independent',()=>{
  const rows=[row({obsDate:'2026-10-17 9:00',value:100}),row({obsDate:'2026-10-17 09:00',value:101}),row({obsDate:'2026-10-17 9:00',value:100}),row()];
  const a=cdecSeries(rows,'PNF',metric,now),b=cdecSeries([...rows].reverse(),'PNF',metric,now);
  assert.deepEqual(a,b);assert.equal(a.lastValid.value,252);assert.equal(a.conflicts,1);assert.equal(a.duplicates,2);
  assert.equal(a.input,a.accepted+a.rejected+a.duplicates);
  assert.equal(reservoirMetricState(a,metric,now).tone,'normal');
});
test('morning readings survive CDEC unpadded hours and genuinely malformed times remain conspicuous',()=>{
  const time=Date.parse('2026-10-18T13:30:00Z');
  const series=cdecSeries([row({obsDate:'2026-10-18 5:00'})],'PNF',metric,time);
  assert.equal(series.rejected,0);assert.equal(reservoirMetricState(series,metric,time).tone,'normal');
  const bad=cdecSeries([row(),row({obsDate:'unrecognized'})],'PNF',metric,now);
  assert.match(reservoirMetricState(bad,metric,now).label,/Unrecognized/);
});
test('recent snapshot collection does not refresh the age of a reservoir measurement',()=>{
  const series=cdecSeries([row({obsDate:'2026-10-16 12:00'})],'PNF',metric,now);
  assert.equal(reservoirMetricState(series,metric,now).label,'Old reading');
  assert.equal(reservoirMetricState(null,metric,now).sample,null);
});
test('collector distinguishes Millerton total outflow, river outlet release and spill contracts',async()=>{
  const settings=JSON.parse(await readFile(new URL('../site/data/reservoir-watchlist.json',import.meta.url),'utf8'));
  const mil=settings.stations.find(s=>s.id==='MIL');
  assert.deepEqual(mil.metrics.filter(m=>['release','spill','outflow'].includes(m.key)).map(m=>[m.key,m.sensor,m.duration]),[['release',85,'D'],['spill',71,'D'],['outflow',23,'D']]);
});
test('collector partial failure retains the failed station with its old successful time',async()=>{
  const previous={stations:[{id:'MIL',lastSuccess:'2026-10-16T20:00:00Z',metrics:{outflow:{lastValid:{value:387}}}}]};
  const snapshot=await collectReservoirs({selection,previous,now,fetchImpl:async url=>{
    if(url.searchParams.get('Stations')==='MIL')throw new Error('Test source unavailable');
    return {ok:true,json:async()=>[row()]};
  }});
  assert.match(snapshot.stations[0].error,/unavailable/);assert.equal(snapshot.stations[0].lastSuccess,previous.stations[0].lastSuccess);
  assert.equal(snapshot.stations[0].metrics.outflow.lastValid.value,387);assert.equal(snapshot.stations[1].metrics.outflow.lastValid.value,252);
  validateReservoirSnapshot(snapshot);
});
test('collector requests completed daily reports and keeps independent metrics despite one historical conflict',async()=>{
  const snapshot=await collectReservoirs({selection,now,fetchImpl:async url=>{
    const stationId=url.searchParams.get('Stations'),durCode=url.searchParams.get('dur_code');
    if(durCode==='E')return {ok:true,json:async()=>[]};
    if(durCode==='D')assert.equal(url.searchParams.get('End'),'2026-10-16');
    return {ok:true,json:async()=>[row({stationId,durCode,obsDate:'2026-10-15 0:00',value:250}),row({stationId,durCode,obsDate:'2026-10-15 00:00',value:251}),row({stationId,durCode,obsDate:'2026-10-16 0:00',value:252})]};
  }});
  assert.equal(snapshot.stations[0].error,null);assert.equal(snapshot.stations[0].metrics.outflow.conflicts,1);assert.equal(snapshot.stations[0].metrics.outflow.lastValid.value,252);
  assert.equal(snapshot.stations[0].scheduled.error,null);
});
test('collector marks unexpected station responses failed rather than silently discarding them',async()=>{
  const snapshot=await collectReservoirs({selection,now,fetchImpl:async()=>({ok:true,json:async()=>[row({stationId:'OTHER'})]})});
  assert(snapshot.stations.every(s=>s.error&&s.lastSuccess===null));
  assert.throws(()=>validateReservoirSnapshot({...snapshot,stations:snapshot.stations.slice(0,1)}),/missing/);
});
test('public source adapters reject HTTP/service errors and never send credentials',async()=>{
  await assert.rejects(fetchRadarFrames(async()=>({ok:false,status:503}),now),/503/);
  await assert.rejects(fetchQpfCycle(QPF_PERIODS[1],async()=>({ok:true,json:async()=>({error:{code:400}})}),now),/service error/);
  let query;
  await fetchQpfCycle(QPF_PERIODS[1],async(url,options)=>{query=url;assert.equal(options.credentials,'omit');return {ok:true,json:async()=>({features:[feature(cycle())]})};},now);
  assert.equal(query.searchParams.get('returnGeometry'),'false');assert.equal(query.searchParams.get('resultRecordCount'),'2000');
});
