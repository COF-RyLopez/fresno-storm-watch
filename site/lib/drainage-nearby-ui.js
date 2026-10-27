import {EOC_CONFIG} from '../eoc-config.js';
import {formatTime} from './model.js';
import {openDrainageDetail} from './drainage-nearby-data.js?v=0.55.0';
import {FMFCD_DETAIL_URL,FMFCD_DETAIL_CATEGORIES} from './drainage-nearby-model.js?v=0.53.0';
import {DETAIL_KEYS} from './drainage-nearby-map.js?v=0.55.0';
import {drainageConnections,CONNECTION_GROUPS} from './drainage-connections.js?v=0.55.0';
const el=(tag,text='')=>{const n=document.createElement(tag);n.textContent=text;return n;};
const button=(label,fn)=>{const b=el('calcite-button',label);b.scale='s';b.appearance='outline';b.onclick=fn;return b;};
const link=(label,url)=>{const a=el('a',label);a.href=url;a.target='_blank';a.rel='noopener noreferrer';return a;};

/** One private supporting-evidence selection. No server copy, export, persistent cache or county-token forwarding. */
export function createDrainageNearby({timeZone,exercise=false,onMap=()=>{},config=EOC_CONFIG,open=openDrainageDetail}={}){
  let session=null,map=null,source=null,host=null,record=null,result=null,error=null,busy=false,generation=0;
  let radius=500,planned=false,unknown=true,selectedKey=null;
  let trace=null,connectionMode='connections',start=null;
  const time=v=>Number.isFinite(v)?formatTime(v,timeZone):'Not supplied';
  const allRows=()=>result?.layers.flatMap(l=>l.rows)||[];
  const shownRows=()=>allRows().filter(r=>(planned||r.category!=='planned')&&(unknown||r.category!=='unknown'));
  function clear(){generation++;source?.close();source=null;host?.replaceChildren();host=null;record=null;result=null;error=null;busy=false;selectedKey=null;trace=null;start=null;map?.clearDrainageNearby();}
  function rebuild(){trace=drainageConnections(record,result,{includeUnknown:unknown,start});}
  function draw(){map?.setDrainageNearby(shownRows(),Object.fromEntries((result?.layers||[]).map(l=>[l.spec.id,l.renderer])),{trace,mode:connectionMode});}
  function enable(){for(const [category,key]of Object.entries(DETAIL_KEYS))map?.setLayerPreference(key,category==='mapped'||category==='planned'&&planned||category==='unknown'&&unknown);}
  function clearIfWithin(container){if(host&&container.contains(host))clear();}
  async function load(){
    if(exercise||!record||!host?.isConnected)return;
    const version=++generation,current=()=>generation===version&&!!host?.isConnected;
    source?.close();source=null;busy=true;error=null;result=null;trace=null;start=null;map?.clearDrainageNearby();render();
    try{
      const opened=await open(config,session);
      if(!current()){opened.close();return;}source=opened;
      const next=await opened.read(record,{radius,planned});if(!current()||!next)return;
      result=next;rebuild();draw();
    }catch(e){if(current()){error=e.message;result=null;map?.clearDrainageNearby();}}
    finally{if(current()){busy=false;render();}}
  }
  function render(){
    if(!host?.isConnected||!record)return;host.replaceChildren();host.className='drainage-nearby';
    host.append(el('h3','Nearby drainage'));
    if(exercise){host.append(el('p','Exercise inventory · live FMFCD detail queries are disabled for fictional locations.'));return;}
    const controls=el('div');controls.className='drainage-actions';
    const label=el('calcite-label','Distance from full basin outline / pump'),picker=el('calcite-select');picker.label='Nearby drainage distance';picker.scale='s';
    for(const value of [250,500,1000]){const o=el('calcite-option',value.toLocaleString()+' m');o.value=String(value);o.selected=radius===value;picker.append(o);}picker.value=String(radius);
    picker.addEventListener('calciteSelectChange',()=>{radius=Number(picker.value);void load();});label.append(picker);
    controls.append(label,button('Refresh drainage detail',()=>void load()),button('Fit nearby area',()=>{onMap();void map?.fitDrainageNearby(record,radius);}));host.append(controls);
    for(const [text,checked,change]of [
      ['Show classification-unconfirmed records',unknown,value=>{unknown=value;start=null;rebuild();draw();enable();render();}],
      ['Show proposed / design assets',planned,value=>{planned=value;enable();void load();}]
    ]){const l=el('calcite-label',text),box=el('calcite-checkbox');l.layout='inline';box.checked=checked;box.addEventListener('calciteCheckboxChange',()=>change(box.checked));l.prepend(box);host.append(l);}
    const status=el('p',busy?'Checking FMFCD’s live service…':error?'Drainage detail unavailable. '+error:result?`Checked ${time(result.checked)} · within ${radius.toLocaleString()} m. Proximity only; hydraulic connection and operation unconfirmed.`:'County EOC sign-in required.');status.setAttribute('role','status');host.append(status);
    if(error)host.append(button('County sign-in',()=>document.getElementById('sign-in').click()));
    const failures=result?.layers.filter(l=>l.error)||[];
    for(const layer of failures){const notice=el('calcite-notice');notice.open=true;notice.kind='warning';notice.scale='s';notice.width='full';const title=el('span',layer.spec.name+' unavailable'),message=el('span',layer.error+' This category is unassessed.');title.slot='title';message.slot='message';notice.append(title,message);host.append(notice);}
    if(result){
      const rows=shownRows(),counts=Object.fromEntries(Object.keys(FMFCD_DETAIL_CATEGORIES).map(c=>[c,allRows().filter(r=>r.category===c).length]));
      renderConnections();
      const edited=result.layers.map(l=>l.sourceEdited).filter(Number.isFinite);
      host.append(el('p',`Latest publisher dataset edit ${edited.length?time(Math.max(...edited)):'not supplied'} · inventory context, not live telemetry.`));
      host.append(el('p',`${counts.mapped} mapped · ${counts.unknown} classification unconfirmed · ${planned?counts.planned+' proposed / design':'proposed / design hidden'}${failures.length?' · incomplete source coverage':''}`));
      const legend=el('details');legend.className='fmfcd-map-key';legend.append(el('summary','FMFCD map symbols'));
      for(const [kind,label]of [['pipe','Blue arrowed pipes / blue square inlets'],['master','Red: master-plan references'],['design','Light blue: design references'],['unknown','Dashed / hollow / gray: classification unconfirmed']]){const entry=el('div'),sample=el('span');entry.className='fmfcd-key-row';sample.className='fmfcd-key-swatch '+kind;sample.setAttribute('aria-hidden','true');entry.append(sample,el('span',label));legend.append(entry);}
      legend.append(el('p','Outfalls use FMFCD’s subtype symbols when supplied. Unclassified outfalls stay hollow gray. Light outlines improve dark-map visibility.'));host.append(legend);
      host.append(el('p','Blue arrows follow the mapped line orientation. Connection highlights are unverified candidates, not measured flow or a hydraulic simulation.'));
      if(result.styleError){const note=el('p',result.styleError);note.setAttribute('role','status');host.append(note);}
      for(const [kind,title]of [['pipe','Pipes'],['inlet','Inlets'],['outfall','Outfalls']]){
        const group=rows.filter(r=>r.kind===kind),block=el('details');block.open=group.some(r=>r.key===selectedKey);block.append(el('summary',`${title} · ${group.length} shown`));
        const ordered=selectedKey?[...group.filter(r=>r.key===selectedKey),...group.filter(r=>r.key!==selectedKey)]:group;
        for(const row of ordered.slice(0,20)){
          const item=el('details');item.className='drainage-nearby-row';item.dataset.detailKey=row.key;item.open=row.key===selectedKey;
          item.append(el('summary',`${row.name} · ${FMFCD_DETAIL_CATEGORIES[row.category].label}`));
          const connection=trace?.items.find(i=>i.row.key===row.key);item.append(el('p',connection?`${CONNECTION_GROUPS[connection.group].label} · unverified. ${connection.evidence}`:'No shared-vertex path found in the loaded records. This does not prove disconnection.'));
          const dl=el('dl');for(const [name,value]of Object.entries(row.attributes))dl.append(el('dt',name),el('dd',value===null?'Not supplied':String(value)));item.append(dl);
          item.append(el('p','Dimensions / elevation values are shown as published. Units and vertical datum require FMFCD confirmation.'),button('Locate drainage feature',()=>{selectedKey=row.key;onMap();void map?.focusDrainageNearby(row.key);}),link('FMFCD source layer',row.source));block.append(item);
        }
        if(group.length>20)block.append(el('p',`First 20 of ${group.length} shown; all matching features draw on the map. Select a map feature to inspect it here.`));
        host.append(block);
      }
      if(!rows.length)host.append(el('p','No features returned in this scope and display filter. This does not establish that drainage infrastructure is absent.'));
      const dates=el('details');dates.append(el('summary','Publisher dates and source'));
      for(const layer of result.layers)dates.append(el('p',`${layer.spec.name} · publisher dataset edited ${time(layer.sourceEdited)} · retrieved ${time(layer.checked)}${layer.error?' · failed':''}`));
      dates.append(el('p','A live query is not telemetry. Source pipe documentation describes general drawn flow direction; actual hydraulic direction, valves, capacity and connectivity still require FMFCD confirmation.'),link('Pipe direction documentation',FMFCD_DETAIL_URL+'/6'),link('Original FMFCD web map','https://www.arcgis.com/home/item.html?id=10e99caf452e482e9e471571f9969930'),link('FMFCD service',FMFCD_DETAIL_URL));host.append(dates);
    }
  }
  function renderConnections(){
    if(!trace)return;
    const section=el('section');section.className='drainage-connections';section.append(el('h3','Connections · unverified'));
    const label=el('calcite-label','Connection map view'),picker=el('calcite-select');picker.label='Connection map view';picker.scale='s';
    for(const [value,text]of [['connections','All candidate connections'],['upstream','Upstream candidates'],['downstream','Downstream candidates'],['unresolved','Uncertain direction / loops'],['nearby','Nearby assets · source symbols']]){const o=el('calcite-option',text);o.value=value;o.selected=value===connectionMode;picker.append(o);}picker.value=connectionMode;
    picker.addEventListener('calciteSelectChange',()=>{connectionMode=picker.value;draw();});label.append(picker);section.append(label);
    const message=trace.error||(!trace.seedCount?'No pipe starting vertex coincides with this pump or lies inside this basin outline. Nearby does not mean connected.':`${trace.items.filter(i=>i.row.kind==='pipe').length} candidate pipes · ${trace.items.filter(i=>i.row.kind==='inlet').length} inlets · ${trace.items.filter(i=>i.row.kind==='outfall').length} outfalls. No verified hydraulic links supplied.`);
    const status=el('p',message);status.setAttribute('role','status');section.append(status);
    if(trace.partial)section.append(el('p','Incomplete source coverage. Missing categories are unassessed; this is not a complete network.'));
    if(trace.manual)section.append(el('p',`Unverified starting link selected across an approximately ${trace.seedDistance.toFixed(1)} m gap. This gap is not a pipe record. Refresh resets this assumption.`),button('Use inventory location',()=>{start=null;rebuild();draw();render();}));
    if(!trace.seedCount&&!trace.error&&trace.starts.length){
      section.append(el('p','Possible pump starting points within 25 m. Approximate horizontal separation only; choose one solely to inspect an unverified link.'));
      for(const candidate of trace.starts){const row=allRows().find(r=>r.key===candidate.rowKey);section.append(button(`Trace from unverified start · ${row?.name||'pipe'} · ≈${candidate.meters.toFixed(1)} m gap`,()=>{start=candidate.id;rebuild();draw();render();}));}
    }
    if(trace.seedCount){
      const key=el('div');key.className='connection-key';
      for(const [id,group]of Object.entries(CONNECTION_GROUPS)){
        const summary=el('div'),sample=el('span');sample.className='connection-swatch';sample.style.color=group.color;sample.setAttribute('aria-hidden','true');summary.append(sample,el('span',`${group.label} · ${trace.counts[id]}`));key.append(summary);
      }section.append(key,el('p',`Review is limited to records loaded within ${radius.toLocaleString()} m; pipes can continue beyond this scope. Shared mapped vertices support candidates, not confirmed connections. Upstream/downstream uses FMFCD’s general-flow drawing convention when documented.`));
      const list=el('details');list.append(el('summary','Candidate records and connection evidence'));
      for(const item of trace.items.slice(0,30)){
        const row=el('div');row.className='connection-row';row.append(el('strong',item.row.name),el('span',`${CONNECTION_GROUPS[item.group].label} · unverified · ${FMFCD_DETAIL_CATEGORIES[item.row.category].label}`),el('small',item.evidence),button('Locate candidate '+item.row.name,()=>{selectedKey=item.row.key;onMap();void map?.focusDrainageNearby(item.row.key);render();}));list.append(row);
      }
      if(trace.items.length>30)list.append(el('p',`First 30 of ${trace.items.length} candidate records listed. All matching connection highlights draw; map selections open the full record below.`));section.append(list);
    }
    section.append(el('p',`${trace.error?'Connection counts are unassessed.':trace.unlinked+' other loaded records have no traced shared-vertex path.'} Proposed/design assets never participate. Crossing lines without a shared vertex stay unconnected; missing records do not establish safe capacity or disconnection.`));host.append(section);
  }
  window.addEventListener('frogDrainageNearbySelect',event=>{if(shownRows().some(r=>r.key===event.detail.key)){selectedKey=event.detail.key;render();host.querySelector('.drainage-nearby-row[open]')?.scrollIntoView({block:'nearest'});}});
  window.addEventListener('stormWorkspaceChange',clear);
  window.addEventListener('pagehide',()=>{session=null;clear();});
  setInterval(()=>{if(!document.hidden&&host?.isConnected&&!busy)void load();},300000);
  return {clear,clearIfWithin,setSession(value){session=value;clear();},setMap(value){map=value;draw();if(record)enable();},renderInto(parent,value){clear();radius=500;planned=false;unknown=true;connectionMode='connections';record=value;host=el('section');parent.append(host);render();enable();void load();},setInventory(snapshot){if(record&&(!snapshot.connected||!snapshot.rows.some(r=>r.key===record.key&&JSON.stringify(r.geometry)===JSON.stringify(record.geometry))))clear();}};
}
