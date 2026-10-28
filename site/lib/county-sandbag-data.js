import {SANDBAG_SOURCE,SANDBAG_APP,SANDBAG_CONFIG,normalizeSandbags,validateSandbagSnapshot} from './county-sandbag-model.js';
const FIELDS='fid,rdyard_nm,rdyard_num,rdyard_add,rdyard_a_1,active,jointlocation,dt_maint,modifiedda';
async function json(url,fetchImpl){const r=await fetchImpl(url,{credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(25000)});if(!r.ok)throw new Error('County sandbag HTTP '+r.status);const value=await r.text();if(value.length>500000)throw new Error('County sandbag response too large');const d=JSON.parse(value);if(d.error)throw new Error('County sandbag GIS error '+(d.error.code||'unknown'));return d;}
function ids(d){if(!Array.isArray(d.objectIds)||d.objectIds.length>1000||new Set(d.objectIds).size!==d.objectIds.length||d.objectIds.some(id=>!Number.isSafeInteger(id)||id<0))throw new Error('County sandbag ID inventory invalid');return [...d.objectIds].sort((a,b)=>a-b);}

/** Public read-only collection, exact ID reconciliation and no stock-readiness inference. Preserve last success on failure. */
export async function collectSandbags({county,previous=null,fetchImpl=fetch,now=Date.now()}={}){
  const at=new Date(now).toISOString(),snapshot={schemaVersion:1,countyGeoid:'06019',source:SANDBAG_SOURCE,app:SANDBAG_APP,generatedAt:at,lastAttempt:at,lastSuccess:previous?.lastSuccess||null,error:null,appSubtitle:previous?.appSubtitle||null,rows:previous?.rows||[],accounting:previous?.accounting||{read:0,active:0,unknown:0,inactive:0,mapped:0,unmapped:0}};
  try{
    const [inventory,app]=await Promise.all([json(SANDBAG_SOURCE+'/query?f=json&where=1%3D1&returnIdsOnly=true',fetchImpl),json(SANDBAG_CONFIG,fetchImpl)]);
    const before=ids(inventory),features=[];
    if(!before.length){const count=await json(SANDBAG_SOURCE+'/query?f=json&where=1%3D1&returnCountOnly=true',fetchImpl);if(count.count!==0)throw new Error('Empty county sandbag inventory unverified');}
    for(let i=0;i<before.length;i+=100){const chunk=before.slice(i,i+100),query=new URLSearchParams({f:'json',objectIds:chunk.join(','),outFields:FIELDS,outSR:'4326',returnGeometry:'true'}),batch=await json(SANDBAG_SOURCE+'/query?'+query,fetchImpl);
      if(!Array.isArray(batch.features)||batch.exceededTransferLimit||batch.features.length!==chunk.length||new Set(batch.features.map(f=>f.attributes?.fid)).size!==chunk.length||batch.features.some(f=>!chunk.includes(f.attributes?.fid))||(batch.spatialReference?.latestWkid||batch.spatialReference?.wkid)!==4326)throw new Error('County sandbag query incomplete or changed');
      features.push(...batch.features);
    }
    const after=ids(await json(SANDBAG_SOURCE+'/query?f=json&where=1%3D1&returnIdsOnly=true',fetchImpl));if(JSON.stringify(before)!==JSON.stringify(after))throw new Error('County sandbag inventory changed during collection');
    Object.assign(snapshot,normalizeSandbags(features,{wkid:4326},county),{lastSuccess:at,appSubtitle:typeof app.subtitle==='string'?app.subtitle.slice(0,120):null});
  }catch(error){snapshot.error=String(error.message||'Collection unavailable').slice(0,180);}
  return validateSandbagSnapshot(snapshot,now);
}
