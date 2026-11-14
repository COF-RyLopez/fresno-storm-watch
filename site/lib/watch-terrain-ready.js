import {withTimeout} from './with-timeout.js';
/** A source error must not count as a successfully loaded focused map. */
export function waitForTerrain(map,onError,timeoutMs=20000){
 let settled=false,ready=false;
 const startup=new Promise((resolve,reject)=>{
  const fail=message=>{if(ready)onError(message);else if(!settled){settled=true;reject(Error(message));}};
  map.on('error',e=>fail(e.error?.message||'Reference map unavailable'));
  map.on('webglcontextlost',()=>fail('3D graphics context was lost'));
  map.once('load',()=>{if(!settled){settled=true;ready=true;resolve();}});
 });
 return withTimeout(startup,timeoutMs,'Terrain startup timed out');
}
