import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {afnContext} from '../site/lib/afn-ui.js';

// Minimal DOM fixture: exercise the actual toggle/click handlers and async lifecycle.
class Element {
  constructor(tag){this.tag=tag;this.children=[];this.handlers=new Map();this.attributes=new Map();this.open=false;}
  append(...nodes){this.children.push(...nodes);}
  replaceChildren(...nodes){this.children=[...nodes];}
  setAttribute(key,value){this.attributes.set(key,value);}
  addEventListener(name,handler){this.handlers.set(name,[...(this.handlers.get(name)||[]),handler]);}
  async emit(name){await Promise.all((this.handlers.get(name)||[]).map(handler=>handler()));}
}
const previousDocument=globalThis.document;
globalThis.document={createElement:tag=>new Element(tag)};
after(()=>{if(previousDocument===undefined)delete globalThis.document;else globalThis.document=previousDocument;});
const zone={key:'county-zone:287',geometry:{rings:[[[-120,36],[-120,37],[-119,37],[-120,36]]],spatialReference:{wkid:4326}}};
const topics=()=>['languages','svi','ces','ccl'].map(key=>({key,rows:[],checked:123,period:'2020–2024',source:'https://www.census.gov/'}));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const text=element=>[element.textContent||'',...element.children.map(text)].join(' ');

test('a partial failure retries on reopen and clears the failed health check',async()=>{
  let calls=0;const health=[];
  const context=afnContext(zone,{readContext:async()=>{calls++;return topics().map(t=>calls===1&&t.key==='svi'?{key:t.key,error:'Source HTTP 503'}:t);},onHealth:(key,label,status)=>health.push({key,...status})});
  const [summary,host,retry]=context.element.children;
  assert.match(summary.textContent,/AFN/);
  context.element.open=true;await context.element.emit('toggle');
  assert.match(text(host),/Unavailable: Source HTTP 503/);
  assert.match(text(host),/No CDSS adult or senior care records/);
  assert.equal(retry.hidden,false);assert.equal(retry.disabled,false);
  context.element.open=false;await context.element.emit('toggle');
  context.element.open=true;await context.element.emit('toggle');
  assert.equal(calls,2);assert.equal(retry.hidden,true);
  assert.doesNotMatch(text(host),/Source HTTP 503/);
  assert.equal(health.filter(t=>t.key==='population:afn:svi').at(-1).error,undefined);
  context.element.open=false;await context.element.emit('toggle');
  context.element.open=true;await context.element.emit('toggle');
  assert.equal(calls,2,'successful results remain loaded during re-renders/reopen');
});

test('the visible retry action recovers partial and unexpected failures',async()=>{
  for(const unexpected of [false,true]){
    let calls=0;const context=afnContext(zone,{readContext:async()=>{calls++;if(calls===1){if(unexpected)throw Error('Offline');return [{key:'svi',error:'Offline'}];}return topics();},onHealth:()=>{}});
    context.element.open=true;await context.element.emit('toggle');
    const retry=context.element.children[2];assert.equal(retry.hidden,false);
    await retry.emit('click');assert.equal(calls,2);assert.equal(retry.hidden,true);
    assert.equal(context.element.children[1].attributes.get('aria-busy'),'false');
  }
});

test('repeated toggles, retry clicks and refresh calls share one pending request',async()=>{
  const wait=deferred();let calls=0;
  const context=afnContext(zone,{readContext:()=>{calls++;return wait.promise;},onHealth:()=>{}});
  context.element.open=true;const opened=context.element.emit('toggle');
  const refreshed=context.refresh(),clicked=context.element.children[2].emit('click');
  assert.equal(calls,1);assert.equal(context.element.children[2].disabled,true);
  wait.resolve(topics());await Promise.all([opened,refreshed,clicked]);assert.equal(calls,1);
});

test('disposing an old zone aborts its request and ignores a late failure after a new zone succeeds',async()=>{
  const wait=deferred(),health=[];let oldSignal;
  const old=afnContext(zone,{readContext:(geometry,{signal})=>{oldSignal=signal;return wait.promise;},onHealth:(key,label,status)=>health.push({key,...status})});
  old.element.open=true;const pending=old.element.emit('toggle');
  old.dispose();assert.equal(oldSignal.aborted,true);
  const next=afnContext({...zone,key:'county-zone:305'},{readContext:async()=>topics(),onHealth:(key,label,status)=>health.push({key,...status})});
  next.element.open=true;await next.element.emit('toggle');
  const before=structuredClone(health);
  wait.resolve([{key:'svi',error:'Late old-zone 503'}]);await pending;
  assert.deepEqual(health,before);assert.doesNotMatch(text(old.element),/Late old-zone 503/);
  await old.refresh();assert.deepEqual(health,before);
});

test('selection guards ignore superseded successful or rejected reads even without transport cancellation',async()=>{
  for(const rejected of [false,true]){
    const wait=deferred(),health=[];let selected=true;
    const context=afnContext(zone,{isCurrent:()=>selected,readContext:()=>wait.promise,onHealth:(...args)=>health.push(args)});
    context.element.open=true;const pending=context.element.emit('toggle');selected=false;
    if(rejected)wait.reject(Error('Old selection failed'));else wait.resolve(topics());
    await pending;assert.deepEqual(health,[]);
    assert.doesNotMatch(text(context.element),/Old selection failed|No CDSS adult or senior care records/);
  }
});

test('AFN grids render as static calcite-tables with a header row, row headers and end-aligned values',async()=>{
  const facility={name:'EXERCISE care home',type:'RESIDENTIAL-ELDERLY',city:'FRESNO',capacity:6,status:3};
  const context=afnContext(zone,{readContext:async()=>topics().map(t=>t.key==='ccl'?{...t,rows:[facility]}:t),onHealth:()=>{}});
  context.element.open=true;await context.element.emit('toggle');
  const all=n=>[n,...(n.children||[]).flatMap(all)],wrap=all(context.element).find(n=>n.className==='data-table'&&n.children[1].caption.startsWith('Records and licensed capacity'));
  const [caption,table]=wrap.children,[head,row]=table.children;
  assert.equal(caption.attributes.get('aria-hidden'),'true');assert.equal(caption.textContent,table.caption);
  assert.equal(table.tag,'calcite-table');assert.equal(table.interactionMode,'static');
  assert.equal(head.slot,'table-header');assert.deepEqual(head.children.map(h=>[h.tag,h.heading,h.alignment]),[['calcite-table-header','Facility type',undefined],['calcite-table-header','Status code','end'],['calcite-table-header','Records','end'],['calcite-table-header','Licensed capacity','end']]);
  assert.deepEqual(row.children.map(c=>[c.tag,c.heading??c.textContent]),[['calcite-table-header','RESIDENTIAL-ELDERLY'],['calcite-table-cell','3'],['calcite-table-cell','1'],['calcite-table-cell','6']]);
});
