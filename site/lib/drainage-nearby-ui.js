import {EOC_CONFIG} from '../eoc-config.js';
import {formatTime} from './model.js';
import {openDrainageDetail} from './drainage-nearby-data.js?v=0.54.0';
import {FMFCD_DETAIL_URL,FMFCD_DETAIL_CATEGORIES} from './drainage-nearby-model.js?v=0.53.0';
import {DETAIL_KEYS} from './drainage-nearby-map.js?v=0.54.0';
const el=(tag,text='')=>{const n=document.createElement(tag);n.textContent=text;return n;};
const button=(label,fn)=>{const b=el('calcite-button',label);b.scale='s';b.appearance='outline';b.onclick=fn;return b;};
const link=(label,url)=>{const a=el('a',label);a.href=url;a.target='_blank';a.rel='noopener noreferrer';return a;};

/** One private supporting-evidence selection. No server copy, export, persistent cache or county-token forwarding. */
export function createDrainageNearby({timeZone,exercise=false,onMap=()=>{},config=EOC_CONFIG,open=openDrainageDetail}={}){
  let session=null,map=null,source=null,host=null,record=null,result=null,error=null,busy=false,generation=0;
  let radius=500,planned=false,unknown=true,selectedKey=null;
  const time=v=>Number.isFinite(v)?formatTime(v,timeZone):'Not supplied';
  const allRows=()=>result?.layers.flatMap(l=>l.rows)||[];
  const shownRows=()=>allRows().filter(r=>(planned||r.category!=='planned')&&(unknown||r.category!=='unknown'));
  function clear(){generation++;source?.close();source=null;host?.replaceChildren();host=null;record=null;result=null;error=null;busy=false;selectedKey=null;map?.clearDrainageNearby();}
  function draw(){map?.setDrainageNearby(shownRows(),Object.fromEntries((result?.layers||[]).map(l=>[l.spec.id,l.renderer])));}
  function enable(){for(const [category,key]of Object.entries(DETAIL_KEYS))map?.setLayerPreference(key,category==='mapped'||category==='planned'&&planned||category==='unknown'&&unknown);}
  function clearIfWithin(container){if(host&&container.contains(host))clear();}
  async function load(){
    if(exercise||!record||!host?.isConnected)return;
    const version=++generation,current=()=>generation===version&&!!host?.isConnected;
    source?.close();source=null;busy=true;error=null;result=null;map?.clearDrainageNearby();render();
    try{
      const opened=await open(config,session);
      if(!current()){opened.close();return;}source=opened;
      const next=await opened.read(record,{radius,planned});if(!current()||!next)return;
      result=next;draw();
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
      ['Show classification-unconfirmed records',unknown,value=>{unknown=value;draw();enable();render();}],
      ['Show proposed / design assets',planned,value=>{planned=value;enable();void load();}]
    ]){const l=el('calcite-label',text),box=el('calcite-checkbox');l.layout='inline';box.checked=checked;box.addEventListener('calciteCheckboxChange',()=>change(box.checked));l.prepend(box);host.append(l);}
    const status=el('p',busy?'Checking FMFCD’s live service…':error?'Drainage detail unavailable. '+error:result?`Checked ${time(result.checked)} · within ${radius.toLocaleString()} m. Proximity only; hydraulic connection and operation unconfirmed.`:'County EOC sign-in required.');status.setAttribute('role','status');host.append(status);
    if(error)host.append(button('County sign-in',()=>document.getElementById('sign-in').click()));
    const failures=result?.layers.filter(l=>l.error)||[];
    for(const layer of failures){const notice=el('calcite-notice');notice.open=true;notice.kind='warning';notice.scale='s';notice.width='full';const title=el('span',layer.spec.name+' unavailable'),message=el('span',layer.error+' This category is unassessed.');title.slot='title';message.slot='message';notice.append(title,message);host.append(notice);}
    if(result){
      const rows=shownRows(),counts=Object.fromEntries(Object.keys(FMFCD_DETAIL_CATEGORIES).map(c=>[c,allRows().filter(r=>r.category===c).length]));
      const edited=result.layers.map(l=>l.sourceEdited).filter(Number.isFinite);
      host.append(el('p',`Latest publisher dataset edit ${edited.length?time(Math.max(...edited)):'not supplied'} · inventory context, not live telemetry.`));
      host.append(el('p',`${counts.mapped} mapped · ${counts.unknown} classification unconfirmed · ${planned?counts.planned+' proposed / design':'proposed / design hidden'}${failures.length?' · incomplete source coverage':''}`));
      const legend=el('details');legend.className='fmfcd-map-key';legend.append(el('summary','FMFCD map symbols'));
      for(const [kind,label]of [['pipe','Blue arrowed pipes / blue square inlets'],['master','Red: master-plan references'],['design','Light blue: design references'],['unknown','Dashed / hollow / gray: classification unconfirmed']]){const entry=el('div'),sample=el('span');entry.className='fmfcd-key-row';sample.className='fmfcd-key-swatch '+kind;sample.setAttribute('aria-hidden','true');entry.append(sample,el('span',label));legend.append(entry);}
      legend.append(el('p','Outfalls use FMFCD’s subtype symbols when supplied. Unclassified outfalls stay hollow gray. Light outlines improve dark-map visibility.'));host.append(legend);
      host.append(el('p','Pipe arrows follow the mapped line orientation. They do not show measured flow or a verified hydraulic trace.'));
      if(result.styleError){const note=el('p',result.styleError);note.setAttribute('role','status');host.append(note);}
      for(const [kind,title]of [['pipe','Pipes'],['inlet','Inlets'],['outfall','Outfalls']]){
        const group=rows.filter(r=>r.kind===kind),block=el('details');block.open=group.some(r=>r.key===selectedKey);block.append(el('summary',`${title} · ${group.length} shown`));
        const ordered=selectedKey?[...group.filter(r=>r.key===selectedKey),...group.filter(r=>r.key!==selectedKey)]:group;
        for(const row of ordered.slice(0,20)){
          const item=el('details');item.className='drainage-nearby-row';item.dataset.detailKey=row.key;item.open=row.key===selectedKey;
          item.append(el('summary',`${row.name} · ${FMFCD_DETAIL_CATEGORIES[row.category].label}`));
          const dl=el('dl');for(const [name,value]of Object.entries(row.attributes))dl.append(el('dt',name),el('dd',value===null?'Not supplied':String(value)));item.append(dl);
          item.append(el('p','Dimensions / elevation values are shown as published. Units and vertical datum require FMFCD confirmation.'),button('Locate drainage feature',()=>{selectedKey=row.key;onMap();void map?.focusDrainageNearby(row.key);}),link('FMFCD source layer',row.source));block.append(item);
        }
        if(group.length>20)block.append(el('p',`First 20 of ${group.length} shown; all matching features draw on the map. Select a map feature to inspect it here.`));
        host.append(block);
      }
      if(!rows.length)host.append(el('p','No features returned in this scope and display filter. This does not establish that drainage infrastructure is absent.'));
      const dates=el('details');dates.append(el('summary','Publisher dates and source'));
      for(const layer of result.layers)dates.append(el('p',`${layer.spec.name} · publisher dataset edited ${time(layer.sourceEdited)} · retrieved ${time(layer.checked)}${layer.error?' · failed':''}`));
      dates.append(el('p','A live service query is not live telemetry. Dataset edit dates do not confirm field inspection or current capacity. No network trace, flow direction or available storage is inferred.'),link('Original FMFCD web map','https://www.arcgis.com/home/item.html?id=10e99caf452e482e9e471571f9969930'),link('FMFCD service',FMFCD_DETAIL_URL));host.append(dates);
    }
  }
  window.addEventListener('frogDrainageNearbySelect',event=>{if(shownRows().some(r=>r.key===event.detail.key)){selectedKey=event.detail.key;render();host.querySelector('.drainage-nearby-row[open]')?.scrollIntoView({block:'nearest'});}});
  window.addEventListener('stormWorkspaceChange',clear);
  window.addEventListener('pagehide',()=>{session=null;clear();});
  setInterval(()=>{if(!document.hidden&&host?.isConnected&&!busy)void load();},300000);
  return {clear,clearIfWithin,setSession(value){session=value;clear();},setMap(value){map=value;draw();if(record)enable();},renderInto(parent,value){clear();radius=500;planned=false;unknown=true;record=value;host=el('section');parent.append(host);render();enable();void load();},setInventory(snapshot){if(record&&(!snapshot.connected||!snapshot.rows.some(r=>r.key===record.key&&JSON.stringify(r.geometry)===JSON.stringify(record.geometry))))clear();}};
}
