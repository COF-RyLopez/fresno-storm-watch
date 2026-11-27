/** Two bounded image slots. Never remove the visible source to load its replacement. */
export function createWeatherRaster(map,id,{before,duration=240,reducedMotion=()=>globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
 createUrl=blob=>URL.createObjectURL(blob),revokeUrl=url=>URL.revokeObjectURL(url)}={}){
 let front=-1,pending=null,closed=false;
 const urls=new Map(),key=slot=>`${id}-${slot}`;
 function remove(slot){const name=key(slot);if(map.getLayer(name))map.removeLayer(name);if(map.getSource(name))map.removeSource(name);
  if(urls.has(slot)){revokeUrl(urls.get(slot));urls.delete(slot);}}
 function clear(){pending?.();pending=null;for(const slot of [0,1])remove(slot);front=-1;}
 return {
  set(image,paint={}){
   if(closed)return Promise.resolve(false);
   pending?.();pending=null;
   if(!image?.blob){clear();return Promise.resolve(true);}
   const back=front===0?1:0,name=key(back);remove(back);
   return new Promise(resolve=>{
    let complete=false,fadeTimer,loadTimer;
    const finish=ok=>{if(complete)return;complete=true;clearTimeout(loadTimer);clearTimeout(fadeTimer);
     map.off('sourcedata',ready);map.off('error',failed);if(pending===cancel)pending=null;resolve(ok);};
    const cancel=()=>{if(front!==back)remove(back);finish(false);};
    const failed=e=>{if(e.sourceId===name)cancel();};
    const ready=e=>{
     if(complete||e.sourceId!==name||!map.isSourceLoaded(name))return;
     clearTimeout(loadTimer);map.off('sourcedata',ready);map.off('error',failed);
     const ms=reducedMotion()?0:duration,previous=front;front=back;
     map.setPaintProperty(name,'raster-opacity-transition',{duration:ms,delay:0});
     map.setPaintProperty(name,'raster-opacity',paint['raster-opacity']??1);
     if(previous>=0){map.setPaintProperty(key(previous),'raster-opacity-transition',{duration:ms,delay:0});map.setPaintProperty(key(previous),'raster-opacity',0);}
     if(ms)fadeTimer=setTimeout(()=>finish(true),ms);else finish(true);
    };
    pending=cancel;map.on('sourcedata',ready);map.on('error',failed);
    loadTimer=setTimeout(cancel,15000);
    try{
     const url=createUrl(image.blob);urls.set(back,url);
     map.addSource(name,{type:'image',url,coordinates:image.coordinates});
     map.addLayer({id:name,type:'raster',source:name,paint:{'raster-fade-duration':0,...paint,'raster-opacity':0}},typeof before==='function'?before():before);
     ready({sourceId:name});
    }catch{cancel();}
   });
  },
  destroy(){clear();closed=true;},
 };
}
