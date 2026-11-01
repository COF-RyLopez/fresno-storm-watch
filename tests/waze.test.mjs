import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,writeFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {collectWaze,run,redact,validateWazeFeed,filterWazeTraffic} from '../scripts/collect-waze.mjs';
import {fresnoCounty} from '../scripts/lib/snapshot-io.mjs';
import {wazeReports,wazeTraffic,validateWazeSnapshot,wazeCategory,WAZE_MAX_AGE} from '../site/lib/waze-model.js';
import {countyGeometry} from '../site/lib/model.js';

const raw=await readFile(new URL('./fixtures/waze-feed.json',import.meta.url),'utf8'),feed=()=>JSON.parse(raw);
const county=await fresnoCounty(),now=Date.parse('2026-11-01T18:00:00Z');
const URL_WITH_KEY='https://www.waze.com/row-partnerhub-api/partners/123/waze-feeds/abc?format=1&key=SUPERSECRETKEY123';
const ok=body=>async()=>new Response(typeof body==='string'?body:JSON.stringify(body),{status:200});
const collect=(body,previous=null)=>collectWaze({url:URL_WITH_KEY,county,previous,fetchImpl:ok(body),now});
const tempOutput=async()=>{const dir=await mkdtemp(join(tmpdir(),'waze-'));return {dir,output:pathToFileURL(join(dir,'waze-latest.json'))};};

test('keeps only allowlisted storm alerts inside Fresno County and counts what it drops',async()=>{
  const s=await collect(feed());
  assert.equal(s.error,null);assert.equal(s.checkedAt,new Date(now).toISOString());
  assert.deepEqual(s.alerts.map(a=>a.subtype).sort(),['','HAZARD_ON_ROAD_OBJECT','HAZARD_WEATHER_FLOOD','HAZARD_WEATHER_FOG','HAZARD_WEATHER_HEAVY_RAIN','ROAD_CLOSED_HAZARD']);
  assert.deepEqual(s.counts,{alerts:12,kept:6,notStormRelevant:4,outsideCounty:2,duplicates:0,jams:2,irregularities:1,irregularitiesKept:1,irregularityDrops:{},irregularityFields:['alertsCount','causeType','city','country','delaySeconds','detectionDate','detectionDateMillis','driversCount','endNode','highway','id','jamLevel','length','line','nComments','nImages','nThumbsUp','regularSpeed','seconds','severity','speed','startNode','street','trend','type','updateDateMillis'],byCategory:{Flooding:1,'Road closed':2,'Hazard on road':3},
    byType:{'ACCIDENT:ACCIDENT_MINOR':1,'JAM:JAM_HEAVY_TRAFFIC':1,'ROAD_CLOSED:NO_SUBTYPE':1,'ROAD_CLOSED:ROAD_CLOSED_CONSTRUCTION':1,'ROAD_CLOSED:ROAD_CLOSED_HAZARD':2,'WEATHERHAZARD:HAZARD_ON_ROAD_OBJECT':1,'WEATHERHAZARD:HAZARD_ON_ROAD_POT_HOLE':1,'WEATHERHAZARD:HAZARD_WEATHER_FLOOD':2,'WEATHERHAZARD:HAZARD_WEATHER_FOG':1,'WEATHERHAZARD:HAZARD_WEATHER_HEAVY_RAIN':1}});
  assert.deepEqual(s.feed,{startTime:'2026-11-01T17:58:00.000Z',endTime:'2026-11-01T17:59:00.000Z'});
  assert.equal(s.possiblyTruncated,false);
  assert.equal(wazeCategory('ROAD_CLOSED','ROAD_CLOSED_CONSTRUCTION'),null);assert.equal(wazeCategory('ACCIDENT','HAZARD_WEATHER_FLOOD'),null);
});

test('minimises each alert: hashed id, rounded point, no uuid, description or reporter fields',async()=>{
  const s=await collect(feed()),text=JSON.stringify(s),flood=s.alerts.find(a=>a.subtype==='HAZARD_WEATHER_FLOOD');
  for(const leak of ['uuid','0000aaaa','reportDescription','Fabricated description','wazeData','reportRating','magvar','reportByMunicipalityUser'])assert(!text.includes(leak),leak);
  assert.deepEqual(flood,{id:flood.id,type:'WEATHERHAZARD',subtype:'HAZARD_WEATHER_FLOOD',lon:-119.7871,lat:36.7378,street:'E Shaw Ave',city:'Fresno, CA',reportedAt:'2026-11-01T17:53:00.000Z',reliability:6,confidence:1,thumbsUp:1});
  assert.match(flood.id,/^[0-9a-f]{16}$/);
  const fog=s.alerts.find(a=>a.subtype==='HAZARD_WEATHER_FOG');assert.equal(fog.street,null);assert.equal(fog.thumbsUp,null);
  assert.equal(s.alerts.find(a=>a.subtype==='HAZARD_WEATHER_HEAVY_RAIN').city,null);
  assert.throws(()=>validateWazeSnapshot({...s,alerts:[{...flood,reportDescription:'x'}],counts:{...s.counts,byCategory:{Flooding:1,'Road closed':0,'Hazard on road':0}}},now),/identity or type/);
  assert.throws(()=>validateWazeSnapshot({...s,alerts:[{...flood,lon:-119.787123}]},now),/location/);
});

test('invalid feed shape keeps the previous snapshot and records the error',async()=>{
  const good=await collect(feed());
  for(const bad of ['not json',{alerts:{}},{...feed(),alerts:[{...feed().alerts[0],location:{x:'a',y:1}}]},{...feed(),startTimeMillis:undefined,startTime:'yesterday'},[]]){
    const s=await collectWaze({url:URL_WITH_KEY,county,previous:good,fetchImpl:ok(bad),now:now+60000});
    assert(s.error);assert.deepEqual(s.alerts,good.alerts);assert.equal(s.checkedAt,good.checkedAt);assert.equal(s.generatedAt,new Date(now+60000).toISOString());
  }
  assert.throws(()=>validateWazeFeed({...feed(),alerts:[{...feed().alerts[0],uuid:''}]}));
  const huge=await collect({...feed(),jams:Array.from({length:4990},()=>({}))});assert.equal(huge.possiblyTruncated,true);
});

test('feed URL and access key never appear in errors or logs',async()=>{
  assert.equal(redact(`Failed to parse URL from ${URL_WITH_KEY}`,URL_WITH_KEY),'Failed to parse URL from [redacted]');
  assert(!redact('bad key=SUPERSECRETKEY123 and https://other.example/x?y=1',URL_WITH_KEY).match(/SUPERSECRET|https:/));
  const lines=[],temp=await tempOutput(),thrown=await run({env:{WAZE_FEED_URL:URL_WITH_KEY,WAZE_PUBLISH:'true'},output:temp.output,fetchImpl:async u=>{throw new TypeError('fetch failed for '+u);},now,log:l=>lines.push(l)});
  assert.match(thrown.error,/\[redacted\]/);
  const status=await collectWaze({url:URL_WITH_KEY,county,fetchImpl:async()=>new Response('',{status:403}),now});assert.equal(status.error,'Waze feed HTTP 403');
  assert(!lines.join().includes('SUPERSECRET')&&!lines.join().includes('waze.com'));await rm(temp.dir,{recursive:true,force:true});
});

test('missing secret is a clean skip and publish gate off writes nothing',async()=>{
  const {dir,output}=await tempOutput(),lines=[];
  try{
    let fetched=0;
    assert.equal(await run({env:{WAZE_PUBLISH:'true'},output,fetchImpl:async()=>{fetched++;},log:l=>lines.push(l)}),null);
    assert.equal(await run({env:{WAZE_FEED_URL:'  ',WAZE_PUBLISH:'true'},output,fetchImpl:async()=>{fetched++;},log:l=>lines.push(l)}),null);
    assert.equal(fetched,0);assert.match(lines[0],/WAZE_FEED_URL not set/);
    for(const WAZE_PUBLISH of [undefined,'','false','TRUE','1']){
      const s=await run({env:{WAZE_FEED_URL:URL_WITH_KEY,WAZE_PUBLISH},output,fetchImpl:ok(feed()),now,log:l=>lines.push(l)});
      assert.equal(s.counts.kept,6);
    }
    assert.deepEqual(await readdir(dir),[]);
    const log=lines.at(-1);assert.match(log,/"published":false/);
    for(const leak of ['E Shaw Ave','36.7378','-119.7871','Fresno, CA'])assert(!log.includes(leak),leak);
    await run({env:{WAZE_FEED_URL:URL_WITH_KEY,WAZE_PUBLISH:'true'},output,fetchImpl:ok(feed()),now,log:()=>{}});
    assert.equal(validateWazeSnapshot(JSON.parse(await readFile(output,'utf8')),now).counts.kept,6);
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('published gate keeps the previous file when the next feed is invalid',async()=>{
  const {dir,output}=await tempOutput();
  try{
    await run({env:{WAZE_FEED_URL:URL_WITH_KEY,WAZE_PUBLISH:'true'},output,fetchImpl:ok(feed()),now,log:()=>{}});
    await run({env:{WAZE_FEED_URL:URL_WITH_KEY,WAZE_PUBLISH:'true'},output,fetchImpl:ok({alerts:'nope'}),now:now+60000,log:()=>{}});
    const s=JSON.parse(await readFile(output,'utf8'));assert.equal(s.alerts.length,6);assert.match(s.error,/alerts is not an array/);assert.equal(s.checkedAt,new Date(now).toISOString());
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('wazeReports categorises, labels, ages and marks stale snapshots',async()=>{
  const s=await collect(feed()),rows=wazeReports(s,now);
  assert.deepEqual(wazeReports(null,now),[]);
  assert.deepEqual(rows.map(r=>[r.category,r.label,r.ageMinutes]),[
    ['Flooding','Flooding · E Shaw Ave',7],['Road closed','Road closed (hazard) · Tollhouse Rd',12],['Hazard on road','Object on road · S Academy Ave',17],
    ['Hazard on road','Heavy rain · I-5 S',22],['Road closed','Road closed · Blackstone Ave',27],['Hazard on road','Fog',62]]);
  assert(rows.every(r=>!r.stale));
  assert(wazeReports(s,now+WAZE_MAX_AGE+1).every(r=>r.stale));
  const failed=await collectWaze({url:URL_WITH_KEY,county,fetchImpl:ok('x'),now});assert.deepEqual(wazeReports(failed,now),[]);assert.equal(failed.checkedAt,null);
  assert.throws(()=>wazeReports({...s,counts:{...s.counts,byCategory:{...s.counts.byCategory,Flooding:9}}},now),/counts mismatch/);
});

test('unusual traffic: kept inside the county, minimised, line capped at 25 points, malformed records skipped',async()=>{
  const s=await collect(feed()),[t]=s.irregularities,text=JSON.stringify(s.irregularities);
  assert.deepEqual(t,{id:t.id,size:'Small',lengthM:900,delaySeconds:180,speedKmh:12.3,regularSpeedKmh:48.1,trend:1,street:'N Blackstone Ave',city:'Fresno, CA',detectedAt:'2026-11-01T17:48:00.000Z',updatedAt:'2026-11-01T17:57:00.000Z',line:[[-119.78,36.75],[-119.779,36.751],[-119.778,36.7515]]});
  assert.match(t.id,/^[0-9a-f]{16}$/);for(const leak of ['7001','driversCount','startNode','W Shaw Ave','causeType'])assert(!text.includes(leak),leak);
  const rings=countyGeometry(county.geometry).rings,base=feed().irregularities[0];
  const long={...base,id:1,line:Array.from({length:60},(_,i)=>({x:-119.78+i*1e-4,y:36.75}))};
  const kept=filterWazeTraffic([long,{...base,id:2,line:[{x:-121.9,y:37.3}]},{...base,id:3,line:[]},{...base,id:4,detectionDateMillis:'x',detectionDate:undefined},{...base,id:null},{...long}],rings);
  assert.equal(kept.length,1);assert.equal(kept[0].line.length,25);assert.deepEqual(kept.drops,{outsideCounty:1,noLine:1,noTime:1,noId:1,duplicate:1});assert.deepEqual(kept[0].line.at(-1),[-119.7741,36.75]);
  const asText=filterWazeTraffic([{...base,detectionDateMillis:String(base.detectionDateMillis),updateDateMillis:String(base.updateDateMillis)},{...base,id:9,detectionDateMillis:undefined,updateDateMillis:undefined}],rings);
  assert.deepEqual(asText.map(k=>k.detectedAt),['2026-11-01T17:48:00.000Z','2026-11-01T17:48:00.000Z'],'digit strings (live feed) and the detectionDate text both count');
  const odd=filterWazeTraffic([{...base,type:'weird',trend:7,delaySeconds:-5,street:42}],rings)[0];
  assert.deepEqual([odd.size,odd.trend,odd.delaySeconds,odd.street],[null,null,null,null]);
  assert.throws(()=>validateWazeSnapshot({...s,irregularities:[{...t,driversCount:3}]},now),/identity invalid/);
  assert.throws(()=>validateWazeSnapshot({...s,irregularities:[{...t,line:[[-119.781234567,36.75]]}]},now),/line invalid/);
});

test('wazeTraffic converts speeds to mph, flags worsening or Medium+, and goes stale with the snapshot',async()=>{
  const s=await collect(feed()),[r]=wazeTraffic(s,now);
  assert.deepEqual([r.label,r.speedMph,r.regularMph,r.rising,r.major,r.stale],['Unusual traffic · N Blackstone Ave',8,30,true,false,false]);
  assert.equal(wazeTraffic(s,now+WAZE_MAX_AGE+1)[0].stale,true);assert.deepEqual(wazeTraffic(null,now),[]);
});

test('untyped closures count only while recent (map-editor closures are long-lived); event closures are not storm closures',async()=>{
  const f=feed(),untyped=f.alerts.find(a=>a.type==='ROAD_CLOSED'&&!a.subtype),H=3_600_000;
  const at=async pub=>(await collect({...f,alerts:[{...untyped,pubMillis:pub}]})).counts;
  assert.deepEqual([(await at(now-11*H)).kept,(await at(now-13*H)).kept,(await at(now-13*H)).notStormRelevant],[1,0,1]);
  const typed=f.alerts.find(a=>a.subtype==='ROAD_CLOSED_HAZARD');
  assert.equal((await collect({...f,alerts:[{...typed,pubMillis:now-48*H}]})).counts.kept,1,'a closure reported for a hazard stays regardless of age');
  assert.equal(wazeCategory('ROAD_CLOSED','ROAD_CLOSED_EVENT'),null);
});
