import {concernSummary} from './mission-model.js?v=0.59.0';
import {pumpReadinessSummary} from './pump-summary-model.js';
import {roadInCurrentView} from './roads.js';
import {POWER_STATES} from './power-model.js';

export const CONCERN_TYPES=Object.freeze({river:'River area',care:'Resident care',pump:'Pump readiness',drainage:'Drainage group',power:'Utility record',road:'Road record',asset:'County facility'});
const TYPE_ORDER=Object.keys(CONCERN_TYPES);
const finite=v=>Number.isFinite(v)?v:null;
const base=(type,id,name,change,extra={})=>({key:`${type}:${id}`,type,id,name,change,private:false,time:null,timeLabel:'Source timing in evidence',owner:null,due:null,status:'Review',quality:'Verify source evidence',...extra});

/** Read-only adapters: reuse domain review decisions, never infer hazard clearance or a risk score. */
export function commandQueue({rivers=[],care=[],drainage=[],drainageReady=false,power=null,roads=null,assets=null}={}){
 const items=[];
 for(const row of rivers){const s=concernSummary(row);if(!s.review)continue;items.push(base('river',s.id,s.name,s.change,{time:s.forecast,timeLabel:'Forecast high',quality:s.quality}));}
 for(const r of care)if(r.review)items.push(base('care',r.key,r.name,r.reasons.join(' · '),{time:finite(r.zonesChecked),timeLabel:'County source checked',quality:r.gaps.length?'Incomplete evidence':'Spatial association · site conditions unconfirmed'}));
 if(drainageReady){
  for(const p of pumpReadinessSummary(drainage).rows){if(!p.attention)continue;const active=p.tasks.filter(t=>t.active||t.changed||t.conflict),owners=[...new Set(active.map(t=>t.owner).filter(Boolean))],due=active.map(t=>t.due).filter(Number.isFinite);items.push(base('pump',p.key,p.name,p.labels.join(' · '),{private:true,groupId:p.groupId,time:finite(p.rain.cycle?.start),timeLabel:'Rainfall window starts',owner:owners.join(', ')||null,due:due.length?Math.min(...due):null,status:active.some(t=>t.overdue)?'Overdue follow-up':active.length?'Assigned follow-up':'Readiness review',quality:p.current?'Owner report · verify event needs':'Readiness unconfirmed'}));}
  for(const r of drainage)if(r.review)items.push(base('drainage',r.id,r.name,r.change||'Drainage evidence needs review',{private:true,time:finite(r.cycle?.start),timeLabel:'Rainfall window starts',quality:r.gaps?.length?'Incomplete evidence':'Capacity and access unconfirmed'}));
 }
 for(const r of power?.rows||[]){if(['restored','cancelled'].includes(r.status))continue;items.push(base('power',r.key,r.name,`${r.utility} · ${POWER_STATES[r.status]||'Status unverified'}`,{time:finite(r.updated?.time),timeLabel:'Utility updated',quality:power.error||r.health?.length?'Source / record needs verification':'Published utility record · site power unconfirmed'}));}
 for(const r of roads?.snapshot?.rows||[]){if(!roadInCurrentView(r))continue;items.push(base('road',r.key,r.name,`${r.kind} · ${r.status}`,{time:finite(r.sourceTime||r.edited),timeLabel:'Source updated',quality:roads.error?'Retained record · source check failed':r.issues?.length?'Record needs verification':'Verify current access with road owner'}));}
 if(assets?.connected)for(const r of assets.sites||[])if(r.review)items.push(base('asset',r.site.key,r.site.name,'Facility power / readiness review',{private:true,time:finite(r.site.fetched),timeLabel:'Inventory retrieved',owner:r.site.owner||null,quality:'Spatial association · site power unconfirmed'}));
 // Stable entity keys prevent repeated joins from multiplying a location. Types retain their meaning.
 const unique=new Map(items.map(r=>[r.key,r]));
 return [...unique.values()].sort((a,b)=>Number(b.status==='Overdue follow-up')-Number(a.status==='Overdue follow-up')||TYPE_ORDER.indexOf(a.type)-TYPE_ORDER.indexOf(b.type)||a.name.localeCompare(b.name)||a.key.localeCompare(b.key));
}

/** Display filters never alter countywide domain counts or the underlying assessment. */
export function queuePage(items,{type='all',page=0,size=10}={}){
 const filtered=items.filter(r=>type==='all'||r.type===type),pages=Math.max(1,Math.ceil(filtered.length/size)),current=Math.max(0,Math.min(page,pages-1));
 return {rows:filtered.slice(current*size,(current+1)*size),total:filtered.length,page:current,pages};
}
