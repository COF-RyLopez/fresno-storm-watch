import {convertRiverUnits,thresholdsFor,riverValue,assessGauge,HOUR} from './river-model.js';

export const GAUGE_STATES=Object.freeze({
 below:{color:'#68bea5',label:'Below published threshold'},
 action:{color:'#f2d56f',label:'At/above action level'},minor:{color:'#f0a25a',label:'Minor flood level'},
 moderate:{color:'#ed7478',label:'Moderate flood level'},major:{color:'#cb96e8',label:'Major flood level'},
 unknown:{color:'#aab5bf',label:'Thresholds unknown'},stale:{color:'#aab5bf',label:'Reading stale / not current'},
 unavailable:{color:'#aab5bf',label:'Reading unavailable'},
});
const labels={action:'Action',minor:'Minor flood',moderate:'Moderate flood',major:'Major flood'};
const stamp=value=>Number.isFinite(value)?new Intl.DateTimeFormat('en-US',{timeZone:'America/Los_Angeles',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(value):'Time unavailable';
const known=value=>Number.isFinite(value);
const round=(value,units)=>Number(value.toFixed(units==='kcfs'?3:2));

function metric(series,point,preferStage=false) {
 if(!series||!point)return null;
 const secondary=preferStage&&series.secondaryName?.toLowerCase()==='stage'&&known(point.secondary);
 return {name:secondary?series.secondaryName:series.name,units:secondary?series.secondaryUnits:series.units,
  value:secondary?point.secondary:point.value,key:secondary?'secondary':'value'};
}

/** Compare only the displayed variable in compatible units. The bar is a station scale, never capacity/depth. */
export function gaugeDisplay(gauge,assessment,station) {
 const observed=assessment.observed;
 const m=metric(gauge?.observed,observed,true);
 const value=m&&known(m.value)?m.value:null;
 const current=!!assessment.current&&value!==null;
 const thresholds=m?thresholdsFor(gauge,m.name,m.units):[];
 const exceeded=current?thresholds.filter(t=>value>=t.value):[];
 const status=value===null?'unavailable':!current?'stale':!thresholds.length?'unknown':exceeded.at(-1)?.level||'below';
 let trend=null,forecast=null;
 if(current){
  const prior=gauge.observed.points.filter(p=>p.time<=observed.time-2.5*HOUR&&p.time>=observed.time-4*HOUR&&known(p[m.key])).at(-1);
  if(prior){const delta=round(value-prior[m.key],m.units);trend={delta,hours:(observed.time-prior.time)/HOUR,start:prior.time,
   direction:delta>0?'rising':delta<0?'falling':'little change'};}
 }
 if(assessment.forecastUsable&&m){
  const points=assessment.future.flatMap(p=>{
   const f=metric(gauge.forecast,p,true);
   const converted=f?.name.toLowerCase()===m.name.toLowerCase()?convertRiverUnits(f.value,f.units,m.units):null;
   return converted===null?[]:[{time:p.time,value:converted}];
  });
  forecast=points.reduce((best,p)=>!best||p.value>best.value?p:best,null);
 }
 let scale=null,fraction=null;
 if(thresholds.length){
  const first=thresholds[0].value,last=thresholds.at(-1).value,span=last-first||Math.max(Math.abs(first)*.1,1);
  scale={min:first-span,max:last+span*.2};
  if(value!==null)fraction=Math.max(0,Math.min(1,(value-scale.min)/(scale.max-scale.min)));
 }
 const reading=value===null?'Reading unavailable':`${current?'Observed':'Last reported'} ${m.name.toLowerCase()}: ${riverValue(value,m.units)}`;
 const qualifier=GAUGE_STATES[status].label;
 const trendText=trend?`${trend.direction} · ${trend.delta>0?'+':''}${riverValue(trend.delta,m.units)} over ${trend.hours.toFixed(1)} h`:'Trend unavailable';
 const thresholdText=thresholds.length?thresholds.map(t=>`${labels[t.level]} ${riverValue(t.value,t.units)}`).join(' · '):'Published thresholds unknown for this variable';
 const readout=[gauge?.name||station.name,reading,qualifier,`Observation · ${stamp(observed?.time)}`,
  `Trend · ${trendText}`,thresholdText,
  ...(forecast?[`Forecast high · ${riverValue(forecast.value,m.units)} · ${stamp(forecast.time)}; issued ${stamp(gauge.forecast.issued)}`]:[]),
  ...(assessment.gaps||[]),
  ...(scale?[`Station display scale ${riverValue(scale.min,m.units)} to ${riverValue(scale.max,m.units)}; capped at ends. Not capacity or water depth.`]:['No threshold scale available.']),
  `NWS NWPS · ${station.id}`].join('\n');
 return {id:station.id,name:gauge?.name||station.name,metric:m?.name||'Reading',units:m?.units||'',value,time:observed?.time??null,
  current,status,color:GAUGE_STATES[status].color,label:qualifier,thresholds,trend,forecast,scale,fraction,readout,
  hoverText:[gauge?.name||station.name,reading,qualifier,`Trend · ${trendText}`].join('\n'),
  mapLabel:`${value===null?'Unknown':riverValue(value,m.units)}${!current?' · stale / unavailable':status==='unknown'?' · thresholds unknown':''}`};
}

/** Age retained readings independently of source success. A failed check must not retain a live color. */
export function refreshGaugeFeatures(features,bundle,config,now=Date.now(),error=null) {
 if(!bundle?.input)return features;
 return features.map(feature=>{
  const id=feature.properties?.gaugeId;if(!id)return feature;
  const station=bundle.input.gauges.stations.find(s=>s.id===id);
  if(!station)return feature;
  const entry=bundle.input.entries.find(e=>e.id===id);
  const display=gaugeDisplay(entry?.gauge,assessGauge(entry?.gauge,config,72,now,error||entry?.error),station);
  return {...feature,properties:{...feature.properties,color:display.color,gaugeDisplay:display,
   gaugeLabel:display.mapLabel,readout:display.readout,hoverText:display.hoverText}};
 });
}

/** Compact level column, not a thermometer or a capacity percentage. Screen-facing in 3D. */
export function gaugeIcon(display,createCanvas=()=>document.createElement('canvas')) {
 const canvas=createCanvas();canvas.width=100;canvas.height=100;
 const c=canvas.getContext('2d');if(!c)throw Error('Gauge symbol rendering unavailable');
 const x=50,top=10,bottom=78,width=32,left=x-width/2;
 c.lineWidth=2.5;c.strokeStyle=display.current?'#dce9ed':'#aab5bf';c.fillStyle='#19292f';
 c.fillRect(left,top,width,bottom-top);
 if(display.fraction===null)c.setLineDash([5,4]);
 c.strokeRect(left,top,width,bottom-top);c.setLineDash([]);
 // The short locator points to the station; the column is a flat map symbol, not 3D water.
 c.fillStyle='#19292f';c.beginPath();c.moveTo(x-6,bottom+5);c.lineTo(x,bottom+17);c.lineTo(x+6,bottom+5);c.closePath();c.fill();
 c.strokeStyle='#dce9ed';c.beginPath();c.moveTo(x-6,bottom+5);c.lineTo(x,bottom+17);c.lineTo(x+6,bottom+5);c.stroke();
 if(display.fraction!==null){
  const y=bottom-(bottom-top)*display.fraction;
  c.fillStyle=display.color;c.globalAlpha=display.current ? .9 : .4;
  c.fillRect(left+3,y+1,width-6,Math.max(0,bottom-y-3));c.globalAlpha=1;
  c.strokeStyle='#f5fcff';c.lineWidth=3;c.beginPath();c.moveTo(left-4,y);c.lineTo(left+width+4,y);c.stroke();
 }else{
  // No reference scale: an unfilled, dashed column is explicitly unknown, never zero/full.
  c.fillStyle='#c7d2d7';c.font='bold 25px Arial';c.textAlign='center';c.fillText('?',x,top+43);
 }
 if(display.scale){
  for(const t of display.thresholds){const y=bottom-(bottom-top)*(t.value-display.scale.min)/(display.scale.max-display.scale.min);
   c.strokeStyle=GAUGE_STATES[t.level].color;c.lineWidth=3;c.beginPath();c.moveTo(left+width+6,y);c.lineTo(left+width+18,y);c.stroke();}
  if(display.forecast){const f=Math.max(0,Math.min(1,(display.forecast.value-display.scale.min)/(display.scale.max-display.scale.min))),y=bottom-(bottom-top)*f;
   c.strokeStyle='#ffedc0';c.lineWidth=2;c.beginPath();c.moveTo(left-17,y);c.lineTo(left-12,y-5);c.lineTo(left-7,y);c.lineTo(left-12,y+5);c.closePath();c.stroke();}
 }
 if(!display.current){
  c.strokeStyle=display.color;c.lineWidth=2.5;c.beginPath();c.arc(88,top+9,7,0,Math.PI*2);c.moveTo(88,top+4);c.lineTo(88,top+9);c.lineTo(92,top+12);c.stroke();
 }else if(display.trend){
  const rising=display.trend.direction==='rising',falling=display.trend.direction==='falling';
  c.strokeStyle='#eef8ff';c.lineWidth=3;c.beginPath();
  if(rising||falling){const y=rising?30:52,other=rising?52:30;c.moveTo(89,other);c.lineTo(89,y);c.moveTo(83,y+(rising?6:-6));c.lineTo(89,y);c.lineTo(95,y+(rising?6:-6));}
  else{c.moveTo(83,41);c.lineTo(95,41);}c.stroke();
 }
 return c.getImageData(0,0,canvas.width,canvas.height);
}
