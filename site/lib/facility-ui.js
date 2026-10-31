import {assessFacilities,facilityExercise,facilityFields,FACILITY_COLORS,FACILITY_MAX_AGE} from './facility-model.js';
import {POWER_STATES} from './power-model.js';
import {openFacilitySource,queryFacilities} from './facility-data.js';
import {loadSdk} from './map.js?v=0.74.0-infra-weather';
import {formatTime} from './model.js';
import {FACILITY_PRESETS,COUNTY_ASSET_REFERENCES} from './facility-presets.js';

const $=id=>document.getElementById(id);
const el=(tag,text='',css='')=>{const n=document.createElement(tag);n.textContent=text;n.className=css;return n;};
const button=(text,fn)=>{const b=el('calcite-button',text);b.setAttribute('scale','s');b.setAttribute('appearance','outline');b.onclick=fn;return b;};
const FIELD_LABELS={id:'Stable site ID (required)',name:'Site name (required)',owner:'Department / owner in source',reference:'Inventory reference ID',assetType:'Asset type in source',status:'Site status in source',backup:'Backup-power inventory status',runtime:'Reported backup runtime (hours)',load:'Critical load (kW)',updated:'Site record update time (date field)'};

/** @param {object} options @returns {object} Private, read-only site review. All site records and source connections live only in this tab's memory. */
export function createFacilityWatch({timeZone,exercise=false,onOpen=()=>{},onMap=()=>{},onData=()=>{}}={}) {
  let session=null,county=null,map=null,sources=[],inspector=null,powerRows=[],feeds=[],generation=0,busy=false,selected=null;
  let previous=new Map(),assessment=null;
  const examples=exercise?facilityExercise():[];
  const time=value=>Number.isFinite(value)?formatTime(value,timeZone):'Not supplied';
  function sites(){return exercise?examples:sources.flatMap(s=>s.rows.map(r=>({...r,sourceError:s.error||s.accounting?.rejected>0})));}
  function show(row,locate=true){
    selected=row.site.key;const s=row.site,host=$('facility-detail');host.replaceChildren();
    host.append(el('p',`${row.label} · site power is unconfirmed`,'power-gap'));
    const dl=el('dl');
    for(const [name,value] of [['Inventory category',s.kind],['Asset type in source',s.assetType||'Not supplied'],['Stable asset ID',s.id],['Inventory reference',s.reference||'Not supplied'],['Site status in source',s.status||'Not supplied — verify operation'],['Department / owner in source',s.owner||'Unassigned — contact county facilities lead'],['Backup power',s.backup||'Unknown — verify'],['Reported backup runtime',s.runtime===null?'Unknown':`${s.runtime} hours (inventory; verify current fuel and load)`],['Critical load',s.load===null?'Unknown':`${s.load} kW (inventory; verify)`],['Site record updated',time(s.updated)],['Site layer retrieved',time(s.fetched)],['Site source',s.sourceTitle]])dl.append(el('dt',name),el('dd',value));
    host.append(dl,el('h3','Utility evidence'));
    if(!row.matches.length)host.append(el('p','No current published polygon overlap. Point-only outages, missing footprints and feed failures can leave impacts undetected. This does not establish site power.'));
    for(const m of row.matches){const p=el('section','','facility-evidence');p.append(el('strong',`${m.utility} · ${POWER_STATES[m.status]}`),el('p',m.name),el('p',`Utility record updated ${m.updated?.time?time(m.updated.time):m.updated?.text||'Not supplied'}`),el('p',`Potential start ${m.start?.time?time(m.start.time):m.start?.text||'Not supplied'}`));if(m.health)p.append(el('p',m.health,'power-gap'));for(const issue of m.issues)p.append(el('p',issue,'power-gap'));const a=el('a','Official utility map');a.href=m.official;a.target='_blank';a.rel='noopener noreferrer';p.append(a);host.append(p);}
    for(const note of row.notes)host.append(el('p',note,'power-gap'));
    host.append(el('h3','Requested follow-up'),el('p',row.next),el('p','Confirm generator connection and capacity, fuel/refueling, access and the facility mission with its owner before prepositioning. A listed shelter is not necessarily open or approved for use.'),button('Show site on map',()=>{onMap();map?.focusFacility(s.key);}));
    const eoc=el('a','Open private EOC workspace to record verification / assignment');eoc.href=exercise?'./eoc.html?exercise=1':'./eoc.html';host.append(eoc,el('small','The link does not submit a report or assign resources. This site review has no write access to the county asset layer.'));
    $('facility-dialog').setAttribute('heading',s.name);$('facility-dialog').setAttribute('open','');if(locate){onMap();map?.focusFacility(s.key);}
  }
  function render(){
    const connected=exercise||sources.length>0;
    assessment=assessFacilities(sites(),powerRows,feeds,previous);previous=new Map(assessment.sites.map(r=>[r.site.key,r]));
    $('facility-connect').toggleAttribute('disabled',exercise);$('facility-refresh').toggleAttribute('disabled',exercise||!sources.length||busy);
    $('facility-preset-load').toggleAttribute('disabled',exercise||busy);
    $('facility-connect').textContent=session?'Connect county layer':'Sign in to connect sites';
    $('facility-connection').textContent=exercise?'EXERCISE · fictional sites; no county inventory connected':session?sources.length?`${sources.length} layer connection${sources.length===1?'':'s'} · private records stay in this tab`:'Signed in · load county facility points or connect another approved site layer.':'Sign in to load county facility points. The source remains protected by county layer permissions.';
    const siteGaps=sources.filter(s=>s.error||!s.lastSuccess||s.accounting?.rejected||Date.now()-s.lastSuccess>FACILITY_MAX_AGE).length;
    const report=connected?`${assessment.overlap} possible area matches · ${assessment.review} asset records to review · ${assessment.unknownBackup} facility reviews lack backup information`:'Facility impact assessment pending county layers';
    $('facility-summary').textContent=report;
    $('facility-banner-text').textContent=connected?`${exercise?'EXERCISE · ':''}${report}${assessment.feedGaps?' · utility coverage incomplete':''}${siteGaps?' · site inventory incomplete':''}`:'';
    if(siteGaps&&$('power-banner').getAttribute('kind')!=='danger')$('power-banner').setAttribute('kind','warning');
    $('facility-banner-text').hidden=!connected;
    $('facility-coverage').textContent=connected?`${assessment.sites.length} unique asset records intersect Fresno County. Multiple assets may share one physical location. ${assessment.pointOnly} current utility records have only point locations and cannot be assigned to sites. An unmatched site is not confirmed powered. ${assessment.feedGaps?`${assessment.feedGaps} utility checks need attention.`:''}${siteGaps?` ${siteGaps} site sources need attention; counts are incomplete.`:''}`:'County point and building-footprint presets are available after sign-in. Site status and utility areas remain separate.';
    $('facility-filter-wrap').hidden=!connected;
    const inventory=$('facility-sources');inventory.replaceChildren();
    for(const source of sources){const card=el('div','','facility-source');card.append(el('strong',source.title),el('p',`Retrieved ${time(source.lastSuccess)} · ${source.rows.length} Fresno asset records`));if(source.accounting)card.append(el('small',`${source.accounting.returned} returned; ${source.accounting.outsideCounty} outside county; ${source.accounting.rejected} invalid location / ID records excluded. Inventory gaps require GIS review.`));if(source.error)card.append(el('p',source.error,'power-gap'));if(source.accounting?.rejected)card.append(el('p','Some sites could not be assessed. This is an incomplete inventory.','power-gap'));card.append(button('Disconnect layer',()=>{source.adapter.close();sources=sources.filter(s=>s!==source);render();}));inventory.append(card);}
    const list=$('facility-list');list.replaceChildren();
    const visible=assessment.sites.filter(r=>$('facility-filter').value==='all'||r.review);
    for(const row of visible){const card=el('article','','power-card facility-card');card.style.setProperty('--power-color',FACILITY_COLORS[row.tone]);const title=el('h3');title.append(button(row.site.name,()=>show(row)));card.append(el('strong',row.label),title,el('p',`${row.site.kind} · ${row.site.owner||'Owner unassigned'}`),el('p',`Backup power: ${row.site.backup||'Unknown — verify'}`),button('Review site',()=>show(row)));list.append(card);}
    if(connected&&!visible.length)list.append(el('p','No site records returned in this filter. Check inventory completeness and utility coverage; this is not an all-clear.','power-empty'));
    map?.setFacilities(assessment.sites);
    onData({connected,sites:assessment.sites,sourceGaps:siteGaps});
    if($('facility-dialog').hasAttribute('open')&&selected){const row=assessment.sites.find(r=>r.site.key===selected);if(row)show(row,false);else{$('facility-dialog').removeAttribute('open');$('facility-detail').replaceChildren();selected=null;}}
  }
  function clearInspector(){inspector?.close();inspector=null;$('facility-mapping').replaceChildren();$('facility-mapping-section').hidden=true;$('facility-source-url').value='';$('facility-source-title').value='';$('facility-setup-message').textContent='';}
  function clear(){generation++;for(const source of sources)source.adapter.close();sources=[];clearInspector();previous.clear();selected=null;busy=false;$('facility-detail').replaceChildren();$('facility-dialog').removeAttribute('open');$('facility-connect-dialog').removeAttribute('open');$('facility-refresh').removeAttribute('loading');$('facility-inspect').removeAttribute('loading');$('facility-add').removeAttribute('loading');$('facility-preset-load').removeAttribute('loading');$('facility-preset-message').textContent='';render();}
  async function refresh(){
    if(busy||!session||!county||exercise)return;busy=true;const epoch=generation;$('facility-refresh').setAttribute('loading','');
    for(const source of [...sources]) {
      try {const result=await queryFacilities(source,source.adapter.metadata,source.adapter.query,county);if(epoch!==generation||!sources.includes(source))continue;source.lastSuccess=Date.now();source.rows=result.rows.map(r=>({...r,fetched:source.lastSuccess}));source.accounting=result.accounting;source.error=null;}
      catch(error) {if(epoch===generation&&sources.includes(source)){if(error.accessDenied){source.rows=[];source.lastSuccess=null;source.error='Access expired or denied; private site records cleared. Sign in or ask the layer owner for access.';}else source.error='Site refresh failed; last retrieved sites retained for verification. Recheck source availability.';}}
    }
    if(epoch!==generation)return;busy=false;$('facility-refresh').removeAttribute('loading');render();
  }
  $('facility-preset-load').onclick=async()=>{
    if(!session){$('sign-in').click();return;}if(busy)return;
    const preset=FACILITY_PRESETS.find(p=>p.id===$('facility-preset').value),epoch=generation;
    if(sources.some(s=>s.family===preset.family||s.url.startsWith(preset.url+'/'))){$('facility-preset-message').textContent='This inventory or an alternate building representation is already connected. Disconnect it before switching.';return;}
    $('facility-preset-load').setAttribute('loading','');$('facility-preset-message').textContent='Checking county layer access…';
    let adapter;
    try{if(!county)throw new Error('County boundary is not ready. Retry after the map loads.');adapter=await openFacilitySource(preset.url,session,loadSdk);if(epoch!==generation){adapter.close();return;}facilityFields(adapter.metadata,preset.fields);sources.push({...preset,url:adapter.url,adapter,rows:[],lastSuccess:null,accounting:null,error:null});$('facility-preset-message').textContent=preset.note;await refresh();}
    catch(error){adapter?.close();if(epoch===generation)$('facility-preset-message').textContent=error.message;}
    finally{if(epoch===generation)$('facility-preset-load').removeAttribute('loading');}
  };
  for(const spec of FACILITY_PRESETS){const option=el('calcite-option',spec.title);option.value=spec.id;$('facility-preset').append(option);}
  for(const spec of COUNTY_ASSET_REFERENCES){const item=el('p'),a=el('a',spec.title);a.href=spec.url;a.target='_blank';a.rel='noopener noreferrer';item.append(a,el('small',spec.note));$('facility-reference-list').append(item);}
  $('facility-connect').onclick=()=>{if(!session){$('sign-in').click();return;}clearInspector();$('facility-connect-dialog').setAttribute('open','');};
  $('facility-inspect').onclick=async()=>{
    if(!session)return;const epoch=generation;inspector?.close();inspector=null;$('facility-mapping-section').hidden=true;$('facility-inspect').setAttribute('loading','');
    try{
      const adapter=await openFacilitySource($('facility-source-url').value.trim(),session,loadSdk);
      if(epoch!==generation){adapter.close();return;}inspector=adapter;
      if(sources.some(s=>s.url===adapter.url))throw new Error('This layer is already connected.');
      $('facility-source-title').value=adapter.metadata.name||'County site layer';
      const host=$('facility-mapping');host.replaceChildren();
      for(const [key,label] of Object.entries(FIELD_LABELS)){
        const wrapper=el('calcite-label',label),select=el('calcite-select');select.id=`facility-field-${key}`;select.setAttribute('label',label);select.setAttribute('scale','s');const empty=el('calcite-option','Not supplied');empty.value='';select.append(empty);
        for(const field of adapter.metadata.fields||[]){if(field.type==='esriFieldTypeGeometry'||field.type==='esriFieldTypeBlob'||field.type==='esriFieldTypeRaster'||key==='id'&&field.type==='esriFieldTypeOID'||key==='updated'&&field.type!=='esriFieldTypeDate')continue;const option=el('calcite-option',`${field.alias||field.name} (${field.name})`);option.value=field.name;if(key==='id'&&field.type==='esriFieldTypeGlobalID')option.selected=true;select.append(option);}wrapper.append(select);host.append(wrapper);
      }
      $('facility-mapping-section').hidden=false;$('facility-setup-message').textContent='Choose the site fields. Map runtime only if measured in hours and load only if measured in kW. No field is interpreted as confirmed generator readiness.';
    }catch(error){if(epoch===generation){inspector?.close();inspector=null;$('facility-setup-message').textContent=error.message;}}
    finally {if(epoch===generation)$('facility-inspect').removeAttribute('loading');}
  };
  $('facility-add').onclick=async()=>{
    if(!inspector||!session)return;
    try{if(!county)throw new Error('County boundary is not ready. Retry after the map loads.');const family=FACILITY_PRESETS.find(p=>inspector.url.startsWith(p.url+'/'))?.family;if(sources.some(s=>s.url===inspector.url||family&&s.family===family))throw new Error('This inventory or an alternate building representation is already connected. Disconnect it before switching.');const fields=Object.fromEntries(Object.keys(FIELD_LABELS).map(k=>[k,$(`facility-field-${k}`).value||'']));facilityFields(inspector.metadata,fields);sources.push({url:inspector.url,family,title:$('facility-source-title').value.trim()||inspector.metadata.name,kind:$('facility-source-kind').value,fields,adapter:inspector,rows:[],lastSuccess:null,accounting:null,error:null});inspector=null;$('facility-connect-dialog').removeAttribute('open');clearInspector();await refresh();}
    catch(error){$('facility-setup-message').textContent=error.message;}
  };
  $('facility-refresh').onclick=()=>void refresh();$('facility-filter').addEventListener('calciteSelectChange',render);$('facility-map-toggle').addEventListener('calciteCheckboxChange',()=>{map?.setLayerPreference('facilities',$('facility-map-toggle').checked);render();});
  $('facility-connect-dialog').addEventListener('stormEvidenceClose',clearInspector);
  setInterval(()=>{if(!document.hidden)void refresh();},300000);setInterval(()=>{if(!document.hidden)render();},30000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)void refresh();});window.addEventListener('pagehide',()=>{session=null;clear();});
  render();
  return {async loadDefault({refreshLoaded=false}={}){if(refreshLoaded&&sources.some(s=>s.family==='county-buildings'))await refresh();if(!sources.some(s=>s.family==='county-buildings')){$('facility-preset').value='facilities';await $('facility-preset-load').onclick();}return $('facility-preset-message').textContent;},setSession(next){session=next?.portal?.id==='ibgDyuD2DLBge82s'?next:null;clear();},setCounty(c){county=c;},setPower(rows,nextFeeds){powerRows=rows;feeds=nextFeeds;render();},setMap(m){map=m;render();if(selected)map.focusFacility(selected);},select(key,{keepWorkspace=false}={}){const row=assessment?.sites.find(r=>r.site.key===key);if(row){if(!keepWorkspace)onOpen();map?.setLayerPreference('facilities',true);show(row);}}};
}
