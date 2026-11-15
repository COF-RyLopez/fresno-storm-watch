import test from 'node:test';
import assert from 'node:assert/strict';
import {advisoryProfile, advisoryContext, advisoryMatches} from '../site/lib/command-model.js';
const feature = (x,y) => ({type:'Feature',geometry:{type:'Point',coordinates:[x,y]},properties:{}});
const alert = {id:'alert',kind:'alert',name:'Flood Advisory',features:[{geometry:{type:'Polygon',coordinates:[[[0,0],[2,0],[2,2],[0,2],[0,0]]]}}]};
const row = (kind,x=1) => ({id:kind,kind,review:true,features:[feature(x,1)]});
test('advisories select hazard-specific context, de-duplicate and keep screening separate from impacts',()=>{
 const rows=[row('river'),row('power'),row('road'),row('care'),row('facility'),row('river'),{...row('road',15),id:'far-road'}];
 const flood=advisoryContext(alert,rows);
 assert.deepEqual(flood.map(r=>r.id),['river','road','care']);
 const wind=advisoryContext({...alert,name:'Wind Advisory'},rows);
 assert.deepEqual(wind.map(r=>r.id),['power','road','care']);
 assert.match(advisoryProfile(alert.name).qualification,/not confirmed impacts/);
 assert.match(advisoryProfile('Dense Fog Advisory').nextAction,/Road Maintenance/);
 assert.equal(advisoryContext({...alert,features:[]},rows).length,0);
 assert.ok(advisoryContext(alert,[...rows,{...row('facility'),private:true}]).some(r=>r.id==='facility'));
});
test('advisory context uses polygon edges and holes, not the bounding rectangle',()=>{
 const shaped={...alert,features:[{geometry:{type:'Polygon',coordinates:[[[0,0],[4,0],[0,4],[0,0]],[[.5,.5],[1,.5],[1,1],[.5,1],[.5,.5]]]}}]};
 assert.equal(advisoryMatches(shaped,feature(3,3)),false);
 assert.equal(advisoryMatches(shaped,feature(.75,.75)),false);
 assert.equal(advisoryMatches(shaped,feature(1.5,1)),true);
 assert.equal(advisoryMatches(shaped,{geometry:{type:'LineString',coordinates:[[-1,2],[3,2]]}}),true);
 assert.equal(advisoryMatches(shaped,{geometry:{type:'LineString',coordinates:[[3,3],[4,4]]}}),false);
 assert.equal(advisoryMatches(shaped,{geometry:{type:'Polygon',coordinates:[[[3,3],[4,3],[4,4],[3,3]]]}}),false);
});
