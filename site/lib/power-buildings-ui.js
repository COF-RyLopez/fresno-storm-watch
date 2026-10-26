import {buildingPowerTarget} from './power-buildings-model.js?v=0.51.0';
import {loadPowerBuildings} from './power-buildings-data.js?v=0.51.0';
const el=(tag,text='')=>{const n=document.createElement(tag);n.textContent=text;return n;};
const button=(text,fn)=>{const b=el('calcite-button',text);b.scale='s';b.appearance='outline';b.onclick=fn;return b;};
/** Session-only selected-area evidence. Refresh revisions cancel older queries, including after the pane closes. */
export function createPowerBuildings({onMap=()=>{},exercise=false}={}){
  let map=null,host=null,row=null,result=null,error=null,busy=false,epoch=0,labels=true,selectedId=null;
  const expanded=new Set();
  function clear(){epoch++;row=null;host=null;result=null;busy=false;error=null;selectedId=null;expanded.clear();map?.clearPowerBuildings();}
  async function load(visible=false){
    if(!map||!row||busy)return;const revision=++epoch,current=()=>epoch===revision&&host?.isConnected;
    busy=true;result=null;error=null;map.clearPowerBuildings();render();
    try{const target=buildingPowerTarget(row),viewport=visible?map.powerBuildingsViewport():null;if(visible&&!viewport)throw Error('Map extent is not ready. Wait for the map, then retry.');const next=await loadPowerBuildings(target.polygons,{viewport,current});if(!current())return;if(next){await map.setPowerBuildings(next.rows);if(!current())return;result=next;map.setPowerBuildingLabels(labels);}}
    catch(e){if(current())error=e.message;}
    finally{if(current()){busy=false;render();}}
  }
  function render(){
    if(!host?.isConnected||!row)return;const target=buildingPowerTarget(row);host.replaceChildren(el('h3','Buildings in this power area'),el('p',target.reason));host.className='power-network-association power-buildings';
    if(!target.polygons.length)return;
    if(exercise)host.append(el('p','EXERCISE · fictional utility area over real public Overture reference. This does not represent an actual outage.'));
    if(row.health||row.issues?.length)host.append(el('p',row.health||'Utility record has qualifications; verify status and timing in the record above.'));
    const controls=el('div');controls.className='power-nearby-controls';const all=button('Load area buildings',()=>void load()),visible=button('Load visible buildings',()=>void load(true));for(const b of [all,visible]){b.disabled=busy||!map;b.loading=busy;}controls.append(all,visible);host.append(controls);
    const note=el('p',busy?'Loading public footprints and checking full polygon overlap…':error||'Load on demand. Buildings draw at 1:50,000; address labels at 1:6,000. Zoom closer for detail.');note.setAttribute('role','status');host.append(note);
    if(!result)return;
    const rows=result.rows,height=rows.filter(r=>r.height!==null).length,address=rows.filter(r=>r.addresses.length).length;
    host.append(el('p',`${rows.length.toLocaleString()} overlapping building footprints · ${height.toLocaleString()} with height · ${address.toLocaleString()} with spatially associated addresses. ${result.scope}. Counts are buildings, not properties, households or customers.`));
    host.append(el('p',`Amber = footprint overlaps the selected published area. Dashed footprint = height unknown (flat). Heights are approximate metres from Overture, not terrain, first-floor elevation or flood depth. Address association does not confirm electric service.`));
    const actions=el('div');actions.className='power-nearby-controls';actions.append(button('View buildings in 3D',async()=>{const version=epoch;onMap();await map.setViewMode('3d');if(version===epoch&&host?.isConnected&&rows.length)await map.focusPowerBuilding(selectedId||rows[0].id);}),button(labels?'Hide address labels':'Show address labels',()=>{labels=!labels;map.setPowerBuildingLabels(labels);render();}));host.append(actions);
    host.append(el('p',`Overture release ${result.index.release} · ${result.index.addressMethod}. Multiple addresses stay separate in the list; unmatched addresses remain unknown.`));
    const source=el('a','Source, attribution and coverage');source.href=new URL('../planning.html#power-buildings',import.meta.url).href;source.target='_blank';source.rel='noopener noreferrer';host.append(source);
    const list=el('div'),ordered=selectedId?[...rows.filter(r=>r.id===selectedId),...rows.filter(r=>r.id!==selectedId)]:rows;for(const r of ordered.slice(0,40)){const item=el('details');item.className='power-nearby-row';item.open=r.id===selectedId||expanded.has(r.id);item.addEventListener('toggle',()=>{if(item.isConnected){if(item.open)expanded.add(r.id);else expanded.delete(r.id);}});item.append(el('summary',r.label),el('p',r.height===null?'Height not supplied · flat footprint':`Published height ${r.height.toFixed(1)} m · approximate extrusion`));for(const a of r.addresses) item.append(el('p',a));item.append(el('p',`Overture ID ${r.id} · version ${r.version} · ${r.sources?.join(', ')||'Source not specified'}`),button('Locate building',()=>{selectedId=r.id;onMap();void map.focusPowerBuilding(r.id);}));list.append(item);}host.append(list);if(rows.length>40)host.append(el('p',`Up to 40 records listed; all ${rows.length.toLocaleString()} footprints are on the map. Click a footprint to inspect its record, or load a smaller visible portion.`));if(!rows.length)host.append(el('p','No overlapping footprints returned in this scope. Coverage may be incomplete; this is not a confirmation that no properties are affected.'));
  }
  window.addEventListener('frogPowerBuildingSelect',event=>{if(result?.rows.some(r=>r.id===event.detail.id)){selectedId=event.detail.id;render();host.querySelector('details[open]')?.scrollIntoView({block:'nearest'});}});
  return {clear,setMap(value){map=value;render();},select(value,element){const same=row?.key===value.key&&row?.revision===value.revision;if(!same)clear();row=value;host=element;render();}};
}
