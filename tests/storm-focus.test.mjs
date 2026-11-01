import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {stormFocus,STORM_CONFIG,ageLabel} from '../site/lib/storm-focus-model.js';
import {parseUsgsIv,usgsReading} from '../site/lib/usgs-gauges.js';

const H=3_600_000,NOW=Date.parse('2026-11-01T18:00:00Z');
const covered=STORM_CONFIG.ungaugedCreeks.map((creek,i)=>({site:'1125000'+i,name:creek+' gauge',creek,latitude:36.9,longitude:-119.6,floodStageFt:null}));
// Signed-in, drainage ready and empty, current road check with no closures, every creek covered: nothing else listed.
const quiet={signedIn:true,drainage:{ready:true,rows:[]},roads:{snapshot:{rows:[],checked:NOW},error:null},watchlist:covered,usgs:{readings:new Map(covered.map(s=>[s.site,reading(0,0)])),checked:NOW}};
function reading(rate,ageMs=10*60_000){const t=NOW-ageMs;return {stage:{time:t,value:5},flow:null,rise:{delta:rate*3,hours:3,rate,start:t-3*H}};}
const usgsRow=(rate,age)=>stormFocus({...quiet,usgs:{readings:new Map([[covered[0].site,reading(rate,age)]]),checked:NOW}},NOW).find(r=>r.key==='usgs:'+covered[0].site);
const area=(id,rank,extra={})=>({area:{id,name:id},rank,status:'status '+id,rising:[],gauges:[],gaps:[],rainfall:{checked:NOW-5*60_000},...extra});

test('USGS parser drops the documented no-data sentinel and computes rise over ~3 h',async()=>{
  const sites=parseUsgsIv(JSON.parse(await readFile(new URL('../site/data/usgs-iv-exercise.json',import.meta.url),'utf8')));
  const row=sites.get('11251000');assert.equal(row.stage.length,23);assert.equal(row.flow.length,24);
  const r=usgsReading(row,Date.parse('2026-11-01T10:00:00-08:00'));
  assert.equal(r.stage.value,6);assert.equal(r.rise.hours,2.5);assert.ok(Math.abs(r.rise.delta-1.5)<1e-9);assert.ok(Math.abs(r.rise.rate-0.6)<1e-9);
  assert.equal(usgsReading({...row,stage:row.stage.slice(-4)},NOW).rise,null,'no prior sample 2.5-4 h back means no rise');
  assert.throws(()=>parseUsgsIv({}),/timeSeries/);
});

test('USGS rise boundaries: >=0.5 Now, 0.2-0.5 Next, below 0.2 unlisted, stale demoted to Verify',()=>{
  assert.equal(usgsRow(0.5).tier,2);assert.equal(usgsRow(0.49).tier,3);assert.equal(usgsRow(0.2).tier,3);assert.equal(usgsRow(0.19),undefined);
  const old=usgsRow(0.9,STORM_CONFIG.staleMs+60_000);assert.equal(old.tier,4);assert.equal(old.stale,true);assert.match(old.why,/0\.90 ft\/h/);
  assert.equal(usgsRow(0.9,STORM_CONFIG.staleMs).tier,2,'exactly 2 h is still current');
  const failed=stormFocus({...quiet,usgs:{readings:new Map(),error:'USGS HTTP 503'}},NOW).find(r=>r.key.startsWith('usgs:'));
  assert.equal(failed.tier,4);assert.equal(failed.stale,true);assert.match(failed.why,/failed/);
});

test('NWS flood-type warnings for Fresno rank first, keep rank when overdue, and carry the overdue tag',()=>{
  const alerts=[{key:'a',type:'Flood Warning',category:'Warning',counties:['Fresno'],issued:NOW-H,office:'HNX'},{key:'b',type:'Flood Advisory',category:'Advisory',counties:['Fresno'],issued:NOW},{key:'c',type:'Flash Flood Warning',category:'Warning',counties:['Tulare'],issued:NOW},{key:'d',type:'Wind Warning',category:'Warning',counties:['Fresno'],issued:NOW}];
  const current=stormFocus({...quiet,alerts,alertCheck:{checked:NOW-60_000,error:null}},NOW);
  assert.deepEqual(current.filter(r=>r.tier===1).map(r=>r.key),['nws:a']);assert.equal(current[0].tag,null);assert.equal(current[0].age,H);
  const overdue=stormFocus({...quiet,alerts,alertCheck:{checked:NOW-STORM_CONFIG.nwsStaleMs-1,error:null},areas:[area('x',4)]},NOW);
  assert.equal(overdue[0].key,'nws:a');assert.equal(overdue[0].tier,1);assert.equal(overdue[0].tag,'NWS check overdue');assert.equal(overdue[0].stale,true);
});

test('river areas map to tiers and old evidence never ranks above Verify',()=>{
  const g=(delta,hours,units='ft')=>({gauge:{observed:{units}},assessment:{trend:{delta,hours},observed:{time:NOW-10*60_000}}});
  const rows=stormFocus({...quiet,areas:[area('threshold',4),area('rising',3,{rising:[g(0.6,3)]}),area('change',3),area('rain',2),area('gaps',1,{gaps:['x','y']}),area('none',0),area('old',4,{rainfall:{checked:NOW-3*H}})]},NOW);
  const tier=Object.fromEntries(rows.map(r=>[r.key.slice(5),r.tier]));
  assert.deepEqual(tier,{threshold:2,rising:2,change:3,rain:3,gaps:4,old:4});
  assert.match(rows.find(r=>r.key==='area:rising').why,/\+0\.6 ft in 3\.0 h/);assert.match(rows.find(r=>r.key==='area:gaps').why,/2 evidence gaps/);
  assert.equal(rows.find(r=>r.key==='area:old').stale,true);
});

test('signed-out visitors get the sign-in row; private drainage flags rank when loaded',()=>{
  const out=stormFocus({},NOW);const signin=out.find(r=>r.key==='signin:drainage');
  assert.equal(signin.place,'Metro drainage evidence needs county sign-in');assert.equal(signin.tier,4);assert.equal(signin.focus,'metro');
  assert.equal(stormFocus({focus:'creeks'},NOW).some(r=>r.key==='signin:drainage'),false);
  assert.equal(stormFocus({signedIn:true},NOW).find(r=>r.key.startsWith('load:'))?.tier,4);
  const d=(id,flags)=>({id,name:id,review:true,change:'c',inventoryChecked:NOW-60_000,inventoryCurrent:true,...flags});
  const rows=stormFocus({...quiet,drainage:{ready:true,rows:[d('power',{powerReview:true}),d('rain',{rainfall:true}),d('gaps',{gaps:['x']}),d('stale',{powerRain:true,inventoryCurrent:false}),{...d('none'),review:false}]}},NOW);
  assert.deepEqual(rows.map(r=>[r.key,r.tier]),[['drainage:power',2],['drainage:rain',3],['drainage:gaps',4],['drainage:stale',4]]);
  assert.equal(rows.some(r=>r.key==='signin:drainage'),false);
});

test('one roads summary row counts current closures and new ones in the last hour',()=>{
  const road=(id,{layer=1,active='yes',start=NOW-5*H,end=null}={})=>({key:'r'+id,layer,active,start,end,sourceTime:null});
  const rows=[road(1),road(2,{start:NOW-10*60_000}),road(3,{layer:0,start:NOW-30*60_000}),road(4,{active:'no'}),road(5,{end:NOW-1}),road(6,{layer:2,start:NOW-60_000})];
  const out=stormFocus({...quiet,roads:{snapshot:{rows,checked:NOW-60_000},error:null}},NOW).filter(r=>r.key==='roads:summary');
  assert.equal(out.length,1);assert.equal(out[0].why,'3 county closures · 2 new in last hour');assert.equal(out[0].tier,4);assert.equal(out[0].stale,false);
  const failed=stormFocus({...quiet,roads:{snapshot:{rows,checked:NOW-H},error:'County service HTTP 500'}},NOW).find(r=>r.key==='roads:summary');
  assert.equal(failed.stale,true);assert.equal(stormFocus(quiet,NOW).some(r=>r.key==='roads:summary'),false,'current check with no closures');
});

test('ungauged creek rows appear in Creeks focus unless a USGS gauge covers the creek',()=>{
  const rows=stormFocus({...quiet,watchlist:[covered[0]]},NOW);
  const creeks=rows.filter(r=>r.key.startsWith('creek:')).map(r=>r.place);
  assert.deepEqual(creeks,STORM_CONFIG.ungaugedCreeks.slice(1).sort());
  for(const r of rows.filter(r=>r.key.startsWith('creek:'))){assert.equal(r.tier,4);assert.equal(r.focus,'creeks');assert.equal(r.source,'No live gauge');}
  assert.equal(stormFocus({...quiet,watchlist:[covered[0]],focus:'metro'},NOW).some(r=>r.key.startsWith('creek:')),false);
});

test('within a tier: faster rise, then earliest peak, then name, then key; empty list stays empty',()=>{
  const g=(rate,peak)=>({gauge:{observed:{units:'ft'}},assessment:{trend:{delta:rate*3,hours:3},observed:{time:NOW},peak:peak===null?null:{time:peak}}});
  const rows=stormFocus({...quiet,areas:[area('b',3,{rising:[g(0.3,null)],gauges:[g(0.3,null)]}),area('a',3,{rising:[g(0.3,null)],gauges:[g(0.3,null)]}),area('slow',3,{rising:[g(0.1,NOW+H)],gauges:[g(0.1,NOW+H)]}),area('fast',3,{rising:[g(0.9,null)],gauges:[g(0.9,null)]}),area('early',3,{rising:[g(0.3,NOW+H)],gauges:[g(0.3,NOW+H)]})]},NOW);
  assert.deepEqual(rows.map(r=>r.key.slice(5)),['fast','early','a','b','slow']);
  assert.deepEqual(stormFocus(quiet,NOW),[]);
  assert.equal(ageLabel(null),'age unknown');assert.equal(ageLabel(61*60_000),'1 h 1 min old');
});
