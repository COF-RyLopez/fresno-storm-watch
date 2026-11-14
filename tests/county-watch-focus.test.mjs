import test from 'node:test';
import assert from 'node:assert/strict';
import {nextReview,focusedLayerVisible,focusLayerAllowed,focusGraphicAllowed,watchExploreRoute} from '../site/lib/county-watch-focus.js';
test('focused watch reveals only selected evidence; exploration and other topics preserve preferences',()=>{
 assert.equal(focusLayerAllowed('watch',false,null,'power'),false);
 assert.equal(focusLayerAllowed('watch',false,{type:'river'},'areas'),true);
 assert.equal(focusLayerAllowed('watch',false,{type:'river'},'powerLines'),false);
 assert.equal(focusLayerAllowed('watch',true,null,'powerLines'),true);
 assert.equal(focusLayerAllowed('rivers',false,null,'waterways'),true);
});
test('refreshes cannot add unrelated entities to a selected concern',()=>{
 const selected={type:'river',id:'kings-lower',related:{power:['p1'],roads:['r1']}};
 assert.equal(focusGraphicAllowed(selected,{areaId:'kings-lower'}),true);
 assert.equal(focusGraphicAllowed(selected,{areaId:'san-joaquin'}),false);
 assert.equal(focusGraphicAllowed(selected,{powerKey:'p1'}),true);
 assert.equal(focusGraphicAllowed(selected,{powerKey:'p2'}),false);
 assert.equal(focusGraphicAllowed(selected,{roadKey:'r1'}),true);
 assert.equal(focusGraphicAllowed(null,{powerKey:'p1'}),false);
 assert.equal(focusGraphicAllowed({type:'pump',id:'p',related:{drainage:['p','b']}},{drainageKey:'b'}),true);
});
test('next reviews preserve assignments and remain verification cues',()=>{
 assert.match(nextReview({type:'pump',owner:'Operations',status:'Overdue follow-up'}),/Operations/);
 assert.match(nextReview({type:'power'}),/Verify/);
 assert.match(nextReview({type:'river',nextReview:'Check release with operator'}),/Check release/);
 assert.match(nextReview({type:'unknown'}),/Review/);
});
test('explicit reference links remain explorable while plain County Watch is quiet',()=>{
 assert.equal(watchExploreRoute('https://test/?view=watch'),false);
 assert.equal(watchExploreRoute('https://test/?view=watch&population=1&zone=L39'),true);
 assert.equal(watchExploreRoute('https://test/?view=watch&dwr=1'),true);
});

test('focused layers respect eligibility and keep old building overlays outside river reviews',()=>{
 const args={workspace:'watch',explore:false,selected:{type:'river'},key:'power',preferred:false,eligible:false};
 assert.equal(focusedLayerVisible(args),false);
 assert.equal(focusedLayerVisible({...args,eligible:true}),true);
 assert.equal(focusedLayerVisible({...args,eligible:true,focusTypes:['power']}),false);
 assert.equal(focusedLayerVisible({...args,eligible:true,explore:true}),false,'exploration restores user preference');
 assert.equal(focusGraphicAllowed({type:'care',id:'c',related:{zones:['z1']}},{zoneKey:'z2'}),false);
});
