import test from 'node:test';
import assert from 'node:assert/strict';
import {powerFocusExtent} from '../site/lib/power-focus.js';

const box=(x,y,w,h=w)=>({rings:[[[x,y],[x+w,y],[x+w,y+h],[x,y+h],[x,y]]],spatialReference:{wkid:4326}});
test('power fitting includes all multipart outlines and uses a proportional rather than fixed margin',()=>{
  const a=box(-119.8,36.7,.002),b=box(-119.79,36.71,.004);
  const bounds=powerFocusExtent([{...a,rings:[...a.rings,...b.rings]}]);
  for(const shape of [a,b])for(const [x,y]of shape.rings.flat())assert(x>bounds.xmin&&x<bounds.xmax&&y>bounds.ymin&&y<bounds.ymax);
  assert(Math.abs((bounds.xmax-bounds.xmin)-.014*1.2)<1e-10);
  assert.equal(powerFocusExtent([]),null);
});
test('small footprints fit at building scale; distant representative points do not stretch a published polygon',()=>{
  const roof=box(-119.8,36.7,.0001),point={x:-120,y:37,spatialReference:{wkid:4326}};
  const bounds=powerFocusExtent([roof,point]);
  assert.deepEqual(bounds,powerFocusExtent([roof]));
  assert(bounds.xmax-bounds.xmin<.003,'Do not add the former .024° / kilometre-wide margin.');
  assert(bounds.ymax-bounds.ymin>.0015,'A single roof retains useful nearby context.');
  assert.throws(()=>powerFocusExtent([{...roof,spatialReference:{wkid:3857}}]),/WGS84/);
  assert.throws(()=>powerFocusExtent([box(NaN,36.7,.1)]),/invalid/);
});
