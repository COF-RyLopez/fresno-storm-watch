import {facilityService,facilityFields,normalizeFacility,FACILITY_LIMIT} from './facility-model.js';
import {powerScope} from './power-geometry.js';
import {countyGeometry} from './model.js';

/** @param {object} source @param {object} metadata @param {Function} query @param {object} county @returns {Promise<object>}
 * Read-only inventory with explicit accounting. Reject truncated/changing ID batches; quarantine bad locations/IDs.
 */
export async function queryFacilities(source,metadata,query,county) {
  const fields=facilityFields(metadata,source.fields),inventory=await query({where:'1=1',returnIdsOnly:true});
  let ids=inventory.objectIds;
  if (ids===null) { const count=await query({where:'1=1',returnCountOnly:true}); if(count.count!==0)throw new Error('Site inventory could not be reconciled.');ids=[]; }
  if (!Array.isArray(ids)||ids.some(id=>!Number.isSafeInteger(id))||new Set(ids).size!==ids.length||ids.length>FACILITY_LIMIT||inventory.exceededTransferLimit) throw new Error(`Incomplete site inventory or more than ${FACILITY_LIMIT.toLocaleString()} sites. Request a smaller county view.`);
  if (!metadata.objectIdField) throw new Error('Site layer is missing an ObjectID field.');
  const rows=[],seen=new Set(),accounting={returned:0,inCounty:0,outsideCounty:0,rejected:0};
  const scope=powerScope(countyGeometry(county.geometry));
  for (let i=0;i<ids.length;i+=100) {
    const batch=ids.slice(i,i+100),data=await query({objectIds:batch.join(','),outFields:fields.join(','),returnGeometry:true,outSR:4326});
    const wkid=data.spatialReference?.latestWkid||data.spatialReference?.wkid;
    if (wkid!==4326||!Array.isArray(data.features)||data.exceededTransferLimit||data.features.length!==batch.length||new Set(data.features.map(f=>f.attributes?.[metadata.objectIdField])).size!==batch.length||data.features.some(f=>!batch.includes(f.attributes?.[metadata.objectIdField]))) throw new Error('Site query was incomplete, changed during reading, or did not return WGS84 coordinates.');
    for (const f of data.features) {
      accounting.returned++;let site;
      try {site=normalizeFacility({...f,geometry:f.geometry?{...f.geometry,spatialReference:f.geometry.spatialReference||{wkid:4326}}:null},source,metadata);}catch{accounting.rejected++;continue;}
      if(seen.has(site.key))throw new Error('Stable site IDs are duplicated within this layer. Ask GIS to repair the identifier mapping.');
      seen.add(site.key);
      if(scope.intersects(site.geometry)){rows.push(site);accounting.inCounty++;}else accounting.outsideCounty++;
    }
  }
  return {rows,accounting};
}

/** @param {string} url @param {object} session @param {Function} loadSdk @returns {Promise<object>} Authenticated POST-only adapter; no edits, exports or browser persistence. */
export async function openFacilitySource(url,session,loadSdk) {
  if(session?.portal?.id!=='ibgDyuD2DLBge82s')throw new Error('Sign in with a county AGOL account before connecting sites.');
  let safe=facilityService(url,true);const [request]=await(await loadSdk()).import(['@arcgis/core/request.js']);
  const pending=new Set();let alive=true;
  const call=async (suffix,params)=>{
    if(!alive)throw new Error('Site connection ended.');
    const controller=new AbortController();pending.add(controller);
    try {
      const response=await request(safe+suffix,{method:'post',responseType:'json',cacheBust:true,signal:controller.signal,timeout:25000,query:{f:'json',...params}});
      if(!alive)throw new Error('Site connection ended.');
      if(response.data?.error)throw Object.assign(new Error('County service denied or failed the request.'),{code:response.data.error.code});
      return response.data;
    }catch(error) {
      const codes=[error.code,error.details?.httpStatus,error.details?.raw?.code,error.details?.raw?.error?.code,error.details?.error?.code];
      const accessDenied=codes.some(c=>[401,403,498,499].includes(Number(c)))||/identity-manager|not-authorized|sign-in|credentials/i.test(error.name||'');
      throw Object.assign(new Error('County site service unavailable or access denied. Check your sign-in and layer permissions.'),{accessDenied});
    }
    finally {pending.delete(controller);}
  };
  try {
    let metadata=await call('',{});
    if(!/\/\d+$/.test(new URL(safe).pathname)){
      const layers=(metadata.layers||[]).filter(l=>!l.subLayerIds?.length);
      if(layers.length!==1)throw new Error('Choose a layer number from this service: '+layers.map(l=>`${l.id}: ${l.name}`).join('; '));
      safe=facilityService(`${safe}/${layers[0].id}`);metadata=await call('',{});
    }
    if(!['esriGeometryPoint','esriGeometryPolygon'].includes(metadata.geometryType))throw new Error('Select a county point or building-footprint polygon feature layer.');
    return {url:safe,metadata,query:params=>call('/query',params),close(){alive=false;for(const c of pending)c.abort();pending.clear();}};
  } catch(error){alive=false;throw error;}
}
