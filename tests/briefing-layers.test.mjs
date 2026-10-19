import {test} from 'node:test';
import assert from 'node:assert/strict';
import {BRIEFING_LAYERS,briefingLayerTime,briefingLayerCycle,briefingLayerLegend} from '../site/lib/briefing-layer-model.js';
import {workspaceDefaults,layerVisible} from '../site/lib/workspace-model.js';
const now=Date.parse('2026-10-19T23:00:00Z'),rain=BRIEFING_LAYERS[0],ero=BRIEFING_LAYERS[5],winter=BRIEFING_LAYERS[6];
const data=(s=rain)=>({features:[{attributes:{product:s.product,issue_time:'2026-10-19 22:00:00',start_time:'2026-10-20 00:00:00',end_time:'2026-10-21 00:00:00',units:'Inches'}}]});
test('seven guided steps use only verified NOAA services and distinguish amount from probability',()=>{
  assert.equal(BRIEFING_LAYERS.length,7);assert.equal(new Set(BRIEFING_LAYERS.map(s=>s.id)).size,7);
  for(const s of BRIEFING_LAYERS)assert.equal(new URL(s.service).hostname,'mapservices.weather.noaa.gov');
  assert.match(rain.relationship,/do not reproduce/);assert.match(ero.relationship,/latest published cycle/);assert.equal(winter.page,14);
});
test('UTC parsing accepts NOAA daily and WSSI formats without local time assumptions',()=>{
  assert.equal(briefingLayerTime('2026-10-19 2019Z'),Date.parse('2026-10-19T20:19:00Z'));
  assert.equal(briefingLayerTime('18Z 10/22/26'),Date.parse('2026-10-22T18:00:00Z'));
  for(const s of ['24Z 10/22/26','18Z 02/30/26','2026-10-19 2560Z','2026-10-19T20:19:00','unknown'])assert.equal(briefingLayerTime(s),null);
});
test('source revision locks all displayed polygons to one issue and forecast window',()=>{
  const d=data(),c=briefingLayerCycle(d,rain,now);assert.equal(c.end-c.start,24*3_600_000);assert.match(c.where,/units = 'Inches'/);assert.match(c.where,/issue_time = '2026-10-19 22:00:00'/);
  d.features.push(structuredClone(d.features[0]));assert.deepEqual(briefingLayerCycle(d,rain,now),c);
  d.features[1].attributes.issue_time='2026-10-19 21:00:00';assert.throws(()=>briefingLayerCycle(d,rain,now),/Mixed/);
});
test('empty, truncated, failed and missing metadata cannot become a no-risk map',()=>{
  for(const d of [{features:[]},{error:{message:'fail'}},{...data(),exceededTransferLimit:true},{features:[{attributes:{}}]}])assert.throws(()=>briefingLayerCycle(d,rain,now));
});
test('wrong product, units, future issue, ended and stale forecasts are withheld',()=>{
  for(const [field,value]of [['product','Probability of rain'],['units','mm'],['issue_time','2026-10-20 01:00:00'],['end_time','2026-10-19 22:00:00'],['issue_time','2026-10-17 00:00:00']]){const d=data();d.features[0].attributes[field]=value;assert.throws(()=>briefingLayerCycle(d,rain,now));}
});
test('WSSI Zulu windows and future daily ERO periods retain their real source dates',()=>{
  const w=data(winter);Object.assign(w.features[0].attributes,{issue_time:'2026-10-19 2019Z',start_time:'20Z 10/19/26',end_time:'18Z 10/22/26'});assert.equal(briefingLayerCycle(w,winter,now).end,Date.parse('2026-10-22T18:00Z'));
  const e=data(ero);Object.assign(e.features[0].attributes,{start_time:'2026-10-21 12:00:00',end_time:'2026-10-22 12:00:00'});assert.equal(briefingLayerCycle(e,ero,now).start,Date.parse('2026-10-21T12:00Z'));
});
test('publisher legend is selected by layer ID, with text and validated PNG symbols',()=>{
  const d={layers:[{layerId:rain.layer,legend:[{label:'0.25 inches',contentType:'image/png',imageData:'aGVsbG8='}]}]};assert.equal(briefingLayerLegend(d,rain)[0].label,'0.25 inches');
  for(const change of [{contentType:'image/svg+xml'},{imageData:'<script>'},{label:null}]){const x=structuredClone(d);Object.assign(x.layers[0].legend[0],change);assert.throws(()=>briefingLayerLegend(x,rain));}
  assert.throws(()=>briefingLayerLegend({layers:[]},rain));
});
test('tour layers default off in every workspace and cannot leak through an ineligible source',()=>{
  for(const id of ['watch','weather','rivers','reservoirs','alerts','power','roads']){const s=workspaceDefaults(id);assert.equal(layerVisible(s,'briefingLayers'),false);s.layers.briefingLayers=true;assert.equal(layerVisible(s,'briefingLayers',false),false);}
});
