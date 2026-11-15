import test from 'node:test';
import assert from 'node:assert/strict';
import {createCommandState,orderedConcerns,arcGeometry,boundedFigure,routeState} from '../site/lib/command-model.js';
test('navigation and refreshed concerns preserve selection and camera',()=>{
 const s=createCommandState();s.patch({selected:'river:kings-lower',camera:{zoom:12}});s.patch({view:'work'});s.patch({concerns:[{id:'other'}]});s.patch({view:'watch'});
 assert.equal(s.value.selected,'river:kings-lower');assert.equal(s.value.camera.zoom,12);
});
test('attention includes reports/conflicts, keeps warnings first and no duplicate ids',()=>{
 const rows=orderedConcerns([{id:'b',group:3,time:1},{id:'a',group:0,time:3},{id:'c',group:1,time:null},{id:'a',group:0,time:3}]);
 assert.deepEqual(rows.map(r=>r.id),['a','c','b']);
});
test('invalid geometries remain unknown and multipart shapes retained',()=>{
 assert.equal(arcGeometry({x:null,y:0}),null);assert.equal(arcGeometry({x:500000,y:4000000}),null);
 assert.equal(arcGeometry({paths:[[[0,0],[1,1]],[[2,2],[3,3]]]}).type,'MultiLineString');
});
test('bounded figures preserve extremes and timestamps, reject missing values as zero',()=>{
 const a=Array.from({length:1000},(_,i)=>({time:i,value:i===456?800:1}));
 const result=boundedFigure(a,96);assert.ok(result.length<=96);assert.ok(result.some(p=>p.value===800));assert.equal(result.at(-1).time,999);
 assert.deepEqual(boundedFigure([{time:1,value:null},{time:2,value:0}]),[{time:2,value:0}]);
});
test('routes accept public selection and known destinations only',()=>{
 assert.deepEqual(routeState('#/work?place=river%3Akings-lower'),{view:'work',selected:'river:kings-lower'});
 assert.equal(routeState('#/arbitrary?token=secret').view,'watch');
});
