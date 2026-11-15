import {cloudTopHeightBand} from './cloud-top-style.js';
const observedTime=new Intl.DateTimeFormat('en-US',{timeZone:'America/Los_Angeles',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'});

/** An approximate altitude on the triangulated NOAA retrieval, never a cloud-base/AGL reading. */
export function cloudTopReadout(height,stamp){
 if(!cloudTopHeightBand(height)||!Number.isFinite(stamp))return null;
 const feet=(Math.round(height/0.3048/500)*500).toLocaleString('en-US');
 return `Cloud top ≈ ${feet} ft (${(height/1000).toFixed(1)} km)\nGOES-18 · ${observedTime.format(stamp)}\nGeopotential altitude · not height above terrain`;
}

/** Screen-surface picking for mouse and touch; ground records retain interaction priority. */
export function installCloudTopInspection({map,Popup,recordAt,onSelect,getSurface,getMetadata}){
 const hover=new Popup({className:'watch-feature-hover',closeButton:false,closeOnClick:false,focusAfterOpen:false,offset:12});
 const cloud=new Popup({className:'watch-cloud-readout',closeButton:true,closeOnClick:false,focusAfterOpen:false,offset:12});
 const canvas=map.getCanvas();let scheduled=null;
 function clear(){
  if(scheduled!==null)cancelAnimationFrame(scheduled);
  scheduled=null;hover.remove();cloud.remove();canvas.style.cursor='';
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
   if(record?.name){cloud.remove();canvas.style.cursor='pointer';hover.setText(record.name).setLngLat(event.lngLat);if(!hover.isOpen())hover.addTo(map);return;}
   const text=cloudAt(event);if(text)showCloud(text,event);else clear();
  });
 };
 const click=event=>{
  clear();const record=recordAt(event.point);
  if(record){onSelect(record);return;}
  const text=cloudAt(event);if(text)showCloud(text,event);
 };
 const moving=()=>{getSurface()?.invalidatePick?.();clear();};
 const key=event=>{if(event.key==='Escape')clear();};
 map.on('mousemove',move);map.on('mouseout',clear);map.on('movestart',moving);map.on('click',click);
 canvas.addEventListener('keydown',key);
 return {clear,destroy(){clear();map.off('mousemove',move);map.off('mouseout',clear);map.off('movestart',moving);map.off('click',click);canvas.removeEventListener('keydown',key);}};
}
