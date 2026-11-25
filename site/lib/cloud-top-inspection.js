import {cloudTopHeightBand} from './cloud-top-style.js';
import {createMapPreview} from './map-preview.js';
const observedTime=new Intl.DateTimeFormat('en-US',{timeZone:'America/Los_Angeles',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'});

/** An approximate altitude on the triangulated NOAA retrieval, never a cloud-base/AGL reading. */
export function cloudTopReadout(height,stamp){
 if(!cloudTopHeightBand(height)||!Number.isFinite(stamp))return null;
 const feet=(Math.round(height/0.3048/500)*500).toLocaleString('en-US');
 return `Cloud top ≈ ${feet} ft (${(height/1000).toFixed(1)} km)\nGOES-18 · ${observedTime.format(stamp)}\nGeopotential altitude · not height above terrain`;
}

/** Screen-surface picking for mouse and touch; ground records retain interaction priority. */
export function installCloudTopInspection({map,Popup,recordAt,onSelect,getSurface,getMetadata,onInspect}){
 const hover=new Popup({className:'watch-feature-hover',closeButton:false,closeOnClick:false,focusAfterOpen:false,offset:12});
 const cloud=new Popup({className:'watch-cloud-readout',maxWidth:'min(340px, calc(100vw - 32px))',closeButton:true,closeOnClick:false,focusAfterOpen:false,offset:12});
 const canvas=map.getCanvas();let scheduled=null;
 const preview=onInspect?createMapPreview(map):null;
 function clear(){
  if(scheduled!==null)cancelAnimationFrame(scheduled);
  scheduled=null;hover.remove();cloud.remove();preview?.remove();canvas.style.cursor='';
 }
 function cloudAt(event){
  const surface=getSurface(),stamp=getMetadata()?.observedAt;
  if(!surface||!Number.isFinite(stamp))return null;
  const hit=surface.pick(event.point,canvas.clientWidth,canvas.clientHeight);
  if(hit&&map.queryTerrainElevation){
   const below=map.queryTerrainElevation([hit.lon,hit.lat]);
   if(Number.isFinite(below)&&hit.height<below)return null;
   // MapLibre 6.15 unproject uses its terrain-aware screenPointToLocation.
   const ground=map.unproject(event.point),height=map.queryTerrainElevation(ground);
   const depth=Number.isFinite(height)?surface.projectDepth?.(ground.lng,ground.lat,height):null;
   if(Number.isFinite(depth)&&depth>=-1&&depth<=1&&depth<hit.depth-1e-7)return null;
  }
  return hit?cloudTopReadout(hit.height,stamp):null;
 }
 function showCloud(text,event){
  if(preview){preview.show(text,event.point);canvas.style.cursor='pointer';return;}
  hover.remove();cloud.setText(text).setLngLat(event.lngLat);
  if(!cloud.isOpen())cloud.addTo(map);
  canvas.style.cursor='pointer';
 }
 const move=event=>{
  if(!matchMedia('(hover: hover)').matches||map.isMoving())return;
  if(scheduled!==null)cancelAnimationFrame(scheduled);
  scheduled=requestAnimationFrame(()=>{
   scheduled=null;
   const record=recordAt(event.point);
   if(record?.name){cloud.remove();canvas.style.cursor='pointer';if(preview)preview.show(record.readout||record.hoverText||record.name,event.point);else{hover.setText(record.hoverText||record.name).setLngLat(event.lngLat);if(!hover.isOpen())hover.addTo(map);}return;}
   const text=cloudAt(event);if(text)showCloud(text,event);else clear();
  });
 };
 const click=event=>{
  clear();const record=recordAt(event.point);
  if(record?.readout){if(onInspect)onInspect(record);else showCloud(record.readout,event);return;}
  if(record){onSelect(record);return;}
  const text=cloudAt(event);if(text){if(onInspect)onInspect({name:'GOES cloud top',readout:text});else showCloud(text,event);}
 };
 const moving=()=>{getSurface()?.invalidatePick?.();clear();};
 const leave=event=>{
  if(cloud.isOpen()&&event?.originalEvent?.relatedTarget?.closest?.('.watch-cloud-readout')){hover.remove();return;}
  clear();
 };
 const key=event=>{if(event.key==='Escape')clear();};
 map.on('mousemove',move);map.on('mouseout',leave);map.on('movestart',moving);map.on('click',click);
 canvas.addEventListener('keydown',key);
 return {clear,destroy(){clear();preview?.destroy();map.off('mousemove',move);map.off('mouseout',leave);map.off('movestart',moving);map.off('click',click);canvas.removeEventListener('keydown',key);}};
}
