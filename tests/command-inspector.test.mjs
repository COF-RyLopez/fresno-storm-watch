import test from 'node:test';
import assert from 'node:assert/strict';
import {createCommandInspector} from '../command/src/inspector.ts';
import {FakeElement} from './helpers/dom.mjs';

function setup(t){
 const nodes=new Map(),panes=[];
 const get=id=>{if(!nodes.has(id)){const node=new FakeElement();node.hidden=false;node.focus=()=>node.dataset.focused='true';node.classList={toggle(){}};nodes.set(id,node);}return nodes.get(id);};
 const inspector=createCommandInspector({get,pane:value=>panes.push(value),resize(){}});
 t.after(()=>inspector.clear());return {inspector,get,panes};
}
test('closing the inspector preserves selection; a background refresh does not reopen it',t=>{
 const h=setup(t);h.inspector.selection('river:kings-lower');assert.equal(h.inspector.panel,'place');
 h.get('evidence-close').onclick();assert.equal(h.inspector.panel,null);assert.equal(h.panes.at(-1),'map');
 assert.equal(h.get('command-map').dataset.focused,'true');
 h.inspector.selection('river:kings-lower');assert.equal(h.inspector.panel,null);
 h.inspector.selection('river:san-joaquin-lower');assert.equal(h.inspector.panel,'place');
});

test('changing weather clears a temporary reading without losing the selected place or reopening closed details',t=>{
 const h=setup(t);h.inspector.selection('river:kings-lower');h.inspector.reading({name:'Gust',readout:'25 mph · forecast'});
 h.inspector.clearReading();assert.equal(h.inspector.panel,'place');assert.equal(h.get('reading-content').textContent,'');
 h.get('evidence-close').onclick();h.inspector.clearReading();assert.equal(h.inspector.panel,null);
});
test('weather and map key are accessible without a selected concern and have one visible panel',t=>{
 const h=setup(t);h.get('weather-details-open').onclick();assert.equal(h.inspector.panel,'weather');
 assert.equal(h.get('evidence').hidden,false);assert.equal(h.get('weather-inspector').hidden,false);
 assert.equal(h.get('place-inspector').hidden,true);assert.equal(h.get('map-key-inspector').hidden,true);
 h.get('map-key-open').onclick();assert.equal(h.inspector.panel,'key');assert.equal(h.get('weather-inspector').hidden,true);
 h.inspector.selection(null);assert.equal(h.inspector.panel,'key');
});
test('temporary map readings use the inspector; source tabs and back retain selected place',t=>{
 const h=setup(t);h.inspector.selection('river:kings-lower');h.inspector.reading({name:'Kings gauge',readout:'3.1 ft\nObserved at 10:00 · thresholds unknown'});
 assert.equal(h.inspector.panel,'reading');assert.match(h.get('reading-content').textContent,/thresholds unknown/);
 h.get('inspector-weather').onclick();h.inspector.selection('river:kings-lower');assert.equal(h.inspector.panel,'weather');
 h.get('inspector-place').onclick();assert.equal(h.inspector.panel,'place');
 h.inspector.clear();assert.equal(h.get('reading-content').textContent,'');assert.equal(h.inspector.panel,null);
});

test('Flow Back returns to the originating weather section; clear deselects private readings',t=>{
 const h=setup(t);h.inspector.show('weather');h.inspector.reading({name:'Gauge',readout:'Private test reading'});
 assert.equal(h.get('reading-flow-item').hasAttribute('selected'),true);
 assert.equal(h.get('inspector-root').hasAttribute('selected'),false);
 const back=new Event('calciteFlowItemBack',{cancelable:true});h.get('reading-flow-item').dispatchEvent(back);
 assert.equal(back.defaultPrevented,true);assert.equal(h.inspector.panel,'weather');
 assert.equal(h.get('inspector-root').hasAttribute('selected'),true);
 h.inspector.reading({readout:'Private test reading'});h.inspector.clear();
 assert.equal(h.get('reading-content').textContent,'');
 assert.equal(h.get('reading-flow-item').hasAttribute('selected'),false);
 assert.equal(h.get('evidence').hidden,true);
});
