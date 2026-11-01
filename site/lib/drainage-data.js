import {readIdBatches} from './acs-data.js';
import {DRAINAGE_URL,DRAINAGE_LAYERS,DRAINAGE_LIMIT,authorizeDrainage,drainageSchema,drainageRecord} from './drainage-model.js';
/** @param {object} spec @param {Function} call @returns {Promise<object[]>} Bounded POST inventory; require exact batch, CRS and ID accounting. */
export async function readDrainageLayer(spec,call){
  const metadata=await call('/'+spec.id,{}),oid=drainageSchema(spec,metadata);
  const inventory=await call('/'+spec.id+'/query',{where:'1=1',returnIdsOnly:true});
  let ids=inventory.objectIds;
  if(ids===null){const count=await call('/'+spec.id+'/query',{where:'1=1',returnCountOnly:true});if(count.count!==0)throw Error('FMFCD empty inventory is unverified.');ids=[];}
  if(!Array.isArray(ids)||ids.length>DRAINAGE_LIMIT||inventory.exceededTransferLimit||ids.some(id=>!Number.isSafeInteger(id)||id<1)||new Set(ids).size!==ids.length)throw Error('FMFCD inventory is incomplete or exceeds the bounded workspace limit.');
  return readIdBatches(ids,spec.kind==='catchment'?20:100,oid,batch=>call('/'+spec.id+'/query',{objectIds:batch.join(','),outFields:[oid,...spec.fields].join(','),returnGeometry:true,outSR:4326,...(spec.kind==='catchment'?{maxAllowableOffset:0.00002}:{})}),'FMFCD batch changed, was truncated or did not return WGS84 coordinates. Refresh required.',f=>drainageRecord(spec,f,oid));
}
/** @param {object} config @param {object} session @param {Function} loadSdk @returns {Promise<object>} Fixed county endpoint; credentials stay inside the ArcGIS SDK. */
export async function openDrainage(config,session,loadSdk){
  await authorizeDrainage(config,session);
  const [request]=await(await loadSdk()).import(['@arcgis/core/request.js']);
  let alive=true;const pending=new Set();
  const ensure=()=>{if(!alive)throw Error('Private drainage session ended.');};
  const call=async(suffix,parameters)=>{
    ensure();const controller=new AbortController();pending.add(controller);
    try{const response=await request(DRAINAGE_URL+suffix,{method:'post',responseType:'json',cacheBust:true,signal:controller.signal,timeout:25000,query:{f:'json',...parameters}});ensure();if(response.data?.error)throw Error('County service denied the request.');return response.data;}
    catch{throw Error('County Enterprise access or FMFCD service failed. Private drainage records cleared. Sign in again or ask GIS to verify service access.');}
    finally{pending.delete(controller);}
  };
  return {async read({includeBoundaries=false}={}){await authorizeDrainage(config,session);ensure();const rows=[];for(const spec of DRAINAGE_LAYERS.filter(s=>includeBoundaries||s.kind!=='catchment'))rows.push(...await readDrainageLayer(spec,call));ensure();return rows;},async readPumps(){await authorizeDrainage(config,session);ensure();return readDrainageLayer(DRAINAGE_LAYERS.find(s=>s.kind==='pump'),call);},async readBoundaries(){await authorizeDrainage(config,session);ensure();return readDrainageLayer(DRAINAGE_LAYERS.find(s=>s.kind==='catchment'),call);},close(){alive=false;for(const c of pending)c.abort();pending.clear();}};
}
