import test from 'node:test';
import assert from 'node:assert/strict';
import {libraryMapStatus} from '../site/lib/library-status-model.js';
const a={id:'a',label:'Scenario A'},b={id:'b',label:'Scenario B'};
test('scenario status never relabels an already displayed map when the selector changes',()=>{
 const current=libraryMapStatus({selected:a,mapped:a});assert.match(current.text,/Map showing: Scenario A/);
 const changed=libraryMapStatus({selected:b,mapped:a});assert.match(changed.text,/Selection changed/);assert.match(changed.text,/Map still shows: Scenario A/);assert(!changed.text.includes('Map showing: Scenario B'));
});
test('unloaded, loading and failure states stay explicit outside advanced setup',()=>{
 assert.match(libraryMapStatus().text,/No published library map loaded/);
 assert.match(libraryMapStatus({selected:b,loading:true,mapped:a}).text,/Loading library map: Scenario B/);
 const failure=libraryMapStatus({selected:b,error:'Source request failed'});assert.equal(failure.problem,true);assert.match(failure.text,/unavailable: Source request failed/);
});
