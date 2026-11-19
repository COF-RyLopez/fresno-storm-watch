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

/** Fixed-size, screen-facing vector glyph rasterized for MapLibre, independent of terrain height. */
export function gaugeIcon(display,createCanvas=()=>document.createElement('canvas')) {
 const canvas=createCanvas();canvas.width=80;canvas.height=128;
 const c=canvas.getContext('2d');if(!c)throw Error('Gauge symbol rendering unavailable');
 const x=25,top=12,bottom=92,width=15;
 c.lineWidth=3;c.strokeStyle='#e8f4f7';c.fillStyle='#19292f';
 c.beginPath();c.roundRect(x-width/2,top,width,bottom-top,7);c.fill();c.stroke();
 c.beginPath();c.arc(x,bottom+3,12,0,Math.PI*2);c.fill();c.stroke();
 c.fillStyle=display.color;
 c.beginPath();c.arc(x,bottom+3,8,0,Math.PI*2);c.fill();
 if(display.fraction!==null){
  const y=bottom-(bottom-top)*display.fraction;
  c.globalAlpha=display.current?1:.45;c.fillRect(x-4,y,8,bottom-y);c.globalAlpha=1;
  c.strokeStyle='#f5fcff';c.lineWidth=3;c.beginPath();c.moveTo(x-13,y);c.lineTo(x+13,y);c.stroke();
 }else{
  c.setLineDash([4,4]);c.strokeStyle=display.color;c.beginPath();c.moveTo(x,top+8);c.lineTo(x,bottom-7);c.stroke();c.setLineDash([]);
 }
 if(display.scale){
  for(const t of display.thresholds){const y=bottom-(bottom-top)*(t.value-display.scale.min)/(display.scale.max-display.scale.min);
   c.strokeStyle=GAUGE_STATES[t.level].color;c.lineWidth=3;c.beginPath();c.moveTo(x+10,y);c.lineTo(x+24,y);c.stroke();}
  if(display.forecast){const f=Math.max(0,Math.min(1,(display.forecast.value-display.scale.min)/(display.scale.max-display.scale.min))),y=bottom-(bottom-top)*f;
   c.strokeStyle='#ffedc0';c.lineWidth=2;c.beginPath();c.moveTo(x-20,y);c.lineTo(x-15,y-5);c.lineTo(x-10,y);c.lineTo(x-15,y+5);c.closePath();c.stroke();}
 }
 if(!display.current){
  c.strokeStyle=display.color;c.lineWidth=3;c.beginPath();c.arc(60,top+9,8,0,Math.PI*2);c.moveTo(60,top+3);c.lineTo(60,top+9);c.lineTo(65,top+12);c.stroke();
 }else if(display.trend){
  const rising=display.trend.direction==='rising',falling=display.trend.direction==='falling';
  c.strokeStyle='#eef8ff';c.lineWidth=3;c.beginPath();
  if(rising||falling){const y=rising?36:58,other=rising?58:36;c.moveTo(60,other);c.lineTo(60,y);c.moveTo(53,y+(rising?7:-7));c.lineTo(60,y);c.lineTo(67,y+(rising?7:-7));}
  else{c.moveTo(53,46);c.lineTo(67,46);}c.stroke();
 }
 return c.getImageData(0,0,canvas.width,canvas.height);
}
