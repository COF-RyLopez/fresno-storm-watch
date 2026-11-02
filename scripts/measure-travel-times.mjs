#!/usr/bin/env node
/** Measure flood-wave travel times between neighbouring San Joaquin main-stem flow gauges.
 * Source: CDEC 15-minute flow (sensor 20) at San Joaquin River Restoration Program stations, resampled to hourly.
 * Method: in 10-day windows where the upstream flow changes substantially, find the lag (0–96 h) that best aligns the
 * smoothed hourly flow changes at the two gauges (cross-correlation). The median lag over windows with r >= MIN_R is the
 * reach travel time; river distance / travel time is the reach speed. Where both flow bands (below / at or above
 * FLOW_SPLIT_CFS, by the window's mean flow below Friant) have at least 3 windows, per-band travel times are kept too; the app
 * picks the band from the live flow below Friant (USGS 11251000). Writes site/data/travel-times.json.
 * Usage: node scripts/measure-travel-times.mjs   (raw months are cached in work/travel-times/; delete to refetch). */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {snapPoints} from './build-river-network.mjs';

const root=new URL('../',import.meta.url),cache=new URL('work/travel-times/',root);
// Upstream to downstream along the San Joaquin main stem (path 41 in river-network.json). Coordinates from CDEC staMeta.
export const STATIONS=[
  {id:'SJF',name:'San Joaquin River below Friant',latitude:36.98415,longitude:-119.72429},
  {id:'H41',name:'San Joaquin River at Hwy 41',latitude:36.8762,longitude:-119.7932},
  {id:'GRF',name:'San Joaquin River at Gravelly Ford',latitude:36.798,longitude:-120.16},
  {id:'SJB',name:'San Joaquin River below Bifurcation',latitude:36.773,longitude:-120.286},
  {id:'MEN',name:'San Joaquin River near Mendota',latitude:36.810505,longitude:-120.378227},
  {id:'SDP',name:'San Joaquin River near Dos Palos',latitude:36.994,longitude:-120.5015},
  {id:'SJH',name:'San Joaquin River near Hwy 152',latitude:37.05542,longitude:-120.548302},
  {id:'SJS',name:'San Joaquin River near Stevinson',latitude:37.295,longitude:-120.851}
];
const YEARS=[2017,2018,2019,2020,2021,2022,2023,2024,2025],MONTHS=[1,2,3,4,5,6],MAX_LAG=96,MIN_R=0.6,WINDOW_H=240,STEP_H=120,FLOW_SPLIT_CFS=1500;
const H=3_600_000,pad=n=>String(n).padStart(2,'0');

/** @returns {Promise<Map<number,number>>} hourly flow (cfs) keyed by UTC-ish epoch hour (CDEC times are Pacific; offsets cancel within a pair). */
async function hourly(id){
  const series=new Map();
  for(const y of YEARS)for(const m of MONTHS){
    const file=new URL(`${id}-${y}-${pad(m)}.json`,cache);let rows;
    try{rows=JSON.parse(await readFile(file,'utf8'));}catch{
      const end=new Date(Date.UTC(y,m,0)).getUTCDate();
      const url=`https://cdec.water.ca.gov/dynamicapp/req/JSONDataServlet?Stations=${id}&SensorNums=20&dur_code=E&Start=${y}-${pad(m)}-01&End=${y}-${pad(m)}-${end}`;
      const r=await fetch(url,{signal:AbortSignal.timeout(120_000)});if(!r.ok)throw new Error(`${id} ${y}-${m}: HTTP ${r.status}`);
      rows=(await r.json()).filter(x=>x.value>-9000&&/:00$/.test(x.obsDate)).map(x=>[x.obsDate,x.value]);
      await writeFile(file,JSON.stringify(rows));
    }
    for(const [d,v] of rows){const [date,time]=d.split(' '),[Y,M,D]=date.split('-').map(Number),[h]=time.split(':').map(Number);series.set(Date.UTC(Y,M-1,D,h)/H,v);}
  }
  return series;
}
/** Centered 3-hour mean then first difference; null where any input is missing. */
function changes(series,start,n){
  const v=i=>series.get(start+i)??null,out=[];
  for(let i=0;i<n;i++){const a=[v(i-2),v(i-1),v(i)],b=[v(i-1),v(i),v(i+1)];out.push(a.includes(null)||b.includes(null)?null:(b[0]+b[1]+b[2]-a[0]-a[1]-a[2])/3);}
  return out;
}
function corr(x,y){let n=0,sx=0,sy=0,sxx=0,syy=0,sxy=0;for(let i=0;i<x.length;i++){if(x[i]===null||y[i]===null)continue;n++;sx+=x[i];sy+=y[i];sxx+=x[i]*x[i];syy+=y[i]*y[i];sxy+=x[i]*y[i];}
  if(n<WINDOW_H/2)return null;const cov=sxy-sx*sy/n,vx=sxx-sx*sx/n,vy=syy-sy*sy/n;return vx>0&&vy>0?cov/Math.sqrt(vx*vy):null;}
/** @returns {object[]} per-window best lag where the upstream flow changed by >= 30% of its mean (and >= 100 cfs). */
export function windowLags(up,down,flowRef=up){
  const hours=[...up.keys()].sort((a,b)=>a-b),out=[];if(!hours.length)return out;
  for(let t=hours[0];t+WINDOW_H+MAX_LAG<=hours.at(-1);t+=STEP_H){
    const vals=[];for(let i=0;i<WINDOW_H;i++){const v=up.get(t+i);if(v!==undefined)vals.push(v);}
    if(vals.length<WINDOW_H*0.9)continue;const mean=vals.reduce((a,b)=>a+b,0)/vals.length,range=Math.max(...vals)-Math.min(...vals);
    if(range<Math.max(100,0.3*mean))continue;
    const du=changes(up,t,WINDOW_H);let best=null;
    for(let lag=0;lag<=MAX_LAG;lag++){const r=corr(du,changes(down,t+lag,WINDOW_H));if(r!==null&&(!best||r>best.r))best={lag,r};}
    if(best&&best.r>=MIN_R&&best.lag>0&&best.lag<MAX_LAG)out.push({start:new Date(t*H).toISOString().slice(0,10),...best,r:Math.round(best.r*100)/100,flowCfs:Math.round(meanOf(flowRef,t))});
  }
  return out;
}
/** Mean flow over a window (the band reference: the release below Friant, which the app also reads live). */
const meanOf=(series,t)=>{let s=0,n=0;for(let i=0;i<WINDOW_H;i++){const v=series.get(t+i);if(v!==undefined){s+=v;n++;}}return n?s/n:NaN;};
const quantile=(xs,q)=>{const s=[...xs].sort((a,b)=>a-b),i=(s.length-1)*q,lo=Math.floor(i);return s[lo]+(s[Math.ceil(i)]-s[lo])*(i-lo);};

if(import.meta.url===`file://${process.argv[1]}`){
  await mkdir(cache,{recursive:true});
  const net=JSON.parse(await readFile(new URL('site/data/river-network.json',root),'utf8'));
  const snapped=snapPoints(STATIONS.map(s=>({...s,kind:'cdec'})),net.paths);
  const series=new Map();for(const s of STATIONS){series.set(s.id,await hourly(s.id));console.log(s.id,series.get(s.id).size,'hourly values');}
  const reaches=[];
  for(let i=0;i+1<STATIONS.length;i++){
    const a=snapped[i],b=snapped[i+1];if(!a.path||a.path!==b.path)throw new Error(`${a.id}/${b.id} not on one network path`);
    const lags=windowLags(series.get(a.id),series.get(b.id),series.get('SJF')),km=Math.round((a.km-b.km)*10)/10;
    const row={from:a.id,to:b.id,fromName:STATIONS[i].name,toName:STATIONS[i+1].name,path:a.path,kmFrom:a.km,kmTo:b.km,distanceKm:km,events:lags.length};
    if(lags.length>=3){const ls=lags.map(l=>l.lag),med=quantile(ls,0.5);Object.assign(row,{lagHours:med,lagP25:quantile(ls,0.25),lagP75:quantile(ls,0.75),speedKmh:Math.round(km/med*100)/100,
      medianR:quantile(lags.map(l=>l.r),0.5),sample:lags.slice(0,40)});
      const low=lags.filter(l=>l.flowCfs<FLOW_SPLIT_CFS).map(l=>l.lag),high=lags.filter(l=>l.flowCfs>=FLOW_SPLIT_CFS).map(l=>l.lag);
      if(low.length>=3&&high.length>=3)row.byFlow=[[low,'below'],[high,'atOrAbove']].map(([ls,side])=>{const lag=quantile(ls,0.5);return {side,lagHours:lag,speedKmh:Math.round(km/lag*100)/100,events:ls.length};});}
    reaches.push(row);console.log(`${a.id}→${b.id} ${km} km · ${lags.length} windows · lag ${row.lagHours??'—'} h (IQR ${row.lagP25??'—'}–${row.lagP75??'—'}) · ${row.speedKmh??'—'} km/h${row.byFlow?' · by flow: '+row.byFlow.map(b=>`${b.side} ${FLOW_SPLIT_CFS} cfs ${b.lagHours} h (${b.events})`).join(', '):''}`);
  }
  await writeFile(new URL('site/data/travel-times.json',root),JSON.stringify({version:1,generatedAt:new Date().toISOString(),
    source:'CDEC 15-minute river flow (sensor 20), San Joaquin River Restoration Program stations, resampled hourly',
    period:`${YEARS[0]}–${YEARS.at(-1)}, January–June`,flowSplitCfs:FLOW_SPLIT_CFS,flowGauge:{usgs:'11251000',cdec:'SJF',name:'San Joaquin River below Friant'},
    method:`Cross-correlation of 3-hour-smoothed hourly flow changes in ${WINDOW_H/24}-day windows (step ${STEP_H/24} days) where the upstream flow changed by at least 30% of its mean and 100 cfs; lags 1–${MAX_LAG-1} h with r >= ${MIN_R}. Reach travel time is the median lag; speed = river distance / travel time. Used only where at least 3 windows qualify.`,
    reaches},null,1)+'\n');
}
