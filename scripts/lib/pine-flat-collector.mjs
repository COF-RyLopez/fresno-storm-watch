import {parseHads,hadsUrl} from '../../site/lib/pine-flat-telemetry.js';
/** Independent bounded source checks. Failed checks preserve old timestamps and cannot cue changes. */
export async function collectPineFlatTelemetry({old,now,fetchImpl}){
 const pairs=await Promise.all(['PFTC1','PFQC1'].map(async id=>{
  const prior=old?.[id],result={...prior,id,lastAttempt:new Date(now).toISOString(),lastSuccess:prior?.lastSuccess||null,error:null};
  try{const r=await fetchImpl(new URL(hadsUrl(id)),{signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error(`NWS HADS HTTP ${r.status}`);Object.assign(result,parseHads(await r.text(),id,now),{lastSuccess:new Date(now).toISOString()});}
  catch(e){result.error=String(e.message||'NWS HADS unavailable').slice(0,180);}
  return [id,result];
 }));return Object.fromEntries(pairs);
}
