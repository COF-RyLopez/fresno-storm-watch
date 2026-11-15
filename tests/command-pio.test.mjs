import test from 'node:test';
import assert from 'node:assert/strict';
import {createCommandPrivate, taskRows} from '../site/lib/command-private.js';
import {commandBriefingText, mountCommandPrivate} from '../site/lib/command-private-ui.js';
import {emptyRecords, makeEvent, digest} from '../site/lib/eoc-model.js';
import {createExerciseStore} from '../site/lib/eoc-store.js';
import {CARE_SOURCES} from '../site/lib/care-model.js';
import {pendingPioSourceReviews} from '../site/lib/pio-source-review.js';
import {FakeElement, stubGlobals} from './helpers/dom.mjs';
const now = Date.now(), incident = 'pio-command';
const plan = () => ({kind:'Follow-up',title:'Exercise message',location:'EXERCISE ZONE A',owner:'Exercise PIO',due:now+3600000,nextReview:'Review update',status:'Open',evidence:'Exercise only',pioOutreach:{schema:1,zone:{source:CARE_SOURCES.zones,key:'county-zone:1',oid:1,name:'EXERCISE ZONE A',status:'Lifted',checked:now,revision:'a'.repeat(64)},languages:['English'],confirmedBy:'Exercise partner',confirmedAt:now,languageEvidence:'Exercise confirmation',messageLanguage:'English',message:'EXERCISE ONLY. Do not distribute.',channels:['Exercise radio'],partners:[],zoneVerifiedBy:'Exercise county source',zoneVerifiedAt:now,zoneEvidence:'Exercise check',analysisNotes:'Population does not establish delivery.'}});
async function setup() {
  const rows=emptyRecords();
  rows.incidents=[{...makeEvent('incidents',{name:'Exercise',level:'Duty Officer monitoring',authority:'County Emergency Manager',decisionBy:'Exercise authority',effective:now,evidence:'Exercise record'},{incident,entity:incident}),created:now}];
  rows.periods=[{...makeEvent('periods',{label:'Exercise shift',start:now,end:now+86400000,nextBriefing:now+3600000,objectives:'Practice outreach'},{incident}),created:now}];
  const store=createExerciseStore(rows), controller=createCommandPrivate({config:{enabled:true,environment:'exercise'},createStore:()=>store});
  await controller.connect({username:'Exercise PIO'}); await controller.selectIncident(incident); controller.selectPeriod(rows.periods[0].id);
  return {store,controller};
}
test('Command preserves PIO event IDs through approval, receipt and retry; excludes generic task duplicates',async()=>{
  const {store,controller:c}=await setup(), append=store.append;
  let first=true;
  store.append=async(...args)=>{const r=await append(...args);if(first){first=false;throw Error('Receipt interrupted');}return r;};
  const event=makeEvent('coordination',plan(),{incident});
  await assert.rejects(c.commitPio(event),/Receipt/);
  const p=await c.commitPio(event); assert.equal(p.id,event.id);
  const a=await c.commitPio(makeEvent('approvals',{kind:'pio-outreach',outreachEvent:p.id,status:'Approved',decisionBy:'Exercise approver',decidedAt:now,evidence:'Exercise approval'},{incident}));
  const notice={key:'pio-source:'+p.entity,revision:'zone-new',category:'Planning review cues'};
  await c.reviewPioSource(notice);
  assert.equal(pendingPioSourceReviews([notice],c.state.records.reviews,'F.R.O.G. EOC exercise team').length,0);
  assert.equal(pendingPioSourceReviews([{...notice,revision:'zone-newer'}],c.state.records.reviews,'F.R.O.G. EOC exercise team').length,1);
  assert.equal(c.state.records.coordination[0].payload.pioOutreach.message,p.payload.pioOutreach.message);
  await c.reviewPioSource(notice,'Reopened');
  assert.equal(c.state.records.reviews.length,2);
  await c.commitPio(makeEvent('coordination',{...plan(),pioOutreach:undefined,title:'Exercise receipt',status:'Complete',pioDistribution:{schema:1,outreachEvent:p.id,outreachEntity:p.entity,approvalEvent:a.id,distributedAt:now,channels:['Exercise radio'],partners:[],receipt:'Sent / posted · receipt unconfirmed',nextUpdate:now+3600000}},{incident}));
  assert.equal(c.state.records.coordination.length,2); assert.equal(taskRows(c.state.records).length,0);
  const b=await c.saveBriefing({title:'Zone handoff',narrative:'Review next update',scope:'pio',zoneKey:'county-zone:1'});
  assert.equal(b.payload.snapshot.scope,'pio'); assert.equal(b.payload.snapshot.pioZoneKey,'county-zone:1');
  assert.match(commandBriefingText(b),/EXERCISE ONLY\. Do not distribute\./);
  assert.match(commandBriefingText(b),/Exercise radio/);
  assert.match(commandBriefingText(b),/source issue time unavailable/);
  assert.match(commandBriefingText(b),/Scope: PIO outreach only · county-zone:1\. Other incident evidence is excluded/);
  const frozen=commandBriefingText(b);
  await c.commitPio(makeEvent('coordination',{...plan(),pioOutreach:{...plan().pioOutreach,message:'Corrected exercise draft'}},{incident,entity:p.entity,supersedes:[p.id]}));
  assert.equal(commandBriefingText(b),frozen); assert.equal(await digest(b.payload.snapshot),b.payload.digest);
});
test('Command PIO adapter rejects foreign incidents, permissions and non-PIO event types',async()=>{
  const {store,controller:c}=await setup();
  await assert.rejects(c.commitPio(makeEvent('coordination',plan(),{incident:'other'})),/incident/);
  store.allowed.delete('coordination'); await assert.rejects(c.commitPio(makeEvent('coordination',plan(),{incident})),/editing group/);
  await assert.rejects(c.commitPio({collection:'briefings',incident,payload:{}}),/PIO/);
  c.disconnect(); await assert.rejects(c.commitPio(makeEvent('coordination',plan(),{incident})),/incident/);
});

test('PIO draft stays connected during Work navigation and refresh, and clears with private scope',async()=>{
  class Element extends FakeElement {
    get localName(){return this.tag;}
    get firstElementChild(){return this.children[0];}
    remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(c=>c!==this);}
    focus(){}
    querySelectorAll(selector){
      const match=n=>selector.startsWith('#')?n.id===selector.slice(1):selector.startsWith('[data-work-view=')?n.dataset.workView===selector.split('"')[1]:n.tag===selector;
      const walk=n=>n.children.flatMap(c=>c instanceof Element?[...(match(c)?[c]:[]),...walk(c)]:[]);return walk(this);
    }
    querySelector(s){return this.querySelectorAll(s)[0]??null;}
  }
  const body=new Element('body'),work=new Element('section'),briefing=new Element('section');body.append(work,briefing);
  const restore=stubGlobals({document:{body,hidden:false,createElement:t=>new Element(t),getElementById:id=>body.querySelector('#'+id)},window:new EventTarget(),Option:class extends Element{constructor(text,value){super('option');this.textContent=text;this.value=value;}},requestAnimationFrame:fn=>fn(),setInterval:()=>1,clearInterval:()=>{},fetch:async()=>{throw Error('Exercise source unavailable');}});
  let view;
  try {
    const {controller:c}=await setup();
    view=mountCommandPrivate({work,briefing,controller:c});view.openPio();
    body.querySelectorAll('calcite-button').find(b=>b.textContent==='New outreach record').dispatchEvent(new Event('click'));
    const form=body.querySelector('#pio-form'),title=body.querySelector('#pio-title');assert.ok(form);title.value='Unsaved exercise draft';
    body.querySelector('[data-work-view="followups"]').onclick();
    assert.equal(body.querySelector('#pio-form'),form);assert.equal(body.querySelector('#pio-workspace').hidden,true);
    const refresh=c.selectIncident(incident);view.render();assert.equal(body.querySelector('#pio-form'),form);
    await refresh;view.render();view.openPio();assert.equal(body.querySelector('#pio-title').value,'Unsaved exercise draft');
    c.disconnect();view.render();assert.equal(body.querySelector('#pio-form'),null);assert.deepEqual(view.pioNotices(),[]);
  } finally {view?.destroy();restore();}
});
