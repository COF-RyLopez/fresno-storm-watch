import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createEvidencePane} from '../site/lib/evidence-ui.js';
import {FakeElement} from './helpers/dom.mjs';

/** A small DOM event harness exercises the actual pane coordinator, including batched attribute changes. */
function setup(){
  const nodes=new Map(),listeners=new Map();let records=[],scheduled=false,callback;
  const notify=target=>{if(!listeners.has(target))return;records.push({target});if(!scheduled){scheduled=true;queueMicrotask(()=>{scheduled=false;const batch=records;records=[];callback(batch);});}};
  class Node extends FakeElement{
    constructor(id){super();this.id=id;this.hidden=false;this.focusCount=0;this.classList={toggle:(k,on)=>{this[k]=on;}};nodes.set(id,this);}
    setAttribute(k,v){super.setAttribute(k,v);if(k==='open')notify(this);}
    removeAttribute(k){if(!this.hasAttribute(k))return;super.removeAttribute(k);if(k==='open')notify(this);}
    getClientRects(){return this.hidden?[]:[{}];}
    focus(){this.focusCount++;document.activeElement=this;}
    setFocus(){this.focus();return Promise.resolve();}
  }
  const ids=['evidence-host','evidence-shell','evidence-mobile-host','planning-workspace','context-open','map-feature-evidence','map-feature-content','map-feature-select','map-feature-status','hanford-dialog','facility-dialog','context-menu','opener'];
  ids.forEach(id=>new Node(id));const panes=['map-feature-evidence','hanford-dialog','facility-dialog','context-menu'].map(id=>nodes.get(id));
  const doc=new EventTarget();doc.getElementById=id=>nodes.get(id);doc.querySelectorAll=()=>panes;doc.activeElement=nodes.get('opener');globalThis.document=doc;
  globalThis.MutationObserver=class{constructor(fn){callback=fn;}observe(n){listeners.set(n,true);}};
  const media=new EventTarget();media.matches=false;globalThis.matchMedia=()=>media;globalThis.customElements={whenDefined:()=>Promise.resolve()};
  nodes.get('evidence-shell').append(nodes.get('evidence-host'));
  const changes=[],controller=createEvidencePane({onChange:value=>changes.push(value)}),flush=()=>new Promise(resolve=>setImmediate(resolve));
  return {nodes,panes,doc,media,controller,changes,flush};
}
test('supporting evidence uses real dock panels with no modal or popup presentation',async()=>{
  const html=await readFile(new URL('../site/index.html',import.meta.url),'utf8');
  assert(!html.includes('<calcite-dialog'));
  for(const id of ['hanford-dialog','river-dialog','release-trend-dialog','source-health-dialog','road-dialog','power-dialog','facility-dialog','context-menu'])assert(new RegExp(`<calcite-panel[^>]+id="${id}"[^>]+data-evidence`).test(html),id);
  assert.match(html,/<calcite-popover id="map-tools-menu" reference-element="map-tools-open"/,'map tools open from the in-map corner button');
  assert.match(html,/<calcite-shell-panel id="evidence-shell"[^>]+display-mode="dock"/);assert.match(html,/id="evidence-mobile-host" hidden/);
});
test('opening and replacing evidence shows exactly one pane and runs prior source cleanup once',async()=>{
  const h=setup(),a=h.nodes.get('hanford-dialog'),b=h.nodes.get('facility-dialog');let cleanup=0;a.addEventListener('stormEvidenceClose',()=>cleanup++);
  a.setAttribute('open','');await h.flush();assert.equal(h.controller.activeId,a.id);assert.equal(h.nodes.get('evidence-shell').hidden,false);
  b.setAttribute('open','');await h.flush();assert.equal(h.controller.activeId,b.id);assert.equal(cleanup,1);assert.equal(a.hasAttribute('open'),false);assert.equal(h.panes.filter(n=>!n.hidden).length,1);
});
test('live refresh of an open record cannot steal focus or trigger cleanup',async()=>{
  const h=setup(),a=h.nodes.get('facility-dialog');let cleanup=0;a.addEventListener('stormEvidenceClose',()=>cleanup++);a.setAttribute('open','');await h.flush();const count=a.focusCount;
  a.setAttribute('open','');await h.flush();assert.equal(a.focusCount,count);assert.equal(cleanup,0);assert.deepEqual(h.changes,[true]);
});
test('a withdrawn or superseded opening never replaces the current evidence',async()=>{
  const h=setup(),a=h.nodes.get('hanford-dialog'),b=h.nodes.get('facility-dialog');a.setAttribute('open','');await h.flush();b.setAttribute('open','');b.removeAttribute('open');await h.flush();assert.equal(h.controller.activeId,a.id);
});
test('private-access removal closes visible evidence and triggers its cleanup',async()=>{
  const h=setup(),a=h.nodes.get('facility-dialog');let cleaned=false;a.addEventListener('stormEvidenceClose',()=>{cleaned=true;});a.setAttribute('open','');await h.flush();a.removeAttribute('open');await h.flush();assert.equal(h.controller.isOpen,false);assert.equal(a.hidden,true);assert.equal(cleaned,true);assert.equal(h.nodes.get('evidence-shell').hidden,true);
});
test('phone evidence reparents below the map without creating a modal or losing panel state',async()=>{
  const h=setup(),a=h.nodes.get('hanford-dialog');a.setAttribute('open','');await h.flush();h.media.matches=true;h.media.dispatchEvent(new Event('change'));assert.equal(h.nodes.get('evidence-host').parentElement.id,'evidence-mobile-host');assert.equal(h.nodes.get('planning-workspace')['evidence-stacked'],true);assert.equal(h.nodes.get('evidence-shell').hidden,true);assert.equal(a.hasAttribute('open'),true);
  h.media.matches=false;h.media.dispatchEvent(new Event('change'));assert.equal(h.nodes.get('evidence-host').parentElement.id,'evidence-shell');assert.equal(h.controller.activeId,a.id);
});
test('close is idempotent, restores keyboard focus and hides the supporting layout',async()=>{
  const h=setup(),a=h.nodes.get('hanford-dialog');let cleanup=0;a.addEventListener('stormEvidenceClose',()=>cleanup++);a.setAttribute('open','');await h.flush();h.controller.close();h.controller.close();await h.flush();assert.equal(cleanup,1);assert.equal(h.doc.activeElement.id,'opener');assert.deepEqual(h.changes,[true,false]);
});
test('the Context layers button toggles its dock panel and exposes its expanded state',async()=>{
  const h=setup(),b=h.nodes.get('context-open');b.dispatchEvent(new Event('click'));await h.flush();assert.equal(h.controller.activeId,'context-menu');assert.equal(b.attributes.get('aria-expanded'),'true');b.dispatchEvent(new Event('click'));await h.flush();assert.equal(h.controller.isOpen,false);assert.equal(b.attributes.get('aria-expanded'),'false');
});
