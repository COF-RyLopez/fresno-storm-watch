import {loadSdk} from './map.js?v=0.73.1';
const $=id=>document.getElementById(id);
/** One nonmodal evidence surface. Existing open attributes remain the domain controllers' visibility contract. */
export function createEvidencePane({onChange=()=>{},timeZone='America/Los_Angeles'}={}){
  const panes=[...document.querySelectorAll('[data-evidence]')],host=$('evidence-host'),shell=$('evidence-shell'),mobile=$('evidence-mobile-host'),compact=matchMedia('(max-width:900px)');
  let active=null,opener=null,focusGeneration=0,features=[],featureView=null,featureGeneration=0,featureComponent=null;
  const focused=()=>{let n=document.activeElement;while(n?.shadowRoot?.activeElement)n=n.shadowRoot.activeElement;return n;};
  function layout(){
    const visible=!!active;
    if(compact.matches){shell.hidden=true;if(host.parentElement!==mobile)mobile.append(host);mobile.hidden=!visible;}
    else{mobile.hidden=true;if(host.parentElement!==shell)shell.append(host);shell.hidden=!visible;}
    $('planning-workspace').classList.toggle('evidence-stacked',visible&&compact.matches);
    for(const [id,target]of [['context-open','context-menu'],['map-tools-open','map-tools-menu']])$(id).setAttribute('aria-expanded',String(active?.id===target));
  }
  function notifyClosed(pane){pane.dispatchEvent(new CustomEvent('stormEvidenceClose'));}
  function close({restoreFocus=true}={}){
    if(!active)return;const previous=active,returnTo=opener;active=null;opener=null;focusGeneration++;
    previous.removeAttribute('open');previous.hidden=true;notifyClosed(previous);layout();onChange(false);
    if(restoreFocus){const target=returnTo?.isConnected&&returnTo.getClientRects().length?returnTo:$('context-open');if(target.setFocus)void target.setFocus();else target.focus({preventScroll:true});}
  }
  function show(pane){
    if(active===pane){layout();return;}
    const previous=active;if(!previous)opener=focused();active=pane;
    if(previous){previous.removeAttribute('open');previous.hidden=true;notifyClosed(previous);}
    for(const other of panes)if(other!==pane){other.removeAttribute('open');other.hidden=true;}
    pane.closed=false;pane.hidden=false;layout();onChange(true);
    const request=++focusGeneration;void customElements.whenDefined('calcite-panel').then(()=>{if(request===focusGeneration&&active===pane)void pane.setFocus();});
  }
  const observer=new MutationObserver(records=>{
    const requested=[...records].reverse().find(r=>r.target.hasAttribute('open'))?.target;
    if(requested)show(requested);else if(active&&!active.hasAttribute('open'))close();
  });
  for(const pane of panes){
    pane.hidden=true;observer.observe(pane,{attributes:true,attributeFilter:['open']});
    pane.addEventListener('calcitePanelClose',e=>{e.preventDefault();pane.removeAttribute('open');});
  }
  for(const [button,id]of [['context-open','context-menu'],['map-tools-open','map-tools-menu']])$(button).addEventListener('click',()=>$(id).toggleAttribute('open',active?.id!==id));
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!e.defaultPrevented&&active&&e.composedPath().includes(active)){e.preventDefault();close();}});
  compact.addEventListener('change',layout);
  /** Destroy component state and invalidate delayed imports when a selection is closed or replaced. */
  function clearFeature(){featureGeneration++;features=[];featureView=null;if(featureComponent){featureComponent.graphic=null;featureComponent.view=null;featureComponent.map=null;void featureComponent.destroy?.();featureComponent.remove();featureComponent=null;}$('map-feature-content').replaceChildren();$('map-feature-select').replaceChildren();}
  $('map-feature-evidence').addEventListener('stormEvidenceClose',clearFeature);
  async function paintFeature(index){
    const request=++featureGeneration,graphic=features[index],view=featureView;if(!graphic||!view)return;
    $('map-feature-status').textContent='Loading publisher feature details…';
    try{
      await loadSdk();
      if(request!==featureGeneration||active?.id!=='map-feature-evidence')return;
      if(!featureComponent){featureComponent=document.createElement('arcgis-feature');featureComponent.setAttribute('auto-destroy-disabled','');featureComponent.setAttribute('heading-level','3');featureComponent.timeZone=timeZone;$('map-feature-content').append(featureComponent);}
      // The existing SDK 5.1 CDN entry registers components on demand; no second loader/import is needed.
      let timeout;try{await Promise.race([customElements.whenDefined('arcgis-feature'),new Promise((_,reject)=>{timeout=setTimeout(()=>reject(new Error('Feature component load timed out')),15_000);})]);}finally{clearTimeout(timeout);}
      if(request!==featureGeneration||active?.id!=='map-feature-evidence')return;
      featureComponent.view=view;featureComponent.map=view.map;featureComponent.spatialReference=view.spatialReference;featureComponent.graphic=graphic;
      $('map-feature-status').textContent='Publisher attributes and source times. A selected feature is evidence, not a verified field condition.';
    }catch(e){if(request===featureGeneration)$('map-feature-status').textContent=`Feature details unavailable · ${e.message}. Use the layer’s official source.`;}
  }
  function openFeatures(selection){
    if(!selection){$('map-feature-evidence').removeAttribute('open');if(active?.id==='map-feature-evidence')close({restoreFocus:false});else clearFeature();return;}
    features=selection.graphics;featureView=selection.view;if(featureComponent)featureComponent.graphic=null;
    const picker=$('map-feature-select');picker.replaceChildren(...features.map((g,i)=>{const n=document.createElement('calcite-option');n.value=String(i);n.textContent=`${g.layer?.title||'Map feature'} · ${i+1}`;return n;}));picker.value='0';
    $('map-feature-evidence').setAttribute('open','');
    // Attribute observers run before the asynchronous component import resolves.
    void paintFeature(0);
  }
  $('map-feature-select').addEventListener('calciteSelectChange',e=>void paintFeature(Number(e.target.value)));
  layout();return {layout,close,openFeatures,get isOpen(){return !!active;},get activeId(){return active?.id||null;}};
}
