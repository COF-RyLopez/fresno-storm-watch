import {viewEventData} from './map-events.js';

const HOVER_DELAY_MS=120;
const plain=value=>typeof value==='string'?value.replace(/[\u0000-\u001f]/g,' ').trim().slice(0,180):'';

/** Use available publisher attributes only; never evaluate a popup or issue a feature query. */
export function mapFeatureName(graphic){
  if(!graphic||graphic.visible===false||graphic.layer?.visible===false||graphic.symbol?.type==='text')return '';
  const attributes=graphic.attributes||{},title=graphic.popupTemplate?.title??graphic.layer?.popupTemplate?.title;
  if(typeof title==='string'){
    let missing=false;
    const resolved=title.replace(/\{([^}]+)\}/g,(_,key)=>{const value=attributes[key];if(value===null||value===undefined){missing=true;return '';}return String(value);});
    if(!missing&&plain(resolved))return plain(resolved);
  }
  for(const key of ['terrainName','name','NAME','DamName','GNIS_Name','GNIS_NAME',graphic.layer?.displayField])if(key&&plain(attributes[key]))return plain(attributes[key]);
  return '';
}

/** Debounce pointer sampling and discard late hits after movement, navigation or view changes. */
export function createHoverPreview({hitTest,label,show,hide,active=()=>true,delay=HOVER_DELAY_MS,schedule=setTimeout,cancelSchedule=clearTimeout}){
  let revision=0,timer=null;
  function cancel(){revision++;if(timer!==null)cancelSchedule(timer);timer=null;hide();}
  function move(event){
    cancel();
    if(!active()||event?.pointerType==='touch'||event?.native?.pointerType==='touch'||event?.buttons||event?.native?.buttons||!Number.isFinite(event?.x)||!Number.isFinite(event?.y))return;
    const request=revision;
    timer=schedule(async()=>{
      timer=null;if(request!==revision||!active())return;
      try{const result=await hitTest(event);if(request!==revision||!active())return;const name=label(result);if(name)show(name,event);else hide();}
      catch{if(request===revision)hide();}
    },delay);
  }
  return {move,cancel};
}

/** Nonmodal names supplement the existing keyboard/touch-accessible lists and click details. */
export function installMapHover({view,container,active,label}){
  const tooltip=document.createElement('div');tooltip.className='map-hover-label';tooltip.hidden=true;
  tooltip.id=`frog-map-hover-${view.uid??view.type}`;tooltip.setAttribute('role','tooltip');tooltip.setAttribute('aria-live','polite');
  container.parentElement.append(tooltip);
  const describe=visible=>{const ids=new Set((container.getAttribute('aria-describedby')||'').split(/\s+/).filter(Boolean));if(visible)ids.add(tooltip.id);else ids.delete(tooltip.id);if(ids.size)container.setAttribute('aria-describedby',[...ids].join(' '));else container.removeAttribute('aria-describedby');};
  const hide=()=>{tooltip.hidden=true;container.classList.remove('map-hover-target');describe(false);};
  const controller=createHoverPreview({active,hitTest:event=>view.hitTest(event),label,hide,show:(name,event)=>{
    if(tooltip.textContent!==name)tooltip.textContent=name;tooltip.hidden=false;container.classList.add('map-hover-target');describe(true);
    const width=tooltip.offsetWidth,height=tooltip.offsetHeight;
    tooltip.style.left=`${Math.max(8,Math.min(event.x+16,container.clientWidth-width-8))}px`;
    tooltip.style.top=`${Math.max(8,Math.min(event.y+18,container.clientHeight-height-8))}px`;
  }});
  const handles=[view.on('pointer-move',event=>controller.move(viewEventData(event))),...['pointer-leave','pointer-down','drag','key-down'].map(name=>view.on(name,controller.cancel))];
  const dismiss=event=>{if(event.key==='Escape')controller.cancel();};container.addEventListener('keydown',dismiss);
  return {cancel:controller.cancel,remove(){controller.cancel();for(const handle of handles)handle.remove();container.removeEventListener('keydown',dismiss);tooltip.remove();}};
}
