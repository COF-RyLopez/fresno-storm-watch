/** Selection, loading and displayed results are separate facts, not interchangeable scenario labels. */
export function libraryMapStatus({selected=null,mapped=null,loading=false,error=null}={}){
 if(error)return {text:`Library map unavailable: ${error}`,problem:true};
 if(loading)return {text:`Loading library map: ${selected?.label||'selected scenario'}`,problem:false};
 if(!mapped)return {text:'No published library map loaded. Choose a scenario and inspect its map.',problem:false};
 if(selected?.id!==mapped.id)return {text:`Selection changed; press Inspect flood map to load it. Map still shows: ${mapped.label}`,problem:false};
 return {text:`Map showing: ${mapped.label}`,problem:false};
}
