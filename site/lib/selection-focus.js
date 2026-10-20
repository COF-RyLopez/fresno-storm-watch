/** Latest selection wins across deferred workspace restores and 3D initialization.
 * Targets are built after switching views, so fallback navigation uses 2D geometry.
 */
export function createSelectionFocus({workspace,ready,setMode,view,navigate,save,missing,failed}) {
  let revision=0;
  function cancel(stopAnimation=true){revision++;if(stopAnimation)view().animation?.stop();}
  async function focus(target){
    cancel();const request=revision,scope=workspace(),current=()=>request===revision&&scope===workspace();
    try {
      await ready();if(!current())return false;
      if(!target(view().type)){missing();return false;}
      await setMode('3d');if(!current())return false;
      const destination=target(view().type);if(!destination){missing();return false;}
      await navigate(destination);if(current()){save();return true;}return false;
    }catch(error){if(current()&&error.name!=='AbortError')failed(error);return false;}
  }
  return {focus,cancel};
}

/** Do not fabricate a map location from absent or invalid source coordinates. */
export const validLocation=p=>Number.isFinite(p?.longitude)&&Number.isFinite(p?.latitude)&&Math.abs(p.longitude)<=180&&Math.abs(p.latitude)<=90;
