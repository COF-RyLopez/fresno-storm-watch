import {COPY_PARENT,COPY_VIEW,COPY_TAG,pumpCopyLayer,verifyCopySchema,verifyStagedCopy,readPumpCopy} from './pump-copy-model.js';
import {privateObjectIds} from './eoc-store.js?v=0.74.0-population';
import {copyUrl} from './pump-copy-data.js';

/** Only the existing county exercise owner may create or advance inventory snapshots. */
export function authorizePumpCopyAdmin(config,session){
  if(!config.enabled||config.environment!=='exercise'||session?.portal?.id!==config.orgId||session.username!==config.owner)throw Error('Only the county exercise owner can maintain the AGOL pump copy.');
}
export const snapshotQuery=id=>{if(!/^[a-f0-9-]{36}$/.test(id))throw Error('Invalid snapshot ID.');return `snapshot_id = '${id}'`;};
const capabilities=value=>new Set(String(value||'').toLowerCase().split(',').map(v=>v.trim()).filter(Boolean));
export function verifyCopyAccess(item,meta,{owner,isView}){
  if(item.owner!==owner||item.type!=='Feature Service'||!item.tags?.includes(COPY_TAG)||!['private','shared'].includes(item.access)||!isView&&item.access!=='private'||Boolean(meta.isView)!==isView)throw Error('Unexpected inventory ownership, sharing or service type. No copy was changed.');
  const caps=capabilities(meta.capabilities);
  if(!caps.has('query')||isView&&caps.size!==1||!isView&&[...caps].some(c=>!['query','create','editing'].includes(c)))throw Error('Inventory service permissions are not the expected private append-only/read-only settings.');
}
/** Complete bounded batches; reject repeated/missing hosted IDs even when counts happen to agree. */
export async function queryCopy(call,url,where='1=1'){
  const ids=await privateObjectIds(await call(url+'/query',{where,returnIdsOnly:true}),()=>call(url+'/query',{where,returnCountOnly:true}));
  if(ids.length>5000)throw Error('Inventory snapshot exceeds the bounded maintenance limit.');
  const meta=await call(url),oid=meta.objectIdField||meta.fields?.find(f=>f.type==='esriFieldTypeOID')?.name;if(!oid)throw Error('Hosted pump IDs are missing.');
  const features=[];
  for(let i=0;i<ids.length;i+=200){const batch=ids.slice(i,i+200),r=await call(url+'/query',{objectIds:batch.join(','),outFields:'*',returnGeometry:false});if(r.exceededTransferLimit||!Array.isArray(r.features)||r.features.length!==batch.length||new Set(r.features.map(f=>f.attributes?.[oid])).size!==batch.length||r.features.some(f=>!batch.includes(f.attributes?.[oid])))throw Error('Incomplete hosted pump-copy response.');features.push(...r.features);}
  return features;
}
/** A verified generation is made visible only after all rows have been read back intact. */
export async function advancePumpCopy({call,parentUrl,viewUrl,snapshot,onProgress=()=>{}}){
  const checkActive=async()=>{const current=await queryCopy(call,viewUrl+'/0');if(current.length&&readPumpCopy(current).sourceChecked>snapshot.checked)throw Error('A newer verified source snapshot is already active. Read FMFCD again before copying.');};
  await checkActive();
  const where=snapshotQuery(snapshot.id),existing=await queryCopy(call,parentUrl+'/0',where),have=new Map(existing.map(f=>[f.attributes.row_key,f]));
  if(have.size!==existing.length||existing.some(f=>!snapshot.features.some(s=>s.attributes.row_key===f.attributes.row_key)))throw Error('Unexpected staged records; the last verified view remains active.');
  // Retry a partially acknowledged request by its unique row keys, never by creating another generation.
  const missing=snapshot.features.filter(f=>!have.has(f.attributes.row_key));
  for(let i=0;i<missing.length;i+=100){const batch=missing.slice(i,i+100);onProgress(`Copying source records ${i+1}–${Math.min(i+100,missing.length)} of ${missing.length}…`);const result=await call(parentUrl+'/0/addFeatures',{features:JSON.stringify(batch),rollbackOnFailure:true});if(!Array.isArray(result.addResults)||result.addResults.length!==batch.length||result.addResults.some(r=>!r.success))throw Error('A source-copy batch was not confirmed. Retry the same prepared snapshot; the last verified view remains active.');}
  onProgress('Verifying the complete source snapshot before changing the form view…');
  await verifyStagedCopy(await queryCopy(call,parentUrl+'/0',where),snapshot);
  await checkActive();
  const query=where+' AND source_subtype = 1';
  await call(viewUrl.replace('/rest/services/','/rest/admin/services/')+'/0/updateDefinition',{updateDefinition:JSON.stringify({viewDefinitionQuery:query}),async:false});
  const meta=await call(viewUrl+'/0');if(meta.viewDefinitionQuery!==query&&meta.definitionExpression!==query)throw Error('AGOL has not confirmed the new view filter. Inspect the existing item before retrying.');
  const copy=readPumpCopy(await queryCopy(call,viewUrl+'/0'));
  if(copy.snapshot!==snapshot.id||copy.rows.length!==snapshot.counts.pumps)throw Error('The form view has not returned the verified source snapshot.');
  return copy;
}

/** Normal OAuth app requests; no credentials or private features are exported or persisted. */
export async function openPumpCopyAdmin(config,authConfig,session,loadSdk){
  authorizePumpCopyAdmin(config,session);
  const portal=authConfig.portalUrl.replace(/\/$/,''),[request]=await(await loadSdk()).import(['@arcgis/core/request.js']);let alive=true;const pending=new Set();
  const call=async(url,params={})=>{authorizePumpCopyAdmin(config,session);if(!alive)throw Error('Maintenance session ended.');const u=new URL(url);if(!url.startsWith(portal+'/sharing/rest/')&&!new RegExp(`^https://services[0-9]*\\.arcgis\\.com/${config.orgId}/arcgis/rest/(?:admin/)?services/${COPY_PARENT}(?:_read)?/FeatureServer(?:/|$)`).test(url))throw Error('Unapproved maintenance destination.');if(u.search||u.hash)throw Error('Maintenance requests must not contain URL parameters.');const controller=new AbortController();pending.add(controller);try{const r=await request(url,{method:'post',responseType:'json',cacheBust:true,timeout:55000,signal:controller.signal,query:{f:'json',...params,token:await session.getToken()}});if(!alive)throw Error('Maintenance session ended.');if(r.data?.error)throw Error(`AGOL maintenance request failed (${r.data.error.code||'unknown'}). Existing items were kept; inspect them before retrying.`);return r.data;}finally{pending.delete(controller);}};
  const itemUrl=id=>{if(!/^[a-f0-9]{32}$/.test(id))throw Error('Unexpected AGOL item ID.');return `${portal}/sharing/rest/content/items/${id}`;};
  const itemCheck=async(item,name,isView)=>{const url=copyUrl(item.url+'/0',config.orgId).replace(/\/0$/,'');if(!url.endsWith('/'+name+'/FeatureServer'))throw Error('Unexpected inventory service name.');const meta=await call(url);verifyCopyAccess(item,meta,{owner:config.owner,isView});return {...item,url,meta};};
  const find=async(name,isView)=>{const r=await call(portal+'/sharing/rest/search',{q:`owner:${config.owner} AND type:"Feature Service" AND tags:"${COPY_TAG}"`,num:100});if(r.nextStart>0)throw Error('Maintenance item search was truncated.');const matches=(r.results||[]).filter(i=>i.url?.endsWith('/'+name+'/FeatureServer'));if(matches.length>1)throw Error('Duplicate inventory services found. Ask GIS to inspect; do not recreate them.');return matches.length?itemCheck(await call(itemUrl(matches[0].id)),name,isView):null;};
  const waitLayer=async(url)=>{for(let i=0;i<20;i++){const meta=await call(url);if(meta.fields?.length){verifyCopySchema(meta);return meta;}await new Promise(resolve=>setTimeout(resolve,1000));}throw Error('AGOL is still finishing the existing pump layer. Keep the item and retry after it settles.');};
  const ensure=async(name,isView,parent=null)=>{
    let item=await find(name,isView);
    if(!item){const parameters={name,capabilities:isView?'Query':'Query,Create',spatialReference:{wkid:4326},initialExtent:pumpCopyLayer().extent,hasStaticData:false,maxRecordCount:2000,allowGeometryUpdates:false,preserveLayerIds:true,sourceSchemaChangesAllowed:false,isUpdatableView:false,options:{dataSourceType:'relational'}};
      const r=await call(`${portal}/sharing/rest/content/users/${config.owner}/createService`,{outputType:'featureService',isView,createParameters:JSON.stringify(parameters),tags:COPY_TAG,description:'Private F.R.O.G. exercise pump inventory copy. Source FMFCD MapServer/0; no readiness/contact data. Original source IDs and WGS84 XY are preserved. Do not share the parent.'});
      item=await itemCheck(await call(itemUrl(r.itemId)),name,isView);
    }
    const service=await call(item.url);
    if(service.tables?.length||service.layers?.some(l=>l.id!==0))throw Error('Unexpected layers in the existing inventory item.');
    if(!service.layers?.length){const layer=isView?{id:0,name:'Existing FMFCD pumps — private form',adminLayerInfo:{viewLayerDefinition:{sourceServiceName:COPY_PARENT,sourceLayerId:0,sourceLayerFields:'*'}}}:pumpCopyLayer();await call(item.url.replace('/rest/services/','/rest/admin/services/')+'/addToDefinition',{addToDefinition:JSON.stringify({layers:[layer]}),async:false});if(isView)await call(item.url.replace('/rest/services/','/rest/admin/services/')+'/0/updateDefinition',{updateDefinition:JSON.stringify({viewDefinitionQuery:'1=0'}),async:false});}
    await waitLayer(item.url+'/0');
    if(isView){const meta=await call(item.url+'/0');if(!meta.isView||capabilities(meta.capabilities).size!==1||!capabilities(meta.capabilities).has('query'))throw Error('The pump form view must be Query-only.');const admin=await call(item.url.replace('/rest/services/','/rest/admin/services/')+'/0');if(admin.adminLayerInfo?.viewLayerDefinition?.sourceServiceName!==COPY_PARENT)throw Error('The form view is not backed by the expected source-copy service.');}
    if(parent&&parent.id===item.id)throw Error('Parent and view cannot be the same item.');return item;
  };
  return {async publish(snapshot,onProgress){authorizePumpCopyAdmin(config,session);const parent=await ensure(COPY_PARENT,false),view=await ensure(COPY_VIEW,true,parent);const data=await call(itemUrl(view.id)+'/data')||{};if(data.frogPumpRefresh?.enabled)throw Error('Scheduled refresh owns this inventory. Pause its task and follow the manual recovery steps before using this page.');const copy=await advancePumpCopy({call,parentUrl:parent.url,viewUrl:view.url,snapshot,onProgress});if(data.frogPumpRefresh){const interval=data.frogPumpRefresh.intervalMinutes||60;await call(`${portal}/sharing/rest/content/users/${config.owner}/items/${view.id}/update`,{text:JSON.stringify({...data,frogPumpRefresh:{schema:'frog-pump-refresh-v1',enabled:false,state:'healthy',intervalMinutes:interval,maxLagMs:interval*180000,activeSnapshot:copy.snapshot,activeDigest:copy.digest,lastAttempt:copy.sourceChecked,lastSuccess:copy.sourceChecked,reasonCode:null}})});}return {parentId:parent.id,readItemId:view.id,readUrl:view.url+'/0',count:copy.rows.length,total:copy.total,sourceChecked:copy.sourceChecked,snapshot:copy.snapshot,sharing:view.access,parentAccess:parent.access};},close(){alive=false;for(const c of pending)c.abort();pending.clear();}};
}
