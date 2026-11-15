/** Bounded, in-memory lookahead. Deduplicates work; eviction/close abort their own requests. */
export function createWeatherFrameCache(limit){
 if(!Number.isInteger(limit)||limit<1)throw Error('Invalid weather cache bound');
 const entries=new Map();
 return {
  get(key,load){
   const previous=entries.get(key);
   if(previous){entries.delete(key);entries.set(key,previous);return previous.task;}
   const entry={controller:new AbortController(),settled:false};
   entry.task=Promise.resolve().then(()=>{entry.controller.signal.throwIfAborted();return load(entry.controller.signal);}).then(value=>{entry.settled=true;return value;}).catch(error=>{
    if(entries.get(key)===entry)entries.delete(key);
    throw error;
   });
   entries.set(key,entry);
   while(entries.size>limit){const oldest=entries.keys().next().value;entries.get(oldest).controller.abort();entries.delete(oldest);}
   return entry.task;
  },
  cancelPending(){for(const [key,entry] of entries)if(!entry.settled){entry.controller.abort();entries.delete(key);}},
  clear(){for(const entry of entries.values())entry.controller.abort();entries.clear();}
 };
}
