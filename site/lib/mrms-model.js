/** NOAA MRMS observed rainfall (radar + gauges) on the HRRR display grid. Observations, not forecasts or flood depth. */
import {HOUR,RAIN_STOPS,RAIN_MIN} from './hrrr-model.js';
export {RAIN_STOPS};
/** 24-hour total (in), evenly spaced like its legend; 2+ in is a very wet day for the valley. */
export const TOTAL_STOPS=Object.freeze([[0,'#7fd1a0'],[.4,'#3fa66a'],[.8,'#2f86b8'],[1.2,'#6c5cc4'],[1.6,'#b04fae'],[2,'#e2558a']]);
const fileName=valid=>`mrms-${valid.replace(/[-:]/g,'').replace('.000','')}.json`;
/** Validate provenance, units, the shared HRRR grid and 24 consecutive hours. */
export function validateMrmsManifest(m,now=Date.now()){
  const g=m?.grid,checked=Date.parse(m?.generatedAt);
  if(m?.schemaVersion!==1||m.product!=='noaa-mrms-conus-analysis-hourly'||m.license!=='CC-BY-4.0'||typeof m.attribution!=='string'||m.hourlyUnits!=='in/h'||m.totalUnits!=='in'||m.total!=='total-24h.json'||!Number.isFinite(checked)||checked>now+120000)throw Error('MRMS identity, units or timestamps changed.');
  if(!g||g.wkid!==4326||g.width!==101||g.height!==80||g.x0!==-121.25||g.y0!==38.12||g.dx!==0.03||g.dy!==-0.03)throw Error('MRMS display grid changed; review coverage.');
  const last=Date.parse(m.frames?.at?.(-1)?.valid);
  if(!Array.isArray(m.frames)||m.frames.length!==24||!Number.isFinite(last)||last>now+120000||m.frames.some((f,i)=>Date.parse(f.valid)!==last-(23-i)*HOUR||f.file!==fileName(f.valid)))throw Error('MRMS hourly inventory is inconsistent.');
  return m;
}
/** One hourly field (in/h) or the 24-hour total (in); null = no coverage, never zero. */
export function validateMrmsGrid(f,m,valid,isTotal=false){
  const n=m.grid.width*m.grid.height,max=isTotal?48:20;
  if(f?.schemaVersion!==1||f.valid!==valid||f.width!==m.grid.width||f.height!==m.grid.height||(isTotal&&f.hours!==24))throw Error('MRMS file does not match the collection.');
  if(!Array.isArray(f.rain)||f.rain.length!==n||f.rain.some(v=>v!==null&&(!Number.isFinite(v)||v<0||v>max)))throw Error('MRMS rain values are invalid.');
  return f;
}
/** Why the field is hidden, or null when current enough to show. MRMS runs about an hour behind. */
export function mrmsReason(m,now=Date.now()){
  if(!m)return 'Waiting for MRMS rainfall';
  if(m.error)return m.error;
  if(now-Date.parse(m.generatedAt)>45*60000)return 'MRMS collection overdue · field hidden';
  if(now-Date.parse(m.frames.at(-1).valid)>4*HOUR)return 'Latest MRMS hour is old · field hidden';
  return null;
}
/** Single band; dry and no-coverage cells transparent (legend says so). */
export function mrmsPixels(f){
  return {width:f.width,height:f.height,pixelType:'f32',pixels:[Float32Array.from(f.rain,v=>v??0)],mask:Uint8Array.from(f.rain,v=>v!==null&&v>=RAIN_MIN?1:0)};
}
