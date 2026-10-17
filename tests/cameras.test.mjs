import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {cameraMediaUrl,normalizeCameras,cameraAvailability,cameraImageFreshness} from '../site/lib/camera-model.js';

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
