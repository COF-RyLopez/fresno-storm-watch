import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fetchFresnoAlerts} from '../site/lib/nws.js';
import {alertConcerns} from '../site/lib/command-data.js';
import {CONFIG} from '../site/config.js';
const now=Date.parse('2026-11-18T22:30:00Z');
const county=JSON.parse(await readFile(new URL('../site/data/counties.geojson',import.meta.url))).features.find(f=>f.properties.GEOID==='06019');
const id='urn:oid:county-warning';
const ring=[[-120,36],[-119,36],[-119,37],[-120,37],[-120,36]];
const official=(patch={})=>({type:'Feature',geometry:null,properties:{id,event:'Wind Advisory',status:'Actual',messageType:'Update',sent:'2026-11-18T22:00:00Z',onset:'2026-11-18T22:00:00Z',ends:'2026-11-19T03:00:00Z',expires:'2026-11-19T04:00:00Z',senderName:'NWS Hanford CA',headline:'Wind Advisory in western Fresno County',description:'Gusts to 45 mph.',instruction:'Use caution.',areaDesc:'West Side Mountains',...patch}});
const mapped=(cap_id=id)=>({attributes:{objectid:1,cap_id,prod_type:'Wind Advisory',issuance:'2026-11-18T22:00:00Z',expiration:'2026-11-19T04:00:00Z'},geometry:{rings:[ring]}});
const reply=body=>({ok:true,json:async()=>body});

test('official Fresno membership controls count; neighboring map overlaps and CAP duplicates do not add alerts',async()=>{
 const calls=[];
 const rows=await fetchFresnoAlerts(county,CONFIG,async(url)=>{
  calls.push(String(url));
  return reply(String(url).startsWith('https://api.weather.gov/')
   ? {type:'FeatureCollection',features:[official(),official(),official({id:'urn:oid:test',status:'Test'})]}
   : {features:[mapped(),mapped('urn:oid:neighbor')],spatialReference:{wkid:4326}});
 },()=>now);
 assert.equal(rows.length,1);
 assert.equal(rows[0].capId,id);
 assert.equal(rows[0].geometries.length,1);
 assert.equal(alertConcerns(rows).length,1);
 assert.ok(calls.includes('https://api.weather.gov/alerts/active?zone=CAC019'));
});
test('an alert arriving before its map shape stays counted and explicitly flags unavailable geometry',async()=>{
 const rows=await fetchFresnoAlerts(county,CONFIG,async(url)=>String(url).startsWith('https://api.weather.gov/')
  ? reply({type:'FeatureCollection',features:[official()]}) : {ok:false,status:503},()=>now);
 const c=alertConcerns(rows)[0];
 assert.equal(c.features.length,0);
 assert.match(c.mapGap,/geometry/i);
 assert.match(c.details.join(' '),/Gusts to 45 mph/);
});
test('expiry and cancellation remove alerts; a passed hazard end does not override continued NWS publication',async()=>{
 const features=[official(),official({id:'urn:oid:expired',expires:new Date(now-1).toISOString()}),official({id:'urn:oid:ended',ends:new Date(now-1).toISOString()}),official({id:'urn:oid:cancel',messageType:'Cancel'})];
 const rows=await fetchFresnoAlerts(county,CONFIG,async(url)=>reply(String(url).startsWith('https://api.weather.gov/')
  ? {type:'FeatureCollection',features} : {features:[],spatialReference:{wkid:4326}}),()=>now);
 assert.equal(rows.length,2);
 assert.match(rows.find(row=>row.capId==='urn:oid:ended').quality,/end time has passed/);
});
test('CAP updates and cancellations suppress their older referenced alert across a complete snapshot',async()=>{
 const reference={identifier:id,sent:'2026-11-18T22:00:00Z'};
 for (const messageType of ['Update','Cancel']) {
  const features=[official(),official({id:'urn:oid:replacement',messageType,sent:'2026-11-18T22:15:00Z',references:[reference]})];
  const rows=await fetchFresnoAlerts(county,CONFIG,async(url)=>reply(String(url).startsWith('https://api.weather.gov/')
   ? {type:'FeatureCollection',features} : {features:[],spatialReference:{wkid:4326}}),()=>now);
  assert.deepEqual(rows.map(row=>row.capId),messageType==='Cancel'?[]:['urn:oid:replacement']);
 }
});
test('failed or incomplete authoritative county responses cannot become an empty success',async()=>{
 for(const body of [{}, {type:'FeatureCollection'}, {type:'FeatureCollection',features:[official({sent:'invalid'})]}, {type:'FeatureCollection',features:[official(),official({event:'Flood Warning'})]}]) {
  await assert.rejects(fetchFresnoAlerts(county,CONFIG,async(url)=>reply(String(url).startsWith('https://api.weather.gov/')?body:{features:[],spatialReference:{wkid:4326}}),()=>now));
 }
 await assert.rejects(fetchFresnoAlerts(county,CONFIG,async()=>({ok:false,status:503}),()=>now),/503/);
});
test('county pagination is complete and rejects repeated or foreign continuations',async()=>{
 const next='https://api.weather.gov/alerts/active?zone=CAC019&cursor=two';
 const rows=await fetchFresnoAlerts(county,CONFIG,async(url)=>reply(String(url).startsWith('https://api.weather.gov/')
  ? {type:'FeatureCollection',features:[official({id:String(url)===next?'urn:oid:second':id})],pagination:String(url)===next?{}:{next}}
  : {features:[],spatialReference:{wkid:4326}}),()=>now);
 assert.equal(rows.length,2);
 for (const bad of [next,'https://other.example/alerts']) await assert.rejects(fetchFresnoAlerts(county,CONFIG,async(url)=>reply(String(url).startsWith('https://api.weather.gov/')
  ? {type:'FeatureCollection',features:[official()],pagination:{next:bad}} : {features:[],spatialReference:{wkid:4326}}),()=>now),/pagination/i);
});
