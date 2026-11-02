import test from 'node:test';
import assert from 'node:assert/strict';
import {labelPoint,gaugeLabel} from '../site/lib/map-labels.js';

test('label anchor is the point itself or the middle vertex of the first path',()=>{
  assert.deepEqual(labelPoint({x:-119.7,y:36.7}),{longitude:-119.7,latitude:36.7});
  assert.deepEqual(labelPoint({paths:[[[0,0],[1,1],[2,2]]]}),{longitude:1,latitude:1});
  assert.deepEqual(labelPoint({paths:[[[0,0],[1,1]]]}),{longitude:0,latitude:0});
  for(const g of [null,{},{paths:[[]]},{x:NaN,y:1}])assert.equal(labelPoint(g),null);
});

test('gauge map label drops the USGS suffix only',()=>{
  assert.equal(gaugeLabel('Cantua Creek near Cantua Creek (USGS)'),'Cantua Creek near Cantua Creek');
  assert.equal(gaugeLabel('Mill Creek near Piedra'),'Mill Creek near Piedra');
});
