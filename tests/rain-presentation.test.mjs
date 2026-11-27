import test from 'node:test';
import assert from 'node:assert/strict';
import {RAIN_BANDS,RAIN_PRESENTATION,rainBand,rainRenderer} from '../site/lib/rain-presentation.js';
import {loadWatershedRain} from '../site/lib/watch-watershed-data.js';
test('six fixed non-overlapping amount bands preserve unknown values',()=>{
 assert.equal(RAIN_BANDS.length,6);
 for(const value of [null,undefined,NaN,-1,0,.009])assert.equal(rainBand(value),null);
 for(const [value,expected] of [[.01,0],[.099,0],[.1,1],[.25,2],[.5,3],[1,4],[2,5],[10,5]])assert.equal(rainBand(value),RAIN_BANDS[expected]);
 assert.deepEqual(rainRenderer([.1,.5,4]).uniqueValueInfos.map(v=>v.symbol.color),[RAIN_BANDS[1],RAIN_BANDS[3],RAIN_BANDS[5]].map(b=>[...b.rgba]));
});
test('Command export applies fixed colors to the same numeric forecast and dates',async()=>{
 const now=Date.parse('2026-11-27T10:00:00Z');let renderer;
 const cycle={product:'72-hour QPF',issue_time:'2026-11-27 06:00:00',start_time:'2026-11-27 12:00:00',end_time:'2026-11-30 12:00:00',units:'Inches'};
 const rain=await loadWatershedRain([-121,35,-118,38],{clock:()=>now,presentation:RAIN_PRESENTATION,fetchImpl:async input=>{
  const u=new URL(input);
  if(u.pathname.endsWith('/export')){const dynamic=JSON.parse(u.searchParams.get('dynamicLayers'))[0];renderer=dynamic.drawingInfo.renderer;
   assert.match(dynamic.definitionExpression,/2026-11-27 06:00:00/);return new Response('png',{headers:{'content-type':'image/png'}});}
  return Response.json({features:u.searchParams.has('geometry')?[{attributes:{qpf:.1}},{attributes:{qpf:2}}]:[{attributes:cycle}]});
 }});
 assert.equal(rain.presentation,RAIN_PRESENTATION);assert.equal(rain.legend.length,6);assert.equal(rain.cycle.hours,72);
 assert.deepEqual(renderer.uniqueValueInfos.map(v=>v.value),['0.1','2']);
 assert.deepEqual(renderer.uniqueValueInfos[0].symbol.color,[...RAIN_BANDS[1].rgba]);
});
