import {blend} from './flood-scenario-model.js?v=0.39.0';
/** Coalesce scrubbing, serialize network batches and retain at most four private previews. */
export function createPrivateFramePlayer({hours,load,display,onError=()=>{},maxFrames=4}){
 const cache=new Map();let pending=null,busy=false,alive=true,version=0;
 async function drain(){if(busy||!alive)return;busy=true;try{while(pending!==null&&alive){const time=pending;pending=null;const request=version,{i0,i1}=blend(time,hours),needed=[...new Set([i0,i1,Math.min(i1+1,hours.length-1)])];
   for(const [i,item]of cache)if(!needed.includes(i)){item.release();cache.delete(i);}
   for(const i of needed){if(cache.has(i))continue;const item=await load(i);if(!alive){item.release();return;}cache.set(i,item);if(cache.size>maxFrames)throw Error('Private frame cache limit exceeded.');}
   if(alive&&request===version)await display(time,new Map([...cache].map(([i,item])=>[i,item.url])));
  }}catch(e){if(alive)onError(e);}finally{busy=false;}}
 return {setTime(time){if(!alive)return;pending=time;version++;void drain();},close(){alive=false;pending=null;version++;for(const item of cache.values())item.release();cache.clear();},get size(){return cache.size;}};
}
