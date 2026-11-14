import {createTerrainSession} from './watch-terrain-session.js';
/** UI shell for the focused terrain map. No records are persisted or sent to a collector. */
export function installWatchTerrain({wanted,snapshot,onSelect,detach,restore}){
 const host=document.createElement('div');host.id='watch-terrain';host.setAttribute('role','region');host.setAttribute('aria-label','Selected concern terrain and nearby reference records');host.hidden=true;document.querySelector('#map-wrap').append(host);
 const button=document.createElement('button');button.id='watch-terrain-overhead';button.type='button';button.textContent='Overhead';button.hidden=true;document.querySelector('#watch-map-heading').append(button);
 const note=document.createElement('p');note.id='watch-terrain-note';note.className='environment-note';note.hidden=true;note.setAttribute('role','status');document.querySelector('.legend-stack').prepend(note);
 let target=null,failed=false,overhead=false,key=null;
 const session=createTerrainSession({
  create:async()=>{host.hidden=false;host.classList.remove('ready');const stage=document.createElement('div');stage.className='watch-terrain-stage';host.append(stage);const {createWatchTerrain}=await import('./watch-terrain-map.js');return createWatchTerrain({container:stage,onSelect,onError:error=>{if(session.active&&stage.isConnected){failed=true;session.clear();showFailure(error);}}});},
  activate(){host.hidden=false;host.classList.add('ready');button.hidden=false;detach(target);},
  deactivate(){host.hidden=true;host.replaceChildren();button.hidden=true;note.hidden=true;restore();},
  failure:error=>{failed=true;showFailure(error.message);}
 });
 function showFailure(message){note.hidden=false;note.textContent='Terrain unavailable — using the regular map. '+String(message).slice(0,150);}
 function data(){return target?snapshot(target):null;}
 function caption(d){note.hidden=false;note.textContent=`Reference terrain · not flood depth · ${d.facilities} facilities shown · nearby search: 5 km${d.facilities?'':' (inventory may be unassessed)'} · proximity, not verified connections`;note.title='Nearby means within 5 km of selected watchpoints or the focus center, not a verified downstream connection, power service or safe route. Reference waterbody outlines are not current pool levels.';}
 function setOverhead(value){overhead=value;session.overhead(overhead);button.textContent=overhead?'View terrain':'Overhead';button.setAttribute('aria-pressed',String(overhead));}
 button.addEventListener('click',()=>setOverhead(!overhead));
 const api={get active(){return session.active;},setMode(mode){setOverhead(mode==='2d');},context(next){const changed=next!==key;if(changed||!wanted()){key=next;if(changed||!next)target=null;failed=false;setOverhead(false);session.clear();}else if(target&&!session.active)void api.focus(target,{animate:false});},clear(){key=null;target=null;failed=false;session.clear();},refresh(){if(session.active&&wanted()){const d=data();if(d){session.refresh(d);caption(d);}else session.clear();}},async focus(shape,options){
  if(!wanted()||failed)return false;target=shape;const d=data();if(!d){session.clear();return false;}
  const ok=await session.open(d,options?.animate!==false);if(ok){const fresh=data();if(!wanted()||!fresh){session.clear();return false;}session.refresh(fresh);caption(fresh);}return ok;
 }};return api;
}
