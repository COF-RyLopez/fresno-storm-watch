import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkspace} from '../site/lib/workspace-ui.js';
import {FakeElement,withGlobals} from './helpers/dom.mjs';

test('topic shortcuts dismiss old evidence, preserve same-topic selections and close on mission changes',()=>{
 class Element extends FakeElement{
  constructor(){super();this.classList={contains:()=>false,toggle:()=>{}};this.hidden=false;}
  getBoundingClientRect(){return {width:900};}
 }
 const elements=new Map(),get=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);},nav=new Element(),media=new EventTarget();media.matches=false;
 const location={href:'https://storm.invalid/?view=watch'},win=new EventTarget();win.history={pushState(_a,_b,url){location.href=String(url);}};
 return withGlobals({document:{getElementById:get,querySelector:()=>nav,querySelectorAll:()=>[]},window:win,location,matchMedia:()=>media,ResizeObserver:class{observe(){}}},()=>{
  let closed=0;const workspace=createWorkspace({evidence:{isOpen:false,layout(){},close(){closed++;}}});
  workspace.showPanel('watch');assert.equal(closed,0,'same topic keeps its selected evidence');
  workspace.showPanel('alerts');assert.equal(closed,1,'notification shortcut must close any old evidence type');assert.equal(workspace.section,'alerts');assert.match(location.href,/view=alerts/);
  workspace.setMission('scenarios');const before=closed;workspace.showPanel('alerts');assert.equal(closed,before+1,'leaving a mission closes evidence even when the remembered topic is unchanged');assert.equal(workspace.mission,'watch');
  workspace.showPanel('watch');
  assert.equal(get('workspace-tabs').hidden,true,'County Watch starts with its attention list, not topic tabs');
  let latest;workspace.setMap({setWorkspace(){},setWatchContext(value){latest=value;}});
  workspace.selectConcern({type:'river',id:'kings-lower',name:'Kings'});
  assert.equal(latest.selected.id,'kings-lower');assert.equal(get('watch-map-title').textContent,'Kings');
  workspace.setExplore(true);assert.equal(get('workspace-tabs').hidden,false);assert.equal(latest.explore,true);
  workspace.selectConcern({type:'power',id:'p',name:'Outage'});
  assert.equal(latest.explore,false,'a new concern returns to focus');assert.equal(get('workspace-tabs').hidden,true);
  workspace.clearConcern();assert.equal(latest.selected,null,'private selection can be cleared on sign-out');
  workspace.showPanel('rivers');assert.equal(get('workspace-tabs').hidden,false,'existing topic paths remain available');
  assert.equal(get('storm-shell').dataset.destination,'watch');assert.equal(get('storm-shell').dataset.mission,undefined,'shell state must not become a mission button');
 });
});

test('phone County Watch opens the attention list and offers a way back after inspecting the map',()=>{
 class Element extends FakeElement{constructor(){super();this.classList={contains:()=>false,toggle:()=>{}};this.hidden=false;}getBoundingClientRect(){return {width:390};}}
 const elements=new Map(),get=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);},nav=new Element();
 const compact=new EventTarget();compact.matches=true;const dock=new EventTarget();dock.matches=false;
 const location={href:'https://storm.invalid/?view=watch'},win=new EventTarget();win.history={pushState(_a,_b,u){location.href=String(u);}};
 return withGlobals({document:{getElementById:get,querySelector:()=>nav,querySelectorAll:()=>[]},window:win,location,matchMedia:q=>q.includes('max-width')?compact:dock,ResizeObserver:class{observe(){}}},()=>{
  const evidence={isOpen:false,layout(){}};const workspace=createWorkspace({evidence});assert.equal(get('watch-phone-evidence').disabled,true);assert.equal(get('tools-shell').hasAttribute('collapsed'),false);assert.equal(get('planning-workspace').inert,true);
  workspace.selectConcern({type:'river',id:'kings-lower',name:'Kings'});workspace.showMap();
  assert.equal(get('tools-shell').hasAttribute('collapsed'),true);assert.equal(get('planning-workspace').inert,false);
  get('watch-attention-list').dispatchEvent(new Event('click'));
  assert.equal(get('tools-shell').hasAttribute('collapsed'),false);assert.equal(get('planning-workspace').inert,true);
  evidence.isOpen=true;workspace.evidenceChanged(true);
  assert.equal(get('storm-shell').dataset.watchPane,'evidence');
  get('watch-phone-map').dispatchEvent(new Event('click'));
  assert.equal(get('storm-shell').dataset.watchPane,'map');assert.equal(evidence.isOpen,true,'map switch must preserve captured evidence');
  get('watch-phone-attention').dispatchEvent(new Event('click'));
  assert.equal(get('storm-shell').dataset.watchPane,'attention');
  get('watch-phone-evidence').dispatchEvent(new Event('click'));
  assert.equal(get('storm-shell').dataset.watchPane,'evidence');
  assert.equal(get('map-panel').inert,true,'hidden map must not receive keyboard focus');
  workspace.showFocusedMap();assert.equal(get('storm-shell').dataset.watchPane,'map','explicit Focus area action opens the map even with evidence retained');assert.equal(evidence.isOpen,true);
  evidence.isOpen=false;workspace.evidenceChanged(false);
  assert.equal(get('storm-shell').dataset.watchPane,'map');assert.equal(get('watch-phone-evidence').disabled,true);
  assert.equal(get('map-panel').inert,false);
  workspace.setExplore(true);assert.equal(get('workspace-tabs').hidden,false);
 });
});
