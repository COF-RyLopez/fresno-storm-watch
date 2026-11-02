/** Selection, loading and displayed results are separate facts, not interchangeable scenario labels. */
export function libraryMapStatus({selected=null,mapped=null,loading=false,error=null}={}){
 if(error)return {text:`Library map unavailable: ${error}`,problem:true};
 if(loading)return {text:`Loading library map: ${selected?.label||'selected scenario'}`,problem:false};
 if(!mapped)return {text:'No published library map loaded. Open a dam on the map and choose a prepared scenario.',problem:false};
 return {text:`Map showing: ${mapped.label}`,problem:false};
}
