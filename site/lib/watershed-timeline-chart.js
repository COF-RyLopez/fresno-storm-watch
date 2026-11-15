import {svgNode as svg} from './river-chart.js';
import {trendSegments} from './release-trend-model.js';
import {HOUR} from './river-model.js';

const chartWidth=360, left=54, right=350;
const rainColor='var(--chart-forecast)';

/** Aligned time tracks with independent vertical scales for unlike measures. */
export function watershedTimelineChart(model,rain,station,selected,timeZone){
 const start=model.now-48*HOUR, end=model.now+78*HOUR;
 const x=t=>left+(t-start)/(end-start)*(right-left);
 const chart=svg('svg',{viewBox:`0 0 ${chartWidth} 228`,role:'img','aria-label':'Shared time axis for Millerton and Pine Flat precipitation, the selected gauge and reservoir releases. Exact times and readings are listed with the chart.'});
 const date=new Intl.DateTimeFormat('en-US',{timeZone,month:'short',day:'numeric'});
 chart.append(svg('rect',{x:x(model.now),y:19,width:right-x(model.now),height:181,fill:rainColor,opacity:.07}));
 for(const t of [model.now-24*HOUR,model.now,model.now+24*HOUR,model.now+48*HOUR,model.now+72*HOUR]){
  chart.append(svg('line',{x1:x(t),x2:x(t),y1:19,y2:200,stroke:t===model.now?'var(--chart-now)':'var(--chart-grid)','stroke-dasharray':t===model.now?'3 3':''}),
    svg('text',{x:x(t),y:219,'text-anchor':'middle',fill:'var(--chart-text)','font-size':13},t===model.now?'Now':date.format(t)));
 }
 if(selected)chart.append(svg('rect',{x:x(selected.start),width:x(selected.end)-x(selected.start),y:19,height:181,fill:rainColor,opacity:.14}));
 const tracks=[['Millerton','in',45],['Pine Flat','in',83],['Gauge',model.gauge.units,139],['Release','cfs',200]];
 for(const [name,units,y] of tracks)chart.append(svg('text',{x:2,y:y-9,'font-size':11.5,fill:'var(--chart-text)'},name),svg('text',{x:2,y:y+3,'font-size':11,fill:'var(--chart-text)'},units),svg('line',{x1:left,x2:right,y1:y,y2:y,stroke:'var(--chart-grid)'}));
 const rainMax=Math.max(.01,...rain.windows.flatMap(w=>[w.max.MIL??0,w.max.PNF??0]));
 for(const [id,y] of [['MIL',45],['PNF',83]])for(const w of rain.windows){
  const amount=w.max[id],height=amount===null?1:Math.max(3,26*amount/rainMax);
  const peak=rain.peaks[id].includes(w);
  chart.append(svg('rect',{x:x(w.start)+1,width:Math.max(1,x(w.end)-x(w.start)-2),y:y-height,height,fill:amount===null?'var(--chart-grid)':rainColor,
    opacity:id===station||peak?1:.65,stroke:peak?'var(--chart-text)':'none','stroke-width':peak?1.1:0}));
 }
 function plot(series,domain,bottom,markers=[]){
  const scale=value=>bottom-4-(value-domain[0])/(domain[1]-domain[0])*43;
  let plotted=false;
  for(const [points,forecast] of [[series.observed,false],[series.forecast,true]]){
   const current=forecast?series.forecastCurrent:series.current;
   const color=current?(forecast?rainColor:'var(--chart-observed)'):'var(--chart-missing)';
   const segments=trendSegments(points.filter(p=>p.time>=start&&p.time<=end),forecast?6*HOUR:2*HOUR);
   for(const segment of segments){
    plotted=true;
    if(!series.daily&&segment.length>1)chart.append(svg('path',{d:segment.map((p,i)=>`${i?'L':'M'}${x(p.time).toFixed(1)},${scale(p.value).toFixed(1)}`).join(' '),fill:'none',stroke:color,'stroke-width':2,'stroke-dasharray':forecast?'4 3':''}));
    else for(const p of segment)chart.append(svg('circle',{cx:x(p.time),cy:scale(p.value),r:2.5,fill:color}));
   }
  }
  for(const p of markers.filter(p=>p.time>=start&&p.time<=end)){
   plotted=true;
   const px=x(p.time),py=scale(p.value),color=p.current?'var(--watch)':'var(--chart-missing)';
   chart.append(svg('path',{d:`M${px},${py-4} l4,4 -4,4 -4,-4 Z`,fill:'var(--chart-background)',stroke:color,'stroke-width':1.5}));
  }
  if(!plotted)chart.append(svg('text',{x:(left+right)/2,y:bottom-23,'text-anchor':'middle','font-size':13,fill:'var(--chart-text)'},'No readings in this window'));
 }
 const releases=[...model.release.observed,...model.markers].filter(p=>p.time>=start&&p.time<=end&&Number.isFinite(p.value));
 plot(model.gauge,model.gaugeDomain,139);
 plot(model.release,[0,Math.max(1,...releases.map(p=>p.value))*1.1],200,model.markers);
 return chart;
}
