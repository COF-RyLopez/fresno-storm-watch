import {networkVicinityGeometry,powerNearbyCandidates,pumpInventoryProblem} from './power-nearby-model.js';
import {createPumpVicinityInventory} from './power-nearby-data.js';
import {openPumpCopy} from './pump-copy-data.js?v=0.73.1';
import {PUMP_INVENTORY_CONFIG} from '../pump-inventory-config.js?v=0.47.0';
import {EOC_CONFIG} from '../eoc-config.js';
import {pumpReadiness} from './pump-readiness-model.js';
const el=(tag,text='')=>{const n=document.createElement(tag);n.textContent=text;return n;};
const button=(text,click)=>{const n=el('calcite-button',text);n.scale='s';n.appearance='outline';n.onclick=click;return n;};

/** Session-only evidence beside a selected network reference. Proximity never becomes electrical connectivity. */
export function createPowerNearby({timeZone,exercise=false,exerciseData,onMap=()=>{},onLoadFacilities=()=>{},onSignIn=()=>{}}){
  let map=null,session=null,facilities={},pumps={},readiness={},target=null,host=null,miles=2,revision=0,autoLoaded=false,loading=false,loadEpoch=0;
  const expanded=new Set();
  const stamp=value=>Number.isFinite(value)?new Date(value).toLocaleString('en-US',{timeZone,timeZoneName:'short'}):'Not supplied';
  const pumpLabel=row=>{if(pumpInventoryProblem(pumps))return 'Inventory / readiness requires verification';const result=pumpReadiness(row,readiness);return result.reasons[0]||result.label;};
  const inventory=createPumpVicinityInventory({open:value=>openPumpCopy(PUMP_INVENTORY_CONFIG,EOC_CONFIG,value),onChange:value=>{pumps=value;render();}});
  const active=()=>host?.isConnected&&target;
  async function loadPlaces(){
    if(exercise||loading)return;if(!session){onSignIn();return;}
    const epoch=loadEpoch;autoLoaded=true;loading=true;render();
    try{await Promise.allSettled([onLoadFacilities(),inventory.load()]);}finally{if(epoch===loadEpoch){loading=false;render();}}
  }
  function render(){
    const version=++revision;if(!active())return;
    map?.clearPowerNearby();host.replaceChildren(el('h3','Nearby county places'));
    host.append(el('p','Horizontal proximity to the full selected reference, not a service territory, confirmed electrical connection, predicted outage or access route. Close this pane to restore the network.'));
    const controls=el('div');controls.className='power-nearby-controls';
    const label=el('calcite-label','Distance from selected reference'),select=el('calcite-select');select.id='power-nearby-distance';select.scale='s';select.label='Nearby county places distance';
    for(const value of [.5,1,2,5]){const option=el('calcite-option',value+' mile'+(value===1?'':'s'));option.value=String(value);option.selected=value===miles;select.append(option);}
    select.addEventListener('calciteSelectChange',()=>{miles=Number(select.value);render();});label.append(select);controls.append(label);
    if(!exercise){const load=button(session?'Refresh county places':'Sign in to load county places',()=>void loadPlaces());load.loading=loading;load.disabled=loading;controls.append(load);}
    host.append(controls);
    const note=el('p');note.setAttribute('role','status');host.append(note);
    const results=el('div');host.append(results);
    const current=()=>version===revision&&host?.isConnected&&!!target;
    if(!map?.findNearbySearch){note.textContent='Map distance tools are loading. Select this reference again when the map is ready.';return;}
    const {entries,conflicts}=powerNearbyCandidates(facilities,pumps);
    note.textContent='Checking loaded county inventories…';
    void map.findNearbySearch(target.shape,entries,{miles,current,limit:10000}).then(found=>{
      if(!current()||!found)return;
      const group=found.asset;
      note.textContent=`Within ${miles} mile${miles===1?'':'s'} of all selected mapped parts. ${group.unknown} records have unusable locations / distances; ${conflicts} conflicting duplicate identities excluded. Distances are horizontal, not driving distances.`;
      for(const [category,title]of [['pump','FMFCD existing pumps'],['facility','County facilities / assets']]){
        const all=group.rows.filter(r=>r.category===category),shown=all.slice(0,12),connected=category==='facility'?facilities.connected:pumps.connected;
        results.append(el('h4',title+(connected?' · '+all.length+' nearby':' · not loaded')));
        if(category==='pump')results.append(el('p',exercise?'FICTIONAL EXERCISE · invented pumps and readiness reports.':'Pump readiness uses the private EOC exercise workspace. Confirm reports with FMFCD before operational use; inventory locations do not establish current operation.'));
        if(category==='facility')results.append(el('p',connected?`${facilities.sites?.length||0} authorized records loaded${facilities.sourceGaps?' · inventory checks need verification':''}.`:'County facility inventory is not loaded. Sign in and load county places; missing coverage is not zero facilities.'));
        else results.append(el('p',pumpInventoryProblem(pumps)||`${exercise?'Fictional inventory':'Private AGOL copy'}: ${pumps.rows.filter(r=>r.kind==='pump'&&r.category==='existing').length} existing pump records · source checked ${stamp(pumps.sourceChecked)} · app retrieved ${stamp(pumps.checked)}. Inventory does not establish pump operation.`));
        if(all.length>shown.length)results.append(el('p',`Nearest ${shown.length} shown. Narrow the distance to inspect more closely.`));
        if(connected&&!all.length)results.append(el('p','No nearby matches in the loaded inventory. Coverage may be incomplete.'));
        for(const row of shown){
          const item=el('details');item.className='power-nearby-row';item.open=expanded.has(row.key);item.addEventListener('toggle',()=>{if(current()&&item.isConnected){if(item.open)expanded.add(row.key);else expanded.delete(row.key);}});
          const distance=row.distanceMeters<160.9344?'<0.1 mi':(row.distanceMeters/1609.344).toFixed(1)+' mi';const summary=el('summary',row.name+' · '+distance),quick=el('span',row.category==='pump'?pumpLabel(row.pump):(row.assessment.label||'Backup power: '+(row.site.backup||'Unknown — verify')));summary.append(quick);item.append(summary,el('p',distance+' from selected reference · electrical connection unverified'));
          if(row.category==='facility'){
            const s=row.site;item.append(el('p',`${s.kind||'County asset'} · Owner: ${s.owner||'Not supplied'}`),el('p',`Backup power: ${s.backup||'Unknown — verify'}${s.runtime!==null&&s.runtime!==undefined?' · inventory runtime '+s.runtime+' hours':''}`),el('p',row.assessment.label||'Site conditions require verification'),el('p',`Source: ${s.sourceTitle||'Loaded county inventory'} · record updated ${stamp(s.updated)} · retrieved ${stamp(s.fetched)}${s.sourceError?' · source needs verification':''}.`));
          }else{
            const r=pumpReadiness(row.pump,readiness),p=r.event?.payload,problem=pumpInventoryProblem(pumps);
            item.append(el('p',problem?'Inventory / readiness requires verification':r.label));
            if(p)item.append(el('p',`${r.current&&!problem?'Owner-reported':'Last reported'} backup: ${p.backup} · fuel: ${p.fuel} · runtime: ${p.runtimeHours===null?'Unknown':p.runtimeHours+' hours'}`),el('p',`Responsible contact: ${p.owner||'Not supplied'}${p.contact?' · '+p.contact:''} · observed ${stamp(p.observed)} · review due ${stamp(p.validUntil)}`));
            else item.append(el('p','Backup power, fuel/runtime and responsible contact are not confirmed in current readiness records.'));
            if(r.reasons.length)item.append(el('p',r.reasons.join(' ')));
            item.append(el('p',`Inventory ID: ${row.pump.code||row.pump.key} · existing inventory only. Proposed assets are excluded.`));
          }
          item.append(button('Locate on map',()=>{if(current()){onMap();map.setLayerPreference('facilities',true);void map.focusPowerNearby(row.geometry,row.category);}}));results.append(item);
        }
      }
      if(group.rows.some(r=>r.category==='pump')){const form=el('a','Open standalone pump readiness form');const formUrl=new URL('../pump-readiness.html',import.meta.url);if(exercise)formUrl.searchParams.set('exercise','1');form.href=formUrl.href;form.target='_blank';form.rel='noopener noreferrer';results.append(form);}
    }).catch(()=>{if(current())note.textContent='Nearby distance checks failed. No spatial relationship is confirmed. Select the reference again or refresh county places to retry.';});
  }
  function clear(){revision++;expanded.clear();host?.replaceChildren();target=null;host=null;map?.clearPowerNearby();}
  if(exercise&&exerciseData){pumps={...exerciseData.snapshot,sourceChecked:exerciseData.snapshot.checked,maxSourceAgeMs:86400000,refreshState:'manual'};}
  window.addEventListener('stormWorkspaceChange',()=>{if(new URL(location.href).searchParams.get('view')!=='power')clear();});
  setInterval(()=>{if(!document.hidden&&active()){if(!exercise&&session&&pumps.connected&&Date.now()-pumps.checked>300000)void loadPlaces();else render();}},60000);
  return {
    setMap(value){map=value;render();},
    select(features,element){revision++;map?.clearPowerNearby();host=element;try{target={shape:networkVicinityGeometry(features)};}catch{target=null;host.replaceChildren(el('p','No usable selected geometry for nearby county places.'));return;}render();if(session&&!autoLoaded)void loadPlaces();},
    clear,
    setFacilities(value){facilities=value||{};render();},
    setReadiness(value){readiness=value||{};render();},
    setSession(value){if(exercise)return;loadEpoch++;revision++;expanded.clear();session=value?.portal?.id===EOC_CONFIG.orgId?value:null;facilities={};readiness={};autoLoaded=false;loading=false;map?.clearPowerNearby();inventory.setSession(session);render();const account=session;queueMicrotask(()=>{if(session&&session===account&&active())void loadPlaces();});}
  };
}
