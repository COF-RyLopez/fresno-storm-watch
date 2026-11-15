/** Own a single transient renderer; superseded/cleared requests cannot publish private features. */
export function createTerrainSession({create,activate,deactivate,failure}){
 let epoch=0,adapter=null,pending=null;const disposed=new WeakSet();
 const dispose=value=>{if(value&&!disposed.has(value)){disposed.add(value);value.destroy();}};
 const clear=()=>{epoch++;dispose(adapter);adapter=null;pending=null;deactivate();};
 return {clear,refresh(data){adapter?.set(data);},overhead(value){adapter?.overhead(value);},
  focus(bounds,padding){adapter?.focus(bounds,true,padding);},watershed(feature){adapter?.watershed(feature);},rain(image){adapter?.rain(image);},cloud(image){adapter?.cloud(image);},cloudTops(vertices){adapter?.cloudTops(vertices);},radar(samples,minDbz){adapter?.radar(samples,minDbz);},radarVolume(volume,minDbz,onFailure){adapter?.radarVolume(volume,minDbz,onFailure);},get active(){return !!adapter;},async open(data,animate=true){
  const request=++epoch;
  try{
   if(!adapter){const loading=pending??=create();const created=await loading;if(request!==epoch){if(pending!==loading&&created!==adapter)dispose(created);return false;}adapter=created;pending=null;}
   if(request!==epoch)return false;
   adapter.set(data);activate();adapter.focus(data.bounds,animate);return true;
  }catch(error){if(request===epoch){clear();failure(error);}return false;}
 }};
}
