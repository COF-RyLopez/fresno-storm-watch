import {windForecast,validateWindSnapshot,GOES_URL,GOES_PRODUCTS,satelliteFrames} from './weather-model.js';
import {environmentalJson} from './environment-data.js';
import {pool} from './pool.js';

/** @param {object} options @returns {Promise<object>} Fall back to public NWS in memory if the scheduled copy is old/unavailable. */
export async function fetchCurrentWind({previous=null,fetchImpl=fetch,now=Date.now()}={}){
  let candidate=null;
  try{candidate=validateWindSnapshot(await environmentalJson(new URL('../data/wind-latest.json',import.meta.url),fetchImpl));}catch{/* Direct public-source check below; it must succeed before replacing prior evidence. */}
  const age=candidate?now-Date.parse(candidate.generatedAt):Infinity;
  if(candidate&&age>=-120_000&&age<=45*60_000&&candidate.sites.every(s=>s.forecast&&!s.error))return candidate;
  const directAge=previous?.sourceMode==='browser-direct'?now-Date.parse(previous.generatedAt):Infinity;
  if(directAge>=0&&directAge<15*60_000)return previous;
  const prior=candidate||previous;
  const selection=prior?{scope:prior.scope,sites:prior.sites.map(({id,name,longitude,latitude})=>({id,name,longitude,latitude}))}:await environmentalJson(new URL('../data/wind-watchlist.json',import.meta.url),fetchImpl);
  validateWindSnapshot({schemaVersion:1,generatedAt:new Date(now).toISOString(),sites:selection.sites.map(s=>({...s,forecast:null}))});
  return validateWindSnapshot(await fetchWindForecasts({selection,previous:prior,fetchImpl,now}));
}

/** @param {Function} fetchImpl @param {number} now @returns {Promise<object>} Validate WMS layer names and advertised frame times in the browser. */
export async function fetchSatelliteCatalog(fetchImpl=fetch,now=Date.now()){
  const url=new URL(GOES_URL);url.search=new URLSearchParams({service:'WMS',version:'1.3.0',request:'GetCapabilities'});
  const response=await fetchImpl(url,{signal:AbortSignal.timeout(25_000),credentials:'omit',cache:'no-store'});
  if(!response.ok)throw new Error(`GOES catalog HTTP ${response.status}`);
  const xml=new DOMParser().parseFromString(await response.text(),'application/xml');
  if(xml.querySelector('parsererror')||xml.getElementsByTagNameNS('*','ServiceException').length)throw new Error('GOES capabilities could not be read.');
  const layers=[...xml.getElementsByTagNameNS('*','Layer')],result={};
  for(const product of GOES_PRODUCTS){
    const node=layers.find(n=>[...n.children].some(c=>c.localName==='Name'&&c.textContent.trim()===product.id));
    const dimension=node&&[...node.children].find(c=>c.localName==='Dimension'&&c.getAttribute('name')==='time');
    if(!dimension)throw new Error(`GOES ${product.label} time catalog is missing.`);
    result[product.id]=satelliteFrames(dimension.textContent,now);
  }
  return result;
}

/** @param {string} url @param {Function} fetchImpl @param {object} headers @returns {Promise<object>} Trusted NWS requests, no credentials. */
async function nwsJson(url,fetchImpl,headers){
  const response=await fetchImpl(url,{signal:AbortSignal.timeout(25_000),credentials:'omit',headers:{Accept:'application/geo+json,application/json',...headers}});
  if(!response.ok)throw new Error(`NWS HTTP ${response.status}`);
  const data=await response.json();if(data?.status>=400||data?.error)throw new Error('NWS returned a source error.');return data;
}

/** @param {object} options @returns {Promise<object>} Two workers; each failed site retains explicitly dated prior data and an error. */
export async function fetchWindForecasts({selection,previous=null,fetchImpl=fetch,now=Date.now(),headers={},sourceMode='browser-direct'}={}){
  if(!Array.isArray(selection?.sites)||selection.sites.length>9)throw new Error('Wind inventory must contain at most nine configured points.');
  const results=await pool(selection.sites,2,async site=>{
    const old=previous?.sites?.find(s=>s.id===site.id);
    const row={...site,lastAttempt:new Date(now).toISOString(),lastSuccess:old?.lastSuccess||null,error:null,forecast:old?.forecast||null};
    try{
      const points=`https://api.weather.gov/points/${site.latitude.toFixed(4)},${site.longitude.toFixed(4)}`;
      const p=(await nwsJson(points,fetchImpl,headers)).properties;
      if(!/^[A-Z]{3}$/.test(p?.gridId)||!Number.isInteger(p?.gridX)||!Number.isInteger(p?.gridY))throw new Error('NWS point-to-grid mapping is invalid.');
      const grid={office:p.gridId,x:p.gridX,y:p.gridY};
      // Rebuild a trusted NWS URL rather than requesting a payload-supplied host.
      const url=`https://api.weather.gov/gridpoints/${grid.office}/${grid.x},${grid.y}`;
      row.forecast=windForecast(await nwsJson(url,fetchImpl,headers),grid,now);
      row.source=url;row.pointSource=points;row.lastSuccess=new Date(now).toISOString();
    }catch(error){row.error=String(error.name==='TimeoutError'?'NWS forecast request timed out':error.message||'NWS forecast check failed').slice(0,180);}
    return row;
  });
  return {schemaVersion:1,generatedAt:new Date(now).toISOString(),publisher:'NOAA National Weather Service',sourceMode,collection:sourceMode==='browser-direct'?'Direct NWS check while application open':'15-minute target, not guaranteed',scope:selection.scope,sites:results};
}
