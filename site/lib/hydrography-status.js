/** Reference freshness only: acquisition is not a field observation or flow reading. */
export function hydrographyStatus(data,now=Date.now()){
 const stamp=Date.parse(data?.lastSuccessAt);
 const valid=Number.isFinite(stamp)&&stamp<=now;
 const date=valid?new Intl.DateTimeFormat('en-US',{timeZone:'America/Los_Angeles',month:'short',day:'numeric',year:'numeric',timeZoneName:'short'}).format(new Date(stamp)):'unknown';
 const state=data?.state==='failed'?'Refresh failed; previous reference retained':!valid||now-stamp>9*86400000?'Reference refresh overdue or unconfirmed':'Weekly reference refresh';
 return `${state} · last validated ${date}. USGS 3DHP waterways and water bodies; retrieval date is not a new survey date. Fresno-intersecting coverage, not the full upstream watersheds. Outlines are not current water levels; connections and travel times remain unverified.`;
}

/** Load when the user opens reference details; no additional banner or persistent data. */
export function installHydrographyStatus(fetchImpl=fetch){
 const block=document.querySelector('.reference-legend');if(!block)return;
 const note=document.createElement('p');note.className='environment-note';note.id='hydrography-refresh-status';note.setAttribute('role','status');block.prepend(note);
 let loaded=false;
 block.addEventListener('calciteBlockToggle',async()=>{
  if(!block.open||loaded)return;loaded=true;note.textContent='Checking waterway reference refresh…';
  try{const r=await fetchImpl(new URL('../basemaps/frog-waterways-dark/refresh-status.json',import.meta.url),{credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(12000)});if(!r.ok)throw Error();note.textContent=hydrographyStatus(await r.json());}
  catch{loaded=false;note.textContent='Waterway refresh status unavailable. The displayed reference is not a live flow or shoreline observation.';}
 });
}
