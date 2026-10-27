import {authorizeDrainage} from './drainage-model.js';
import {FMFCD_DETAIL_URL,FMFCD_DETAIL_LIMIT,FMFCD_DETAIL_LAYERS,drainageDetailScope,drainageDetailSchema,drainageDetailRecord} from './drainage-nearby-model.js?v=0.53.0';
import {FMFCD_WEBMAP_DATA,fmfcdRendererOverrides} from './fmfcd-symbology.js?v=0.54.0';

/** Read the complete spatial ID inventory before bounded batches. No geometry simplification or silent truncation. */
export async function readDrainageDetail(spec,scope,call,override=null){
  const meta=await call('/'+spec.id,{}),oid=drainageDetailSchema(spec,meta);
  const inventory=await call('/'+spec.id+'/query',{...scope,returnIdsOnly:true});
  let ids=inventory.objectIds;
  if(ids===null){const n=await call('/'+spec.id+'/query',{...scope,returnCountOnly:true});if(n.count!==0||n.exceededTransferLimit)throw Error('Empty inventory could not be verified.');ids=[];}
  if(!Array.isArray(ids)||inventory.exceededTransferLimit||new Set(ids).size!==ids.length||ids.some(id=>!Number.isSafeInteger(id)||id<0))throw Error('Publisher inventory is incomplete or duplicated.');
  if(ids.length>FMFCD_DETAIL_LIMIT)throw Error('Too many nearby records. Choose a smaller distance.');
  const rows=[];
  for(let i=0;i<ids.length;i+=100){
    const batch=ids.slice(i,i+100),data=await call('/'+spec.id+'/query',{objectIds:batch.join(','),outFields:[oid,...spec.fields].join(','),returnGeometry:true,outSR:4326,returnZ:false,returnM:false});
    if((data.spatialReference?.latestWkid||data.spatialReference?.wkid)!==4326||data.exceededTransferLimit||!Array.isArray(data.features)||data.features.length!==batch.length||new Set(data.features.map(f=>f.attributes?.[oid])).size!==batch.length||data.features.some(f=>!batch.includes(f.attributes?.[oid])))throw Error('Nearby records changed, were truncated or returned an unexpected CRS. Refresh required.');
    rows.push(...data.features.map(f=>drainageDetailRecord(spec,f,oid)));
  }
  return {spec,rows,renderer:override||meta.drawingInfo?.renderer||null,sourceEdited:meta.editingInfo?.dataLastEditDate??meta.editingInfo?.lastEditDate??null,checked:Date.now(),error:null};
}

/** Public FMFCD reads inside the private UI. County credentials are checked locally and NEVER sent to FMFCD. */
export async function openDrainageDetail(config,session,{fetcher=fetch}={}){
  const authorize=async()=>{await authorizeDrainage(config,session);await session.getToken();};
  await authorize();let alive=true,request=null;
  return {async read(record,{radius=500,planned=false}={}){
    await authorize();if(!alive)throw Error('Private drainage session ended.');request?.abort();
    const controller=new AbortController();request=controller;
    const current=()=>alive&&request===controller&&!controller.signal.aborted;
    const scope=drainageDetailScope(record,radius),json=async(url,query)=>{
      if(!current())throw new DOMException('Selection changed','AbortError');
      const response=await fetcher(url,{method:'POST',credentials:'omit',cache:'no-store',redirect:'error',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(25000)]),headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({f:'json',...query})});
      if(!response.ok)throw Error(`FMFCD HTTP ${response.status}`);
      const data=await response.json();if(!current())throw new DOMException('Selection changed','AbortError');
      if(data.error)throw Error('FMFCD query unavailable. Check the publisher service.');return data;
    };
    const call=(suffix,query)=>json(FMFCD_DETAIL_URL+suffix,query);
    let overrides={},styleError=null;
    try{overrides=fmfcdRendererOverrides(await json(FMFCD_WEBMAP_DATA,{}));}
    catch{if(!current())return null;styleError='FMFCD web-map styling unavailable; source-service / reference symbols used.';}
    const specs=FMFCD_DETAIL_LAYERS.filter(s=>planned||!s.planned),layers=[];
    // Two layers at once bounds traffic and decoding on EOC phones.
    for(let i=0;i<specs.length&&current();i+=2){
      const pair=specs.slice(i,i+2),values=await Promise.allSettled(pair.map(spec=>readDrainageDetail(spec,scope,call,overrides[spec.id])));
      values.forEach((value,j)=>layers.push(value.status==='fulfilled'?value.value:{spec:pair[j],rows:[],sourceEdited:null,checked:Date.now(),error:value.reason.message}));
    }
    if(!current())return null;
    try{await authorize();}catch(error){controller.abort();throw error;}
    if(!current())return null;
    return {layers,checked:Date.now(),radius,planned,source:FMFCD_DETAIL_URL,styleError};
  },close(){alive=false;request?.abort();}};
}
