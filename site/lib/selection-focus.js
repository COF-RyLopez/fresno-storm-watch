/** Latest selection wins across deferred workspace restores and 3D initialization.
 * Targets are built after switching views, so fallback navigation uses 2D geometry.
 */
export function createSelectionFocus({workspace,ready,setMode,view,navigate,save,missing,failed,settled=()=>Promise.resolve(),preferredMode=()=> '3d'}) {
  let revision=0;
  function cancel(stopAnimation=true){revision++;if(stopAnimation)view().animation?.stop();}
  async function focus(target,{canNavigate=()=>true}={}){
    if(!canNavigate())return false;
    cancel();const request=revision,scope=workspace(),current=()=>request===revision&&scope===workspace();
    try {
      await ready();if(!current()||!canNavigate())return false;
      if(!target(view().type)){missing();return false;}
      await setMode(preferredMode());if(!current()||!canNavigate())return false;
      await settled();if(!current()||!canNavigate())return false;
      const destination=target(view().type);if(!destination){missing();return false;}
      await navigate(destination);if(current()){save();return true;}return false;
    }catch(error){if(current()&&error.name!=='AbortError')failed(error);return false;}
  }
  return {focus,cancel};
}

/** Do not fabricate a map location from absent or invalid source coordinates. */
export const validLocation=p=>Number.isFinite(p?.longitude)&&Number.isFinite(p?.latitude)&&Math.abs(p.longitude)<=180&&Math.abs(p.latitude)<=90;

/** Fit polygon extents with room around the full outline; avoid a point scale for small lakes. */
export function searchDestination(geometry,mode){
  if(geometry.type==='polygon')return {target:geometry.extent.clone().expand(1.25),...(mode==='3d'?{tilt:0,heading:0}:{})};
  return {target:geometry,...(geometry.type==='point'||Math.max(geometry.extent?.width??0,geometry.extent?.height??0)<.04?{scale:12000}:{}),...(mode==='3d'?{tilt:45,heading:0}:{})};
}
