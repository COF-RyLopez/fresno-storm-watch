import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHads,telemetryGauge,poolBackup,HADS_SITES} from '../site/lib/pine-flat-telemetry.js';
import {collectPineFlatTelemetry} from '../scripts/lib/pine-flat-collector.mjs';
import {buildReleaseTrend} from '../site/lib/release-trend-model.js';
import {CONFIG} from '../site/config.js';
const now=Date.parse('2026-11-14T16:30:00Z');
const line=(id,pe,time,value,flag='')=>`${HADS_SITES[id].nesdis}|${id}|${pe}|2026-11-14 ${time}|${value}|${flag}|`;
test('HADS locks station and variable; UTC, flags, blanks and conflicting values remain explicit',()=>{
 const raw=[line('PFQC1','TW','16:00','61.8'),line('PFQC1','HG','16:00','1.53'),line('PFQC1','HG','15:45',''),line('PFQC1','HG','15:30','1.52','Q'),line('PFQC1','HG','15:00','1.5'),line('PFQC1','HG','15:00','1.6')].join('\n');
 const s=parseHads(raw,'PFQC1',now);assert.equal(s.points.at(-1).time,Date.parse('2026-11-14T16:00:00Z'));assert.equal(s.points.at(-1).value,1.53);assert.ok(s.points.slice(0,-1).every(p=>p.value===null));
 assert.throws(()=>parseHads(line('PFTC1','HP','16:00','755'),'PFQC1',now),/identity/);
 assert.throws(()=>parseHads('<html>Error</html>','PFQC1',now),/format/);
});
test('downstream stage is observation-only and does not inherit a successful browser check',()=>{
 const raw=parseHads(line('PFQC1','HG','16:00','1.53'),'PFQC1',now);
 const block={...raw,lastSuccess:new Date(now).toISOString(),error:null};
 const g=telemetryGauge(block);assert.equal(g.observed.units,'ft');assert.equal(g.forecast.points.length,0);assert.deepEqual(g.categories,{});assert.equal(g.fetched,now);
 assert.equal(telemetryGauge({...block,error:'offline'}).inService,false);
});
test('pool backup requires same-time agreement; does not splice CDEC and telemetry trends',()=>{
 const points=[{time:now-1.5*3600000,value:755.6},{time:now-0.5*3600000,value:755.63}];
 const block={id:'PFTC1',pe:'HP',units:'ft',points,lastSuccess:new Date(now).toISOString(),error:null};
 const cdec={samples:[{time:points[0].time,value:755.6}]};
 const b=poolBackup(block,cdec,now,45*60000);assert.equal(b.samples.length,2);assert.equal(b.lastValid.value,755.63);
 assert.equal(poolBackup(block,{samples:[{time:points[0].time,value:760}]},now,45*60000),null);
 assert.equal(poolBackup({...block,error:'offline'},cdec,now,45*60000),null);
 assert.equal(poolBackup({...block,lastSuccess:new Date(now-3600000).toISOString()},cdec,now,45*60000),null);
});
test('failed pool collection preserves its date and does not block downstream collection',async()=>{
 const old={PFTC1:{lastSuccess:'2026-11-13T15:00:00Z',points:[{time:now-86400000,value:755}]}};
 const result=await collectPineFlatTelemetry({old,now,fetchImpl:async url=>{if(url.searchParams.get('nwslis')==='PFTC1')throw Error('timeout');return{ok:true,text:async()=>line('PFQC1','HG','16:00','1.53')};}});
 assert.equal(result.PFTC1.lastSuccess,old.PFTC1.lastSuccess);assert.match(result.PFTC1.error,/timeout/);assert.equal(result.PFQC1.error,null);assert.equal(result.PFQC1.points[0].value,1.53);
});
test('Pine Flat comparison uses stage, retains gaps and never invents flow or forecasts',()=>{
 const block={...parseHads([line('PFQC1','HG','15:00','1.5'),line('PFQC1','HG','15:30',''),line('PFQC1','HG','16:00','1.53')].join('\n'),'PFQC1',now),lastSuccess:new Date(now-10*60000).toISOString(),error:null};
 const reservoirs={checked:now,selection:{stations:[]},snapshot:{generatedAt:new Date(now).toISOString(),stations:[],telemetry:{PFQC1:block}}};
 const args={stationId:'PNF',measure:'stage',reservoirs,config:CONFIG,now};
 const m=buildReleaseTrend(args);assert.equal(m.gauge.current,true);assert.equal(m.gauge.observed[1].value,null);assert.equal(m.gauge.forecast.length,0);assert.equal(m.gauge.units,'ft');
 assert.equal(buildReleaseTrend({...args,measure:'flow'}).gauge.observed.length,0);
 reservoirs.checked=now-3600000;assert.equal(buildReleaseTrend(args).gauge.current,false);
});
