import test from 'node:test';
import assert from 'node:assert/strict';
import {snowLevels,snowLevelAt,snowRange,feet,snowLines,ROUTE_PRIORITIES} from '../site/lib/snow-model.js';

const grid={properties:{snowLevel:{uom:'wmoUnit:m',values:[
  {validTime:'2026-11-02T06:00:00+00:00/PT1H',value:1896.16},{validTime:'2026-11-02T07:00:00+00:00/PT2H',value:1700},
  {validTime:'2026-11-02T09:00:00+00:00/PT1H',value:null},{validTime:'garbage',value:1500}]}}};
test('NWS snow level: metres per step, gaps stay unknown, units are checked',()=>{
  const s=snowLevels(grid);assert.equal(s.length,2);
  assert.equal(snowLevelAt(s,Date.parse('2026-11-02T06:30:00Z')),1896.16);assert.equal(snowLevelAt(s,Date.parse('2026-11-02T08:59:00Z')),1700);
  assert.equal(snowLevelAt(s,Date.parse('2026-11-02T09:30:00Z')),null);
  assert.deepEqual(snowRange(s,Date.parse('2026-11-02T06:00:00Z'),Date.parse('2026-11-03T06:00:00Z')),{low:1700,high:1896.16});
  assert.equal(snowRange(s,0,1),null);assert.equal(feet(1896.16),6200);
  assert.throws(()=>snowLevels({properties:{snowLevel:{uom:'wmoUnit:ft',values:[]}}}));
});
test('forecast discussion: keeps snow sentences only',()=>{
  const afd='.DISCUSSION... A cold trough arrives Tuesday. Snow levels fall to 5000 feet by Wednesday morning. Valley rain totals near 0.5 inch. Heavy snowfall is possible above 6000 ft. Freezing levels lower to 4500 ft. Dry Friday.';
  assert.deepEqual(snowLines(afd),['Snow levels fall to 5000 feet by Wednesday morning.','Heavy snowfall is possible above 6000 ft.','Freezing levels lower to 4500 ft.']);
  assert.deepEqual(snowLines(''),[]);assert.deepEqual(snowLines('Mostly sunny. Breezy.'),[]);
});
test('every county priority code in the layer has a style',()=>{for(const p of [1,2,3,4,9,10,11])assert.ok(ROUTE_PRIORITIES[p].color);});
import {chainPaths,profileSamples,profileStats,km} from '../site/lib/snow-model.js';
test('road segments chain end to end, reversing pieces drawn the other way',()=>{
  const a=[[0,0],[0,0.01]],b=[[0,0.02],[0,0.01]],c=[[0,0.02],[0,0.03]];// b is drawn backwards
  const parts=chainPaths([c,a,b]);assert.equal(parts.length,1);const line=parts[0];
  assert.deepEqual([line[0],line.at(-1)].map(String).sort(),['0,0','0,0.03']);assert.equal(line.length,4);// either direction is a valid profile
  const ys=line.map(p=>p[1]);assert.deepEqual(ys,[...ys].sort((x,y)=>line[0][1]===0?x-y:y-x));
  // A 1 km gap starts a new part rather than a straight jump.
  const far=[[0,0.04],[0,0.05]];assert.equal(chainPaths([a,b,c,far]).length,2);
  assert.deepEqual(chainPaths([]),[]);
  assert.ok(Math.abs(km([0,0],[0,1])-111.2)<0.1);
});
test('3DEP samples are re-ordered, de-duplicated and measured along the line',()=>{
  const s=(id,y,v)=>({locationId:id,location:{x:0,y},value:String(v)});
  const pts=profileSamples([s(2,0.02,1900),s(0,0,1700),s(1,0.01,1800),s(1,0.01,1801),s(3,0.03,'NoData')]);
  assert.deepEqual(pts.map(p=>p.m),[1700,1800,1900]);assert.ok(Math.abs(pts[2].km-2.224)<0.01);
});
test('profile stats: length, range and miles above the snow level (interpolated crossing)',()=>{
  const pts=[{km:0,m:1700},{km:1,m:1800},{km:2,m:1900}];
  const s=profileStats(pts,1850);assert.ok(Math.abs(s.lengthMi-1.2427)<1e-3);assert.ok(Math.abs(s.aboveMi-0.5/1.609344)<1e-6);
  assert.equal(Math.round(s.lowFt),5577);assert.equal(profileStats(pts,null).aboveMi,null);assert.equal(profileStats(pts,1000).aboveMi.toFixed(4),s.lengthMi.toFixed(4));
});
import {placeOnProfile,labelRows} from '../site/lib/snow-model.js';
test('landmarks land at their nearest point along the road, one per name, in road order',()=>{
  const pts=[0,1,2,3].map(i=>({km:i,m:1000+i*100,x:0,y:i*0.009}));
  const out=placeOnProfile([{name:'Lakeshore',kind:'place',x:0.001,y:0.027},{name:'Big Creek',kind:'place',x:0,y:0.0},{name:'Big Creek',kind:'place',x:0.05,y:0.01},{name:'Kerckhoff Dome',kind:'peak',x:0.01,y:0.018}],pts);
  assert.deepEqual(out.map(o=>[o.name,o.km,o.m]),[['Big Creek',0,1000],['Kerckhoff Dome',2,1200],['Lakeshore',3,1300]]);
  assert.ok(out[0].offKm<0.01);assert.deepEqual([out[1].x,out[1].y],[0.01,0.018]);// the peak's own position, for the map
});
test('labels never overlap; extras and peaks become ticks',()=>{
  const marks=[{name:'Big Creek',kind:'place',km:0,offKm:.1},{name:'Camp Sierra',kind:'place',km:0.2,offKm:.3},{name:'Cedar Crest',kind:'place',km:0.4,offKm:.2},{name:'Kerckhoff Dome',kind:'peak',km:5,offKm:.5},{name:'Lakeshore',kind:'place',km:10,offKm:.1}];
  const out=labelRows(marks,{width:260,maxKm:10,rows:2});
  assert.equal(out.find(m=>m.name==='Kerckhoff Dome').row,null);
  assert.deepEqual(out.filter(m=>m.row!==null).map(m=>m.name).sort(),['Big Creek','Cedar Crest','Lakeshore']);// Camp Sierra collides on both rows
  assert.equal(labelRows(marks,{width:260,maxKm:10,maxLabels:1}).filter(m=>m.row!==null).length,1);
});
