type Panel = 'place' | 'weather' | 'key' | 'reading';
interface InspectorOptions {
  pane(value: string): void;
  resize(): void;
  changed?: (panel: Panel | null) => void;
  get?: (id: string) => HTMLElement;
}

/** One in-memory inspector; visibility never changes the selected location. */
export function createCommandInspector({pane,resize,changed,get=id=>document.getElementById(id)!}: InspectorOptions){
  let selected: string | null = null, panel: Panel | null = null;
  let returnPanel: Exclude<Panel,'reading'> = 'place';
  function render(){
    get('evidence').hidden=panel===null;
    get('watch-view').classList.toggle('has-selection',panel!==null);
    for(const name of ['place','weather','key','reading'] as const)get(name==='key'?'map-key-inspector':name+'-inspector').hidden=panel!==name;
    for(const name of ['place','weather','key'] as const)get('inspector-'+name).setAttribute('aria-pressed',String(panel===name||name==='place'&&panel==='reading'));
    get('inspector-title').textContent=panel==='weather'?'Weather details':panel==='key'?'Map key & layers':panel==='reading'?'Map reading':'Selected place';
    get('inspector-root').toggleAttribute('selected',panel!=='reading');
    get('reading-flow-item').toggleAttribute('selected',panel==='reading');
    changed?.(panel);
    resize();
  }
  function show(value: Panel,focus=true){
    panel=value;render();
    if(focus){pane('details');get(value==='reading'?'reading-title':'inspector-title').focus({preventScroll:true});}
  }
  get('weather-details-open').onclick=()=>show('weather');
  get('map-key-open').onclick=()=>show('key');
  for(const name of ['place','weather','key'] as const)get('inspector-'+name).onclick=()=>show(name);
  const back=()=>show(returnPanel);
  get('reading-back').onclick=back;
  get('reading-flow-item').addEventListener('calciteFlowItemBack',event=>{event.preventDefault();back();});
  get('inspector-map').onclick=()=>{pane('map');get('command-map').focus({preventScroll:true});};
  const close=()=>{panel=null;render();pane('map');get('command-map').focus({preventScroll:true});};
  get('evidence-close').onclick=close;
  get('reading-close').onclick=close;
  render();
  return {
    get panel(){return panel;},show,
    selection(id: string | null){
      if(id!==selected){selected=id;if(id)show('place',false);else if(panel==='place'||panel==='reading'){panel=null;render();}}
    },
    reading(value: {name?:string;readout:string}){
      if(panel!=='reading')returnPanel=panel||'place';
      get('reading-back').textContent=returnPanel==='weather'?'Back to weather':returnPanel==='key'?'Back to map key':selected?'Back to selected place':'Choose a place';
      get('reading-title').textContent=value.name||'Map reading';
      get('reading-content').textContent=value.readout;
      show('reading');
    },
    clearReading(){
      get('reading-title').textContent='';get('reading-content').textContent='';
      if(panel==='reading'){panel=selected?'place':'weather';render();}
    },
    clear(){selected=null;panel=null;returnPanel='place';get('reading-title').textContent='';get('reading-content').textContent='';render();},
  };
}
