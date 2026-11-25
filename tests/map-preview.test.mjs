import test from 'node:test';
import assert from 'node:assert/strict';
import {previewPosition,previewText} from '../site/lib/map-preview.js';

test('map previews stay within the actual viewport at every edge',()=>{
 for(const point of [{x:0,y:0},{x:390,y:0},{x:390,y:300},{x:0,y:300},{x:195,y:150}]){
  const box=previewPosition(point,{width:240,height:90},{width:390,height:300});
  assert(box.left>=8&&box.top>=8);assert(box.left+box.width<=382&&box.top+box.height<=292);
 }
 const narrow=previewPosition({x:5,y:5},{width:280,height:100},{width:100,height:75});
 assert.equal(narrow.width,84);assert.equal(narrow.height,59);
});
test('placement avoids map tools when there is free space',()=>{
 const obstacle={left:150,top:0,right:390,bottom:120};
 const box=previewPosition({x:140,y:70},{width:180,height:90},{width:390,height:300},[obstacle]);
 assert(box.top>=obstacle.bottom||box.left+box.width<=obstacle.left||box.top+box.height<=obstacle.top);
});
test('short previews retain value, freshness and source time; full readouts are not rewritten',()=>{
 const text='Kings gauge\n3.1 ft\nThreshold unknown / stale\nObserved Nov 25 5:00 AM\nAdditional methods';
 assert.equal(previewText(text),text.split('\n').slice(0,4).join('\n'));
});
