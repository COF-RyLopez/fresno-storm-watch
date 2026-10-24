import {CONFIG} from './config.js';
import {EOC_CONFIG} from './eoc-config.js';
import {setupAuth} from './lib/auth.js?v=0.40.0';
import {loadSdk} from './lib/map.js?v=0.42.0';
import {openDrainage} from './lib/drainage-data.js?v=0.46.0';
import {createPumpReadiness} from './lib/pump-readiness-ui.js?v=0.46.0';
import {pumpReadiness} from './lib/pump-readiness-model.js';
import {pumpFormChoices,pumpFormCurrent,pumpFormLink} from './lib/pump-form-model.js';
import {PUMP_READINESS_SCOPE,PUMP_READINESS_TEST_SCOPE} from './lib/pump-readiness-contract.js';
import {pumpSummaryExercise} from './lib/pump-summary-exercise.js?v=0.45.0';

const $=id=>document.getElementById(id),params=new URLSearchParams(location.search),exercise=params.get('exercise')==='1',acceptance=!exercise&&params.get('acceptance')==='1';
const fictional=exercise||acceptance,fixture=fictional?pumpSummaryExercise():null;
const scope=acceptance?PUMP_READINESS_TEST_SCOPE:PUMP_READINESS_SCOPE;
let session=null,adapter=null,inventory={connected:false,rows:[],checked:null,error:null},selected=null,epoch=0,selectionEpoch=0,mapEpoch=0,busy=false,locationReady=false,mapView=null,state=null,controller=null;
const time=v=>Number.isFinite(v)?new Date(v).toLocaleString('en-US',{timeZone:CONFIG.timeZone,timeZoneName:'short'}):'Unknown';
const feedback=text=>{$('pump-form-feedback').textContent=text;};
if(fictional){$('pump-page-mode').textContent=exercise?'FICTIONAL REHEARSAL · this tab only':'PRIVATE ACCEPTANCE TEST · fictional pump';$('pump-page-mode-detail').textContent=exercise?'Synthetic pumps and contacts. No AGOL writes; updates disappear on reload.':'A fictional pump uses the separate private acceptance scope. It does not change normal Area Watch or FMFCD records. Use fictional details only.';}

function resetSelection(){selectionEpoch++;mapEpoch++;selected=null;locationReady=false;controller?.clearForm();mapView?.destroy();mapView=null;$('pump-selection').hidden=true;$('pump-current-summary').replaceChildren();$('pump-selected-name').textContent='Selected pump';$('pump-selected-location').textContent='';$('pump-map-status').textContent='';$('pump-form-reopen').hidden=true;$('pump-previous').open=false;}
function clearInventory(message=null){epoch++;adapter?.close();adapter=null;inventory={connected:false,rows:[],checked:null,error:message};busy=false;resetSelection();$('pump-form-search').value='';$('pump-form-select').replaceChildren(new Option('Choose a pump…',''));renderInventory();}
function renderInventory(){
  $('pump-form-load').disabled=busy||!fictional&&!session;$('pump-form-load').loading=busy;$('pump-form-load').textContent=inventory.connected?'Refresh pump list':'Load pump list';
  $('pump-picker-controls').hidden=!inventory.connected||busy;
  $('pump-inventory-status').textContent=busy?'Loading the pump inventory. Complete county Enterprise sign-in if prompted.':inventory.error||!inventory.connected?inventory.error||'Sign in, then load the pump list. Proposed and unclassified assets are excluded.':`${pumpFormChoices(inventory.rows).length} existing pump records · retrieved ${time(inventory.checked)}. Source operation remains unconfirmed.${Date.now()-inventory.checked>600000?' Retrieval overdue; refresh before saving.':''}`;
}
function renderChoices(){
  const select=$('pump-form-select'),rows=pumpFormChoices(inventory.rows,$('pump-form-search').value),keep=selected?.key;select.replaceChildren(new Option(rows.length?'Choose a pump…':'No matching existing pump returned',''));
  for(const r of rows)select.add(new Option(r.name,r.key));if(rows.some(r=>r.key===keep))select.value=keep;
}
function current(record,version){return version===selectionEpoch&&locationReady&&pumpFormCurrent(record,inventory);}
function renderPrevious(){const host=$('pump-current-summary');host.replaceChildren();if(selected&&controller&&state)controller.renderSummary(host,{readiness:pumpReadiness(selected,state)},{includeTasks:false});}

async function drawLocation(record,version){
  const drawing=++mapEpoch,active=()=>version===selectionEpoch&&drawing===mapEpoch;
  $('pump-map-status').textContent='Loading the selected pump location…';
  try{
    const [Map,MapView,Basemap,TileLayer,Graphic]=await(await loadSdk()).import(['@arcgis/core/Map.js','@arcgis/core/views/MapView.js','@arcgis/core/Basemap.js','@arcgis/core/layers/TileLayer.js','@arcgis/core/Graphic.js']);
    if(!active())return false;
    const dark=document.documentElement.dataset.theme!=='light',shade=dark?'Dark':'Light',basemap=new Basemap({baseLayers:[new TileLayer({url:`https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_${shade}_Gray_Base/MapServer`})],referenceLayers:[new TileLayer({url:`https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_${shade}_Gray_Reference/MapServer`})]});
    const view=new MapView({container:'pump-location-map',map:new Map({basemap}),center:[record.geometry.x,record.geometry.y],zoom:16,popupEnabled:false,attributionVisible:true,ui:{components:['zoom']}});mapView=view;
    view.graphics.add(new Graphic({geometry:record.geometry,symbol:{type:'simple-marker',style:'circle',size:14,color:'#65cad1',outline:{color:'#17252b',width:2}}}));
    await view.when();if(!active()){view.destroy();return false;}
    locationReady=true;$('pump-map-status').textContent='Cyan circle: selected inventory pump. Check its location and actual identity; this map does not confirm operation or readiness.';return true;
  }catch{if(active()){locationReady=false;mapView?.destroy();mapView=null;$('pump-map-status').textContent='Location map unavailable. Refresh the pump list to retry; verify the location before submitting.';}return false;}
}
async function choosePump(){
  const key=$('pump-form-select').value;resetSelection();feedback('');if(!key)return;
  const record=inventory.rows.find(r=>r.key===key);if(!pumpFormCurrent(record,inventory)){feedback('The pump list is overdue or changed. Refresh it before selecting a pump.');return;}
  selected=record;const version=selectionEpoch;$('pump-selection').hidden=false;$('pump-selected-name').textContent=record.name;$('pump-selected-location').textContent=`Location: ${record.geometry.y.toFixed(6)}° N, ${Math.abs(record.geometry.x).toFixed(6)}° W · inventory retrieved ${time(inventory.checked)}. Record IDs can change; verify the actual pump.`;renderPrevious();
  if(await drawLocation(record,version))await controller.open($('pump-form-host'),record,()=>current(record,version));
}
async function loadPumps(){
  if(busy||!fictional&&!session)return;const version=epoch;busy=true;feedback('');resetSelection();renderInventory();
  try{
    let rows;
    if(fictional)rows=acceptance?[fixture.snapshot.rows.find(r=>r.key==='fictional-pump')]:fixture.snapshot.rows;
    else {if(!adapter){const opened=await openDrainage(EOC_CONFIG,session,loadSdk);if(version!==epoch){opened.close();return;}adapter=opened;}rows=await adapter.readPumps();}
    if(version!==epoch)return;const verified=pumpFormChoices(rows);inventory={connected:true,rows:verified,checked:Date.now(),error:null};renderChoices();await controller.refresh();
  }catch(e){if(version===epoch)clearInventory(e.message);}
  finally{if(version===epoch){busy=false;renderInventory();}}
}
controller=createPumpReadiness({exercise,exerciseData:fixture,timeZone:CONFIG.timeZone,scope,onClosed:()=>{$('pump-form-reopen').hidden=false;feedback('Form closed without saving. Choose Enter another update to return to this pump.');},onData:value=>{state=value;renderPrevious();},onSaved:()=>{controller.clearForm();$('pump-form-reopen').hidden=false;renderPrevious();feedback(exercise?'Fictional update saved in this tab only.':acceptance?'Private acceptance update saved; normal Area Watch is unchanged.':'Update saved privately. Area Watch and the banner use this version on their next successful refresh while open. EOC staff can reopen the evidence and Add to briefing; previous briefing snapshots remain unchanged.');$('pump-form-feedback').scrollIntoView({block:'center'});}});
$('pump-form-load').onclick=()=>void loadPumps();$('pump-form-search').oninput=()=>{resetSelection();renderChoices();feedback('');};$('pump-form-select').onchange=()=>void choosePump();
$('pump-form-reopen').onclick=()=>{if(selected){const record=selected,version=selectionEpoch;$('pump-form-reopen').hidden=true;void controller.open($('pump-form-host'),record,()=>current(record,version));}};
$('pump-form-link').onclick=async()=>{try{await navigator.clipboard.writeText(pumpFormLink(location.href,{exercise,acceptance}));feedback('Form link copied. It contains no pump details and does not grant access.');}catch{feedback('Clipboard unavailable. Share this page’s address after removing any sign-in parameters.');}};
window.addEventListener('storm-theme-change',()=>{if(selected){const record=selected;locationReady=false;mapView?.destroy();mapView=null;void drawLocation(record,selectionEpoch).then(ready=>{if(ready&&!$('pump-form-host').querySelector('form'))$('pump-form-reopen').hidden=false;});}});
setInterval(()=>{if(!document.hidden)renderInventory();},30000);
window.addEventListener('pagehide',()=>{session=null;clearInventory();feedback('');});renderInventory();
void setupAuth(CONFIG.arcgis,exercise,value=>{session=value;clearInventory();feedback('');controller.setSession(value);});
if(exercise){$('identity-status').textContent='Fictional rehearsal · no sign-in required.';$('pump-store-note').textContent='Fictional updates stay in this tab and disappear on reload. No private AGOL records are written.';void loadPumps();}
