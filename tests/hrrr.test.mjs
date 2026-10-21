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
