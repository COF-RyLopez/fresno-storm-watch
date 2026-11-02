/** WPC Probabilistic Precipitation Portal contract, checked 2026-10-20.
 * Publisher images and legend colors are retained, not inferred from briefing pixels.
 */
export const PROBABILITY_SOURCE='https://www.wpc.ncep.noaa.gov/Prob_Precip/?zoom=HNX';
export const PROBABILITY_BASE='https://www.wpc.ncep.noaa.gov/Prob_Precip/';
export const PROBABILITY_MAX_CHECK_AGE=2*3_600_000;
const PROBABILITY_MAX_CYCLE_AGE=6*3_600_000;
export const PROBABILITY_BOUNDS=Object.freeze({xmin:-124.786952,ymin:24.530802,xmax:-95.856708,ymax:38.002106,spatialReference:{wkid:4326}});
export const PROBABILITY_LEGEND=Object.freeze([
  ['90%','#003200'],['80%','#00440a'],['70%','#185612'],['60%','#266a1b'],['50%','#347e24'],['40%','#51a736'],['30%','#85c16d'],['20%','#b4dca3'],['10%','#e2f6da'],['1%','#f5f5f5']
]);
export const PROBABILITY_STEPS=Object.freeze([0,1,2].flatMap(period=>['0p25','0p50'].map(threshold=>({
  id:`prob-${threshold}-${period+1}`,kind:'probability',period,threshold,
  label:`Chance ≥ ${threshold==='0p25'?'0.25':'0.50'} in. · 24h period ${period+1}`,
  service:PROBABILITY_SOURCE,source:PROBABILITY_SOURCE,maxAge:PROBABILITY_MAX_CYCLE_AGE,
  meaning:`Probability (%) of at least ${threshold==='0p25'?'0.25':'0.50'} inches of liquid-equivalent precipitation during the displayed 24 hours. Includes melted frozen precipitation; not a flood probability or rainfall amount.`,
  relationship:'Same threshold as Hanford briefing rainfall probabilities. Latest WPC portal cycle and available 24-hour windows; dates can differ from a briefing. Western CONUS image coverage only (south of 38°N), including Fresno County.'
}))));
/** Read a cycle declaration as data, never execute the publisher JavaScript. */
export function parseProbabilityCycle(text,now=Date.now()){
  const match=/^\s*window\.cycle\s*=\s*['"](\d{10})['"];?\s*$/.exec(text);
  if(!match)throw new Error('Unrecognized WPC cycle declaration.');
  const c=match[1],iso=`${c.slice(0,4)}-${c.slice(4,6)}-${c.slice(6,8)}T${c.slice(8)}:00:00.000Z`,issue=Date.parse(iso);
  if(!Number.isFinite(issue)||new Date(issue).toISOString()!==iso||issue>now+120_000||now-issue>PROBABILITY_MAX_CYCLE_AGE)throw new Error('WPC cycle is invalid, future or overdue.');
  return {cycle:c,issue};
}
/** Mirror the portal's available CONUS 24h keys; choose successive nonoverlapping periods. */
export function probabilityPeriods(cycle,now=Date.now()){
  const {issue}=parseProbabilityCycle(`window.cycle = '${cycle}';`,now),hour=Number(cycle.slice(8)),offset=hour%6;
  const max=[6,7,8,9,10,18,19,20,21].includes(hour)?66:72;
  const end=[11,22,23].includes(hour)?max+6-offset:max-offset;
  // First 24-hour key in the publisher's six-hour grid, including its cycle offset.
  const first=24-offset;
  return [first,first+24,first+48].filter(f=>f<=end).map((forecastHour,index)=>({index,forecastHour,start:new Date(issue+(forecastHour-24)*3_600_000).toISOString(),end:new Date(issue+forecastHour*3_600_000).toISOString()}));
}
/** Construct only the publisher's known public southwest tile path. */
export function probabilityImageUrl(cycle,threshold,forecastHour){
  if(!/^\d{10}$/.test(cycle)||!['0p25','0p50'].includes(threshold)||!Number.isInteger(forecastHour)||forecastHour<18||forecastHour>78)throw new Error('Invalid probability image key.');
  return `${PROBABILITY_BASE}hourly-data/co/${cycle}/png/ppp_ndfd_co_pp24ige${threshold}_${cycle}f${String(forecastHour).padStart(3,'0')}_tile_0_1.png`;
}
/** Reject mixed cycles, altered extents/legends and missing files before displaying any probability. */
export function validateProbabilitySnapshot(value,now=Date.now()){
  if(value?.schemaVersion!==1||value.source!==PROBABILITY_SOURCE||!(value.error===null||typeof value.error==='string'))throw new Error('Invalid WPC snapshot.');
  const checked=Date.parse(value.checkedAt);
  if(!Number.isFinite(checked)||checked>now+120_000||now-checked>PROBABILITY_MAX_CHECK_AGE)throw new Error('Probability collection check overdue or invalid.');
  if(value.error)throw new Error(`Probability collection failed: ${String(value.error).slice(0,240)}`);
  const {issue}=parseProbabilityCycle(`window.cycle = '${value.cycle}';`,now);
  if(JSON.stringify(value.bounds)!==JSON.stringify(PROBABILITY_BOUNDS)||JSON.stringify(value.legend)!==JSON.stringify(PROBABILITY_LEGEND)||value.issue!==new Date(issue).toISOString()||!Array.isArray(value.records))throw new Error('Probability source geometry, colors or issue changed.');
  const periods=probabilityPeriods(value.cycle,now),keys=new Set();
  for(const r of value.records){const p=periods.find(p=>p.index===r.period);if(!p||!['0p25','0p50'].includes(r.threshold)||r.start!==p.start||r.end!==p.end||r.source!==probabilityImageUrl(value.cycle,r.threshold,p.forecastHour)||!/^[a-f0-9]{64}$/.test(r.sha256)||r.file!==`probability-images/${r.sha256}.png`||!Number.isInteger(r.bytes)||r.bytes<100||r.bytes>8_000_000||!Number.isInteger(r.width)||!Number.isInteger(r.height)||r.width<2||r.height<2||r.width>4096||r.height>4096||keys.has(`${r.period}:${r.threshold}`))throw new Error('Incomplete or conflicting probability image metadata.');keys.add(`${r.period}:${r.threshold}`);}
  if(value.records.length!==periods.length*2)throw new Error('Probability snapshot does not contain both thresholds for all available periods.');
  return value;
}
/** Return one exact revision/window; never silently substitute a different period. */
export function probabilityRecord(value,step,now=Date.now()){
  validateProbabilitySnapshot(value,now);const record=value.records.find(r=>r.period===step.period&&r.threshold===step.threshold);
  if(!record)throw new Error('This 24-hour period is not available in the current WPC cycle.');
  if(Date.parse(record.end)<=now)throw new Error('Probability forecast period has ended.');
  return record;
}
