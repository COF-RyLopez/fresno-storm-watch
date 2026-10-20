import {WORKSPACES,workspaceRoute} from './workspace-model.js?v=0.29.0';
/** One active topic, independent map state, and no persisted operational data. */
export function createWorkspace({onCameraChange=()=>{},onActivate=()=>{},evidence=null}={}){
  const $=id=>document.getElementById(id),compact=matchMedia('(max-width:900px)'),dock=matchMedia('(min-width:1280px)');
  let section=workspaceRoute(location.href),panelOpen=true,camerasOpen=false,map=null,syncing=false;
  const cameraStates=new Map(),cameraPanel=$('camera-panel');
  function mapLabels(){
    const narrow=compact.matches||$('map-panel').getBoundingClientRect().width<520;
    $('fit-region').setAttribute('text',narrow?'Fit':'Fit workspace');
    if(!$('map-panel').classList.contains('map-expanded'))$('expand-map').setAttribute('text',narrow?'Expand':'Expand map');
  }
  function render(){
    const actionHost=compact.matches?$('header-tools-host'):$('header-actions-host');if($('header-actions').parentElement!==actionHost)actionHost.append($('header-actions'));if(!compact.matches)$('header-tools-menu').removeAttribute('open');
    for(const [id,p] of Object.entries(WORKSPACES))$(p.panel).hidden=id!==section;
    for(const id of ['river-metrics','weather-metrics','weather-footer'])$(id).hidden=false;
    $('weather-banner-wrap').hidden=false;
    $('tools-shell').toggleAttribute('collapsed',compact.matches&&!panelOpen);
    const covered=compact.matches&&panelOpen;$('planning-workspace').classList.toggle('map-covered',covered);$('planning-workspace').inert=covered;
    $('workspace-list').hidden=!compact.matches;
    if(evidence?.isOpen){$('camera-sheet').removeAttribute('open');$('camera-shell').hidden=true;}
    else if(dock.matches){$('camera-sheet').removeAttribute('open');if(cameraPanel.parentElement!==$('camera-shell'))$('camera-shell').append(cameraPanel);$('camera-shell').hidden=!camerasOpen;}
    else{$('camera-shell').hidden=true;if(cameraPanel.parentElement!==$('camera-sheet-host'))$('camera-sheet-host').append(cameraPanel);$('camera-sheet').toggleAttribute('open',camerasOpen);}
    evidence?.layout();
    syncing=true;
    for(const title of document.querySelectorAll('[data-workspace]')){title.selected=title.dataset.workspace===section;title.toggleAttribute('selected',title.selected);}
    for(const tab of document.querySelectorAll('#workspace-tabs > calcite-tab'))tab.selected=tab.getAttribute('tab')===section;
    syncing=false;
    $('storm-shell').dataset.workspace=section;
    $('map-panel').setAttribute('heading',WORKSPACES[section].title+' map');$('scope-note').textContent=WORKSPACES[section].description;
    $('scope-label').textContent=section==='alerts'?'Fresno · Madera · Merced · Kings · Tulare':'Fresno County · '+WORKSPACES[section].title;
    mapLabels();
  }
  function setCameras(open){if(open)evidence?.close({restoreFocus:false});camerasOpen=!!open;cameraStates.set(section,camerasOpen);map?.setLayerPreference('cameras',camerasOpen);render();}
  function showPanel(name,{history:push=true}={}){
    name=name==='environment'?'weather':name;if(!WORKSPACES[name])return;
    const changed=name!==section;cameraStates.set(section,camerasOpen);section=name;panelOpen=true;
    if(changed){for(const id of ['river-dialog','power-dialog','facility-dialog','road-dialog','release-trend-dialog','alert-evidence'])$(id)?.removeAttribute('open');for(const id of ['context-menu','map-tools-menu'])$(id).removeAttribute('open');camerasOpen=cameraStates.get(section)||false;}
    render();if(map)void map.setWorkspace(section);if(changed)onCameraChange(camerasOpen);onActivate(section);
    if(push){const u=new URL(location.href);u.searchParams.set('view',section);u.searchParams.delete('trends');if(u.href!==location.href)window.history.pushState({},'',u);}
  }
  function showMap(){panelOpen=!compact.matches;render();}
  $('workspace-tabs').addEventListener('calciteTabsActivate',e=>{const id=e.target.dataset.workspace;if(!syncing&&id&&id!==section)showPanel(id);});
  for(const title of document.querySelectorAll('[data-workspace]'))title.addEventListener('click',()=>{if(title.dataset.workspace!==section)showPanel(title.dataset.workspace);});
  window.addEventListener('popstate',()=>showPanel(workspaceRoute(location.href),{history:false}));
  $('workspace-list').addEventListener('click',()=>{panelOpen=true;render();});
  $('view-map').addEventListener('click',showMap);
  $('view-cameras').addEventListener('click',()=>onCameraChange(!camerasOpen));
  document.querySelectorAll('[data-show-map]').forEach(b=>b.addEventListener('click',showMap));
  $('camera-sheet').addEventListener('calciteSheetClose',()=>{if(!dock.matches&&!evidence?.isOpen&&camerasOpen){setCameras(false);onCameraChange(false);}});
  compact.addEventListener('change',()=>{if(evidence?.isOpen)panelOpen=!compact.matches;render();});dock.addEventListener('change',render);
  new ResizeObserver(mapLabels).observe($('map-panel'));
  render();
  return {showPanel,showMap,setCameras,refreshLayout:render,setMap(controller){map=controller;void map.setWorkspace(section);},get camerasOpen(){return camerasOpen;},get section(){return section;}};
}
