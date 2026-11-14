import {elClass as el,classLink as link} from './dom.js';
import {RESERVOIR_CONNECTION_NOTE} from './reservoir-watch-summary.js';

/** Current values first; provenance and comparison checks remain available on expansion. */
export function appendReservoirWatch(host,row,time){
 const values=[...(row.releases||[]),...(row.pools||[])];if(!values.length)return;
 const report=(p,d)=>d==='D'?`Report ${p?.reportDate||'unknown'} · PST`:time(p?.time);
 const fmt=(v,d=2)=>Number.isFinite(v)?v.toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d}):'Unknown';
 host.append(el('h3','Conditions at a glance'));
 const grid=el('dl','','watch-condition-grid'),cell=(label,value,stamp,note,current)=>{
  const item=el('div','','watch-condition-cell');item.dataset.current=String(current);
  item.append(el('dt',label),el('dd',value),el('small',stamp),el('small',note));grid.append(item);
 };
 for(const s of values){
  const pool=s.metric==='elevation',unit=pool?'ft':'cfs',d=pool?2:0;
  const delta=s.delta===null?'Change unverified':`${s.delta>0?'↑ +':s.delta<0?'↓ ':'→ '}${fmt(s.delta,d)} ${unit} / ${s.hours.toFixed(1)} h`;
  cell(`${s.station} · ${pool?'Pool level':s.label}`,`${fmt(s.sample?.value,d)} ${unit}`,report(s.sample,s.duration),`${s.current?delta:'Old / unverified'}${s.backup?' · NWS backup':''}`,s.current);
 }
 const rain=row.rainfall;
 if(rain)cell('Rain forecast · 72 h',`${fmt(rain.maximum)} in`,`${time(rain.cycle?.start)} → ${time(rain.cycle?.end)}`,rain.usable?'Highest watchpoint sample · not basin runoff':'Unavailable / stale',rain.usable);
 for(const q of row.gauges||[]){const a=q.assessment;
  cell(q.id==='PFQC1'?'Below dam · stage':`${q.id} · ${q.gauge?.observed?.name||'Gauge'}`,a?.observed?`${fmt(a.observed.value)} ${q.gauge.observed.units}`:'Unknown',time(a?.observed?.time),!a?.current?'Old / unverified':a.trend?`${a.trend.delta>0?'↑ +':a.trend.delta<0?'↓ ':'→ '}${fmt(a.trend.delta)} ${q.gauge.observed.units} / ${a.trend.hours.toFixed(1)} h`:'Trend unavailable',a?.current);
 }
 host.append(grid);
 if(row.gauges?.some(g=>g.id==='PFQC1'))host.append(el('p','PFQC1: provisional near-dam stage only. No forecast, farther-downstream coverage or verified travel time.','watch-context'));
 else if(!row.gauges?.length)host.append(el('p','Downstream gauge unavailable · verify conditions with NWS and the operator.','watch-context'));
 const detail=el('details'),summary=el('summary','Sources, report times & connection limits');detail.append(summary,el('p',RESERVOIR_CONNECTION_NOTE));
 for(const s of values){detail.append(el('p',`${s.name} · ${s.label}: ${s.reason}. Collected ${time(s.lastSuccess)}; app checked ${time(s.checked)}.`));if(s.source)detail.append(link(s.publisher||'CDEC observations',s.source));}
 if(rain)detail.append(el('p',`WPC rainfall issued ${time(rain.cycle?.issue)}. ${rain.gaps||0} sample amounts unknown.`));
 host.append(detail);
}
