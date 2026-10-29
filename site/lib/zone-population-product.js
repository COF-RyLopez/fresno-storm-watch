export const PRODUCT_METHOD='frog-zone-acs-batch/1';
export const estimatedResidents=n=>n===null?'Unavailable':n>0&&n<5?'<10':'≈ '+new Intl.NumberFormat('en-US').format(Math.round(n/10)*10);
export const zoneLabel=p=>p.name+'\n'+(p.population===null?'Estimate unavailable':estimatedResidents(p.population)+' residents');
const validTime=t=>Number.isFinite(t)&&t>0&&t<=Date.now()+300000;

/** The map and CSV show independently estimated zones, never an overlapping total. */
export function validateZoneProduct(meta,data){
  if(meta?.schema!==1||meta.method!==PRODUCT_METHOD||meta.period!=='2020–2024'||meta.baselineYear!==2020||!validTime(meta.built)||!validTime(meta.zonesChecked)||!meta.limits?.uncertainty||!meta.limits?.method||!meta.limits?.boundary)throw Error('Population source/version metadata is invalid.');
  if(meta.geojson?.file!=='zones.geojson'||!/^[a-f0-9]{64}$/.test(meta.geojson.sha256)||!Number.isSafeInteger(meta.geojson.bytes)||meta.geojson.bytes<1||meta.geojson.bytes>25000000||meta.csv?.file!=='zone-population.csv')throw Error('Population delivery manifest is invalid.');
  if(data?.type!=='FeatureCollection'||!Array.isArray(data.features)||data.features.length!==meta.counts?.zones||!data.features.length||data.features.length>1000)throw Error('Zone inventory is incomplete.');
  const seen=new Set();let estimated=0;
  for(const f of data.features){
    const p=f.properties;if(!Number.isSafeInteger(p?.oid)||seen.has(p.oid)||f.id!==p.oid||p.key!==`county-zone:${p.oid}`||typeof p.name!=='string'||!p.name.trim()||p.name.length>160||p.method!==PRODUCT_METHOD)throw Error('Zone identity is invalid or duplicated.');seen.add(p.oid);
    for(const k of ['population','samplingMoe'])if(p[k]!==null&&(!Number.isFinite(p[k])||p[k]<0))throw Error('Missing/invalid population must remain unknown.');
    if(!Number.isInteger(p.tracts)||p.tracts<0||!Number.isInteger(p.missing)||p.missing<0||!Number.isInteger(p.missingMoe)||p.missingMoe<0||!Number.isFinite(p.countyShare)||p.countyShare<0||p.countyShare>1.000001)throw Error('Population accounting is invalid.');
    if(p.population===null&&(typeof p.reason!=='string'||!p.reason.trim())||p.population!==null&&(p.missing||!p.tracts))throw Error('Unknown allocation must retain its reason.');
    if(p.population!==null)estimated++;
    if(f.geometry?.type!=='MultiPolygon'||!f.geometry.coordinates?.length)throw Error('Zone outline is missing.');
    for(const polygon of f.geometry.coordinates)for(const ring of polygon){if(ring.length<4||ring.some(([x,y])=>!Number.isFinite(x)||!Number.isFinite(y)||x< -125||x> -114||y<32||y>43)||ring[0][0]!==ring.at(-1)[0]||ring[0][1]!==ring.at(-1)[1])throw Error('Zone outline has invalid WGS84 coordinates.');}
  }
  if(estimated!==meta.counts.estimated||data.features.length-estimated!==meta.counts.unknown)throw Error('Estimate accounting does not reconcile.');return {meta,data};
}

export async function readZoneProduct({fetcher=fetch,base=new URL('../data/zone-population/',import.meta.url),signal}={}){
  const get=async name=>{const r=await fetcher(new URL(name,base),{credentials:'omit',cache:'no-store',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(30000)]):AbortSignal.timeout(30000)});if(!r.ok)throw Error('Population file HTTP '+r.status);return r;};
  const meta=await(await get('manifest.json')).json(),buffer=await(await get('zones.geojson')).arrayBuffer();
  if(buffer.byteLength!==meta.geojson?.bytes)throw Error('Population map download is incomplete.');
  const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',buffer))].map(b=>b.toString(16).padStart(2,'0')).join('');
  if(hash!==meta.geojson.sha256)throw Error('Population files belong to different snapshots; reload.');
  return validateZoneProduct(meta,JSON.parse(new TextDecoder().decode(buffer)));
}

export function zoneRows(features,query='',onlyUnknown=false){const q=query.trim().toLocaleLowerCase('en-US');return features.filter(f=>(!onlyUnknown||f.properties.population===null)&&f.properties.name.toLocaleLowerCase('en-US').includes(q)).sort((a,b)=>a.properties.name.localeCompare(b.properties.name,undefined,{numeric:true}));}

export async function boundaryFingerprint(rows){
  const text=JSON.stringify([...rows].sort((a,b)=>a.key.localeCompare(b.key)).map(z=>({key:z.key,name:z.name,geometry:z.geometry})));
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(b=>b.toString(16).padStart(2,'0')).join('');
}
