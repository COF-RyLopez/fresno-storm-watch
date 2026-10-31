/** Forecast/observation time contracts. No interpolation or automatic action thresholds. */
export const GOES_URL='https://nowcoast.noaa.gov/geoserver/observations/satellite/ows';
export const GOES_PRODUCTS=Object.freeze([
  {id:'goes_longwave_imagery',label:'GOES infrared',meaning:'Infrared cloud-top imagery · available day and night'},
  {id:'goes_water_vapor_imagery',label:'GOES water vapor',meaning:'Atmospheric moisture aloft · not surface humidity or rainfall'}
]);
export const HOUR=3_600_000;
const SPEED_FACTORS=Object.freeze({'wmoUnit:km_h-1':1/1.609344,'wmoUnit:m_s-1':2.2369362920544,'wmoUnit:kn':1.1507794480235,'wmoUnit:mi_h-1':1});

/** @param {string} text @returns {{start:number,end:number}} Fixed ISO intervals only; reject ambiguous calendar durations. */
export function forecastInterval(text){
  const [stamp,duration,...extra]=String(text).split('/');
  const match=duration?.match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/);
  const start=Date.parse(stamp),length=match?((+match[1]||0)*86400+(+match[2]||0)*3600+(+match[3]||0)*60+(+match[4]||0))*1000:0;
  if(extra.length||!/[Zz]|[+-]\d\d:\d\d$/.test(stamp)||!Number.isFinite(start)||length<=0||length>8*24*HOUR)throw new Error('Unrecognized NWS forecast interval.');
  return {start,end:start+length};
}

/** @param {object} payload @param {object} grid @param {number} now @returns {object} Preserve nulls, explicit units, intervals and source identity. */
export function windForecast(payload,grid,now=Date.now()){
  const p=payload?.properties,issued=Date.parse(p?.updateTime);
  if(p?.gridId!==grid.office||p?.gridX!==grid.x||p?.gridY!==grid.y||!Number.isFinite(issued)||issued>now+300_000)throw new Error('NWS grid identity or update time did not match.');
  const series={};
  for(const name of ['windSpeed','windGust','windDirection']){
    const field=p[name],factor=name==='windDirection'?field?.uom==='wmoUnit:degree_(angle)'?1:null:SPEED_FACTORS[field?.uom];
    if(!factor||!Array.isArray(field?.values))throw new Error(`Unrecognized NWS ${name} units or series.`);
    const unique=new Map();
    for(const row of field.values){
      const interval=forecastInterval(row.validTime),raw=row.value;
      const value=Number.isFinite(raw)&&raw>=0&&(name!=='windDirection'||raw<=360)?raw*factor:null;
      const sample={...interval,value:name==='windDirection'&&value===360?0:value};
      const key=`${interval.start}:${interval.end}`;
      const prior=unique.get(key);
      if(prior&&(prior.conflict||prior.value!==sample.value)){sample.value=null;sample.conflict=true;}
      unique.set(key,sample);
    }
    const values=[...unique.values()].sort((a,b)=>a.start-b.start||a.end-b.end);
    // Overlapping intervals with different starts have no publisher revision order.
    if(values.some((v,i)=>i&&v.start<values[i-1].end))throw new Error(`Overlapping NWS ${name} intervals.`);
    series[name]=values;
  }
  return {issued,grid:{...grid},units:'mph',sourceUnits:Object.fromEntries(['windSpeed','windGust','windDirection'].map(k=>[k,p[k].uom])),directionConvention:'meteorological-from-degrees-true-north',heightMeters:10,series};
}

/** @param {object[]} samples @param {number} target @returns {object|null} Half-open intervals; never bridge gaps or extrapolate. */
export const intervalAt=(samples,target)=>(samples||[]).find(s=>s.start<=target&&target<s.end)||null;

/** @param {number[]} frames @param {number} target @param {number} now @param {object} limits @returns {number|null} Observations never extend into forecast time. */
export function observationAt(frames,target,now,{maxGapMs=20*60_000,maxAgeMs=30*60_000}={}){
  if(!Number.isFinite(target)||target>now||!frames.length||now-Math.max(...frames)>maxAgeMs)return null;
  const eligible=frames.filter(t=>t<=target&&target-t<=maxGapMs);
  return eligible.length?Math.max(...eligible):null;
}

/** @param {string} dimension @param {number} now @returns {number[]} Use only explicit publisher frames, not inferred cadence. */
export function satelliteFrames(dimension,now=Date.now()){
  const frames=[...new Set(String(dimension).split(',').map(s=>Date.parse(s.trim())).filter(t=>Number.isFinite(t)&&t<=now+120_000&&t>=now-8*HOUR))].sort((a,b)=>b-a);
  if(!frames.length)throw new Error('GOES returned no recent explicit image times.');
  return frames;
}

/** @param {number} now @returns {number[]} Three hours of history at 15 min; 72 forecast hours. */
export function weatherStops(now=Date.now()){
  const base=Math.floor(now/(15*60_000))*15*60_000,next=Math.floor(now/HOUR)*HOUR+HOUR;
  return [...Array.from({length:12},(_,i)=>base-(12-i)*15*60_000),now,...Array.from({length:72},(_,i)=>next+i*HOUR)];
}

/** @param {object} snapshot @returns {object} Validate the public snapshot before displaying any location. */
export function validateWindSnapshot(snapshot){
  if(snapshot?.schemaVersion!==1||!Number.isFinite(Date.parse(snapshot.generatedAt))||!Array.isArray(snapshot.sites)||snapshot.sites.length!==9||new Set(snapshot.sites.map(s=>s.id)).size!==9)throw new Error('Wind snapshot format or planning-point inventory is invalid.');
  const ids=['SJ41','FRIANT','MENDOTA','JAMES','PINEFLAT','TRIMMER','FRESNO','COALINGA','SHAVER'];
  for(const s of snapshot.sites){
    if(!ids.includes(s.id)||typeof s.name!=='string'||s.longitude<-121.5||s.longitude>-118||s.latitude<35.5||s.latitude>38||!Number.isFinite(s.longitude)||!Number.isFinite(s.latitude))throw new Error('Invalid wind planning point.');
    if(s.forecast){
      if(!Number.isFinite(s.forecast.issued)||s.forecast.units!=='mph'||s.forecast.heightMeters!==10)throw new Error('Invalid wind forecast metadata.');
      for(const key of ['windSpeed','windGust','windDirection']){
        const rows=s.forecast.series?.[key];
        if(!Array.isArray(rows)||rows.some((r,i)=>!Number.isFinite(r.start)||!Number.isFinite(r.end)||r.end<=r.start||(i&&r.start<rows[i-1].end)||(r.value!==null&&(!Number.isFinite(r.value)||r.value<0||(key==='windDirection'&&r.value>360)))))throw new Error('Invalid wind forecast samples.');
      }
    }
  }
  return snapshot;
}

/** @param {object} site @param {number} target @param {number} now @param {boolean} collectionStale @returns {object} A successful browser check cannot renew source issuance. */
export function windAt(site,target,now=Date.now(),collectionStale=false){
  const f=site?.forecast,success=Date.parse(site?.lastSuccess);
  const reason=site?.error?'Source check failed':collectionStale?'Collection overdue':!f?'No forecast returned':!Number.isFinite(success)||now-success>45*60_000||success>now+120_000?'Source collection overdue':f.issued>now+300_000||now-f.issued>24*HOUR?'Forecast update is old or invalid':target<f.issued?'Selected time predates this forecast update':null;
  const samples=reason?{}:Object.fromEntries(['windSpeed','windGust','windDirection'].map(k=>[k,intervalAt(f.series[k],target)]));
  return {reason,speed:samples.windSpeed?.value??null,gust:samples.windGust?.value??null,direction:samples.windDirection?.value??null,samples};
}

/** @param {number|null} degrees @returns {string} Wind is reported as the direction it comes FROM. */
export function windCompass(degrees){return Number.isFinite(degrees)?['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'][Math.round(degrees/22.5)%16]:'Unknown';}
