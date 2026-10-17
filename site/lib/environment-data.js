import { RADAR_URL,QPF_URL,radarFrames,qpfCycle } from './environment-model.js';

/** @param {string|URL} url @param {Function} fetchImpl @returns {Promise<object>} Bounded, credential-free public request. */
export async function environmentalJson(url,fetchImpl=fetch){
  const response=await fetchImpl(url,{signal:AbortSignal.timeout(25_000),credentials:'omit',cache:'no-store',headers:{Accept:'application/json'}});
  if(!response.ok)throw new Error(`Source returned HTTP ${response.status}`);
  const data=await response.json();if(data?.error)throw new Error('Publisher returned a service error.');return data;
}

/** @param {Function} fetchImpl @param {number} now @returns {Promise<object[]>} National CONUS catalog, independent of map panning. */
export async function fetchRadarFrames(fetchImpl=fetch,now=Date.now()){
  const url=new URL(`${RADAR_URL}/query`);
  url.search=new URLSearchParams({f:'json',where:"idp_subset = 'CONUS'",outFields:'objectid,idp_subset,idp_validtime,idp_ingestdate',returnGeometry:'false',orderByFields:'idp_validtime DESC',resultRecordCount:'1000'});
  return radarFrames(await environmentalJson(url,fetchImpl),now);
}

/** @param {object} period @param {Function} fetchImpl @param {number} now @returns {Promise<object>} Do not derive source timing from local rain/no-rain polygons. */
export async function fetchQpfCycle(period,fetchImpl=fetch,now=Date.now()){
  const url=new URL(`${QPF_URL}/${period.id}/query`);
  // The publisher advertises DISTINCT but returned HTTP-200 service errors for
  // that query. Read the bounded band rows and verify every row's cycle instead.
  url.search=new URLSearchParams({f:'json',where:'1=1',outFields:'product,issue_time,start_time,end_time,units',returnGeometry:'false',resultRecordCount:'2000'});
  return qpfCycle(await environmentalJson(url,fetchImpl),period.hours,now);
}
