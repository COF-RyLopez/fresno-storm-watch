import {comparisonWindow,compareForecasts,MODELS} from './forecast-comparison-model.js';
export const REVIEW_MAX_AGE=45*60000;
const HOUR=3600000,IDS=['nws',...MODELS.map(m=>m.id)];

/** Seven unique public locations; shared Friant sample is fetched once. */
export function uniqueComparisonPoints(areas){
  const points=new Map();
  for(const a of areas)for(const p of a.points){const prior=points.get(p.id);if(prior&&(prior.latitude!==p.latitude||prior.longitude!==p.longitude))throw Error('Conflicting comparison point identity.');points.set(p.id,p);}
  if(!points.size||points.size>9)throw Error('Comparison point inventory exceeds its bound.');
  return [...points.values()];
}

/** Reject drift in public snapshots, including extra/private inventory or source URLs. */
export function validateComparisonSnapshot(snapshot,points){
  if(snapshot?.schemaVersion!==1||!Number.isFinite(Date.parse(snapshot.generatedAt))||!Array.isArray(snapshot.points)||snapshot.points.length!==points.length||new Set(snapshot.points.map(p=>p.point?.id)).size!==points.length)throw Error('Invalid comparison snapshot inventory.');
  for(const p of snapshot.points){
    const expected=points.find(e=>e.id===p.point?.id);
    if(!expected||p.point.latitude!==expected.latitude||p.point.longitude!==expected.longitude||!Number.isFinite(p.checked)||!Array.isArray(p.rows)||p.rows.length!==3||new Set(p.rows.map(r=>r.id)).size!==3)throw Error('Comparison point or source identity changed.');
    for(const row of p.rows){
      if(!IDS.includes(row.id))throw Error('Unexpected comparison source.');
      if(row.error){if(typeof row.error!=='string')throw Error('Invalid source failure.');continue;}
      if(!Number.isFinite(row.issued)||typeof row.gustProvided!=='boolean'||!row.source?.startsWith(row.id==='nws'?'https://api.weather.gov/gridpoints/':'https://api.dynamical.org/v1/data/'))throw Error('Invalid source time or link.');
      for(const key of ['rain','wind','gust']){
        const list=row[key];
        if(!Array.isArray(list)||list.length>500||list.some((r,i)=>!Number.isFinite(r.start)||!Number.isFinite(r.end)||r.end<=r.start||(i&&r.start<list[i-1].end)||(r.value!==null&&(!Number.isFinite(r.value)||r.value<0))))throw Error('Invalid comparison intervals or values.');
      }
    }
  }
  return snapshot;
}

/** Keep all tied peak periods at display precision; never invent a unique peak. */
function peakPeriods(row,key,places){
  const values=row.periods.map(p=>p[key].value);
  if(values.some(v=>!Number.isFinite(v)))return [];
  const rounded=values.map(v=>Number(v.toFixed(places))),maximum=Math.max(...rounded);
  return maximum>0?row.periods.filter((_,i)=>rounded[i]===maximum).map(p=>({start:p.start,end:p.end})):[];
}

/** Largest NWS/model minimum separation between tied six-hour peak-period starts. */
function timing(rows,key,places){
  const official=rows.find(r=>r.id==='nws'),baseline=official?peakPeriods(official,key,places):[];
  if(!baseline.length)return null;
  const pairs=rows.filter(r=>r.id!=='nws').map(row=>{
    const periods=peakPeriods(row,key,places);if(!periods.length)return null;
    const distance=Math.min(...baseline.flatMap(a=>periods.map(b=>Math.abs(a.start-b.start)/HOUR)));
    return {hours:distance,source:row.label,sourceId:row.id,nwsPeriods:baseline,modelPeriods:periods};
  }).filter(Boolean);
  return pairs.length?pairs.reduce((a,b)=>b.hours>a.hours?b:a):null;
}

/** Point differences use a single valid window, fresh sources and an NWS anchor. */
export function pointDifferences(input,now=Date.now()){
  const window=comparisonWindow(now),fresh=input&&Number.isFinite(input.checked)&&input.checked<=now+120000&&now-input.checked<=REVIEW_MAX_AGE;
  const rows=compareForecasts((input?.rows||[]).map(row=>row.error?row:!fresh?{...row,error:'Comparison collection overdue'}:row.issued>now+300000||now-row.issued>(row.id==='nws'?24:18)*HOUR?{...row,error:'Forecast update/run is old or invalid'}:row),window);
  const rain=rows.filter(r=>!r.error&&Number.isFinite(r.summary?.rain.value)),wind=rows.filter(r=>!r.error&&Number.isFinite(r.summary?.wind.value));
  const anchored=list=>list.some(r=>r.id==='nws')&&list.some(r=>r.id!=='nws');
  const rainSpread=anchored(rain)?Math.max(...rain.map(r=>r.summary.rain.value))-Math.min(...rain.map(r=>r.summary.rain.value)):null;
  const windSpread=anchored(wind)?Math.max(...wind.map(r=>r.summary.wind.value))-Math.min(...wind.map(r=>r.summary.wind.value)):null;
  const rainTiming=anchored(rain)?timing(rain,'rain',2):null,windTiming=anchored(wind)?timing(wind,'wind',1):null;
  const review=(rainSpread!==null&&Number(rainSpread.toFixed(2))>0)||(rainTiming?.hours||0)>0||(windTiming?.hours||0)>0;
  return {point:input?.point,checked:input?.checked,window,rows,rainSpread,windSpread,rainTiming,windTiming,rainSources:rain.length,windSources:wind.length,complete:rain.length===3&&wind.length===3,fresh,review};
}

/** Maxima across an area's explicit samples retain their individual locations. */
export function areaDifferences(areas,snapshot,now=Date.now()){
  const points=new Map((snapshot?.points||[]).map(p=>[p.point.id,p]));
  return areas.map(area=>{
    const samples=area.points.map(point=>pointDifferences(points.get(point.id)||{point,rows:[],checked:null},now));
    const maximum=(value,eligible)=>samples.filter(eligible).reduce((a,b)=>!a||value(b)>value(a)?b:a,null);
    return {id:area.id,name:area.name,samples,window:comparisonWindow(now),rain:maximum(p=>p.rainSpread,p=>p.rainSpread!==null),wind:maximum(p=>p.windTiming.hours,p=>!!p.windTiming),rainTiming:maximum(p=>p.rainTiming.hours,p=>!!p.rainTiming),review:samples.some(s=>s.review),complete:samples.every(s=>s.complete),checked:samples.every(s=>Number.isFinite(s.checked))?Math.min(...samples.map(s=>s.checked)):null};
  });
}

/** Order available differences only; missing coverage never sorts as measured zero. */
export function rankDifferences(areas,metric='rain'){
  const value=a=>metric==='wind'?a.wind?.windTiming.hours??null:metric==='rainTiming'?a.rainTiming?.rainTiming.hours??null:a.rain?Number(a.rain.rainSpread.toFixed(2)):null;
  return [...areas].sort((a,b)=>{const x=value(a),y=value(b);return x===null&&y!==null?1:y===null&&x!==null?-1:x!==null&&y!==null&&x!==y?y-x:a.name.localeCompare(b.name);});
}

/** One area counts once even if its hydrology, power and forecast all need review. */
export function mergeForecastReviews(rows,differences){
  const compact=p=>p?{point:p.point,checked:p.checked,rainSpread:p.rainSpread,windTiming:p.windTiming,rainTiming:p.rainTiming}:null;
  return rows.map(r=>{const f=differences.find(d=>d.id===r.area.id),forecast=f?{id:f.id,review:f.review,complete:f.complete,checked:f.checked,rain:compact(f.rain),wind:compact(f.wind),rainTiming:compact(f.rainTiming)}:null;return {...r,forecastDifference:forecast,review:r.review||!!forecast?.review,gaps:[...r.gaps,...(!forecast?.complete?['Forecast comparison coverage incomplete or awaiting collection']:[])],status:!r.review&&forecast?.review?'Forecast differences need planning review':r.status};});
}
