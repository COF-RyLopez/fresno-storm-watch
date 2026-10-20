import {sourceTime} from './environment-model.js';
import {PROBABILITY_STEPS} from './precip-probability-model.js';
const BASE='https://mapservices.weather.noaa.gov/vector/rest/services/';
export const BRIEFING_LAYER_CHECK_MS=7*60_000;
const rain={service:BASE+'precip/wpc_qpf/MapServer',field:'qpf',product:'24-hour QPF',maxAge:36*3_600_000,page:4,source:'https://www.wpc.ncep.noaa.gov/#page=qpf',meaning:'Forecast liquid-equivalent precipitation in inches, including melted snow. Not runoff, flood depth or probability of exceeding a rainfall threshold.',relationship:'Related rainfall guidance. WPC amounts do not reproduce Hanford’s local rainfall ranges or quarter-/half-inch probabilities.'};
const ero={service:BASE+'hazards/wpc_precip_hazards/MapServer',field:'dn',maxAge:36*3_600_000,page:3,source:'https://www.wpc.ncep.noaa.gov/qpf/excessive_rainfall_outlook_ero.php',meaning:'WPC excessive-rainfall risk categories describe the chance of rainfall exceeding flash-flood guidance within 25 miles of a point. Not predicted inundation or a river flood warning.',relationship:'Same WPC product family as partner slide 3. This is the latest published cycle, not the archived Wednesday map.'};
export const BRIEFING_LAYERS=Object.freeze([
  ...[1,2,3].map(day=>({...rain,id:`rain-day-${day}`,layer:day,label:`Rainfall amount · Day ${day}`})),
  ...[1,2,3].map(day=>({...ero,id:`ero-day-${day}`,layer:day-1,product:`Day ${day} Excessive Rainfall Potential Forecast`,label:`Excessive rainfall · Day ${day}`})),
  {id:'winter',label:'Winter impacts · Days 1–3',service:BASE+'outlooks/wpc_wssi/MapServer',layer:4,field:'impact',product:'WINTER STORM SEVERITY INDEX',maxAge:12*3_600_000,page:14,source:'https://www.wpc.ncep.noaa.gov/wwd/wssi/wssi.php',meaning:'WPC Winter Storm Severity Index: anticipated winter-weather impacts. Not snow depth, snow probability or a road-access determination.',relationship:'Same WPC product family as partner slide 14. The full Days 1–3 window can differ from the slide’s window; read the source times.'},
  ...PROBABILITY_STEPS
]);
/** Parse only documented NOAA UTC formats; reject invalid dates rather than normalizing them. */
export function briefingLayerTime(value){
  const standard=sourceTime(value);if(standard!==null)return standard;
  let m=typeof value==='string'&&value.match(/^(\d{4}-\d{2}-\d{2}) (\d{2})(\d{2})Z$/);
  if(m)return sourceTime(`${m[1]} ${m[2]}:${m[3]}:00`);
  m=typeof value==='string'&&value.match(/^(\d{2})Z (\d{2})\/(\d{2})\/(\d{2})$/);
  return m?sourceTime(`20${m[4]}-${m[2]}-${m[3]} ${m[1]}:00:00`):null;
}
/** A national distinct-values query must contain exactly one coherent source revision. */
export function briefingLayerCycle(payload,step,now=Date.now()){
  if(payload?.error||payload?.exceededTransferLimit||!Array.isArray(payload?.features)||!payload.features.length)throw new Error('No complete forecast cycle returned. A blank map does not establish no risk.');
  const fields=['product','issue_time','start_time','end_time',...(step.field==='qpf'?['units']:[])];
  const cycles=new Set(payload.features.map(f=>JSON.stringify(fields.map(k=>f.attributes?.[k]))));
  if(cycles.size!==1)throw new Error('Mixed forecast revisions returned; map withheld until a coherent cycle is available.');
  const a=payload.features[0].attributes,issue=briefingLayerTime(a.issue_time),start=briefingLayerTime(a.start_time),end=briefingLayerTime(a.end_time);
  if(a.product!==step.product||(step.field==='qpf'&&a.units!=='Inches'))throw new Error('Source product or units changed; map withheld for verification.');
  if([issue,start,end].some(t=>t===null)||end<=start||end-start>73*3_600_000||issue>now+120_000||start<issue-24*3_600_000)throw new Error('Forecast timestamps are invalid or inconsistent.');
  if(step.field!=='impact'&&end-start>25*3_600_000)throw new Error('Unexpected daily forecast window.');
  if(end<=now||now-issue>step.maxAge)throw new Error('Source forecast has ended or its issue is overdue; map withheld.');
  const where=fields.map(k=>`${k} = '${String(a[k]).replaceAll("'","''")}'`).join(' AND ');
  return {issue,start,end,where};
}
/** Keep publisher labels and symbols; no local hazard-color substitution. */
export function briefingLayerLegend(payload,step){
  const rows=payload?.layers?.find(l=>l.layerId===step.layer)?.legend;
  if(payload?.error||!Array.isArray(rows)||!rows.length)throw new Error('Official legend unavailable; map withheld.');
  return rows.map(r=>{if(typeof r.label!=='string'||r.contentType!=='image/png'||typeof r.imageData!=='string'||r.imageData.length>200_000||!/^[A-Za-z0-9+/=]+$/.test(r.imageData))throw new Error('Invalid publisher legend.');return {label:r.label,image:'data:image/png;base64,'+r.imageData};});
}
