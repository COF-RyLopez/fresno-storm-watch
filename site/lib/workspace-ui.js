import {WORKSPACES,workspaceRoute} from './workspace-model.js?v=0.57.0';
/** One active topic, independent map state, and no persisted operational data. */
export function createWorkspace({onCameraChange=()=>{},onActivate=()=>{},evidence=null}={}){
  const $=id=>document.getElementById(id),compact=matchMedia('(max-width:900px)'),dock=matchMedia('(min-width:1280px)');
  let section=workspaceRoute(location.href),mission=['scenarios','briefing'].includes(new URL(location.href).searchParams.get('mission'))?new URL(location.href).searchParams.get('mission'):'watch',panelOpen=!compact.matches,camerasOpen=false,map=null;
  const cameraStates=new Map(),cameraPanel=$('camera-panel');
  function mapLabels(){
    const narrow=compact.matches||$('map-panel').getBoundingClientRect().width<520;
    $('fit-region').setAttribute('text',narrow?'Fit':'Fit workspace');
    for(const [id,short,long]of [['map-search-open','Results','Search results'],['context-open','Layers','Context layers'],['map-tools-open','Map tools','Map tools']])$(id).setAttribute('text',narrow?short:long);
    if(!$('map-panel').classList.contains('map-expanded'))$('expand-map').setAttribute('text',narrow?'Expand':'Expand map');
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
    $('storm-shell').dataset.workspace=section;$('storm-shell').dataset.destination=mission;$('workspace-tabs').hidden=true;
    $('map-panel').setAttribute('heading',mission==='scenarios'?'Hypothetical scenario map':mission==='briefing'?'Briefing map':WORKSPACES[section].title+' map');$('scope-note').textContent=mission==='scenarios'?'Hypothetical model/library domain · independent scenario clock':mission==='briefing'?'Captured evidence · verify source timing and access':WORKSPACES[section].description;
    $('scope-label').textContent=mission!=='watch'?'Fresno County · '+(mission==='scenarios'?'Planning':'Briefing & Handoff'):section==='alerts'?'Fresno · Madera · Merced · Kings · Tulare':'Fresno County · '+WORKSPACES[section].title;
    mapLabels();
  }
  function setCameras(open){if(open)evidence?.close({restoreFocus:false});camerasOpen=!!open;cameraStates.set(section,camerasOpen);map?.setLayerPreference('cameras',camerasOpen);render();}
  function showPanel(name,{history:push=true}={}){
    name=name==='environment'?'weather':name;if(!WORKSPACES[name])return;
    mission='watch';const changed=name!==section;cameraStates.set(section,camerasOpen);section=name;panelOpen=true;
    if(changed){for(const id of ['map-search-evidence','river-dialog','power-dialog','facility-dialog','drainage-evidence','road-dialog','release-trend-dialog','alert-evidence'])$(id)?.removeAttribute('open');for(const id of ['context-menu','map-tools-menu'])$(id).removeAttribute('open');camerasOpen=cameraStates.get(section)||false;}
    render();if(map)void map.setWorkspace(section);if(changed)onCameraChange(camerasOpen);onActivate(section);
    if(push){const u=new URL(location.href);u.searchParams.set('view',section);u.searchParams.delete('mission');u.searchParams.delete('trends');if(u.href!==location.href)window.history.pushState({},'',u);}
    window.dispatchEvent(new Event('stormWorkspaceChange'));
  }
  function showMap(){panelOpen=!compact.matches;render();}
  // Legacy tab elements remain hidden for compatibility. Their asynchronous activation
  // events must not re-navigate after a topic-menu choice or a browser history change.
  window.addEventListener('popstate',()=>{cameraStates.set(section,camerasOpen);section=workspaceRoute(location.href);camerasOpen=cameraStates.get(section)||false;mission=['scenarios','briefing'].includes(new URL(location.href).searchParams.get('mission'))?new URL(location.href).searchParams.get('mission'):'watch';evidence?.close({restoreFocus:false});render();if(map)void map.setWorkspace(section);onCameraChange(camerasOpen);onActivate(section);});
  $('workspace-list').addEventListener('click',()=>{panelOpen=true;render();});
  $('view-map').addEventListener('click',showMap);
  $('view-cameras').addEventListener('click',()=>onCameraChange(!camerasOpen));
  document.querySelectorAll('[data-show-map]').forEach(b=>b.addEventListener('click',showMap));
  $('camera-sheet').addEventListener('calciteSheetClose',()=>{if(!dock.matches&&!evidence?.isOpen&&camerasOpen){setCameras(false);onCameraChange(false);}});
  compact.addEventListener('change',()=>{if(evidence?.isOpen)panelOpen=!compact.matches;render();});dock.addEventListener('change',render);
  new ResizeObserver(mapLabels).observe($('map-panel'));
  render();
  return {setMission(id,{history:push=true}={}){if(!['watch','scenarios','briefing'].includes(id))return;mission=id;panelOpen=true;evidence?.close({restoreFocus:false});render();if(push){const u=new URL(location.href);if(id==='watch')u.searchParams.delete('mission');else u.searchParams.set('mission',id);if(u.href!==location.href)window.history.pushState({},'',u);}window.dispatchEvent(new Event('stormWorkspaceChange'));},get mission(){return mission;},showPanel,showMap,setCameras,refreshLayout:render,setMap(controller){map=controller;void map.setWorkspace(section);},get camerasOpen(){return camerasOpen;},get section(){return section;}};
}
