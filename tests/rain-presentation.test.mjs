import test from 'node:test';
import assert from 'node:assert/strict';
import {RAIN_BANDS,RAIN_PRESENTATION,rainBand,remapRainPixels} from '../site/lib/rain-presentation.js';
import {prepareRainImage} from '../scripts/lib/rain-image.mjs';
import {PNG} from 'pngjs';
test('six fixed non-overlapping amount bands preserve unknown values',()=>{
 assert.equal(RAIN_BANDS.length,6);
 for(const value of [null,undefined,NaN,-1,0,.009])assert.equal(rainBand(value),null);
 for(const [value,expected] of [[.01,0],[.099,0],[.1,1],[.25,2],[.5,3],[1,4],[2,5],[10,5]])assert.equal(rainBand(value),RAIN_BANDS[expected]);
 const p=new Uint8Array([0,255,0,255,8,139,0,128,245,245,245,255,0,0,0,0]);
 remapRainPixels(p,[{value:.1,color:'rgb(0,255,0)'},{value:.25,color:'rgb(8,139,0)'}]);
 assert.deepEqual([...p.slice(0,4)],[85,135,171,90]);
 assert.deepEqual([...p.slice(4,8)],[99,143,194,60]);assert.equal(p[11],0);assert.equal(p[15],0);
});
test('prepared PNG retains contour pixels, extent and dates while changing only its display palette',async()=>{
 const image=new PNG({width:2,height:1});image.data.set([0,255,0,255,8,139,0,255]);
 const source={cycle:{start:1,end:7,units:'in'},coordinates:[[0,1],[1,1],[1,0],[0,0]],legend:[{value:.1,color:'rgb(0,255,0)'},{value:.25,color:'rgb(8,139,0)'}],blob:new Blob([PNG.sync.write(image)])};
 const out=await prepareRainImage(source),pixels=PNG.sync.read(Buffer.from(await out.blob.arrayBuffer())).data;
 assert.equal(out.presentation,RAIN_PRESENTATION);assert.equal(out.legend.length,6);assert.equal(out.cycle,source.cycle);assert.equal(out.coordinates,source.coordinates);
 assert.deepEqual([...pixels],[85,135,171,90,99,143,194,120]);
});
