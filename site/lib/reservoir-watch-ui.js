import {elClass as el,classLink as link} from './dom.js';
import {RESERVOIR_CONNECTION_NOTE} from './reservoir-watch-summary.js';

/** Dated source observations; collapsed qualifications keep the main evidence concise. */
export function appendReservoirWatch(host,row,time){
 const values=[...(row.releases||[]),...(row.pools||[])];if(!values.length)return;
 const report=(p,d)=>d==='D'?`Report date ${p?.reportDate||'unknown'} · PST`:time(p?.time);
 host.append(el('h3','Reservoir changes'));
 for(const id of [...new Set(values.map(v=>v.station))]){
  const station=values.filter(v=>v.station===id),section=el('section','','watch-evidence-source');
  section.append(el('strong',station[0].name));
  for(const s of station){
   const pool=s.metric==='elevation',unit=pool?'ft':'cfs',format=v=>Number.isFinite(v)?v.toLocaleString('en-US',{minimumFractionDigits:pool?2:0,maximumFractionDigits:pool?2:0}):'Unknown';
   section.append(el('p',`${s.label}: ${format(s.sample?.value)} ${unit}${s.current?'':' · old / unverified'}`),el('p',report(s.sample,s.duration)));
   section.append(el('p',s.delta===null?`Change unavailable · ${s.reason}`:`${s.delta>0?'+':''}${format(s.delta)} ${unit} over ${s.hours.toFixed(1)} h · prior ${report(s.prior,s.duration)}`));
   if(s.current&&s.reason.includes('not posted'))section.append(el('p',s.reason));
  }
  if(station[0].source)section.append(link('CDEC source',station[0].source));host.append(section);
 }
 const rain=row.rainfall;
 if(rain)host.append(el('p',`Rain forecast window: ${time(rain.cycle?.start)} → ${time(rain.cycle?.end)} · issued ${time(rain.cycle?.issue)}${rain.usable?'':' · unavailable / stale'}`));
 host.append(el('p',row.gauges?.length?'Compare the connected gauge observations below; reservoir and gauge report times differ.':'No downstream gauge connected. Confirm Kings River conditions with NWS and the operator.','watch-context'));
 const detail=el('details'),summary=el('summary','Connection limits & source checks');detail.append(summary,el('p',RESERVOIR_CONNECTION_NOTE));
 for(const s of values)detail.append(el('p',`${s.station} ${s.label} · collected ${time(s.lastSuccess)} · app checked ${time(s.checked)} · ${s.reason}`));
 host.append(detail);
}
