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
  assert.equal(get('storm-shell').dataset.destination,'watch');assert.equal(get('storm-shell').dataset.mission,undefined,'shell state must not become a mission button');
 });
});
