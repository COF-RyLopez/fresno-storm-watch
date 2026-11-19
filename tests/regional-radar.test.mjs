import test from 'node:test';
import assert from 'node:assert/strict';
import {mosaicTimes,mosaicLegend,mosaicRequest} from '../site/lib/regional-radar-data.js';
const now=Date.parse('2026-11-19T20:00:00Z'),minute=60000;
test('regional radar uses only advertised observations; sorts and bounds replay and flags gaps',()=>{
 const list=[now+5*minute,now,now-5*minute,now-20*minute,now-200*minute].map(t=>new Date(t).toISOString()).join(',');
 const result=mosaicTimes(list,now);
 assert.deepEqual(result.frames.map(f=>f.time),[now-20*minute,now-5*minute,now]);assert.equal(result.gaps,true);
 assert.throws(()=>mosaicTimes(new Date(now-180*minute).toISOString(),now),/recent|unavailable/i);
 assert.throws(()=>mosaicTimes('2026-11-19T19:00Z/2026-11-19T20:00Z/PT5M',now),/explicit|time/i);
});
test('requests pin the observation, geographic image corners and bounded pixel count',()=>{
 const request=mosaicRequest(now,[-131,28,-107.5,47]);
 assert.equal(request.url.origin,'https://nowcoast.noaa.gov');assert.equal(request.url.searchParams.get('time'),new Date(now).toISOString());
 assert.equal(request.url.searchParams.get('layers'),'conus_base_reflectivity_mosaic');
 assert.equal(request.url.searchParams.get('crs'),'EPSG:3857');
 assert.deepEqual(request.coordinates,[[-131,47],[-107.5,47],[-107.5,28],[-131,28]]);
 assert(request.width<=1400&&request.height<=1400);
 assert.throws(()=>mosaicRequest(now,[-140,28,-107.5,91]),/bounds/i);
});
test('radar key comes from the named publisher colormap, not the old custom echo colors',()=>{
 const entries=[10,20,30,40,50,60,70].map(quantity=>({quantity:String(quantity),label:String(quantity),color:'#123456',opacity:'1'}));
 const json={Legend:[{layerName:'conus_base_reflectivity_mosaic',rules:[{symbolizers:[{Raster:{colormap:{entries}}}]}]}]};
 assert.deepEqual(mosaicLegend(json).map(b=>b.value),entries.map(e=>e.label));
 assert.throws(()=>mosaicLegend({...json,Legend:[]}),/legend/i);
});
