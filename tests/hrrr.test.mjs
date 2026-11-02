import test from 'node:test';
import assert from 'node:assert/strict';
import {validateHrrrManifest,validateHrrrFrame,hrrrAt,hrrrPoint,hrrrPixels,HOUR,MPH} from '../site/lib/hrrr-model.js';
import {workspaceDefaults,layerVisible} from '../site/lib/workspace-model.js';

const now=Date.parse('2026-10-21T04:30:00Z'),run='2026-10-21T00:00:00Z';
function manifest(){return {schemaVersion:1,product:'noaa-hrrr-forecast-48-hour',units:'m/s',license:'CC-BY-4.0',attribution:'NOAA HRRR processed by Dynamical',vectorConvention:'earth-east-north',run,generatedAt:new Date(now).toISOString(),grid:{wkid:4326,width:101,height:80,x0:-121.25,y0:38.12,dx:.03,dy:-.03},frames:Array.from({length:49},(_,i)=>({file:`20261021T000000Z-f${String(i).padStart(2,'0')}.json`,valid:new Date(Date.parse(run)+i*HOUR).toISOString().replace('.000Z','Z'),leadHours:i}))};}
function frame(m,entry=m.frames[4]){return {schemaVersion:1,run:m.run,valid:entry.valid,leadHours:entry.leadHours,width:101,height:80,u:Array(8080).fill(3),v:Array(8080).fill(4),gust:Array(8080).fill(9)};}

test('HRRR catalog contract rejects changed units, direction, coverage, duplicate times and mixed runs',()=>{
 const m=manifest();assert.equal(validateHrrrManifest(m,now),m);
 for(const patch of [{units:'mph'},{vectorConvention:'grid-relative'},{run:'2030-01-01T00:00:00Z'},{grid:{...m.grid,dx:.3}}])assert.throws(()=>validateHrrrManifest({...m,...patch},now));
 m.frames[5]={...m.frames[4]};assert.throws(()=>validateHrrrManifest(m,now));
});
test('shared time uses explicit earlier hourly steps, hides gaps and never extrapolates past 48h',()=>{
 const m=manifest();assert.equal(hrrrAt(m,now,now).frame.leadHours,4);
 assert.equal(hrrrAt(m,Date.parse(run)-1,now).frame,undefined);
 assert.equal(hrrrAt(m,Date.parse(run)+48*HOUR,now).frame.leadHours,48);
 assert.equal(hrrrAt(m,Date.parse(run)+48*HOUR+1,now).frame,undefined);
 m.frames=m.frames.filter(f=>f.leadHours!==4);assert.equal(hrrrAt(m,now,now).frame,undefined);
});
test('fresh browser checks do not renew old collections or old model runs; errors fail closed',()=>{
 const m=manifest();assert.match(hrrrAt({...m,generatedAt:new Date(now-46*60000).toISOString()},now,now).reason,/overdue/);
 assert.match(hrrrAt({...m,run:new Date(now-19*HOUR).toISOString()},now,now).reason,/old/);
 assert.match(hrrrAt({...m,error:'Publisher failed'},now,now).reason,/Publisher failed/);
});
test('frame identity and pixel accounting prevent displaying another lead/run, negatives or invalid values',()=>{
 const m=manifest(),f=frame(m);assert.equal(validateHrrrFrame(f,m,m.frames[4]),f);
 assert.throws(()=>validateHrrrFrame({...f,leadHours:5},m,m.frames[4]));
 assert.throws(()=>validateHrrrFrame({...f,run:'different'},m,m.frames[4]));
 for(const bad of [-1,NaN,Infinity,'9']){const gust=[...f.gust];gust[9]=bad;assert.throws(()=>validateHrrrFrame({...f,gust},m,m.frames[4]));}
 assert.throws(()=>validateHrrrFrame({...f,u:[3]},m,m.frames[4]));
});
test('nulls remain masked while actual zero is calm; UV ordering, top row and mph conversion remain explicit',()=>{
 const m=manifest(),f=frame(m);f.u[0]=null;f.u[1]=0;f.v[1]=0;f.gust[1]=0;
 const p=hrrrPixels(f,'wind');assert.equal(p.mask[0],0);assert.equal(p.mask[1],1);assert.equal(p.pixels[0][2],3);assert.equal(p.pixels[1][2],4);
 const zero=hrrrPoint(f,m.grid,m.grid.x0+m.grid.dx,m.grid.y0);assert.equal(zero.speed,0);assert.equal(zero.gust,0);
 const at=hrrrPoint(f,m.grid,-119.75,36.92);assert.ok(Math.abs(at.speed-5*MPH)<1e-8);assert.ok(Math.abs(at.gust-9*MPH)<1e-8);
 assert.equal(hrrrPoint(f,m.grid,-122,36),null);assert.equal(hrrrPoint(f,m.grid,m.grid.x0,m.grid.y0).speed,null);
});
test('HRRR starts only in Weather and eligibility cannot reveal unrelated map content',()=>{
 assert.equal(workspaceDefaults('weather').layers.hrrr,true);
 for(const id of ['watch','rivers','reservoirs','alerts','power','roads'])assert.equal(layerVisible(workspaceDefaults(id),'hrrr',true),false);
 assert.equal(layerVisible(workspaceDefaults('weather'),'hrrr',false),false);
});
test('rain is optional for older collections, strict when present, and dry cells stay transparent',()=>{
 const m=manifest(),f=frame(m);assert.equal(validateHrrrFrame(f,m,m.frames[4]),f);
 const rain=Array(8080).fill(0);rain[2]=0.005;rain[3]=0.01;rain[4]=0.4;rain[5]=null;
 assert.equal(validateHrrrFrame({...f,rain},m,m.frames[4]).rain,rain);
 for(const bad of [-0.1,21,NaN,'0.2'])assert.throws(()=>validateHrrrFrame({...f,rain:rain.map((v,i)=>i===6?bad:v)},m,m.frames[4]));
 assert.throws(()=>validateHrrrFrame({...f,rain:[0]},m,m.frames[4]));
 assert.throws(()=>validateHrrrManifest({...m,rainUnits:'mm/h'},now));assert.equal(validateHrrrManifest({...m,rainUnits:'in/h'},now).rainUnits,'in/h');
 const p=hrrrPixels({...f,rain},'rain');assert.deepEqual([...p.mask.slice(0,6)],[0,0,0,1,1,0]);assert.ok(Math.abs(p.pixels[0][4]-0.4)<1e-6);
 assert.equal(hrrrPoint({...f,rain},m.grid,m.grid.x0+4*m.grid.dx,m.grid.y0).rain,0.4);assert.equal(hrrrPoint(f,m.grid,-119.75,36.92).rain,null);
});

import {validateMrmsManifest,validateMrmsGrid,mrmsReason,mrmsPixels} from '../site/lib/mrms-model.js';
function mrms(){const last=Date.parse('2026-11-02T12:00:00Z');return {schemaVersion:1,product:'noaa-mrms-conus-analysis-hourly',license:'CC-BY-4.0',attribution:'NOAA MRMS processed by dynamical.org',hourlyUnits:'in/h',totalUnits:'in',total:'total-24h.json',generatedAt:'2026-11-02T12:40:00Z',grid:{wkid:4326,width:101,height:80,x0:-121.25,y0:38.12,dx:.03,dy:-.03},error:null,
 frames:Array.from({length:24},(_,i)=>{const valid=new Date(last-(23-i)*HOUR).toISOString().replace('.000','');return {valid,file:`mrms-${valid.replace(/[-:]/g,'')}.json`};})};}
const mNow=Date.parse('2026-11-02T13:00:00Z');
test('MRMS contract: 24 consecutive hours on the HRRR grid, honest gaps, overdue hides the field',()=>{
 const m=mrms();assert.equal(validateMrmsManifest(m,mNow),m);assert.equal(m.frames[23].file,'mrms-20261102T120000Z.json');
 for(const patch of [{hourlyUnits:'mm/h'},{totalUnits:'mm'},{grid:{...m.grid,dx:.01}},{frames:m.frames.slice(1)},{license:'proprietary'}])assert.throws(()=>validateMrmsManifest({...m,...patch},mNow));
 const gap=mrms();gap.frames[5]={...gap.frames[6]};assert.throws(()=>validateMrmsManifest(gap,mNow));
 assert.equal(mrmsReason(m,mNow),null);assert.match(mrmsReason(m,Date.parse('2026-11-02T13:30:00Z')),/overdue/);
 assert.match(mrmsReason({...m,generatedAt:'2026-11-02T16:40:00Z'},Date.parse('2026-11-02T17:00:00Z')),/old/);assert.match(mrmsReason({...m,error:'Collection failed'},mNow),/failed/);
 const rain=Array(8080).fill(0);rain[1]=0.005;rain[2]=0.02;rain[3]=null;const f={schemaVersion:1,valid:m.frames[0].valid,width:101,height:80,rain};
 assert.equal(validateMrmsGrid(f,m,m.frames[0].valid),f);assert.throws(()=>validateMrmsGrid(f,m,m.frames[1].valid));
 for(const bad of [-1,25,NaN])assert.throws(()=>validateMrmsGrid({...f,rain:rain.map((v,i)=>i===9?bad:v)},m,m.frames[0].valid));
 assert.equal(validateMrmsGrid({...f,hours:24,rain:rain.map((v,i)=>i===9?25:v)},m,m.frames[0].valid,true).hours,24);
 assert.deepEqual([...mrmsPixels(f).mask.slice(0,4)],[0,0,1,0]);
});
