/** Calcite owns the panel layout; this controller only chooses which workspace is visible. */
export function createWorkspace({onCameraChange}) {
  const element=id=>document.getElementById(id);
  const compact=matchMedia('(max-width:900px)');
  const phone=matchMedia('(max-width:600px)');
  const cameraDock=matchMedia('(min-width:1280px)');
  let section='rivers', panelOpen=true, camerasOpen=cameraDock.matches;
  const activate=(id,active)=>{
    const action=element(id);
    action.toggleAttribute('active',active);
    action.removeAttribute('aria-pressed');
    if(customElements.get('calcite-action'))action.aria={pressed:String(active)};
  };

  function render() {
    element('tools-shell').toggleAttribute('collapsed',!panelOpen);
    element('tools-shell').setAttribute('display-mode','dock');
    element('camera-shell').hidden=!camerasOpen;
    element('camera-shell').setAttribute('display-mode','dock');
    // On compact screens, switch the pane instead of placing focusable controls behind it.
    const covered=compact.matches&&(panelOpen||camerasOpen);
    element('planning-workspace').classList.toggle('map-covered',covered);
    element('planning-workspace').inert=covered;
    for(const id of ['review-areas','about','sign-in','theme-toggle'])element(id).toggleAttribute('text-enabled',!phone.matches);
    for(const name of ['watch','rivers','environment','alerts']){
      activate(`view-${name}`,panelOpen&&section===name);
    }
    activate('view-map',!panelOpen&&!camerasOpen);
    activate('view-cameras',camerasOpen);
    element('storm-shell').dataset.workspace=section;
  }

  function setCameras(open) {
    camerasOpen=open;
    if(open&&!cameraDock.matches)panelOpen=false;
    render();
  }

  function showPanel(name) {
    section=name;panelOpen=true;
    if(!cameraDock.matches&&camerasOpen){setCameras(false);onCameraChange(false);}
    render();
  }

  function showMap() {
    panelOpen=false;
    if(!cameraDock.matches&&camerasOpen){setCameras(false);onCameraChange(false);}
    render();
  }

  element('view-map').addEventListener('click',showMap);
  element('view-cameras').addEventListener('click',()=>{setCameras(!camerasOpen);onCameraChange(camerasOpen);});
  document.querySelectorAll('[data-show-map]').forEach(button=>button.addEventListener('click',showMap));
  const resize=()=>{if(camerasOpen&&!cameraDock.matches)panelOpen=false;render();};
  compact.addEventListener('change',resize);cameraDock.addEventListener('change',resize);phone.addEventListener('change',render);
  render();
  void customElements.whenDefined('calcite-action').then(render);
  return {showPanel,showMap,setCameras,get camerasOpen(){return camerasOpen;}};
}
