import {WORKSPACES,workspaceRoute} from './workspace-model.js';
/** One active topic, independent map state, and no persisted operational data. */
export function createWorkspace({onCameraChange=()=>{},onActivate=()=>{},evidence=null}={}){
  const $=id=>document.getElementById(id),compact=matchMedia('(max-width:900px)'),dock=matchMedia('(min-width:1280px)');
  let section=workspaceRoute(location.href),mission=['scenarios','briefing'].includes(new URL(location.href).searchParams.get('mission'))?new URL(location.href).searchParams.get('mission'):'watch',panelOpen=!compact.matches,camerasOpen=false,map=null;
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
    // County Watch topics are visible tabs; Storm now, Planning and Briefing are their own missions.
    $('workspace-tabs').hidden=mission!=='watch'||section==='storm';
    $('scope-label').textContent=mission!=='watch'?'Fresno County · '+(mission==='scenarios'?'Planning':'Briefing'):section==='alerts'?'Fresno · Madera · Merced · Kings · Tulare':'Fresno County · '+WORKSPACES[section].title;
    mapLabels();
  }
  function setCameras(open){if(open)evidence?.close({restoreFocus:false});camerasOpen=!!open;cameraStates.set(section,camerasOpen);map?.setLayerPreference('cameras',camerasOpen);render();}
  function showPanel(name,{history:push=true}={}){
    name=name==='environment'?'weather':name;if(!WORKSPACES[name])return;
    const changed=name!==section||mission!=='watch';mission='watch';cameraStates.set(section,camerasOpen);section=name;panelOpen=true;
    if(changed){evidence?.close({restoreFocus:false});for(const id of ['map-search-evidence','river-dialog','power-dialog','facility-dialog','drainage-evidence','road-dialog','release-trend-dialog','alert-evidence','usgs-evidence','waze-evidence'])$(id)?.removeAttribute('open');for(const id of ['context-menu','map-tools-menu'])$(id).removeAttribute('open');camerasOpen=cameraStates.get(section)||false;}
    render();if(map)void map.setWorkspace(section);if(changed)onCameraChange(camerasOpen);onActivate(section);
    if(push){const u=new URL(location.href);u.searchParams.set('view',section);u.searchParams.delete('mission');u.searchParams.delete('trends');if(u.href!==location.href)window.history.pushState({},'',u);}
    window.dispatchEvent(new Event('stormWorkspaceChange'));
  }
  function showMap(){panelOpen=!compact.matches;render();}
  // County Watch topic tabs navigate on user clicks / Enter / Space only: Calcite's own activation events can
  // arrive late after a programmatic selection or a browser history change and must not re-navigate.
  for(const t of document.querySelectorAll('#workspace-tabs calcite-tab-title')){const go=()=>{if(t.dataset.workspace!==section)showPanel(t.dataset.workspace);};t.addEventListener('click',go);t.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' ')go();});}
  window.addEventListener('popstate',()=>{cameraStates.set(section,camerasOpen);section=workspaceRoute(location.href);camerasOpen=cameraStates.get(section)||false;mission=['scenarios','briefing'].includes(new URL(location.href).searchParams.get('mission'))?new URL(location.href).searchParams.get('mission'):'watch';evidence?.close({restoreFocus:false});render();if(map)void map.setWorkspace(section);onCameraChange(camerasOpen);onActivate(section);});
  $('workspace-list').addEventListener('click',()=>{panelOpen=true;render();});
  document.querySelectorAll('[data-show-map]').forEach(b=>b.addEventListener('click',showMap));
  $('camera-sheet').addEventListener('calciteSheetClose',()=>{if(!dock.matches&&!evidence?.isOpen&&camerasOpen){setCameras(false);onCameraChange(false);}});
  compact.addEventListener('change',()=>{if(evidence?.isOpen)panelOpen=!compact.matches;render();});dock.addEventListener('change',render);
  new ResizeObserver(mapLabels).observe($('map-panel'));
  render();
  return {setMission(id,{history:push=true}={}){if(!['watch','scenarios','briefing'].includes(id))return;mission=id;panelOpen=true;evidence?.close({restoreFocus:false});render();if(push){const u=new URL(location.href);if(id==='watch')u.searchParams.delete('mission');else u.searchParams.set('mission',id);if(u.href!==location.href)window.history.pushState({},'',u);}window.dispatchEvent(new Event('stormWorkspaceChange'));},get mission(){return mission;},showPanel,showMap,setCameras,refreshLayout:render,setMap(controller){map=controller;void map.setWorkspace(section);},get camerasOpen(){return camerasOpen;},get section(){return section;}};
}
