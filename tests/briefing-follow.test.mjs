import {test} from 'node:test';
import assert from 'node:assert/strict';
import {FOLLOW_DOCUMENT,slideMapping,chooseSlideLayer} from '../site/lib/briefing-follow-model.js';
import {createBriefingLayers} from '../site/lib/briefing-layer-ui.js';
import {FakeElement,withGlobals} from './helpers/dom.mjs';
const context=(page,more={})=>({sha256:FOLLOW_DOCUMENT,page,verified:true,follow:true,...more});
test('page associations require the verified exact PDF revision, not a matching page number',()=>{
  assert(slideMapping(context(6)).mapping);assert.match(slideMapping(context(6,{verified:false})).reason,/verification/);assert.match(slideMapping(context(6,{sha256:'a'.repeat(64)})).reason,/revision/);
  for(const page of [1,2,8,9,10,11,12,13,15,16,17,18,19])assert.equal(slideMapping(context(page)).mapping,null);
});
test('quarter and half inch select the exact threshold and UTC period, independently of rolling period index',()=>{
  const m=slideMapping(context(6)).mapping;
  assert.equal(chooseSlideLayer(m,[{id:'prob-0p25-1',start:m.start-86400000,end:m.end-86400000},{id:'prob-0p25-2',start:m.start,end:m.end}]).id,'prob-0p25-2');
  assert.equal(chooseSlideLayer(m,[{id:'prob-0p25-1',start:m.start,end:m.end}]).id,'prob-0p25-1');
  assert.throws(()=>chooseSlideLayer(m,[{id:'prob-0p50-2',start:m.start,end:m.end}]));
  const half=slideMapping(context(7)).mapping;assert.equal(half.end,Date.parse('2026-10-23T00:00Z'));assert.equal(half.start,m.end);
});
test('absent exact periods and unrelated cycles are withheld, never replaced by another date',()=>{
  const m=slideMapping(context(3)).mapping;
  for(const values of [[],[{id:'ero-day-1',start:m.start-1,end:m.end}],[{id:'rain-day-2',start:m.start,end:m.end}],[{id:'ero-day-2',start:NaN,end:m.end}]])assert.throws(()=>chooseSlideLayer(m,values));
});
test('rainfall ranges and WSSI are explicitly related guidance, choosing deterministic overlap only',()=>{
  const m=slideMapping(context(4)).mapping;
  assert.match(m.note,/not Hanford/);assert.equal(m.match,'overlap');
  const candidates=[{id:'rain-day-3',start:m.start+43200000,end:m.end+43200000},{id:'rain-day-2',start:m.start-43200000,end:m.end-43200000}];
  assert.equal(chooseSlideLayer(m,candidates).id,'rain-day-2');assert.equal(chooseSlideLayer(m,candidates.reverse()).id,'rain-day-2');
  assert.throws(()=>chooseSlideLayer(m,[{id:'rain-day-2',start:m.end,end:m.end+86400000}]));assert.match(slideMapping(context(14)).mapping.note,/window can differ/);
});
/** Minimal DOM harness executes the actual asynchronous follow controller, with public-source contracts. */
test('controller ignores superseded pages, clears unsupported maps and re-resolves dates on periodic cycle rollover',async t=>{
  let now=Date.parse('2026-10-20T02:00:00Z'),opened=0,hold=false,resolvers=[],interval,queryNumber=0,shiftAt=0;
  class Node extends FakeElement{cloneNode(){const n=new Node(this.tag);n.textContent=this.textContent;return n;}}
  const nodes=new Map(),location={href:'https://example.test/?view=weather',get search(){return new URL(this.href).search;}};
  t.mock.method(Date,'now',()=>now);
  await withGlobals({
    document:{hidden:false,getElementById:id=>{if(!nodes.has(id))nodes.set(id,new Node());return nodes.get(id);},createElement:tag=>new Node(tag),addEventListener(){}},
    window:{addEventListener(){},dispatchEvent(){}},location,history:{pushState(a,b,url){location.href=String(url);},replaceState(a,b,url){location.href=String(url);}},setInterval:fn=>{interval=fn;return 1;},
    fetch:async input=>{
      const u=new URL(input);if(u.pathname.endsWith('/query')&&++queryNumber===shiftAt)now+=86400000;const day=Number(/MapServer\/(\d+)/.exec(u.pathname)?.[1]||0)+1;
      if(hold&&u.pathname.endsWith('/query'))await new Promise(r=>resolvers.push(r));
      const start=new Date(now);start.setUTCHours(12,0,0,0);start.setUTCDate(start.getUTCDate()+day-1);
      const stamp=n=>new Date(n).toISOString().slice(0,19).replace('T',' ');
      const data=u.pathname.endsWith('/query')?{features:[{attributes:{product:`Day ${day} Excessive Rainfall Potential Forecast`,issue_time:stamp(now-3600000),start_time:stamp(+start),end_time:stamp(+start+86400000)}}]}:u.pathname.endsWith('/legend')?{layers:[0,1,2].map(layerId=>({layerId,legend:[{label:'Marginal',contentType:'image/png',imageData:'aGVsbG8='}]}))}:{geometryType:'esriGeometryPolygon',drawingInfo:{renderer:{field1:'dn'}}};
      return new Response(JSON.stringify(data));
    }},async()=>{
    const controller=createBriefingLayers({timeZone:'America/Los_Angeles',onOpen:()=>opened++});
    hold=true;const pending=controller.followSlide(context(3));await Promise.resolve();await controller.followSlide(context(8));hold=false;resolvers.splice(0).forEach(r=>r());await pending;
    assert.equal(opened,0);assert.match(nodes.get('hanford-live-note').textContent,/no verified matching/);assert.equal(new URL(location.href).searchParams.get('briefingLayer'),null);
    await controller.followSlide(context(3));await new Promise(r=>setImmediate(r));assert.equal(nodes.get('briefing-layer-select').value,'ero-day-2');
    now+=86400000;interval();await new Promise(r=>setImmediate(r));await new Promise(r=>setImmediate(r));assert.equal(nodes.get('briefing-layer-select').value,'ero-day-1');
    await controller.followSlide(context(8));assert.equal(nodes.get('hanford-live-times').textContent,'No live briefing forecast selected.');
    now=Date.parse('2026-10-20T02:00:00Z');queryNumber=0;shiftAt=4;await controller.followSlide(context(3));await new Promise(r=>setImmediate(r));assert.match(nodes.get('briefing-layer-status').textContent,/Map withheld/);assert.match(nodes.get('briefing-layer-status').textContent,/forecast window/);
  });
});
