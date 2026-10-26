import {buildingPowerTarget} from './power-buildings-model.js?v=0.51.1';
import {loadPowerBuildings,loadPowerBuildingsAutomatic} from './power-buildings-data.js?v=0.51.1';
const el=(tag,text='')=>{const n=document.createElement(tag);n.textContent=text;return n;};
const button=(text,fn)=>{const b=el('calcite-button',text);b.scale='s';b.appearance='outline';b.onclick=fn;return b;};
/** Session-only selected-area evidence. Refresh revisions cancel older queries, including after the pane closes. */
export function createPowerBuildings({onMap=()=>{},exercise=false}={}){
  let map=null,host=null,row=null,result=null,error=null,busy=false,epoch=0,labels=true,selectedId=null,detailsOpen=false;
  let started=false,starting=false,visibleMode=false,viewSignature=null,viewTimer=null,unsubscribeView=null;
  const expanded=new Set();
  function clear(){epoch++;clearTimeout(viewTimer);started=false;starting=false;visibleMode=false;viewSignature=null;row=null;host=null;result=null;busy=false;error=null;selectedId=null;detailsOpen=false;expanded.clear();map?.clearPowerBuildings();}
  function updateVisible(){
    clearTimeout(viewTimer);
    if(!visibleMode||!row||!host?.isConnected)return;
    const shape=map?.powerBuildingsViewport();
    if(!shape||JSON.stringify(shape)===viewSignature)return;
    viewTimer=setTimeout(()=>{if(!busy&&visibleMode&&host?.isConnected)void load(true);},200);
  }
  async function start(ready,locate){
    if(starting||started||!map||!host?.isConnected||!buildingPowerTarget(row).polygons.length)return;
    starting=true;
    const version=epoch;
    let navigated;
    try{navigated=await ready;}catch{/* Navigation failure does not prevent a whole-area overlap check. */}
    if(version!==epoch)return;
    starting=false;
    if(started||!map||!host?.isConnected||!buildingPowerTarget(row).polygons.length)return;
    const canFocus=locate&&navigated!==false?map.capturePowerBuildingFocus():null;
    started=true;void load(false,canFocus);
  }
  async function load(visible=false,canFocus=null){
    if(!map||!row||busy)return;const revision=++epoch,current=()=>epoch===revision&&host?.isConnected;
    busy=true;result=null;error=null;map.clearPowerBuildings();render();
    const viewport=()=>{const shape=map.powerBuildingsViewport();viewSignature=JSON.stringify(shape);return shape;};
    try{
      const target=buildingPowerTarget(row);let next;
      if(visible){const shape=viewport();if(!shape)throw Error('Map extent is not ready. Retry when the map is available.');next=await loadPowerBuildings(target.polygons,{viewport:shape,current});}
      else next=await loadPowerBuildingsAutomatic(target.polygons,{viewport,current,onVisible:()=>{visibleMode=true;}});
      if(!current())return;
      if(next){
        await map.setPowerBuildings(next.rows);if(!current())return;
        result=next;map.setPowerBuildingLabels(labels);
        // Never chase a background revision, a partial viewport query, or an operator who has moved on.
        if(!visibleMode&&next.rows.length&&canFocus?.())await map.focusPowerBuildings({canNavigate:()=>current()&&canFocus()});
      }
    }
    catch(e){if(current()){error=e.message;map.clearPowerBuildings();}}
    finally{if(current()){busy=false;render();updateVisible();}}
  }
  function render(){
    if(!host?.isConnected||!row)return;
    const target=buildingPowerTarget(row),details=el('details'),content=el('div');
    host.replaceChildren(details);host.className='power-buildings';details.className='power-detail-disclosure';details.open=detailsOpen;
    const quantity=result?` · ${result.rows.length.toLocaleString()}${visibleMode?' in view':''}`:busy?' · loading…':error?' · unavailable':!target.polygons.length?' · no published area':'';
    details.append(el('summary','Buildings and addresses'+quantity),content);
    details.addEventListener('toggle',()=>{if(details.isConnected)detailsOpen=details.open;});
    content.append(el('p',target.reason));
    if(!target.polygons.length)return;
    if(exercise)content.append(el('p','EXERCISE · fictional utility area over real public Overture reference.'));
    if(error){const failure=el('p','Building map unavailable.');failure.setAttribute('role','status');host.append(failure,button('Retry buildings',()=>void load(visibleMode)));content.append(el('p',error));}
    if(!result)return;
    const rows=result.rows,height=rows.filter(r=>r.height!==null).length,address=rows.filter(r=>r.addresses.length).length;
    if(visibleMode)content.append(el('p','Visible map portion only; updates after you pan or zoom. This is not a whole-area total.'));
    content.append(el('p',`${rows.length.toLocaleString()} overlapping footprints · ${height.toLocaleString()} with height · ${address.toLocaleString()} with associated addresses. ${result.scope}. Counts are buildings, not properties or customers.`));
    content.append(el('p','Amber = potential utility-area overlap. Dashed = height unknown (flat). Heights are approximate metres, not terrain, first-floor elevations or flood depth. Address associations do not confirm electric service.'));
    content.append(button(labels?'Hide address labels':'Show address labels',()=>{labels=!labels;map.setPowerBuildingLabels(labels);render();}));
    content.append(el('p',`Overture ${result.index.release} · ${result.index.addressMethod}. Address labels appear at 1:6,000 and closer. Unmatched addresses remain unknown.`));
    const source=el('a','Building sources and coverage');source.href=new URL('../planning.html#power-buildings',import.meta.url).href;source.target='_blank';source.rel='noopener noreferrer';content.append(source);
    const list=el('div'),ordered=selectedId?[...rows.filter(r=>r.id===selectedId),...rows.filter(r=>r.id!==selectedId)]:rows;
    for(const r of ordered.slice(0,40)){
      const item=el('details');item.className='power-nearby-row';item.open=r.id===selectedId||expanded.has(r.id);
      item.addEventListener('toggle',()=>{if(item.isConnected){if(item.open)expanded.add(r.id);else expanded.delete(r.id);}});
      item.append(el('summary',r.label),el('p',r.height===null?'Height not supplied · flat footprint':`Published height ${r.height.toFixed(1)} m · approximate extrusion`));
      for(const a of r.addresses)item.append(el('p',a));
      item.append(el('p',`Overture ID ${r.id} · version ${r.version} · ${r.sources?.join(', ')||'Source not specified'}`),button('Locate building',()=>{selectedId=r.id;onMap();void map.focusPowerBuilding(r.id);}));list.append(item);
    }
    content.append(list);
    if(rows.length>40)content.append(el('p',`Up to 40 records listed; ${rows.length.toLocaleString()} footprints are on the map. Click a footprint to inspect it.`));
    if(!rows.length)content.append(el('p','No overlapping footprints returned in this scope. Building coverage may be incomplete.'));
  }
  window.addEventListener('frogPowerBuildingSelect',event=>{if(result?.rows.some(r=>r.id===event.detail.id)){selectedId=event.detail.id;detailsOpen=true;render();host.querySelector('.power-nearby-row[open]')?.scrollIntoView({block:'nearest'});}});
  async function refocus(ready){
    const version=epoch;
    if(await ready===false||version!==epoch||!host?.isConnected||!result?.rows.length||visibleMode)return;
    const canFocus=map.capturePowerBuildingFocus();
    await map.focusPowerBuildings({canNavigate:()=>version===epoch&&host?.isConnected&&canFocus()});
  }
  return {clear,setMap(value){
    unsubscribeView?.();map=value;unsubscribeView=map.onPowerBuildingsViewSettled(updateVisible);render();
    if(row){const key=row.key;void start(Promise.resolve().then(()=>row?.key===key&&map.focusPower(key)),true);}
  },select(value,element,{ready=Promise.resolve(),locate=true}={}){
    const same=row?.key===value.key&&row?.revision===value.revision;if(!same)clear();
    row=value;host=element;render();if(same&&locate&&result)void refocus(ready);else void start(ready,locate);
  }};
}
