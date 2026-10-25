/** A private read cannot outlive its account. The existing adapter enforces AGOL/EOC access. */
export function createPumpVicinityInventory({open,onChange=()=>{},now=Date.now}){
  let session=null,adapter=null,epoch=0,pending=null;
  let state={connected:false,rows:[],checked:null,error:null,busy:false};
  const publish=()=>onChange(state);
  function setSession(value){epoch++;session=value;adapter?.close();adapter=null;pending=null;state={connected:false,rows:[],checked:null,error:null,busy:false};publish();}
  async function load(){
    if(!session)return;if(pending)return pending;
    const version=epoch;state={...state,busy:true,error:null};publish();
    pending=(async()=>{
      try{
        if(!adapter){const opened=await open(session);if(version!==epoch){opened.close();return;}adapter=opened;}
        const copy=await adapter.read();if(version!==epoch)return;
        state={...copy,connected:true,checked:now(),error:null,busy:false};
      }catch{
        if(version!==epoch)return;adapter?.close();adapter=null;
        state={connected:false,rows:[],checked:null,error:'Private AGOL pump inventory could not be read. Sign in again or verify EOC viewer access; no Enterprise fallback was attempted.',busy:false};
      }finally{if(version===epoch){pending=null;publish();}}
    })();
    return pending;
  }
  return {load,setSession,getState:()=>state};
}
