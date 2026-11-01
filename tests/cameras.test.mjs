import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {cameraMediaUrl,normalizeCameras,cameraAvailability,cameraImageFreshness,nearbyCameras} from '../site/lib/camera-model.js';

const now=Date.parse('2026-10-17T20:40:00Z');
const sites=JSON.parse(await readFile(new URL('../site/data/camera-watchlist.json',import.meta.url),'utf8')).cameras;
const site=sites[0];
const record=()=>({cctv:{index:site.index,location:{district:'6',locationName:site.sourceName,longitude:String(site.longitude),latitude:String(site.latitude),county:site.county,route:site.route},inService:'true',
  recordTimestamp:{recordEpoch:'1700000000'},imageData:{static:{currentImageUpdateFrequency:'1',currentImageURL:'https://cwwp2.dot.ca.gov/data/d6/cctv/image/mad41atave9/mad41atave9.jpg'},streamingVideoURL:'https://wzmedia.dot.ca.gov/D6/41_Ave_9.stream/playlist.m3u8'}}});
const normalized=()=>normalizeCameras({data:[record()]},[site],now)[0];
test('camera selection is unique, preserves boundary counties and has no media credentials',()=>{
  assert.equal(sites.length,8);assert.equal(new Set(sites.map(s=>s.id)).size,8);
  assert(sites.some(s=>s.county==='Madera'));assert(sites.some(s=>s.county==='Tulare'));
  assert(sites.every(s=>s.longitude < -119 && s.latitude>36 && s.latitude<37 && s.note && s.sourceName));
});
test('normalize live catalog with district/index identity, original coordinates and source cadence',()=>{
  const c=normalized();assert.equal(c.error,null);assert.equal(c.checked,now);assert.equal(c.imageIntervalMs,60_000);
  assert.equal(c.county,'Madera');assert.equal(c.longitude,site.longitude);assert.equal(c.recordChanged,1_700_000_000_000);
  assert.equal(cameraAvailability(c,null,now).usable,true);
});
test('camera catalog timestamp is never used as image freshness',()=>{
  const c=normalized();assert(c.recordChanged<now-365*86400_000);
  assert.equal(cameraImageFreshness(null,now).tone,'unknown');
  assert.equal(cameraImageFreshness({loaded:now,modified:now-60_000},now).tone,'current');
});
test('missing, duplicate, renamed and moved camera identities cannot load media',()=>{
  const missing=normalizeCameras({data:[]},[site],now)[0];assert(missing.error);assert.equal(missing.imageUrl,null);
  const duplicate=normalizeCameras({data:[record(),record()]},[site],now)[0];assert.match(duplicate.error,/Duplicate/);
  const renamed=record();renamed.cctv.location.locationName='New camera';assert.equal(normalizeCameras({data:[renamed]},[site],now)[0].videoUrl,null);
  const moved=record();moved.cctv.location.longitude='-120.7';assert.match(normalizeCameras({data:[moved]},[site],now)[0].error,/location/);
});
test('null, blank or invalid coordinates cannot be coerced into valid locations',()=>{
  for(const value of [null,'',undefined,'Not Reported','NaN']){const r=record();r.cctv.location.latitude=value;assert(normalizeCameras({data:[r]},[site],now)[0].error);}
  assert.throws(()=>normalizeCameras({features:[]},[site],now),/unexpected/);
});
test('out-of-service, missing service status, overdue and failed checks disable media',()=>{
  const c=normalized();for(const inService of [false,null,undefined])assert.equal(cameraAvailability({...c,inService},null,now).usable,false);
  assert.equal(cameraAvailability(c,null,now+421_000).usable,false);
  assert.equal(cameraAvailability(c,'HTTP 503',now).usable,false);
});
test('untrusted URLs, alternate protocols, credentialed and wrong-kind media are rejected',()=>{
  for(const u of ['http://cwwp2.dot.ca.gov/data/d6/cctv/image/a/a.jpg','javascript:alert(1)','https://cwwp2.dot.ca.gov.evil.example/data/d6/cctv/image/a/a.jpg','https://user:pass@cwwp2.dot.ca.gov/data/d6/cctv/image/a/a.jpg','https://cwwp2.dot.ca.gov/data/d6/cctv/image/a/a.jpg?token=secret','Not Reported'])assert.equal(cameraMediaUrl(u,'image'),null);
  assert.equal(cameraMediaUrl(normalized().videoUrl,'image'),null);assert.equal(cameraMediaUrl(normalized().imageUrl,'video'),null);
});
test('old image does not become current after a successful reload',()=>{
  assert.equal(cameraImageFreshness({loaded:now,modified:now-600_000},now).tone,'gap');
  assert.equal(cameraImageFreshness({loaded:now-600_000,modified:now},now).tone,'gap');
  assert.equal(cameraImageFreshness({loaded:now,modified:null},now).tone,'unknown');
  assert.equal(cameraImageFreshness({loaded:now,modified:now+120_000},now).tone,'unknown');
  assert.equal(cameraImageFreshness({loaded:now,modified:now,error:'Network failure'},now).tone,'gap');
});

test('nearbyCameras: in-service D6 cameras with an approved image near the line, nearest first, capped',()=>{
  const cam=(index,lon,lat,extra={})=>({cctv:{index,inService:'true',location:{district:'6',locationName:`CAM ${index}`,longitude:String(lon),latitude:String(lat),route:'SR-41',direction:'North'},imageData:{static:{currentImageURL:`https://cwwp2.dot.ca.gov/data/d6/cctv/image/c${index}/c${index}.jpg`}},...extra}});
  // ~1.1 km of road along a latitude line; cameras off the middle of the segment, beyond its end, and out of range.
  const line=[[-119.80,36.80],[-119.7875,36.80]],data=[cam('1',-119.79,36.805),cam('2',-119.79,36.801),cam('3',-119.77,36.80),cam('4',-119.79,36.85),
    cam('5',-119.79,36.8001,{inService:'false'}),cam('6',-119.79,36.8001,{imageData:{static:{currentImageURL:'http://evil.example/x.jpg'}}}),{cctv:{...cam('7',-119.79,36.8001).cctv,location:{...cam('7',-119.79,36.8001).cctv.location,district:'7'}}}];
  const near=nearbyCameras({data},line,{limit:5});
  assert.deepEqual(near.map(c=>c.index),['2','1','3']);
  assert(Math.abs(near[0].km-0.11)<0.01);assert(Math.abs(near[2].km-1.56)<0.02);assert.equal(near[0].direction,'North');
  assert.deepEqual(nearbyCameras({data},line).map(c=>c.index),['2','1']);
  assert.deepEqual(nearbyCameras({data},[[-119.79,36.80]],{maxKm:0.2}).map(c=>c.index),['2']);
  assert.throws(()=>nearbyCameras({},line),/unexpected format/);
});
