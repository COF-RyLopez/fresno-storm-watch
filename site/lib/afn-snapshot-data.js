import {readAfnContext} from './afn-data.js?v=0.74.0-helpers';
import {AFN_TOPIC_KEYS,freezeAfnEvidence} from './afn-snapshot-model.js?v=0.74.0-helpers';

/** Only a public county-zone geometry reaches the public source readers. */
export async function captureAfnEvidence(row,zone,{signal,current=()=>true,readContext=readAfnContext}={}){
  const check=()=>{if(signal?.aborted||!current())throw new DOMException('Selection changed','AbortError');};check();
  let topics;
  try{topics=await readContext(row.geometry,{signal});}
  catch(error){check();if(error.name==='AbortError')throw error;topics=AFN_TOPIC_KEYS.map(key=>({key,error:error.message||'Public AFN context unavailable.'}));}
  check();return freezeAfnEvidence({zone,topics});
}
