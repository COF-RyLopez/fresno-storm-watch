import test from 'node:test';
import assert from 'node:assert/strict';
import {layoutPresentation,createCommandLayout} from '../command/src/layout.ts';
import {FakeElement} from './helpers/dom.mjs';

const base={width:1920,height:1080,pane:'attention',inspectorOpen:true,attentionCollapsed:false};
test('wide docked panels leave a persistent map; compact has exactly one pane',()=>{
 assert.deepEqual(layoutPresentation(base),{compact:false,attention:true,evidence:true,map:true});
 for(const size of [{width:390,height:844},{width:844,height:390}])for(const pane of ['attention','map','details']){
  const p=layoutPresentation({...base,...size,pane});
  assert.equal([p.attention,p.evidence,p.map].filter(Boolean).length,1);
  assert.equal(p[pane==='details'?'evidence':pane],true);
 }
 assert.equal(layoutPresentation({...base,width:700}).compact,true);
 assert.equal(layoutPresentation({...base,width:701}).compact,false);
});
test('medium widths show one side at a time; absent details never leaves a blank compact screen',()=>{
 assert.deepEqual(layoutPresentation({...base,width:1000,pane:'details'}),{compact:false,attention:false,evidence:true,map:true});
 assert.equal(layoutPresentation({...base,width:1000,pane:'attention'}).evidence,false);
 assert.deepEqual(layoutPresentation({...base,width:390,pane:'details',inspectorOpen:false}),{compact:true,attention:false,evidence:false,map:true});
});
test('controller retains presentation choices on resize and never owns place or weather state',()=>{
 const nodes=new Map(),get=id=>{if(!nodes.has(id))nodes.set(id,new FakeElement());return nodes.get(id);};
 let size={width:1920,height:1080};const layout=createCommandLayout({get,viewport:()=>size,resize(){}});
 layout.inspector(true);layout.toggleAttention();assert.equal(get('attention-shell').hidden,true);
 size={width:390,height:844};layout.pane('details');layout.refresh();assert.equal(get('evidence').hidden,false);assert.equal(get('map-panel').hidden,true);
 size={width:1920,height:1080};layout.refresh();assert.equal(get('attention-shell').hidden,true);assert.equal(get('map-panel').hidden,false);
 layout.toggleAttention();assert.equal(get('attention-shell').hidden,false);
 layout.inspector(false);assert.equal(get('evidence').hidden,true);
});

test('internal panel navigation notifies the owner so footer and animation visibility agree after resize',()=>{
 const nodes=new Map(),get=id=>{if(!nodes.has(id))nodes.set(id,new FakeElement());return nodes.get(id);};
 let size={width:1000,height:720},mobile='map';
 const layout=createCommandLayout({get,viewport:()=>size,resize(){},onPane:value=>{mobile=value;}});
 layout.pane(mobile);layout.inspector(true);assert.equal(mobile,'details');
 layout.toggleAttention();assert.equal(mobile,'attention');
 size={width:390,height:844};layout.refresh();
 assert.equal(get('attention-shell').hidden,false);assert.equal(get('map-panel').hidden,true);
 assert.notEqual(mobile,'map');
 layout.pane('details');layout.inspector(false);assert.equal(mobile,'map');
 assert.equal(get('map-panel').hidden,false);
});
