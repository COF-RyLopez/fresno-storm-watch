/** Public source contracts shared by the browser, collector and tests. */
export const RADAR_URL = 'https://mapservices.weather.noaa.gov/eventdriven/rest/services/radar/radar_base_reflectivity_time/ImageServer';
export const QPF_URL = 'https://mapservices.weather.noaa.gov/vector/rest/services/precip/wpc_qpf/MapServer';
export const CDEC_URL = 'https://cdec.water.ca.gov/dynamicapp/req/JSONDataServlet';
export const QPF_PERIODS = Object.freeze([
  {id:1,hours:24,label:'Day 1 · 24 hours'},
  {id:9,hours:72,label:'Days 1–3 · 72 hours'},
  {id:11,hours:168,label:'Days 1–7 · 168 hours'}
]);
export const QPF_BANDS = Object.freeze([
  {min:0.01,max:0.249999,label:'0.01–<0.25',color:'#d0e9ef'},
  {min:0.25,max:0.499999,label:'0.25–<0.50',color:'#a2cfdc'},
  {min:0.5,max:0.999999,label:'0.50–<1',color:'#6babc8'},
  {min:1,max:1.999999,label:'1–<2',color:'#3f83b2'},
  {min:2,max:4.999999,label:'2–<5',color:'#215c91'},
  {min:5,max:1000,label:'5+',color:'#163b66'}
]);

/** @param {unknown} value @returns {number|null} Reject blank/sentinel/nonfinite values. */
export function realNumber(value) {
  if(value===null||value===undefined||typeof value==='boolean'||String(value).trim()==='')return null;
  const n=Number(value);return Number.isFinite(n)&&![-999,-9999,-99999].includes(n)?n:null;
}

/** @param {unknown} value @param {string} offset @returns {number|null} Parse publisher wall-clock text with an explicit source offset. */
export function sourceTime(value,offset='Z') {
  const parts=typeof value==='string'&&value.match(/^(\d{4})-(\d{1,2})-(\d{1,2}) (\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if(!parts||!['Z','-08:00'].includes(offset))return null;
  const normalized=`${parts[1]}-${parts[2].padStart(2,'0')}-${parts[3].padStart(2,'0')} ${parts[4].padStart(2,'0')}:${parts[5]}${parts[6]?':'+parts[6]:''}`;
  const t=Date.parse(normalized.replace(' ','T')+offset);
  if(!Number.isFinite(t))return null;
  const wall=new Date(t+(offset==='-08:00'?-8*3_600_000:0)).toISOString().slice(0,normalized.length).replace('T',' ');
  return wall===normalized?t:null;
}

/** @param {object} payload @param {number} now @returns {object[]} Latest CONUS frames; never use another region's timestamp. */
export function radarFrames(payload,now=Date.now()) {
  if(payload?.error||!Array.isArray(payload?.features)||payload.exceededTransferLimit)throw new Error('Radar catalog is incomplete or unavailable.');
  const frames=new Map();
  for(const {attributes:a} of payload.features){
    const time=realNumber(a?.idp_validtime),id=realNumber(a?.objectid);
    if(a?.idp_subset!=='CONUS'||time===null||id===null||!Number.isInteger(id)||time>now+120_000||time<now-4*3_600_000)continue;
    if(!frames.has(time)||id>frames.get(time).id)frames.set(time,{id,time,ingested:realNumber(a.idp_ingestdate)});
  }
  const result=[...frames.values()].sort((a,b)=>b.time-a.time);
  if(!result.length)throw new Error('No recent CONUS radar frames returned.');
  return result;
}

/** @param {object} payload @param {number} hours @param {number} now @returns {object} Require a single coherent issue/window across the national product. */
export function qpfCycle(payload,hours,now=Date.now()) {
  if(payload?.error||payload?.exceededTransferLimit||!Array.isArray(payload?.features)||!payload.features.length)throw new Error('Rainfall forecast cycle is missing, mixed or incomplete.');
  const cycles=new Set(payload.features.map(f=>JSON.stringify(['product','issue_time','start_time','end_time','units'].map(k=>f.attributes?.[k]))));
  if(cycles.size!==1)throw new Error('Rainfall forecast cycle is mixed or incomplete.');
  const a=payload.features[0].attributes;
  const issue=sourceTime(a?.issue_time),start=sourceTime(a?.start_time),end=sourceTime(a?.end_time);
  if(a?.units!=='Inches'||issue===null||start===null||end===null||end-start!==hours*3_600_000||issue>now+300_000||issue>=end)throw new Error('Rainfall forecast times or units did not match the source contract.');
  return {issue,start,end,issueText:a.issue_time,startText:a.start_time,endText:a.end_time,hours,units:'in',product:String(a.product||`${hours}-hour QPF`)};
}

/** @param {object[]} rows @param {string} station @param {object} metric @param {number} now @returns {object} Preserve missing/flagged records and report dates without turning them into zeros. */
export function cdecSeries(rows,station,metric,now=Date.now(),{through=now+120_000}={}) {
  if(!Array.isArray(rows))throw new Error('CDEC response is not a record array.');
  const matching=rows.filter(r=>r.stationId===station&&r.durCode===metric.duration&&Number(r.SENSOR_NUM)===metric.sensor);
  const byTime=new Map();let rejected=0,duplicates=0,conflicts=0,invalidTimes=0;
  for(const row of matching){
    const time=sourceTime(row.obsDate,'-08:00');
    if(time===null||time>through){rejected++;if(time===null)invalidTimes++;continue;}
    const flag=String(row.dataFlag??'').trim(), value=realNumber(row.value);
    const valid=row.units===metric.units&&value!==null&&(metric.allowNegative||value>=0)&&!flag;
    const reportDate=new Date(time-8*3_600_000).toISOString().slice(0,10);
    const sample={time,reportDate,value:valid?value:null,flag,units:row.units};
    if(byTime.has(time)){
      duplicates++;
      const prior=byTime.get(time);
      if(prior.conflict)continue;
      if(JSON.stringify(prior)!==JSON.stringify(sample)){
        // No publisher revision ordering exists: quarantine this timestamp, not the whole reservoir.
        byTime.set(time,{time,reportDate,value:null,flag:'CONFLICT',units:metric.units,conflict:true});conflicts++;
      }
    }else byTime.set(time,sample);
  }
  const samples=[...byTime.values()].sort((a,b)=>a.time-b.time);
  const latest=samples.at(-1)||null,lastValid=samples.filter(r=>r.value!==null).at(-1)||null;
  return {sensor:metric.sensor,duration:metric.duration,units:metric.units,latest,lastValid,samples,input:matching.length,accepted:samples.length,rejected,duplicates,conflicts,invalidTimes};
}

/** @param {object|null} series @param {object} metric @param {number} now @returns {object} Age and gaps are independent of collector/browser fetch success. */
export function reservoirMetricState(series,metric,now=Date.now()) {
  const value=series?.lastValid;
  if(series?.invalidTimes)return {tone:'gap',label:'Unrecognized source timestamp · verify CDEC',sample:value||null};
  if(!value||!Number.isFinite(value.time)||realNumber(value.value)===null||series.units!==metric.units)return {tone:'gap',label:'Unavailable',sample:null};
  if(value.time>now+120_000)return {tone:'gap',label:'Source time is in the future',sample:null};
  const age=now-value.time;
  if(age>metric.maxAgeHours*3_600_000)return {tone:'gap',label:'Old reading',sample:value};
  if(series.latest?.time>value.time)return {tone:'gap',label:'Newer record missing or flagged · last valid',sample:value};
  return {tone:'normal',label:metric.duration==='D'?'Daily report':'Recent hourly report',sample:value};
}

/** @param {object} snapshot @returns {object} Refuse malformed collector output before it reaches the interface. */
export function validateReservoirSnapshot(snapshot) {
  if(snapshot?.schemaVersion!==1||!Number.isFinite(Date.parse(snapshot.generatedAt))||!Array.isArray(snapshot.stations))throw new Error('Reservoir snapshot format is invalid.');
  if(snapshot.stations.length!==2||new Set(snapshot.stations.map(s=>s.id)).size!==2||snapshot.stations.some(s=>!['MIL','PNF'].includes(s.id)||typeof s.metrics!=='object'||!s.metrics))throw new Error('Reservoir snapshot is missing expected stations.');
  return snapshot;
}
