import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createIrrigationReference} from '../site/lib/irrigation-ui.js';
import {FakeElement} from './helpers/dom.mjs';
const data=JSON.parse(await readFile(new URL('../site/data/irrigation-sources.json',import.meta.url),'utf8'));

test('documentary routes reference known publishers and existing reference locations, with no invented asset geometry',()=>{
  const ids=new Set(data.sources.map(s=>s.id));assert.equal(ids.size,data.sources.length);
  assert.equal(data.countyGeoid,'06019');assert.equal(new Set(data.connections.map(c=>c.id)).size,data.connections.length);
  for(const route of data.connections){assert(route.nodes.length>=2);assert(route.sources.every(id=>ids.has(id)));assert(['MIL','PNF','SJMC1'].includes(route.locate));assert(route.dateLabel&&route.note);assert(!('geometry'in route));}
  for(const source of data.sources){const url=new URL(source.url);assert.equal(url.protocol,'https:');assert(!url.searchParams.has('token'));assert(source.dateLabel&&source.status&&source.limitation);}
});

test('historical, regulatory and storm-drain records retain their qualifications instead of becoming operating irrigation assets',()=>{
  const fid=data.sources.find(s=>s.id==='fid-2018');assert.match(fid.status,/Authorization/);assert.match(fid.limitation,/Kept local, not republished/);assert.match(fid.limitation,/zero on every record/);
  const cal=data.sources.find(s=>s.id==='calwatrs');assert.match(cal.coverage,/0 conveyance lines/);assert.match(cal.limitation,/not flow or gate state/);
  assert.match(data.sources.find(s=>s.id==='fmfcd-pumps').limitation,/do not establish connected irrigation canals/);
  assert.match(data.sources.find(s=>s.id==='cid').limitation,/Washington.*excluded/);
});

/** Small DOM harness for the actual async load/retry and selection behavior. */
function setup(fetchImpl){
  const host=new FakeElement('div'),panel=new FakeElement('panel'),button=new FakeElement('button'),located=[];
  globalThis.document={getElementById:id=>id==='irrigation-evidence'?panel:host,querySelectorAll:()=>[button],createElement:tag=>new FakeElement(tag)};
  return {host,panel,button,located,controller:createIrrigationReference({fetchImpl,onLocate:id=>{located.push(id);return true;}})};
}

test('unavailable source register remains apparent and can be retried without a page reload',async()=>{
  let calls=0;const h=setup(async()=>++calls===1?{ok:false,status:503}:{ok:true,json:async()=>data});
  await h.controller.load();assert.match(h.host.children[0].textContent,/unavailable.*503/);
  await h.controller.load();assert.match(h.host.children[0].textContent,/not modeled routes/);assert.equal(calls,2);
});

test('concurrent openings share one request and locate controls target existing reservoir/gauge references only',async()=>{
  let calls=0;const h=setup(async()=>{calls++;return {ok:true,json:async()=>data};});
  await Promise.all([h.controller.load(),h.controller.load()]);assert.equal(calls,1);
  const first=h.host.children.find(n=>n.tag==='calcite-accordion').children[0];first.children.find(n=>n.tag==='calcite-button').dispatchEvent(new Event('click'));assert.deepEqual(h.located,['MIL']);
  await h.controller.load();assert.equal(calls,1);
});
