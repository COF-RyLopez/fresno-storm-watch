import {EOC_CONFIG} from '../eoc-config.js';
import {loadSdk} from './map.js?v=0.74.0-shell';
import {formatTime} from './model.js';
import {DRAINAGE_URL,DRAINAGE_MAX_AGE,drainageCounts,unchangedDrainageSelection} from './drainage-model.js?v=0.53.0';
import {openDrainage} from './drainage-data.js';
const $=id=>document.getElementById(id),el=(tag,text='')=>{const n=document.createElement(tag);n.textContent=text;return n;};
/** @param {object} options @returns {object} Private, read-only drainage context; memory cleared on sign-out, expiry, disconnect and failure. */
export function createDrainageWatch({timeZone,exercise=false,onMap=()=>{},onRainfall=()=>{},onFacilities=()=>{},onRoad=()=>{},onData=()=>{},renderNearby=()=>{}}){
  let session=null,adapter=null,map=null,rows=[],checked=null,error=null,busy=false,generation=0,selected=null,weather=null,roads=null,facilities=null,listSignature='';
  const time=v=>Number.isFinite(v)?formatTime(v,timeZone):'Unknown';
  const button=(label,fn)=>{const b=el('calcite-button',label);b.scale='s';b.appearance='outline';b.onclick=fn;return b;};
  function clear({message=null}={}){generation++;adapter?.close();adapter=null;rows=[];checked=null;selected=null;busy=false;error=message;$('drainage-detail').replaceChildren();$('drainage-search').value='';$('drainage-facility-message').textContent='';$('drainage-boundary-status').textContent='';$('drainage-catchments').checked=false;map?.setLayerPreference('drainageCatchments',false);$('drainage-evidence').removeAttribute('open');map?.clearEnvironmentPopup();map?.setDrainage([]);render();}
  function select(key,focus=true){
    const row=rows.find(r=>r.key===key);if(!row)return;selected=key;
    const host=$('drainage-detail');host.replaceChildren();$('drainage-evidence').heading=row.name;
    const dl=el('dl');for(const [label,value]of [['Source classification',row.status],['Drainage / basin code',row.code||'Not supplied'],['Source modification time',time(row.updated)],['Source revision date',time(row.revision)],['Retrieved',time(checked)],['Operating condition','Unconfirmed — contact FMFCD'],['Capacity / available storage','Not supplied by this service'],['Selection ID',`${row.layerId}/${row.objectId} · session-only ObjectID`]])dl.append(el('dt',label),el('dd',value));
    host.append(el('p',row.status));if(['basin','pump'].includes(row.kind))renderNearby(host,row);
    const inventory=el('details');inventory.append(el('summary','Inventory dates and attributes'),dl);host.append(inventory);
    host.append(el('p',row.kind==='pump'?'This inventory does not supply pump discharge, power availability, backup, controls or current status.':'The polygon is a mapped inventory / drainage boundary. It is not a current shoreline, storage-volume curve or predicted flood extent.'),el('h3','Planning context'),el('p',weather?.status||'Rainfall forecast is checking; source availability and dates remain visible on the map.'),el('p','Rainfall polygons are liquid-equivalent forecasts, not runoff or flood depth. Drainage and receiving-water connections require owner verification.'));
    const a=el('a','FMFCD source layer');a.href=DRAINAGE_URL+'/'+row.layerId;a.target='_blank';a.rel='noopener noreferrer';host.append(a,button('Zoom to full outline / location',()=>{onMap();void map?.focusDrainage(key);}));
    $('drainage-evidence').setAttribute('open','');if(focus){onMap();void map?.focusDrainage(key);}
  }
  function render(){
    const counts=drainageCounts(rows),connected=!!adapter&&!!checked;
    onData({rows,checked,error,connected,busy});
    $('drainage-load').textContent=!session?'County sign-in':connected?'Refresh FMFCD layers':'Load private FMFCD layers';$('drainage-load').disabled=busy||exercise;$('drainage-load').loading=busy;
    $('drainage-disconnect').hidden=!adapter;
    $('drainage-status').textContent=error||(!session?'County AGOL sign-in and private EOC viewer access required. County Enterprise separately controls this service.':busy?'Reading FMFCD layers; complete the county Enterprise sign-in dialog if prompted.':connected?`Retrieved ${time(checked)}. Source age and operating conditions unknown.${Date.now()-checked>DRAINAGE_MAX_AGE?' Retrieval overdue — refresh required.':''}`:'Signed in. Load the private FMFCD layers for this session.');
    $('drainage-summary').textContent=connected?`${counts.basins} existing basin polygons · ${counts.pumps} existing pump records`:'No private drainage records loaded';
    $('drainage-proposed-count').textContent=connected?`Proposed / future assets (${counts.proposed})`:'Proposed / future assets';
    $('drainage-other-count').textContent=connected?`Other / unclassified assets (${counts.other})`:'Other / unclassified assets';
    $('drainage-weather-status').textContent=weather?.qpf?`WPC ${weather.period.hours}h · issued ${time(weather.qpf.issue)} · valid ${time(weather.qpf.start)} to ${time(weather.qpf.end)}. Shared planning time ${time(weather.selectedTime)}. ${weather.overlay==='qpf'?(weather.rainfallHealth||'Check the shared weather timeline.'):'Rainfall is not selected; use Show rainfall forecast.'}${weather.layerError?' Map layer failed; use Weather to check source health.':''}`:weather?.status||'Checking published rainfall forecast dates…';
    if(weather?.period&&$('drainage-qpf').value!==String(weather.period.id))$('drainage-qpf').value=String(weather.period.id);
    $('drainage-roads-status').textContent=roads?.snapshot?`${roads.snapshot.rows.length} road records loaded · current display filters retained. A drawn road is not confirmed open.`:'Road source checking / unavailable. Use Roads to inspect source health.';
    $('drainage-facilities-status').textContent=facilities?.connected?`${facilities.sites.length} authorized asset records loaded · power and access unconfirmed.`:'County facilities are not loaded. Use Load county facilities below; source permissions apply.';
    const filter=$('drainage-filter').value||'existing',query=String($('drainage-search').value||'').trim().toLowerCase();
    const visible=rows.filter(r=>r.kind!=='catchment'&&r.category===filter&&r.name.toLowerCase().includes(query)).sort((a,b)=>a.name.localeCompare(b.name)),list=$('drainage-list');
    $('drainage-list-count').textContent=connected?`${visible.length} ${filter} records in list · map category controls are separate`:'';
    const signature=JSON.stringify([generation,checked,filter,query]);if(signature!==listSignature){listSignature=signature;list.replaceChildren();
    for(const row of visible.slice(0,60)){const item=el('article');item.className='drainage-row';item.append(button(row.name,()=>select(row.key)),el('small',row.status));list.append(item);}
    if(visible.length>60)list.append(el('p','First 60 shown. Enter a basin / drainage code to narrow the list. All loaded records remain available on the map.'));
    if(connected&&!visible.length)list.append(el('p','No records returned in this list filter. This is not an all-clear.'));}
    for(const [id,key]of [['drainage-existing','drainage'],['drainage-proposed','drainageProposed'],['drainage-other','drainageOther'],['drainage-catchments','drainageCatchments']])$(id).disabled=!connected;
  }
  async function load(){
    if(exercise)return;if(!session){$('sign-in').click();return;}if(busy)return;busy=true;error=null;const epoch=generation;render();
    try{if(!adapter){const opened=await openDrainage(EOC_CONFIG,session,loadSdk);if(epoch!==generation){opened.close();return;}adapter=opened;}const first=!checked,loaded=await adapter.read({includeBoundaries:$('drainage-catchments').checked});if(epoch!==generation)return;
      const unchanged=unchangedDrainageSelection(selected,rows,loaded);rows=loaded;checked=Date.now();
      if(!unchanged){selected=null;$('drainage-evidence').removeAttribute('open');$('drainage-detail').replaceChildren();map?.clearEnvironmentPopup();}
      map?.setDrainage(rows);if(first&&!$('drainage-panel').hidden){onMap();void map?.fitDrainage();}}
    catch(e){if(epoch===generation)clear({message:e.message});}
    finally{if(epoch===generation){busy=false;render();}}
  }
  $('drainage-load').onclick=()=>void load();$('drainage-disconnect').onclick=()=>clear();
  $('drainage-filter').addEventListener('calciteSelectChange',render);$('drainage-search').addEventListener('calciteInputInput',render);
  for(const [id,key]of [['drainage-existing','drainage'],['drainage-proposed','drainageProposed'],['drainage-other','drainageOther']])$(id).addEventListener('calciteCheckboxChange',()=>map?.setLayerPreference(key,$(id).checked));
  $('drainage-catchments').addEventListener('calciteCheckboxChange',async()=>{const wanted=$('drainage-catchments').checked;map?.setLayerPreference('drainageCatchments',wanted);if(!wanted||!adapter||rows.some(r=>r.kind==='catchment'))return;const epoch=generation;$('drainage-boundary-status').textContent='Loading optional boundaries in small batches…';try{const boundaries=await adapter.readBoundaries();if(epoch!==generation)return;if($('drainage-catchments').checked){rows=[...rows.filter(r=>r.kind!=='catchment'),...boundaries];map?.setDrainage(rows);$('drainage-boundary-status').textContent='Drainage boundaries generalized for display. Use FMFCD source geometry for engineering.';render();}}catch(e){if(epoch===generation)clear({message:e.message});}});
  $('drainage-rainfall').onclick=()=>{onRainfall(Number($('drainage-qpf').value));map?.setLayerPreference('weather',true);};
  $('drainage-qpf').addEventListener('calciteSelectChange',()=>{onRainfall(Number($('drainage-qpf').value));map?.setLayerPreference('weather',true);});
  $('drainage-fit').onclick=()=>{onMap();void map?.fitDrainage();};
  document.addEventListener('frogLayerPreference',e=>{const id={drainage:'drainage-existing',drainageProposed:'drainage-proposed',drainageOther:'drainage-other',drainageCatchments:'drainage-catchments'}[e.detail.key];if(id)$(id).checked=e.detail.wanted;});
  $('drainage-connect-facilities').onclick=async()=>{$('drainage-connect-facilities').loading=true;try{$('drainage-facility-message').textContent=await onFacilities()||'County inventory checked. See the connected facility count above.';}catch{$('drainage-facility-message').textContent='County facility connection failed. Retry from Power / PSPS.';}finally{$('drainage-connect-facilities').loading=false;}};$('drainage-open-roads').onclick=onRoad;
  setInterval(()=>{if(!document.hidden){if(adapter&&!busy)void load();else render();}},300000);
  setInterval(()=>{if(!document.hidden)render();},30000);
  window.addEventListener('pagehide',()=>{session=null;clear();});
  render();return {load,setSession(next){session=next;clear();},setMap(controller){map=controller;map.setDrainage(rows);},select,setWeather(data){weather=data;render();},setRoads(data){roads=data;render();},setFacilities(data){facilities=data;render();}};
}
