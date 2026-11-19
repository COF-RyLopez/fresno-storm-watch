import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {loadGustForecast, gustPointFeatures} from '../site/lib/command-gust.js';
import {advisoryForecastWindow} from '../site/lib/command-model.js';
const now=Date.parse('2026-11-18T22:30:00Z'),hour=3600000;
const selection=JSON.parse(await readFile(new URL('../site/data/wind-watchlist.json',import.meta.url)));
const reply=body=>({ok:true,json:async()=>body});
function fetcher(log=[],overrides={}){
 return async url=>{
  log.push(String(url));
  if(String(url).endsWith('/latest.json')) return reply({error:'Collection failed'});
  if(String(url).endsWith('/wind-latest.json')) return {ok:false,status:404};
  if(String(url).endsWith('/wind-watchlist.json')) return reply(selection);
  if(String(url).includes('/points/')) return reply({properties:{gridId:'HNX',gridX:53,gridY:106}});
  if(String(url).includes('/gridpoints/')) return reply({properties:{
   gridId:'HNX',gridX:53,gridY:106,updateTime:new Date(now-hour).toISOString(),
   windSpeed:{uom:'wmoUnit:km_h-1',values:[{validTime:'2026-11-18T22:00:00Z/PT3H',value:16}]},
   windDirection:{uom:'wmoUnit:degree_(angle)',values:[{validTime:'2026-11-18T22:00:00Z/PT3H',value:180}]},
   windGust:{uom:'wmoUnit:km_h-1',values:[{validTime:'2026-11-18T22:00:00Z/PT1H',value:0},{validTime:'2026-11-18T23:00:00Z/PT1H',value:null},{validTime:'2026-11-19T00:00:00Z/PT1H',value:64.37376}]},...overrides,
  }});
  throw Error('Unexpected source '+url);
 };
}
test('unavailable HRRR falls back to freshly checked NWS gust samples, with honest time gaps and zero gusts',async()=>{
 const calls=[];
 const forecast=await loadGustForecast(new AbortController().signal,{fetchImpl:fetcher(calls),now});
 assert.equal(forecast.provider,'nws');
 assert.ok(calls.some(url=>url.startsWith('https://api.weather.gov/gridpoints/')));
 assert.deepEqual(forecast.windows.map(w=>w.start),[now,now+1.5*hour]);
 assert.equal(advisoryForecastWindow(forecast.windows,{start:now-hour,end:now+hour},now+1000),forecast.windows[0]);
 const points=gustPointFeatures(forecast.snapshot,now,now);
 assert.equal(points.length,9);
 assert.ok(points.every(p=>p.properties.label==='0 mph'));
 assert.equal(gustPointFeatures(forecast.snapshot,now+.75*hour,now).length,0);
 assert.equal(gustPointFeatures(forecast.snapshot,now+1.5*hour,now)[0].properties.value,40);
 assert.equal(gustPointFeatures(forecast.snapshot,now,now+hour).length,0);
});
test('old NWS source issuance and cancelled requests cannot produce usable gusts',async()=>{
 await assert.rejects(loadGustForecast(new AbortController().signal,{fetchImpl:fetcher([],{updateTime:new Date(now-25*hour).toISOString()}),now}),/No current NWS gust/);
 const controller=new AbortController();controller.abort();
 await assert.rejects(loadGustForecast(controller.signal,{fetchImpl:fetcher(),now}),error=>error.name==='AbortError');
});

test('a fresh HRRR run remains the primary forecast and a failed image can select NWS explicitly',async()=>{
 const run='2026-11-18T18:00:00Z';
 const manifest={schemaVersion:1,product:'noaa-hrrr-forecast-48-hour',units:'m/s',license:'CC-BY-4.0',attribution:'NOAA HRRR processed by Dynamical',vectorConvention:'earth-east-north',run,generatedAt:new Date(now).toISOString(),grid:{wkid:4326,width:101,height:80,x0:-121.25,y0:38.12,dx:.03,dy:-.03},frames:Array.from({length:49},(_,i)=>({leadHours:i,valid:new Date(Date.parse(run)+i*hour).toISOString(),file:`20261118T180000Z-f${String(i).padStart(2,'0')}.json`}))};
 const direct=fetcher();const calls=[];
 const fetchImpl=(url,options)=>{calls.push(String(url));return String(url).endsWith('/latest.json')?reply(manifest):direct(url,options);};
 const primary=await loadGustForecast(new AbortController().signal,{fetchImpl,now});
 assert.equal(primary.provider,'hrrr');assert.equal(calls.length,1);
 const fallback=await loadGustForecast(new AbortController().signal,{fetchImpl,now,preferNws:true});
 assert.equal(fallback.provider,'nws');
});
