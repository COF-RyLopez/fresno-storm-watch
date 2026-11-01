/** Storm now: simple, explainable "where to look next" rules. A planning aid, never an alert service or risk score. */
import {fresh} from './source-health-model.js';
import {roadInCurrentView} from './roads.js';

const HOUR=3_600_000;
/** Owner-adjustable settings. Extents are WGS84 bounds used by the Focus control. */
export const STORM_CONFIG=Object.freeze({
  usgsNowFtPerHour:0.5,   // USGS stage rise at or above this rate on current data -> Now
  usgsNextFtPerHour:0.2,  // ... at or above this (below Now) -> Next
  staleMs:2*HOUR,         // gauge / river evidence older than this is "Old" and ranks Verify
  nwsStaleMs:420_000,     // regional NWS check overdue (matches CONFIG.staleMs)
  roadStaleMs:420_000,    // county road check overdue (matches roads.js roadHealth)
  roadNewMs:HOUR,         // "new" county closure window
  extents:{
    // FMFCD drainage service area: extent of the public FMFCD "Drainage Boundaries" layer
    // (FMFCD_Layers/FeatureServer/0, 303 areas, queried 2026-11-01), lightly padded.
    metro:{xmin:-119.95,ymin:36.65,xmax:-119.57,ymax:36.94},
    // Eastern foothills: Big Dry / Dry / Fancher / Dog / Redbank creeks, Friant (Millerton) to Pine Flat.
    creeks:{xmin:-119.82,ymin:36.62,xmax:-119.25,ymax:37.06}
  },
  // Layer presets applied by the Focus control (keys from LAYER_LABELS). Cameras keep the operator's choice.
  presets:{
    all:{drainage:true,drainageAreas:true,roads:true,gauges:true,areas:true,waterways:false,reservoirs:false,alerts:true},
    metro:{drainage:true,drainageAreas:true,roads:true,gauges:false,areas:false,waterways:false,reservoirs:false,alerts:true},
    creeks:{drainage:false,drainageAreas:false,roads:false,gauges:true,areas:true,waterways:true,reservoirs:true,alerts:true}
  },
  // Foothill creeks without a live gauge in this app. Big Dry, Fancher and Redbank match
  // data/flood-scenarios/index.json; Dry Creek and Dog Creek are owner-named (no scenario there).
  ungaugedCreeks:['Big Dry Creek','Dry Creek','Fancher Creek','Dog Creek','Redbank Creek']
});
export const TIERS=Object.freeze({1:{label:'NWS',icon:'exclamation-mark-triangle'},2:{label:'Now',icon:'arrow-up'},3:{label:'Next',icon:'clock'},4:{label:'Verify',icon:'information'}});
export const FOCUS=Object.freeze({all:'All',metro:'Metro drainage',creeks:'Creeks & rivers'});

const num=v=>Number.isFinite(v)?v:null;
const latest=values=>{const v=values.filter(Number.isFinite);return v.length?Math.max(...v):null;};
const ft=(d,h)=>`${d>=0?'+':''}${d.toFixed(1)} ft in ${h.toFixed(1)} h`;
function item(key,{tier,place,why,source,time=null,stale=false,focus,rise=null,peak=null,open,tag=null},now){
  const age=time===null?null:Math.max(0,now-time);
  // Old evidence never ranks above Verify; NWS warnings stay first but carry an overdue tag.
  return {key,tier:stale&&tier!==1?4:tier,place,why,source,time,age,stale,focus,rise,peak,open,tag};
}
const UNGAUGED_KEY='creek:ungauged';
const order=(a,b)=>a.tier-b.tier||(a.key===UNGAUGED_KEY)-(b.key===UNGAUGED_KEY)||(b.rise??-Infinity)-(a.rise??-Infinity)||(a.peak??Infinity)-(b.peak??Infinity)||a.place.localeCompare(b.place)||a.key.localeCompare(b.key);

/** @param {number|null} ms @returns {string} */
export const ageLabel=ms=>ms===null?'age unknown':ms<60_000?'under 1 min old':ms<HOUR?`${Math.floor(ms/60_000)} min old`:`${Math.floor(ms/HOUR)} h ${Math.floor(ms%HOUR/60_000)} min old`;

/** @param {object} inputs @param {number} now @returns {object[]} Rows for the requested focus, ranked. */
export function stormFocus({alerts=[],alertCheck=null,areas=[],drainage=null,signedIn=false,roads=null,usgs=null,watchlist=[],focus='all'}={},now=Date.now()){
  const rows=[],c=STORM_CONFIG;
  const nwsOverdue=!alertCheck||!!alertCheck.error||!fresh(alertCheck.checked,c.nwsStaleMs,now);
  for(const a of alerts)if(a.category==='Warning'&&/flood/i.test(a.type)&&a.counties.includes('Fresno'))
    rows.push(item('nws:'+a.key,{tier:1,place:a.type,why:'Active NWS flood-type warning covering Fresno County',source:'NWS '+(a.office||''),time:num(a.issued),stale:nwsOverdue,tag:nwsOverdue?'NWS check overdue':null,focus:'both',peak:num(a.onset),open:{kind:'alert',id:a.key}},now));

  for(const r of areas){
    if(!r.rank)continue;
    const rising=(r.rising||[]).map(g=>({g,t:g.assessment.trend})).filter(x=>x.t&&x.t.hours>0);
    const rates=rising.filter(x=>x.g.gauge?.observed.units==='ft').map(x=>x.t.delta/x.t.hours);
    const tier=r.rank>=4||(r.rank===3&&rising.length)?2:r.rank>=2?3:4;
    const detail=rising.length&&rising[0].g.gauge?.observed.units==='ft'?' · '+ft(rising[0].t.delta,rising[0].t.hours):r.rank===1?` · ${r.gaps.length} evidence gaps`:'';
    const time=latest([...(r.gauges||[]).map(g=>g.assessment?.observed?.time),r.rainfall?.checked]);
    rows.push(item('area:'+r.area.id,{tier,place:r.area.name,why:r.status+detail,source:r.rank===2?'WPC rainfall · NWPS':'NWPS river gauges',time,stale:time===null||now-time>c.staleMs,focus:'creeks',rise:rates.length?Math.max(...rates):null,peak:(r.gauges||[]).map(g=>g.assessment?.peak?.time).filter(Number.isFinite).sort((x,y)=>x-y)[0]??null,open:{kind:'area',id:r.area.id}},now));
  }

  if(drainage?.ready)for(const r of drainage.rows||[]){
    if(!r.review)continue;
    const tier=r.powerRain||r.powerReview?2:r.combined||r.rainfall?3:4;
    rows.push(item('drainage:'+r.id,{tier,place:r.name,why:r.change,source:r.powerReview||r.powerRain?'FMFCD · utility records':'FMFCD · WPC rainfall',time:num(r.inventoryChecked),stale:!r.inventoryCurrent,focus:'metro',open:{kind:'drainage',id:r.id}},now));
  }
  else if(!signedIn)rows.push(item('signin:drainage',{tier:4,place:'Metro drainage evidence needs county sign-in',why:'Pump and basin reviews are private; public drainage areas stay on the map',source:'FMFCD · county sign-in',focus:'metro',open:{kind:'signin'}},now));
  else rows.push(item('load:drainage',{tier:4,place:'Metro drainage reviews not loaded',why:'Load FMFCD records to assess basins and pumps',source:'FMFCD · county sign-in',focus:'metro',open:{kind:'drainage-load'}},now));

  const snap=roads?.snapshot,closures=(snap?.rows||[]).filter(r=>r.layer!==2&&roadInCurrentView(r,now));
  const added=closures.filter(r=>{const t=r.start??r.sourceTime;return Number.isFinite(t)&&t<=now&&now-t<=c.roadNewMs;}).length;
  const roadStale=!!roads?.error||!snap||!fresh(snap.checked,c.roadStaleMs,now);
  // A current check with no open closure has nothing to look at; a failed or old check always shows.
  if(roadStale||closures.length)rows.push(item('roads:summary',{tier:4,place:'County road closures',why:snap?`${closures.length} county closures · ${added} new in last hour`:roads?.error?'County road feed failed; no current count':'No county road check yet',source:'Fresno County road records',time:num(snap?.checked),stale:roadStale,focus:'both',open:{kind:'roads'}},now));

  for(const s of watchlist){
    const r=usgs?.readings?.get(s.site),base={place:s.name,source:'USGS '+s.site,focus:'creeks',open:{kind:'usgs',id:s.site}};
    if(!r?.stage){rows.push(item('usgs:'+s.site,{...base,tier:4,why:usgs?.error?'USGS check failed; no current stage':usgs?'No recent stage value returned':'Waiting for first USGS check',time:num(r?.flow?.time),stale:true},now));continue;}
    const stale=now-r.stage.time>c.staleMs,rate=r.rise?r.rise.rate:null,flood=Number.isFinite(s.floodStageFt)&&r.stage.value>=s.floodStageFt;
    const tier=flood||rate>=c.usgsNowFtPerHour?2:rate>=c.usgsNextFtPerHour?3:stale?4:0;
    if(!tier)continue;
    rows.push(item('usgs:'+s.site,{...base,tier,why:(flood?`At/above flood stage ${s.floodStageFt} ft · `:'')+(r.rise?`${ft(r.rise.delta,r.rise.hours)} (${rate.toFixed(2)} ft/h)`:'Rise unknown'),time:r.stage.time,stale,rise:rate},now));
  }
  // One standing reminder, not one row per creek: a permanent gap must not crowd out live signals.
  const ungauged=c.ungaugedCreeks.filter(creek=>!watchlist.some(s=>s.creek===creek));
  if(ungauged.length)rows.push(item(UNGAUGED_KEY,{tier:4,place:'Foothill creeks without a live gauge',why:ungauged.join(', ')+' · check FMFCD and field reports',source:'No live gauge',focus:'creeks',open:{kind:'creek',id:ungauged.join(', ')}},now));

  return rows.filter(r=>focus==='all'||r.focus==='both'||r.focus===focus).sort(order);
}
