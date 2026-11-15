import {buildReleaseTrend,TREND_REACHES} from './release-trend-model.js';
import {HOUR,riverValue} from './river-model.js';
import {upstreamReservoir} from './watch-watershed-data.js';
import {precipitationTimeline,timelineSnapshotCurrent,RESERVOIR_NAMES,RISE_OUTLET,TIMELINE_QPF_URL} from './watershed-timeline-model.js';
import {watershedTimelineChart} from './watershed-timeline-chart.js';
import {positiveChange} from './planning-model.js';
import {el,elClass,link} from './dom.js';

const asset=new URL('../data/watershed-timeline.json',import.meta.url);
const wwdh='https://api.wwdh.internetofwater.app/collections/teacup-edr/items/Millerton';
const when=(value,format)=>Number.isFinite(value)?format.format(value):'Time unavailable';

/** Use the original gauge and CDEC snapshots. Fetch just one public timeline document. */
export function createWatershedTimeline({config,timeZone,exercise}){
 const format=new Intl.DateTimeFormat('en-US',{timeZone,weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'});
 const time=value=>when(value,format);
 const windowTime=row=>format.formatRange(row.start,row.end);
 let active,reservoirs={},entries=new Map(),stations=new Map(),snapshot,checked=0,pending;

 function collect(){
  if(exercise||pending||Date.now()-checked<5*60_000)return;
  checked=Date.now();
  pending=fetch(asset,{cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(12000)})
   .then(response=>{if(!response.ok)throw Error('Timeline unavailable');return response.json();})
   .then(data=>{snapshot=data;}).catch(()=>{snapshot=null;}).finally(()=>{pending=null;render();});
 }

 function render({navigate=false}={}){
  if(!active?.details.open||!active.details.isConnected)return;
  const {station,options,picker,windowPicker,output,chart,readout}=active;
  const now=Date.now();
  const gaugeId=picker.value;
  const measure=entries.get(gaugeId)?.gauge?.observed?.name?.toLowerCase()==='flow'?'flow':'stage';
  const trend=buildReleaseTrend({stationId:station,gaugeId,gaugeIds:options.map(g=>g.id),measure,historyHours:72,futureHours:168,reservoirs,entries,config,now});
  const rain=precipitationTimeline(snapshot,now);
  const signature=rain.windows.map(row=>`${row.layer}:${row.issue}:${row.start}:${row.end}`).join(',');
  if(signature!==active.signature){
   windowPicker.replaceChildren(new Option('72-hour overview',''),...rain.windows.map(row=>new Option(windowTime(row),String(row.start))));
   windowPicker.value=rain.windows.some(row=>String(row.start)===active.choice)?active.choice:'';
   active.signature=signature;
  }
  windowPicker.disabled=!rain.windows.length;
  const window=rain.windows.find(row=>String(row.start)===windowPicker.value);
  const expired=!!active.choice&&!window;
  if(expired)active.choice='';
  const mapKey=window?`${window.layer}:${window.issue}:${window.start}:${window.end}`:'';
  if(navigate||active.mapKey!==mapKey){
   active.mapKey=mapKey;
   active.onWindow(window??null,station,{navigate});
  }
  chart.replaceChildren(watershedTimelineChart(trend,rain,station,window,timeZone));
  const best=rain.peaks[station];
  const heading=best.length?`${best[0].max[station].toFixed(2)} in · ${best.length>1?`${best.length} tied peak windows`:'Heaviest mapped 6-hour window'}`:
   exercise?'Exercise timeline':pending?'Checking precipitation timing…':rain.windows.length?'No ≥0.01 in contour in available windows':'Precipitation timing unavailable';
  output.replaceChildren(el('strong',heading));
  if(best.length)output.append(el('p',`${windowTime(best[0])}${best.length>1?' · first tied window':''}`));
  const other=station==='MIL'?'PNF':'MIL',otherPeak=rain.peaks[other][0];
  if(otherPeak)output.append(el('small',`${RESERVOIR_NAMES[other]} peak ${otherPeak.max[other].toFixed(2)} in · ${windowTime(otherPeak)}`));
  if(rain.windows.length&&!rain.continuous)output.append(elClass('p','Forecast coverage is incomplete. Peak applies to available windows.','watch-gap'));
  if(expired)output.append(elClass('p','The selected window is no longer current. The 72-hour overview is selected.','watch-gap'));
  readout.replaceChildren();
  if(window){
   const amount=id=>window.max[id]===null?'no ≥0.01 in contour':`${window.max[id].toFixed(2)} in`;
   readout.append(el('p',`Millerton ${amount('MIL')} · Pine Flat ${amount('PNF')} · issued ${time(window.issue)}`));
  }
  const gauge=trend.gauge,last=gauge.observed.filter(p=>Number.isFinite(p.value)).at(-1);
  const observed=gauge.assessment.observed,change=gauge.assessment.trend;
  const obsUnits=gaugeId==='PFQC1'?'ft':entries.get(gaugeId)?.gauge?.observed?.units;
  const gaugeText=last?`${riverValue(last.value,gauge.units)} · ${time(last.time)}${gauge.current?'':' · old or unverified'}`:'Observation unavailable';
  const rising=gauge.current&&change&&observed&&positiveChange(change.delta,obsUnits);
  readout.append(metric(gauge.title,gaugeText,rising?`Rising ${riverValue(change.delta,obsUnits)} over ${change.hours.toFixed(1)} h`:
   gaugeId==='PFQC1'?'Provisional near-dam stage · no NWS forecast':null,gauge.source));
  if(gauge.forecastCurrent){
   const values=gauge.forecast.filter(p=>Number.isFinite(p.value)&&p.time<=now+78*HOUR);
   const peak=values.reduce((a,b)=>a&&a.value>=b.value?a:b,null);
   if(peak)readout.append(metric('NWS forecast high',`${riverValue(peak.value,gauge.units)} · ${time(peak.time)}`,`Issued ${time(gauge.issued)}`,gauge.source));
  }
  const release=trend.release,reported=release.observed.filter(p=>Number.isFinite(p.value)).at(-1);
  readout.append(metric(station==='MIL'?'Friant river outlet':'Pine Flat reported outflow',reported?
   `${riverValue(reported.value,'cfs')} · ${reported.kind==='daily report'?`report date ${reported.reportDate}`:time(reported.time)}${release.current?'':' · old or unverified'}`:'Report unavailable',null,release.source));
  const next=trend.markers.filter(p=>p.time>now&&p.time<=now+78*HOUR),unverified=trend.schedule.pending.some(p=>p.time>now&&p.time<=now+78*HOUR);
  if(next.length){
   for(const notice of next)readout.append(metric(`${notice.direction}${notice.current?'':' · verify notice'}`,`${riverValue(notice.value,'cfs')} effective ${time(notice.time)}`,'Reservoir effective time',notice.source));
  }else readout.append(el('p',trend.schedule.current&&!unverified?'No planned release notice returned in this window.':'Upcoming release changes require verification.'));
  if(station==='MIL'&&!exercise){
   const report=Array.isArray(snapshot?.riseOutlet)?snapshot.riseOutlet.findLast(p=>p&&Number.isFinite(p.time)&&Number.isFinite(p.value)&&p.value>=0):null;
   const age=report&&now-report.time;
   const old=age>72*HOUR||age<0||!timelineSnapshotCurrent(snapshot,now);
   const riseText=report?`${riverValue(report.value,'cfs')} · report date ${report.date}${old?' · old or unverified':''}`:'Daily outlet report unavailable';
   const paired=report&&release.observed.find(p=>p.reportDate===report.date&&Number.isFinite(p.value));
   const agreement=paired?paired.value===report.value?' · matches CDEC on this report date':` · CDEC ${riverValue(paired.value,'cfs')} for the same date` : '';
   readout.append(metric('Reclamation RISE cross-check',riseText,'Provisional daily river outlet average'+agreement,RISE_OUTLET));
  }
 }

 function append(host,areaId,rows,{open=false,onWindow=()=>{}}={}){
  const station=upstreamReservoir('river:'+areaId);
  if(!station){active=null;return;}
  const group=rows.filter(row=>upstreamReservoir('river:'+row.area.id)===station);
  const gauges=new Map(TREND_REACHES[station].gauges.map(id=>[id,{id,title:stations.get(id)?.name||id,side:'Downstream'}]));
  for(const row of group)for(const gauge of row.gauges||[]){
   gauges.set(gauge.id,{id:gauge.id,title:gauge.gauge?.name||stations.get(gauge.id)?.name||gauge.id,side:row.area.id.endsWith('upper')?'Upstream':'Downstream'});
  }
  const options=[...gauges.values()],preferred=group.flatMap(row=>row.rising||[])[0]?.id??options[0].id;
  const details=elClass('details','','watershed-timeline');details.open=open;
  const selector=el('label','Gauge'),picker=el('select');
  picker.append(...options.map(g=>new Option(`${g.side} · ${g.id}`,g.id)));picker.value=preferred;selector.append(picker);
  const windowLabel=el('label','Map forecast window'),windowPicker=el('select');windowLabel.append(windowPicker);
  const output=elClass('div','','watershed-timeline-peak');output.setAttribute('role','status');
  const chart=elClass('div','','watershed-timeline-chart'),readout=elClass('div','','watershed-timeline-readout');
  details.append(el('summary','Rain, gauges & releases timeline'),output,windowLabel,chart,selector,readout,
   el('small','Bars show the highest six-hour liquid-equivalent precipitation mapped inside each watershed. Outlines mark peaks. Solid lines and dots are reports, dashed lines are forecasts, and diamonds are planned releases. Gray indicates old or unverified data. Tracks share Pacific time and use separate units. Confirm release plans and resource lead times with the operators.'),
   link('WPC forecast windows',TIMELINE_QPF_URL));
  if(station==='MIL'&&!exercise)details.append(document.createTextNode(' · '),link('WWDH Millerton catalog',wwdh));
  if(exercise)details.append(el('p','Gauge and release evidence is exercise data. Live forecast and Reclamation values are disabled.'));
  host.append(details);
  active={station,options,details,picker,windowPicker,output,chart,readout,signature:null,choice:'',mapKey:null,onWindow};
  picker.onchange=()=>render();windowPicker.onchange=()=>{active.choice=windowPicker.value;render({navigate:true});};
  details.ontoggle=()=>{if(active?.details===details&&details.open){collect();render();}};
  if(open){collect();render();}
 }

 setInterval(()=>{if(!document.hidden&&active?.details.open&&active.details.isConnected){collect();render();}},60_000);
 return {append,setReservoirData(data){reservoirs=data;render();},setRiverData(data){entries=new Map(data.entries);if(data.stations)stations=new Map(data.stations.map(s=>[s.id,s]));render();}};
}

function metric(title,value,note,url){
 const row=el('section');row.append(el('strong',title),el('p',value));
 if(note)row.append(el('small',note));
 if(url)row.append(link('Source',url));
 return row;
}
