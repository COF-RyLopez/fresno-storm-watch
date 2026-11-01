import {sandbagSearchEntries} from './county-sandbag-model.js';
import {findMapEntries,geometryShardUrl,roadSearchEntries,facilitySearchEntries,gaugeSearchEntries,reservoirSearchEntries} from './map-search-model.js';
import {elIfText as el,link,disclosure} from './dom.js';
import {formatDateTime} from './model.js';
const $=id=>document.getElementById(id);
const BASE=new URL('../data/search/v0.31.0/',import.meta.url),WATERBODY_BASE=new URL('../data/search/waterbodies-v0.34.0/',import.meta.url);
const KIND={sandbag:'County sandbag site',waterbody:'Lake / reservoir outline',waterway:'Stream / canal',street:'County street reference','road-record':'Road status record',asset:'Loaded asset',gauge:'NWS gauge',reservoir:'Reservoir reporting point'};

/** Shared nonmodal search. No query is sent to a geocoder, source service or storage. */
export function createMapSearch({showMap=()=>{},fetchImpl=fetch,onInspect=()=>{}}={}){
  let map=null,publicIndex=null,indexError=null,waterbodyIndex=null,waterbodyError=null,pending=null,generation=0,selected=null,selectionBusy=false,typingTimer,selectedShape=null,nearbyRevision=0;
  const groups=new Map(),groupSignatures=new Map(),shards=new Map(),panel=$('map-search-evidence'),input=$('map-search-input'),results=$('map-search-results'),status=$('map-search-status');
  const nearbyHost=$('map-search-nearby'),nearbyList=$('map-search-nearby-list'),nearbyStatus=$('map-search-nearby-status'),nearbyDetail=$('map-search-nearby-detail'),quick=$('map-search-quick'),sourceNotes={gauges:'Gauge sources loading / not available',roads:'Road source loading / not available',assets:'No authorized assets loaded'};
  const all=()=>[...(publicIndex?.entries??[]),...(waterbodyIndex?.entries??[]),...[...groups.values()].flat()];
  const date=value=>{const timestamp=Number.isFinite(value)?value:typeof value==='string'?Date.parse(value):NaN;return Number.isFinite(timestamp)?formatDateTime(timestamp):'Not supplied';};
  function clearSelection(message='Search highlight cleared.'){
    nearbyRevision++;selectedShape=null;nearbyHost.hidden=true;nearbyList.replaceChildren();nearbyDetail.replaceChildren();nearbyStatus.textContent='';map?.setSearchContext?.([]);generation++;selected=null;selectionBusy=false;map?.clearSearchSelection();$('map-search-selection').replaceChildren();$('map-search-clear').disabled=true;$('search-selection-note').hidden=true;$('search-selection-label').textContent='';
    if(message)status.textContent=message;
  }
  function coverage(){
    const assets=groups.get('assets')?.length??0,roads=groups.get('roads')?.length??0;
    $('map-search-coverage').textContent=`${publicIndex?`${publicIndex.entries.length.toLocaleString()} stream / street references`:indexError?'Public reference index unavailable':'Public reference index loading'} · ${waterbodyIndex?waterbodyIndex.entries.length+' named lake / reservoir outlines':waterbodyError?'Lake outline index unavailable':'Lake outlines loading'} · ${roads} returned road status records · ${assets} loaded assets · ${groups.get('sandbags')?.length??0} county sandbag records. Search is independent of map extent and list filters. Private assets require sign-in and layer loading. Unnamed waterways / water bodies, imagery and arbitrary basemap labels are not indexed.`;
    if(waterbodyError)$('map-search-coverage').textContent+=` ${waterbodyError}. Reopen search to retry lake outlines.`;
    if(indexError)$('map-search-coverage').textContent+=` ${indexError}. Reopen search to retry.`;
  }
  function render(){
    const found=findMapEntries(all(),input.value,$('map-search-scope').value);results.replaceChildren();coverage();
    if(input.value.trim().length<2){status.textContent='Enter at least two characters, such as Millerton, Pine Flat Reservoir, Kings River, Shaw Ave, a gauge ID or a loaded asset name.';return;}
    status.textContent=found.total?`${found.total} matches${found.total>found.rows.length?` · showing first ${found.rows.length}; refine your search`:''}. Select a result to highlight and zoom.`:publicIndex||waterbodyIndex||[...groups.values()].some(rows=>rows.length)?'No matches in available search data. Missing sources and unloaded assets can leave gaps.':'Search sources are not available yet. Reopen to retry or load authorized assets.';
    if(selectionBusy)status.textContent='Loading and locating the selected feature…';
    else if(selected)status.textContent+=` Selected: ${selected.name}.`;
    for(const row of found.rows){
      const item=el('calcite-list-item');item.label=row.name;item.description=`${KIND[row.kind]??row.kind} · ${row.detail??`${row.segments} mapped segments`}`;if(row.kind==='reservoir'){const lake=waterbodyIndex?.entries.find(entry=>entry.stationId===row.key.slice('reservoir:'.length));if(lake)item.description=`Reservoir reporting point · Select to show the full ${lake.name} outline`;}item.setAttribute('value',row.key);item.addEventListener('click',()=>void select(row.key));
      item.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();event.stopPropagation();void select(row.key);}});
      results.append(item);
    }
  }
  async function loadIndex(){
    if(pending||publicIndex&&waterbodyIndex)return pending;
    async function load(base,waterbody){
      if(waterbody?waterbodyIndex:publicIndex)return;
      try{
        const response=await fetchImpl(new URL('index.json',base),{credentials:'omit',signal:AbortSignal.timeout(20_000)});if(!response.ok)throw new Error(`HTTP ${response.status}`);
        const data=await response.json();if(data.countyGeoid!=='06019'||!Array.isArray(data.entries)||waterbody&&data.entries.some(row=>row.kind!=='waterbody'))throw new Error('Unexpected reference index');
        if(waterbody){waterbodyIndex=data;waterbodyError=null;}else{publicIndex=data;indexError=null;}
      }catch(error){if(waterbody)waterbodyError=error.message;else indexError=error.message;}
      finally{if(panel.hasAttribute('open'))render();}
    }
    pending=Promise.all([load(BASE,false),load(WATERBODY_BASE,true)]).finally(()=>{pending=null;});return pending;
  }
  async function geometry(row){
    if(row.geometry)return row.geometry;
    if(!row.shard)return null;
    const url=geometryShardUrl(row,row.kind==='waterbody'?WATERBODY_BASE:BASE);let task=shards.get(url.href);
    if(!task){task=fetchImpl(url,{credentials:'omit',signal:AbortSignal.timeout(20_000)}).then(async response=>{if(!response.ok)throw new Error(`Geometry HTTP ${response.status}`);return response.json();});shards.set(url.href,task);task.catch(()=>shards.delete(url.href));}
    return (await task)[row.key]??null;
  }
  async function select(key){
    let row=all().find(entry=>entry.key===key);if(!row)return;
    if(row.kind==='sandbag'){clearSelection('Opening county sandbag evidence…');onInspect(row);return;}
    if(row.kind==='reservoir'&&!waterbodyIndex){clearSelection('Loading lake outlines for the selected reservoir…');selectionBusy=true;const request=generation;await loadIndex();if(request!==generation)return;}
    const outline=row.kind==='reservoir'?waterbodyIndex?.entries.find(entry=>entry.stationId===row.key.slice('reservoir:'.length)):null;
    if(outline){row=outline;key=row.key;}
    clearSelection('Loading selected feature geometry…');selected=row;selectionBusy=true;const revision=generation;
    try{
      const shape=await geometry(row);if(revision!==generation||!all().some(entry=>entry.key===key))return;
      if(!shape){clearSelection('This record has no usable map geometry. Its location remains unknown.');return;}
      if(!map){clearSelection('Map is still initializing. Select the result again when the map is available.');return;}
      $('search-selection-note').hidden=false;$('search-selection-label').textContent=`Search selection: ${row.name} · reference only`;
      showMap();const located=await map.focusSearchSelection(shape);if(revision!==generation)return;
      if(!located){clearSelection('Map navigation was interrupted or unavailable. Select the result to retry.');return;}
      selectionBusy=false;selectedShape=shape;
      const source=(row.kind==='waterbody'?waterbodyIndex:publicIndex)?.sources?.[row.kind],detail=$('map-search-selection');
      const reference=disclosure('Selected reference & source');reference.append(el('p',row.reference||'Grouped mapped segments may be disconnected. This is reference geometry, not a route, current flow or proof of open access.'),el('p',`Source date / retrieval: ${date(row.sourceTime??source?.retrievedAt)}`));
      detail.replaceChildren(el('h3',row.name),el('p',`${KIND[row.kind]} · ${row.detail??`${row.segments} source segments with this name`}`),reference);
      if(row.kind==='waterbody'){const fit=el('calcite-button','Fit full lake outline');fit.setAttribute('scale','s');fit.addEventListener('click',()=>void select(row.key));detail.append(fit);if(outline)reference.append(el('p','Showing the complete lake outline associated with the selected reservoir reporting site.'));}
      if(row.kind==='reservoir')detail.append(el('p','Full lake outline unavailable. This result is a reporting point only; reopen search to retry the lake index.'));
      if(row.sourceUrl||source?.url)reference.append(link('Official source',row.sourceUrl||source.url));
      $('map-search-clear').disabled=false;$('search-selection-note').hidden=false;$('search-selection-label').textContent=`Search selection: ${row.name} · reference only`;
      status.textContent='Selection highlighted in magenta with a white outline. Use Clear highlight to remove it.';void renderNearby();
    }catch(error){if(revision===generation)clearSelection(`Could not locate this result: ${error.message}. Select another result or retry.`);}
  }
  async function renderNearby(){
    const revision=++nearbyRevision,shape=selectedShape;
    nearbyList.replaceChildren();nearbyDetail.replaceChildren();map?.setSearchContext?.([]);
    nearbyHost.hidden=!shape||!['waterbody','waterway','street','road-record'].includes(selected?.kind);
    if(nearbyHost.hidden)return;
    const current=()=>revision===nearbyRevision&&shape===selectedShape;
    nearbyStatus.textContent='Checking loaded planning references…';
    try{
      if(!map?.findNearbySearch)throw new Error('Map proximity tools are not ready');
      const miles=Number($('map-search-radius').value||2),history=!!$('map-search-history').checked;
      const found=await map.findNearbySearch(shape,[...groups.values()].flat(),{miles,history,current});
      if(!found||!current())return;
      const shown=Object.values(found).flatMap(group=>group.rows);map.setSearchContext(shown);
      nearbyStatus.textContent=`${selected.kind==='waterbody'?'Approximate horizontal lake vicinity. ':''}Within ${miles} miles of ${selected.kind==='waterbody'?'the full mapped footprint (including its interior) of':'all mapped parts of'} ${selected.name}. ${shown.length} references shown in cyan; counts below include all matches. No match does not establish safe conditions. Rechecked ${date(Date.now())}.`;
      for(const [kind,title,groupName]of [['gauge','Gauges','gauges'],['road-record','Closure / detour records','roads'],['asset','Loaded county assets','assets']]){
        const group=found[kind],heading=el('h4',`${title} · ${group.total} nearby`),note=el('p',`${sourceNotes[groupName]}. ${group.available} available records${group.historyExcluded?`; ${group.historyExcluded} explicitly inactive records excluded`:''}${group.unknown?`; ${group.unknown} locations / distances unknown`:''}${group.total>group.rows.length?`; showing nearest ${group.rows.length}`:''}.`);
        nearbyList.append(heading,note);
        if(!group.total)nearbyList.append(el('p','No nearby matches in available records. Coverage may be incomplete.'));
        const list=el('calcite-list');list.setAttribute('label',`Nearby ${title}`);list.setAttribute('selection-mode','single');
        for(const row of group.rows){
          const item=el('calcite-list-item');item.label=row.name;item.description=`${selected.kind==='waterbody'&&row.distanceMeters===0?'Intersects reference footprint':row.distanceMeters>0&&row.distanceMeters<160.9344?'<0.1 mi':(row.distanceMeters/1609.344).toFixed(1)+' mi'} · ${row.detail}`;
          const inspect=()=>{if(!current())return;nearbyDetail.replaceChildren(el('h4',row.name),el('p',row.detail),el('p',`Source observation / update: ${date(row.sourceTime)}`),el('p',row.reference));
            if(row.kind==='road-record')nearbyDetail.append(el('p',`Source active flag: ${row.active||'Not supplied'} · Start: ${date(row.start)} · End: ${date(row.end)}. An elapsed end date does not confirm reopening.`));
            const locate=el('calcite-button','Locate nearby reference');locate.setAttribute('scale','s');locate.addEventListener('click',()=>{if(current())void map.focusSearchContext(row.key).then(ok=>{if(current()&&!ok)nearbyDetail.append(el('p','Map navigation was interrupted; select Locate to retry.'));});});nearbyDetail.append(locate);
            if(row.sourceUrl)nearbyDetail.append(el('p'),link('Official source / evidence',row.sourceUrl));
            const open=el('calcite-button','Open full workspace evidence');open.setAttribute('appearance','outline');open.setAttribute('scale','s');open.addEventListener('click',()=>{if(current())onInspect(row);});nearbyDetail.append(el('p'),open);
          };
          item.addEventListener('click',inspect);item.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();event.stopPropagation();inspect();}});list.append(item);
        }
        nearbyList.append(list);
      }
    }catch(error){if(current())nearbyStatus.textContent=`Nearby references unavailable: ${error.message}. Missing results do not establish safe conditions. Change the distance or select the feature again to retry.`;}
  }
  function setEntries(group,rows){
    const signature=JSON.stringify([rows,sourceNotes[group]]);if(groupSignatures.get(group)===signature)return;
    const old=groups.get(group)??[];groups.set(group,rows);groupSignatures.set(group,signature);
    if(selected&&old.some(row=>row.key===selected.key)&&JSON.stringify(old.find(row=>row.key===selected.key))!==JSON.stringify(rows.find(row=>row.key===selected.key)))clearSelection('Selected record changed or is no longer available. Search highlight and details cleared; select its updated record again.');
    if(selectedShape)void renderNearby();
    if(panel.hasAttribute('open'))render();
  }
  function openSearch(fromQuick=false){
    if(fromQuick){input.value=quick.value;clearSelection('');}
    showMap();panel.setAttribute('open','');render();void loadIndex();void customElements.whenDefined('calcite-input').then(()=>input.setFocus());
  }
  $('map-search-open').addEventListener('click',()=>openSearch());
  $('map-search-submit').addEventListener('click',()=>openSearch(true));
  quick.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();openSearch(true);}});
  $('map-search-radius').addEventListener('calciteSelectChange',()=>void renderNearby());
  $('map-search-history').addEventListener('calciteCheckboxChange',()=>void renderNearby());
  input.addEventListener('calciteInputInput',()=>{clearTimeout(typingTimer);quick.value=input.value;clearSelection('');typingTimer=setTimeout(render,180);});
  input.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();clearTimeout(typingTimer);render();}});
  $('map-search-scope').addEventListener('calciteSelectChange',()=>{clearSelection('');render();});
  $('map-search-clear').addEventListener('click',()=>clearSelection());$('search-clear-highlight').addEventListener('click',()=>clearSelection());
  panel.addEventListener('stormEvidenceClose',()=>{clearTimeout(typingTimer);if(selectionBusy)clearSelection('Pending map search cancelled.');});
  return {setSandbags:data=>setEntries('sandbags',sandbagSearchEntries(data)),setMap(controller){map=controller;},setFacilities(data){sourceNotes.assets=data?.sites?.length?'Authorized inventory loaded; readiness requires verification':'No authorized assets loaded; sign in and load county layers in Power / PSPS';setEntries('assets',facilitySearchEntries(data));},setRoads(data){sourceNotes.roads=data?.exercise?'Exercise mode; live road records disabled':data?.error?'Road feed failed; retained records require verification':data?.snapshot?`County road feed checked ${date(data.snapshot.checked)}; dates and active flags require review`:'Road source unavailable';setEntries('roads',roadSearchEntries(data));},setGauges(data){sourceNotes.gauges='Configured NWS watchpoints only; open gauge evidence to verify freshness and forecast';setEntries('gauges',gaugeSearchEntries(data));},setReservoirs:data=>setEntries('reservoirs',reservoirSearchEntries(data)),clear:clearSelection};
}
