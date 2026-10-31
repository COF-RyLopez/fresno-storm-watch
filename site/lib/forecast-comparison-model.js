/** Bounded point comparisons, not basin rainfall, runoff or model confidence. */
import {forecastInterval,windForecast,HOUR} from './weather-model.js';
import {MPH} from './hrrr-model.js';
export const MODELS=Object.freeze([
  {id:'noaa-hrrr-forecast-48-hour',label:'HRRR · Dynamical',resolution:'3 km',hours:48,gust:true},
  {id:'noaa-gfs-forecast',label:'GFS · Dynamical',resolution:'0.25°',hours:72,gust:false}
]);
const positive=v=>Number.isFinite(v)&&v>=0?v:null;
const stamp=t=>typeof t==='string'&&/[Zz]|[+-]\d\d:\d\d$/.test(t)&&Number.isFinite(Date.parse(t))?Date.parse(t):NaN;

/** Next full UTC six-hour boundary; never compare different forecast windows. */
export function comparisonWindow(now=Date.now()){
  const start=Math.ceil(now/(6*HOUR))*6*HOUR;
  return {start,end:start+24*HOUR};
}

/** Validate explicit associations; an existing gauge supplies an upper-reach point. */
export function comparisonAreas(areas,associations,winds,gauges){
  return areas.map(area=>{
    const association=associations.find(a=>a.id===area.id);
    const ids=association?.windPoints?.length?association.windPoints:area.gauges.slice(0,1);
    const points=ids.map(id=>{
      const p=[...winds,...gauges].find(s=>s.id===id);
      if(!p||!Number.isFinite(p.longitude)||!Number.isFinite(p.latitude)||p.longitude< -121.5||p.longitude> -118||p.latitude<35.5||p.latitude>38)throw Error('Comparison point is not in the configured Fresno inventory.');
      return {id:p.id,name:p.name,latitude:p.latitude,longitude:p.longitude};
    });
    return {id:area.id,name:area.name,note:association?.windPoints?.length?association.note:'Forecast sampled at the existing river gauge location; this adds point weather context, not coverage across the reach.',points};
  });
}

/** Strict interval identity and non-overlap; never resolve conflicting source order. */
function intervals(rows){
  const ordered=rows.sort((a,b)=>a.start-b.start);
  if(ordered.some((r,i)=>!Number.isFinite(r.start)||!Number.isFinite(r.end)||r.end<=r.start||(i&&r.start<ordered[i-1].end)))throw Error('Forecast intervals overlap or are invalid.');
  return ordered;
}

/** Decode a model run; precipitation is the average rate since the previous step. */
export function modelSeries(result,model,point,now=Date.now()){
  if(result?.dataProduct?.id!==model.id||result?.point?.requested?.latitude!==point.latitude||result?.point?.requested?.longitude!==point.longitude)throw Error('Model response identity does not match the requested point.');
  const selected=result.point.selected;
  if(!Number.isFinite(selected?.latitude)||!Number.isFinite(selected?.longitude)||Math.abs(selected.latitude-point.latitude)>0.5||Math.abs(selected.longitude-point.longitude)>0.5)throw Error('Selected model grid cell is missing or too distant.');
  const keys=['precipitation_surface','wind_u_10m','wind_v_10m',...(model.gust?['wind_gust_surface']:[])];
  for(const k of keys)if(result.variables?.[k]?.unit!==(k==='precipitation_surface'?'kg m-2 s-1':'m s-1'))throw Error('Model variable units changed: '+k);
  if(result.forecasts?.length!==1)throw Error('Expected one resolved model run.');
  const f=result.forecasts[0],issued=stamp(f.initTime),times=f.validTimes?.map(stamp),leads=f.leadTimeHours;
  if(!Number.isFinite(issued)||issued>now+300000||now-issued>18*HOUR)throw Error('Model run is old or in the future.');
  if(!Array.isArray(times)||times.length<2||times.length>73||!Array.isArray(leads)||times.length!==leads.length||times.some((t,i)=>!Number.isFinite(t)||!Number.isFinite(leads[i])||leads[i]<0||leads[i]>model.hours||t!==issued+leads[i]*HOUR||(i&&t<=times[i-1])))throw Error('Model valid-time axes do not match its run and lead times.');
  for(const k of keys)if(!Array.isArray(f.data?.[k])||f.data[k].length!==times.length)throw Error('Model values do not match the valid-time axis.');
  const rain=[],wind=[],gust=[];
  for(let i=0;i<times.length;i++){
    // Lead zero has no previous interval. Missing data stay null, including U/V.
    if(i){const rate=positive(f.data.precipitation_surface[i]);rain.push({start:times[i-1],end:times[i],value:rate===null?null:rate*(times[i]-times[i-1])/1000/25.4});}
    const u=f.data.wind_u_10m[i],v=f.data.wind_v_10m[i];
    wind.push({start:times[i],end:times[i]+HOUR,value:Number.isFinite(u)&&Number.isFinite(v)?Math.hypot(u,v)*MPH:null});
    if(model.gust)gust.push({start:times[i],end:times[i]+HOUR,value:positive(f.data.wind_gust_surface[i])===null?null:f.data.wind_gust_surface[i]*MPH});
  }
  const canonical=f.links?.canonical;
  return {id:model.id,label:model.label,resolution:model.resolution,issued,selected,snapshotId:result.snapshotId,source:typeof canonical==='string'&&canonical.startsWith('/v1/data/')?'https://api.dynamical.org'+canonical:'https://dynamical.org/api/',rain:intervals(rain),wind:intervals(wind),gust:intervals(gust),gustProvided:model.gust,windMeaning:'Maximum hourly 10 m wind-speed sample; not an interval average'};
}

/** NWS grid totals are interval amounts; never substitute probability for amount. */
export function nwsSeries(payload,grid,point,now=Date.now()){
  const f=windForecast(payload,grid,now),field=payload.properties.quantitativePrecipitation;
  if(now-f.issued>24*HOUR)throw Error('NWS forecast update is old.');
  if(field?.uom!=='wmoUnit:mm'||!Array.isArray(field.values))throw Error('NWS quantitative precipitation units or series changed.');
  const rain=intervals(field.values.map(r=>({...forecastInterval(r.validTime),value:positive(r.value)===null?null:r.value/25.4})));
  return {id:'nws',label:'NWS Hanford grid',issued:f.issued,selected:{latitude:point.latitude,longitude:point.longitude},grid,source:`https://api.weather.gov/gridpoints/${grid.office}/${grid.x},${grid.y}`,rain,wind:f.series.windSpeed,gust:f.series.windGust,gustProvided:true,windMeaning:'Maximum published sustained-wind interval overlapping the window'};
}

/** Complete amounts only. Do not apportion an NWS total across a partial interval. */
export function summarizeWindow(series,start,end){
  const amount=rows=>{
    const found=rows.filter(r=>r.start<end&&r.end>start);let cursor=start,total=0,covered=0;
    let complete=true;
    for(const r of found){if(r.start!==cursor||r.end>end||r.start<start||r.value===null)complete=false;if(r.start>=start&&r.end<=end&&r.value!==null){total+=r.value;covered+=r.end-r.start;}cursor=r.end;}
    return {value:complete&&cursor===end?total:null,hours:covered/HOUR};
  };
  const peak=rows=>{
    const found=rows.filter(r=>r.start<end&&r.end>start);let cursor=start,best=null,covered=0;
    let complete=true;
    for(const r of found){const a=Math.max(start,r.start),b=Math.min(end,r.end);if(a!==cursor||r.value===null)complete=false;if(r.value!==null){covered+=b-a;if(!best||r.value>best.value)best={value:r.value,start:a,end:b};}cursor=b;}
    return {value:complete&&cursor===end?best?.value??null:null,hours:covered/HOUR,peak:complete&&cursor===end?best:null};
  };
  return {rain:amount(series.rain),wind:peak(series.wind),gust:peak(series.gust)};
}

/** Same 24h/6h periods for every source; partial totals never become zero. */
export function compareForecasts(rows,window){
  return rows.map(row=>{
    if(row.error)return row;
    const periods=Array.from({length:4},(_,i)=>{const start=window.start+i*6*HOUR;return {start,end:start+6*HOUR,...summarizeWindow(row,start,start+6*HOUR)};});
    const summary=summarizeWindow(row,window.start,window.end);
    const wettest=periods.every(p=>p.rain.value!==null)&&summary.rain.value>0?periods.reduce((a,b)=>b.rain.value>a.rain.value?b:a):null;
    return {...row,summary,periods,wettest};
  });
}
