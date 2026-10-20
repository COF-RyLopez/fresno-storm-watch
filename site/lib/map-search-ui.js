import {findMapEntries,geometryShardUrl,roadSearchEntries,facilitySearchEntries,gaugeSearchEntries,reservoirSearchEntries} from './map-search-model.js?v=0.31.0';
const $=id=>document.getElementById(id),el=(tag,text)=>{const n=document.createElement(tag);if(text)n.textContent=text;return n;};
const BASE=new URL('../data/search/v0.31.0/',import.meta.url);
const KIND={waterway:'Stream / canal',street:'County street reference','road-record':'Road status record',asset:'Loaded asset',gauge:'NWS gauge',reservoir:'Reservoir'};

/** Shared nonmodal search. No query is sent to a geocoder, source service or storage. */
export function createMapSearch({showMap=()=>{},fetchImpl=fetch}={}){
  let map=null,publicIndex=null,indexError=null,pending=null,generation=0,selected=null,selectionBusy=false,typingTimer;
  const groups=new Map(),groupSignatures=new Map(),shards=new Map(),panel=$('map-search-evidence'),input=$('map-search-input'),results=$('map-search-results'),status=$('map-search-status');
  const all=()=>[...(publicIndex?.entries??[]),...[...groups.values()].flat()];
  const date=value=>{const timestamp=Number.isFinite(value)?value:typeof value==='string'?Date.parse(value):NaN;return Number.isFinite(timestamp)?new Intl.DateTimeFormat('en-US',{year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short',timeZone:'America/Los_Angeles'}).format(timestamp):'Not supplied';};
  function clearSelection(message='Search highlight cleared.'){
    generation++;selected=null;selectionBusy=false;map?.clearSearchSelection();$('map-search-selection').replaceChildren();$('map-search-clear').disabled=true;$('search-selection-note').hidden=true;$('search-selection-label').textContent='';
    if(message)status.textContent=message;
  }
  function coverage(){
    const assets=groups.get('assets')?.length??0,roads=groups.get('roads')?.length??0;
    $('map-search-coverage').textContent=`${publicIndex?`${publicIndex.entries.length.toLocaleString()} named public references`:indexError?'Public reference index unavailable':'Public reference index loading'} · ${roads} returned road status records · ${assets} loaded assets. Search is independent of map extent and list filters. Private assets require sign-in and layer loading. Unnamed waterways, imagery and arbitrary basemap labels are not indexed.`;
    if(indexError)$('map-search-coverage').textContent+=` ${indexError}. Reopen search to retry.`;
  }
  function render(){
    const found=findMapEntries(all(),input.value,$('map-search-scope').value);results.replaceChildren();coverage();
    if(input.value.trim().length<2){status.textContent='Enter at least two characters, such as Kings River, Shaw Ave, a gauge ID or a loaded asset name.';return;}
    status.textContent=found.total?`${found.total} matches${found.total>found.rows.length?` · showing first ${found.rows.length}; refine your search`:''}. Select a result to highlight and zoom.`:publicIndex||[...groups.values()].some(rows=>rows.length)?'No matches in available search data. Missing sources and unloaded assets can leave gaps.':'Search sources are not available yet. Reopen to retry or load authorized assets.';
    if(selectionBusy)status.textContent='Loading and locating the selected feature…';
    else if(selected)status.textContent+=` Selected: ${selected.name}.`;
    for(const row of found.rows){
      const item=el('calcite-list-item');item.label=row.name;item.description=`${KIND[row.kind]??row.kind} · ${row.detail??`${row.segments} mapped segments`}`;item.setAttribute('value',row.key);item.addEventListener('click',()=>void select(row.key));
      item.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();event.stopPropagation();void select(row.key);}});
      results.append(item);
    }
  }
  async function loadIndex(){
    if(publicIndex||pending)return pending;
    pending=(async()=>{try{
      const response=await fetchImpl(new URL('index.json',BASE),{credentials:'omit',signal:AbortSignal.timeout(20_000)});if(!response.ok)throw new Error(`HTTP ${response.status}`);
      const data=await response.json();if(data.countyGeoid!=='06019'||!Array.isArray(data.entries))throw new Error('Unexpected reference index');publicIndex=data;indexError=null;
    }catch(error){indexError=error.message;}finally{pending=null;if(panel.hasAttribute('open'))render();}})();return pending;
  }
  async function geometry(row){
    if(row.geometry)return row.geometry;
    if(!row.shard)return null;
    const url=geometryShardUrl(row,BASE);let task=shards.get(url.href);
    if(!task){task=fetchImpl(url,{credentials:'omit',signal:AbortSignal.timeout(20_000)}).then(async response=>{if(!response.ok)throw new Error(`Geometry HTTP ${response.status}`);return response.json();});shards.set(url.href,task);task.catch(()=>shards.delete(url.href));}
    return (await task)[row.key]??null;
  }
  async function select(key){
    const row=all().find(entry=>entry.key===key);if(!row)return;
    clearSelection('Loading selected feature geometry…');selected=row;selectionBusy=true;const revision=generation;
    try{
      const shape=await geometry(row);if(revision!==generation||!all().some(entry=>entry.key===key))return;
      if(!shape){clearSelection('This record has no usable map geometry. Its location remains unknown.');return;}
      if(!map){clearSelection('Map is still initializing. Select the result again when the map is available.');return;}
      showMap();const located=await map.focusSearchSelection(shape);if(revision!==generation)return;
      if(!located){clearSelection('Map navigation was interrupted or unavailable. Select the result to retry.');return;}
      selectionBusy=false;
      const source=publicIndex?.sources?.[row.kind],detail=$('map-search-selection');
      detail.replaceChildren(el('h3',row.name),el('p',`${KIND[row.kind]} · ${row.detail??`${row.segments} source segments with this name`}`),el('p',row.reference||'Grouped mapped segments may be disconnected. This is reference geometry, not a route, current flow or proof of open access.'),el('p',`Source date / retrieval: ${date(row.sourceTime??source?.retrievedAt)}`));
      if(row.sourceUrl||source?.url){const a=el('a','Official source');a.href=row.sourceUrl||source.url;a.target='_blank';a.rel='noopener noreferrer';detail.append(a);}
      $('map-search-clear').disabled=false;$('search-selection-note').hidden=false;$('search-selection-label').textContent=`Search selection: ${row.name} · reference only`;
      status.textContent='Selection highlighted in magenta with a white outline. Use Clear highlight to remove it.';
    }catch(error){if(revision===generation)clearSelection(`Could not locate this result: ${error.message}. Select another result or retry.`);}
  }
  function setEntries(group,rows){
    const signature=JSON.stringify(rows);if(groupSignatures.get(group)===signature)return;
    const old=groups.get(group)??[];groups.set(group,rows);groupSignatures.set(group,signature);
    if(selected&&old.some(row=>row.key===selected.key)&&!rows.some(row=>row.key===selected.key))clearSelection('Selected record is no longer available in the loaded data. Search highlight and details cleared.');
    if(panel.hasAttribute('open'))render();
  }
  $('map-search-open').addEventListener('click',()=>{panel.setAttribute('open','');render();void loadIndex();void customElements.whenDefined('calcite-input').then(()=>input.setFocus());});
  input.addEventListener('calciteInputInput',()=>{clearTimeout(typingTimer);clearSelection('');typingTimer=setTimeout(render,180);});
  input.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();clearTimeout(typingTimer);render();}});
  $('map-search-scope').addEventListener('calciteSelectChange',()=>{clearSelection('');render();});
  $('map-search-clear').addEventListener('click',()=>clearSelection());$('search-clear-highlight').addEventListener('click',()=>clearSelection());
  panel.addEventListener('stormEvidenceClose',()=>{clearTimeout(typingTimer);if(selectionBusy)clearSelection('Pending map search cancelled.');});
  return {setMap(controller){map=controller;},setFacilities:data=>setEntries('assets',facilitySearchEntries(data)),setRoads:data=>setEntries('roads',roadSearchEntries(data)),setGauges:data=>setEntries('gauges',gaugeSearchEntries(data)),setReservoirs:data=>setEntries('reservoirs',reservoirSearchEntries(data)),clear:clearSelection};
}
