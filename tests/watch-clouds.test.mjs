import test from 'node:test';
import assert from 'node:assert/strict';
import {matchCloudObservation,cloudMapRequest,loadCloudImage} from '../site/lib/watch-cloud-data.js';

const now=Date.parse('2026-11-15T03:25:00Z'),minute=60_000;

test('clouds use an advertised time at or before the radar scan and clear large gaps',()=>{
 const images=[now+minute,now-2*minute,now-12*minute,now-40*minute];
 assert.equal(matchCloudObservation(images,now,now),now-2*minute);
 assert.equal(matchCloudObservation(images,now-5*minute,now),now-12*minute);
 assert.equal(matchCloudObservation(images,now-15*minute,now),null);
 assert.equal(matchCloudObservation(images,now+minute,now),null);
});

test('satellite image request uses a fixed regional Mercator footprint and explicit NOAA infrared time',async()=>{
 const {url,width,height,coordinates}=cloudMapRequest(now);
 assert.equal(url.origin,'https://nowcoast.noaa.gov');
 assert.equal(url.searchParams.get('time'),new Date(now).toISOString());
 assert.equal(url.searchParams.get('layers'),'goes_longwave_imagery');
 assert.equal(url.searchParams.get('crs'),'EPSG:3857');
 assert.equal(width,896);assert(height>0&&height<=1024);
 assert.deepEqual(coordinates,[[-122.5,39.6],[-116.5,39.6],[-116.5,34.75],[-122.5,34.75]]);
 await assert.rejects(loadCloudImage(now,{fetchImpl:async()=>new Response('<ServiceException/>',{headers:{'Content-Type':'text/xml'}})}),/image unavailable/);
});
