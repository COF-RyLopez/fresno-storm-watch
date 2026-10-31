import { HOUR, riverValue, convertRiverUnits } from './river-model.js';
/** @param {string} tag @param {object} attributes @param {string} text @returns {SVGElement} */
export function svgNode(tag, attributes = {}, text = '') {
  const el=document.createElementNS('http://www.w3.org/2000/svg',tag);
  for (const [k,v] of Object.entries(attributes)) el.setAttribute(k,String(v));
  el.textContent=text; return el;
}
/** @param {object} gauge @param {object} assessment @param {number} hours @param {string} zone @returns {HTMLElement} Primary values only; no invented uncertainty interval or interpolated crossing. */
export function riverChart(gauge, assessment, hours, zone) {
  const box=document.createElement('figure'); box.className='river-chart';
  const now=Date.now(), start=now-24*HOUR, end=now+hours*HOUR;
  const observed=gauge.observed.points.filter(p=>p.time>=start && p.time<=now);
  const compatible=!observed.length || !assessment.future.length || (gauge.observed.name===gauge.forecast.name && gauge.observed.units===gauge.forecast.units);
  const forecast=compatible?assessment.future:[];
  const units=observed.length?gauge.observed.units:gauge.forecast.units;
  const name=observed.length?gauge.observed.name:gauge.forecast.name;
  const values=[...observed,...forecast].map(p=>p.value);
  const caption=document.createElement('figcaption');
  caption.textContent=`${name || 'Hydrograph'}${units ? ` (${units})` : ''} · observed solid blue; forecast dashed purple. Times: ${zone}. ${assessment.forecastUsable?'':'Forecast may be missing or old. '}${compatible?'':'Series units differ; forecast is not overlaid. '}Lines connect reported samples; long gaps are left open.`;
  if (!values.length) { caption.textContent='No valid hydrograph samples in this time window.'; box.append(caption); return box; }
  const low=Math.min(...values), high=Math.max(...values), margin=Math.max((high-low)*0.15,0.05);
  const min=low-margin, max=high+margin;
  const x=t=>42+(t-start)/(end-start)*258, y=v=>140-(v-min)/(max-min)*112;
  const chart=svgNode('svg',{viewBox:'0 0 320 180',role:'img','aria-label':caption.textContent});
  chart.append(svgNode('title',{},`${name} hydrograph; values and timestamps also appear below.`));
  for (const v of [min,(min+max)/2,max]) {
    chart.append(svgNode('line',{x1:42,x2:300,y1:y(v),y2:y(v),stroke:'var(--chart-grid)'}),svgNode('text',{x:38,y:y(v)+3,'text-anchor':'end',fill:'var(--chart-text)','font-size':9},riverValue(v)));
  }
  const formatter=new Intl.DateTimeFormat('en-US',{timeZone:zone,month:'numeric',day:'numeric',hour:'numeric',hour12:false});
  for (const t of [start,now,end]) chart.append(svgNode('text',{x:x(t),y:158,'text-anchor':t===start?'start':t===end?'end':'middle','font-size':8,fill:'var(--chart-text)'},formatter.format(t)));
  chart.append(svgNode('line',{x1:x(now),x2:x(now),y1:23,y2:140,stroke:'var(--chart-now)','stroke-dasharray':'2 3'}),svgNode('text',{x:x(now)+3,y:19,'font-size':9,fill:'var(--chart-text)'},'Now'));
  const draw=(points,color,dashed,gapHours)=>{
    let path='', prior=null;
    for (const p of points) { path+=`${!prior || p.time-prior.time>gapHours*HOUR?'M':'L'}${x(p.time).toFixed(2)},${y(p.value).toFixed(2)} `; prior=p; }
    chart.append(svgNode('path',{d:path,fill:'none',stroke:color,'stroke-width':2,'stroke-dasharray':dashed?'5 3':'none'}));
    if (points.length===1) chart.append(svgNode('circle',{cx:x(points[0].time),cy:y(points[0].value),r:3,fill:color}));
  };
  draw(observed,'var(--chart-observed)',false,2); draw(forecast,assessment.forecastUsable?'var(--chart-forecast)':'var(--chart-missing)',true,6);
  for (const t of assessment.thresholds) {
    const value=convertRiverUnits(t.value,t.units,units);
    if(value===null || value<min || value>max)continue;
    chart.append(svgNode('line',{x1:42,x2:300,y1:y(value),y2:y(value),stroke:'var(--gauge-threshold)','stroke-dasharray':'2 4'}));
    chart.append(svgNode('text',{x:300,y:y(value)-3,'text-anchor':'end','font-size':8,fill:'var(--gauge-threshold)'},t.level));
  }
  box.append(chart,caption); return box;
}
