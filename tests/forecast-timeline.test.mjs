import test from 'node:test';
import assert from 'node:assert/strict';
import {createForecastTimeline} from '../site/lib/forecast-timeline.js';
import {createForecastPlayback} from '../site/lib/command-weather-player.js';
import {FakeElement,stubGlobals} from './helpers/dom.mjs';
const frames=[{start:0,end:6},{start:12,end:18},{start:18,end:24}];
function make(t,options={}){
 const restore=stubGlobals({document:{createElement:tag=>new FakeElement(tag)}});t.after(restore);
 return createForecastTimeline({frames,selectedStart:12,format:(a,b)=>`${a} to ${b}`, ...options});
}
test('timeline indexes available windows rather than inventing missing six-hour data',t=>{
 const ui=make(t);assert.equal(ui.input.type,'range');assert.equal(ui.input.min,'0');assert.equal(ui.input.max,'2');assert.equal(ui.input.step,'1');
 assert.equal(ui.input.value,'1');assert.equal(ui.input.dataset.forecastStart,'12');assert.equal(ui.input.attributes.get('aria-valuetext'),'12 to 18');
 ui.input.value='0';ui.input.dispatchEvent(new Event('input'));assert.equal(ui.label.textContent,'0 to 6');assert.equal(ui.input.dataset.forecastStart,'0');
 ui.setIndex(2);assert.equal(ui.input.value,'2');assert.equal(ui.label.textContent,'18 to 24');
});
test('empty and single-window timelines have clear non-playable states',t=>{
 const empty=make(t,{frames:[]});assert.equal(empty.input.disabled,true);assert.match(empty.label.textContent,/No matching/);
 const single=make(t,{frames:frames.slice(0,1)});assert.equal(single.input.disabled,true);assert.equal(single.label.textContent,'0 to 6');
});
test('playback and manual keyboard-style scrubbing update the same timeline and frame',async t=>{
 const ui=make(t),seen=[];
 const player=createForecastPlayback({frames,load:async f=>f,render:(_v,_f,index)=>{ui.setIndex(index);seen.push(index);}});t.after(()=>player.destroy());
 ui.input.addEventListener('input',()=>void player.select(Number(ui.input.value)));
 await player.select(1);assert.equal(ui.label.textContent,'12 to 18');
 ui.input.value='2';ui.input.dispatchEvent(new Event('input'));await new Promise(r=>setImmediate(r));
 assert.equal(ui.input.dataset.forecastStart,'18');assert.deepEqual(seen,[1,2]);assert.equal(ui.input.attributes.get('aria-valuetext'),'18 to 24');
});
