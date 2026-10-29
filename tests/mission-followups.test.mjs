import test from 'node:test';
import assert from 'node:assert/strict';
import {missionEvidenceKey,missionFollowups,followupsForEvidence} from '../site/lib/mission-followup-model.js';
import {incidentHandoffLines} from '../site/lib/mission-model.js';
import {createMissionFollowups} from '../site/lib/mission-followup-ui.js';
const item={kind:'planning-evidence',id:'kings'},now=Date.now();
const record=(id='a',changes={})=>({id,entity:'task1',incident:'exercise',author:'Fictional tester',created:now-1000,supersedes:[],payload:{kind:'Follow-up',title:'Verify readiness',location:'Fictional river',owner:'Exercise team',due:now-60000,status:'Open',nextReview:'Verify source',sourceKey:missionEvidenceKey(item),...changes}});
test('follow-ups use exact evidence identities and retain corrections, conflicts and unlinked records',()=>{
 const a=record(),completed={...record('b',{status:'Complete'}),created:now,supersedes:['a']};
 assert.equal(missionFollowups([a,a],now).length,1);
 assert.equal(missionFollowups([a,completed],now)[0].overdue,false);
 const conflict=missionFollowups([completed,{...record('c'),supersedes:['a']}],now)[0];assert.equal(conflict.conflict,true);assert.equal(conflict.active,true);assert.equal(conflict.status,'Conflicting versions');assert.deepEqual(conflict.versions,['b','c']);
 assert.equal(followupsForEvidence({...item,id:'other'},[conflict]).length,0,'same location name never implies a link');
 assert.equal(followupsForEvidence(item,[conflict]).length,1);
 assert.equal(missionFollowups([record('d',{sourceKey:null,evidence:JSON.stringify(item)})],now)[0].key,missionEvidenceKey(item));
 assert.equal(missionFollowups([record('e',{sourceKey:null,evidence:'Unstructured legacy note'})],now)[0].key,null);
 const text=incidentHandoffLines({incidentFollowups:{assessed:true,incident:'exercise',checked:now,rows:[conflict]}},String).join('\n');assert.match(text,/Conflicting versions/);assert.match(text,/owner Exercise team/);assert.match(text,/version /);
});
/** Minimal DOM for controller privacy/lifecycle tests; no ArcGIS calls or remote writes. */
async function withController(run){
 const keys=['document','window','setInterval'],original=new Map(keys.map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)])),elements=new Map();
 class Element extends EventTarget{constructor(){super();this.value='';this.children=[];}append(...rows){this.children.push(...rows);}replaceChildren(...rows){this.children=[...rows];}}
 const get=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);},win=new EventTarget();
 try{Object.defineProperty(globalThis,'document',{value:{getElementById:get,createElement:()=>new Element(),hidden:false},configurable:true});Object.defineProperty(globalThis,'window',{value:win,configurable:true});Object.defineProperty(globalThis,'setInterval',{value:()=>0,configurable:true});await run({get,win});}
 finally{for(const [key,descriptor]of original)if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}
}
test('private follow-up failure and sign-out clear retained records, and stale responses cannot repopulate them',()=>withController(async({get,win})=>{
 let fail=false,release=null,defer=false;const events=[];win.addEventListener('storm-mission-followups',e=>events.push(e.detail));
 const controller=createMissionFollowups({openStore:async()=>({close(){},async incidents(){if(defer)await new Promise(resolve=>release=resolve);return [{incident:'exercise',payload:{name:'Fictional private incident'}}];},async loadCollection(){if(fail)throw Error('denied');return [record()];}})});
 controller.setSession({username:'test'});await controller.selectIncident('exercise');assert.equal(controller.snapshot(item).rows.length,1);assert.equal(events.at(-1).overdue,1);
 fail=true;await controller.selectIncident('exercise');assert.equal(controller.snapshot(item).assessed,false);assert.equal(get('mission-followups-list').children.length,0);assert.equal(events.at(-1).assessed,false);
 fail=false;defer=true;const pending=controller.selectIncident('exercise');await new Promise(resolve=>setImmediate(resolve));assert(release);controller.setSession(null);release();await pending;
 assert.equal(controller.snapshot(item).rows.length,0);assert.equal(get('mission-followups-list').children.length,0);assert.equal(get('mission-followups-incident').children.length,0);assert.match(get('mission-followups-status').textContent,/sign-in required/);
}));

test('PIO records are separate from general assignments and do not inflate their counts',()=>{
 assert.equal(missionFollowups([record(),{...record('pio',{pioOutreach:{schema:1}}),entity:'pio'},{...record('receipt',{pioDistribution:{schema:1}}),entity:'receipt'}]).length,1);
});

test('Area Watch receives private PIO source flags, then clears details and banner counts on logout',()=>withController(async({get,win})=>{
 const events=[];win.addEventListener('storm-mission-followups',e=>events.push(e.detail));let release=null,defer=false,closed=0;
 const monitor={clear(){closed++;},async check(){if(defer)await new Promise(r=>release=r);return {checked:now,notices:[{key:'pio-afn:entity',evidence:{outreachEvent:'event'},category:'Planning review cues',location:'PIO · EXERCISE',change:'AFN context changed',owner:'EXERCISE PIO',verification:'Approved message unchanged',nextReview:'Review sources',sourceTime:now},{key:'pio-zone:entity',evidence:{outreachEvent:'event'},category:'Planning review cues',location:'PIO · EXERCISE',change:'County zone changed',owner:'EXERCISE PIO',verification:'Approved message unchanged',nextReview:'Review sources',sourceTime:now}]};}};
 const controller=createMissionFollowups({sourceMonitor:monitor,openStore:async()=>({close(){},async incidents(){return [{incident:'exercise',payload:{name:'EXERCISE'}}];},async loadCollection(key){return key==='coordination'?[record()]:[];}})});
 controller.setSession({username:'test'});await controller.selectIncident('exercise');assert.equal(events.at(-1).pioReview,1);assert.equal(events.at(-1).overdue,1);assert.equal(get('mission-pio-reviews').hidden,false);assert.equal(get('mission-pio-reviews').children.filter(n=>n.className==='mission-card').length,1);assert(get('mission-pio-reviews').children.some(n=>n.textContent?.includes('Approved messages')));
 defer=true;const pending=controller.selectIncident('exercise');await new Promise(r=>setImmediate(r));assert(release);controller.setSession(null);release();await pending;
 assert.equal(events.at(-1).pioReview,0);assert.equal(events.at(-1).assessed,false);assert.equal(get('mission-pio-reviews').children.length,0);assert.equal(get('mission-pio-reviews').hidden,true);assert(closed>0);
}));
