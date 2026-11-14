import {watchExploreRoute} from './county-watch-focus.js';
import {WORKSPACES,workspaceRoute} from './workspace-model.js';
/** One active topic, independent map state, and no persisted operational data. */
export function createWorkspace({onCameraChange=()=>{},onActivate=()=>{},evidence=null}={}){
  const $=id=>document.getElementById(id),compact=matchMedia('(max-width:900px)'),dock=matchMedia('(min-width:1280px)');
  let section=workspaceRoute(location.href),mission=['scenarios','briefing'].includes(new URL(location.href).searchParams.get('mission'))?new URL(location.href).searchParams.get('mission'):'watch',panelOpen=section==='watch'||!compact.matches,camerasOpen=false,map=null;
  let explore=watchExploreRoute(location.href),selectedConcern=null,phonePane='map';
  const cameraStates=new Map(),cameraPanel=$('camera-panel');
  function mapLabels(){
    const narrow=compact.matches||$('map-panel').getBoundingClientRect().width<520;
    // Narrow maps show the toolbar as icons; each action's text stays its accessible name.
    for(const a of document.querySelectorAll('.map-action-bar calcite-action'))a.textEnabled=!narrow;
  }
  function render(){
    const nav=document.querySelector('.mission-nav'),navHost=compact.matches?$('mobile-mission-nav'):$('command-navigation');if(nav.parentElement!==navHost)navHost.append(nav);
    const actionHost=$('header-tools-host');if($('header-actions').parentElement!==actionHost)actionHost.append($('header-actions'));
    for(const [id,p] of Object.entries(WORKSPACES))$(p.panel).hidden=mission!=='watch'||id!==section;
    $('scenarios-panel').hidden=mission!=='scenarios';$('mission-briefing-panel').hidden=mission!=='briefing';
    for(const id of ['river-metrics','weather-metrics','weather-footer'])$(id).hidden=false;
    $('weather-banner-wrap').hidden=false;
    $('tools-shell').toggleAttribute('collapsed',compact.matches&&!panelOpen);
    const covered=compact.matches&&panelOpen;$('planning-workspace').classList.toggle('map-covered',covered);$('planning-workspace').inert=covered;
    $('workspace-list').hidden=!compact.matches;
    if(evidence?.isOpen){$('camera-sheet').removeAttribute('open');$('camera-shell').hidden=true;}
    else if(dock.matches){$('camera-sheet').removeAttribute('open');if(cameraPanel.parentElement!==$('camera-shell'))$('camera-shell').append(cameraPanel);$('camera-shell').hidden=!camerasOpen;}
    else{$('camera-shell').hidden=true;if(cameraPanel.parentElement!==$('camera-sheet-host'))$('camera-sheet-host').append(cameraPanel);$('camera-sheet').toggleAttribute('open',camerasOpen);}
    evidence?.layout();
    for(const title of document.querySelectorAll('[data-workspace]')){title.selected=title.dataset.workspace===section;title.toggleAttribute('selected',title.selected);}
    for(const tab of document.querySelectorAll('#workspace-tabs > calcite-tab'))tab.selected=tab.getAttribute('tab')===section;
    $('storm-shell').dataset.workspace=section;$('storm-shell').dataset.destination=mission;
    // Topic tabs and specialist controls appear only during deliberate map exploration.
    const phoneWatch=compact.matches&&mission==='watch'&&section==='watch';
    const pane=panelOpen?'attention':phonePane==='evidence'&&evidence?.isOpen?'evidence':'map';
    $('storm-shell').dataset.watchPane=phoneWatch?pane:'desktop';
    $('watch-phone-nav').hidden=!phoneWatch;
    for(const id of ['attention','map','evidence'])$('watch-phone-'+id).setAttribute('aria-pressed',String(pane===id));
    $('watch-phone-evidence').disabled=!evidence?.isOpen;
    $('watch-phone-evidence').title=evidence?.isOpen?'Return to the selected evidence':'Select a concern to open its evidence';
    $('map-panel').inert=phoneWatch&&pane!=='map';
    $('evidence-mobile-host').inert=phoneWatch&&pane!=='evidence';
    const focused=mission==='watch'&&section==='watch'&&!explore;
    $('storm-shell').dataset.watchFocus=String(focused);
    $('workspace-tabs').hidden=mission!=='watch'||section==='storm'||focused;
    $('watch-map-heading').hidden=mission!=='watch'||section!=='watch';
    $('watch-map-title').textContent=selectedConcern?.name||'Choose a concern to focus the map';
    $('watch-map-explore').textContent=explore?'Return to focused view':'Explore map';
    $('watch-map-explore').setAttribute('aria-expanded',String(explore));
    $('watch-map-explore').setAttribute('aria-controls','workspace-tabs map-toolbar-controls');
    map?.setWatchContext?.({explore,selected:selectedConcern});
    $('scope-label').textContent=mission!=='watch'?'Fresno County · '+(mission==='scenarios'?'Planning':'Briefing'):section==='alerts'?'Fresno · Madera · Merced · Kings · Tulare':'Fresno County · '+WORKSPACES[section].title;
    mapLabels();
  }
  function setExplore(value){explore=!!value;render();}
  function selectConcern(item){selectedConcern=item;explore=false;for(const id of ['context-menu','map-tools-menu'])$(id).removeAttribute('open');render();}
  function setCameras(open){if(open)evidence?.close({restoreFocus:false});camerasOpen=!!open;cameraStates.set(section,camerasOpen);map?.setLayerPreference('cameras',camerasOpen);render();}
  function showPanel(name,{history:push=true}={}){
    name=name==='environment'?'weather':name;if(!WORKSPACES[name])return;
    const changed=name!==section||mission!=='watch';mission='watch';cameraStates.set(section,camerasOpen);section=name;panelOpen=true;if(name==='watch'&&push)explore=false;
    if(changed){selectedConcern=null;explore=false;evidence?.close({restoreFocus:false});for(const id of ['map-search-evidence','river-dialog','power-dialog','facility-dialog','drainage-evidence','road-dialog','release-trend-dialog','alert-evidence','usgs-evidence','waze-evidence'])$(id)?.removeAttribute('open');for(const id of ['context-menu','map-tools-menu'])$(id).removeAttribute('open');camerasOpen=cameraStates.get(section)||false;}
    render();if(map)void map.setWorkspace(section);if(changed)onCameraChange(camerasOpen);onActivate(section);
    if(push){const u=new URL(location.href);u.searchParams.set('view',section);u.searchParams.delete('mission');u.searchParams.delete('trends');if(u.href!==location.href)window.history.pushState({},'',u);}
    window.dispatchEvent(new Event('stormWorkspaceChange'));
  }
  function showMap(){panelOpen=!compact.matches;phonePane=evidence?.isOpen?'evidence':'map';render();}
  function showFocusedMap(){panelOpen=!compact.matches;phonePane='map';render();}
  function showWatchPane(pane){if(pane==='evidence'&&!evidence?.isOpen)return;panelOpen=pane==='attention';phonePane=pane;render();}
  function evidenceChanged(open){if(open){panelOpen=!compact.matches;phonePane='evidence';}else if(phonePane==='evidence'){phonePane='map';}render();}
  // County Watch topic tabs navigate on user clicks / Enter / Space only: Calcite's own activation events can
  // arrive late after a programmatic selection or a browser history change and must not re-navigate.
  for(const t of document.querySelectorAll('#workspace-tabs calcite-tab-title')){const go=()=>{if(t.dataset.workspace!==section)showPanel(t.dataset.workspace);};t.addEventListener('click',go);t.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' ')go();});}
  window.addEventListener('popstate',()=>{cameraStates.set(section,camerasOpen);selectedConcern=null;explore=watchExploreRoute(location.href);section=workspaceRoute(location.href);camerasOpen=cameraStates.get(section)||false;mission=['scenarios','briefing'].includes(new URL(location.href).searchParams.get('mission'))?new URL(location.href).searchParams.get('mission'):'watch';evidence?.close({restoreFocus:false});render();if(map)void map.setWorkspace(section);onCameraChange(camerasOpen);onActivate(section);});
  for(const pane of ['attention','map','evidence'])$('watch-phone-'+pane).addEventListener('click',()=>showWatchPane(pane));
  $('watch-reference').open=watchExploreRoute(location.href);
  $('watch-map-explore').addEventListener('click',()=>setExplore(!explore));
  $('watch-attention-list').addEventListener('click',()=>{panelOpen=true;render();});
  $('watch-reference').addEventListener('click',e=>{if(e.target.closest?.('calcite-button,calcite-link,a'))setExplore(true);});
  $('workspace-list').addEventListener('click',()=>{panelOpen=true;render();});
  document.querySelectorAll('[data-show-map]').forEach(b=>b.addEventListener('click',showFocusedMap));
  $('camera-sheet').addEventListener('calciteSheetClose',()=>{if(!dock.matches&&!evidence?.isOpen&&camerasOpen){setCameras(false);onCameraChange(false);}});
  compact.addEventListener('change',()=>{if(evidence?.isOpen)panelOpen=!compact.matches;render();});dock.addEventListener('change',render);
  new ResizeObserver(mapLabels).observe($('map-panel'));
  render();
  return {showFocusedMap,evidenceChanged,setExplore,selectConcern,clearConcern(){selectedConcern=null;render();},get explore(){return explore;},setMission(id,{history:push=true}={}){if(!['watch','scenarios','briefing'].includes(id))return;mission=id;panelOpen=true;evidence?.close({restoreFocus:false});render();if(push){const u=new URL(location.href);if(id==='watch')u.searchParams.delete('mission');else u.searchParams.set('mission',id);if(u.href!==location.href)window.history.pushState({},'',u);}window.dispatchEvent(new Event('stormWorkspaceChange'));},get mission(){return mission;},showPanel,showMap,setCameras,refreshLayout:render,setMap(controller){map=controller;map.setWatchContext?.({explore,selected:selectedConcern});void map.setWorkspace(section);},get camerasOpen(){return camerasOpen;},get section(){return section;}};
}
