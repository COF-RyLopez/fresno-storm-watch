import test from 'node:test';
import assert from 'node:assert/strict';

test('fixed height classes include exact boundaries and reject unavailable heights',async()=>{
 const {CLOUD_TOP_HEIGHT_BANDS,cloudTopHeightBand}=await import('../site/lib/cloud-top-style.js');
 for(const [height,index]of [[0,0],[1999.9,0],[2000,1],[5999.9,1],[6000,2],[20000,2]])
  assert.equal(cloudTopHeightBand(height),CLOUD_TOP_HEIGHT_BANDS[index]);
 for(const height of [-1,20000.1,NaN,Infinity,null,undefined])assert.equal(cloudTopHeightBand(height),null);
 for(const band of CLOUD_TOP_HEIGHT_BANDS){
  const hex='#'+band.rgb.map(value=>value.toString(16).padStart(2,'0')).join('');
  assert.equal(band.color,hex,'The legend and shader use identical color channels.');
 }
 const lightness=CLOUD_TOP_HEIGHT_BANDS.map(band=>band.rgb.reduce((sum,c,i)=>sum+c*[0.2126,0.7152,0.0722][i],0));
 assert.ok(lightness[0]<lightness[1]&&lightness[1]<lightness[2],'Lightness preserves height order without red/green cues.');
});
