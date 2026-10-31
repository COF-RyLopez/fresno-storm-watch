/** NWPS source semantics and planning cues. No local flood model or extrapolation. */
import { formatTime } from './model.js';
export const HOUR = 3_600_000;
export const RIVER_COLORS = Object.freeze({ threshold:'#a73332', change:'#9a650c', monitor:'#246c91', gap:'#707b86' });
const LEVELS = ['action','minor','moderate','major'];

/** @param {number|null|undefined} value @param {string} timeZone @returns {string} Missing source time must never become the application clock. */
export function formatRiverTime(value,timeZone) { return value===null||value===undefined?'Not available':formatTime(value,timeZone); }

/** @param {unknown} value @returns {number|null} Preserve real zero and negative gauge stages. */
export function riverNumber(value) {
  return Number.isFinite(value) && ![-999,-9999].includes(value) ? value : null;
}
/** @param {unknown} value @returns {number|null} Ignore NWPS year-0001 sentinels. */
export function riverTime(value) {
  if (typeof value !== 'string' || !/^\d{4}-.*(?:Z|[+-]\d\d:\d\d)$/.test(value)) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) && ms >= Date.UTC(2000,0,1) ? ms : null;
}
/** @param {number|null} value @param {string} from @param {string} to @returns {number|null} Explicit dimensional conversion only. */
export function convertRiverUnits(value, from, to) {
  if (!Number.isFinite(value) || !from || !to) return null;
  if (from === to) return value;
  const groups = [{ ft:0.3048, m:1 }, { cfs:1, kcfs:1000, cms:35.3146667 }];
  for (const group of groups) if (group[from] && group[to]) return value * group[from] / group[to];
  return null;
}
/** @param {object} raw @param {boolean} observed @param {number} now @returns {object} */
function series(raw, observed, now) {
  if (!raw || !Array.isArray(raw.data)) throw new Error('NWPS hydrograph schema is incomplete.');
  const points = new Map();
  let excluded = 0;
  for (const row of raw.data) {
    const time = riverTime(row?.validTime), value = riverNumber(row?.primary);
    if (time === null || value === null || (observed && time > now + 5*60_000)) { excluded++; continue; }
    const point = { time, value, secondary:riverNumber(row.secondary), generated:riverTime(row.generatedTime) };
    const prior = points.get(time);
    if (prior && (prior.value !== value || prior.secondary !== point.secondary)) throw new Error('Conflicting NWPS values for one valid time.');
    points.set(time, point);
  }
  if (points.size && (!raw.primaryName || !raw.primaryUnits)) throw new Error('NWPS series has values without a name or units.');
  return { name:raw.primaryName || '', units:raw.primaryUnits || '', secondaryName:raw.secondaryName || '', secondaryUnits:raw.secondaryUnits || '',
    issued:riverTime(raw.issuedTime), points:[...points.values()].sort((a,b)=>a.time-b.time), excluded, pedts:raw.pedts || '' };
}
/** @param {object} metadata @param {object} hydrograph @param {object} station @param {number} now @returns {object} */
export function normalizeGauge(metadata, hydrograph, station, now = Date.now()) {
  if (metadata?.lid?.toUpperCase() !== station.id || typeof metadata.name !== 'string') throw new Error('NWPS gauge identity does not match the watchlist.');
  const longitude = riverNumber(metadata.longitude), latitude = riverNumber(metadata.latitude);
  if (longitude === null || latitude === null || longitude < -125 || longitude > -114 || latitude < 32 || latitude > 43) throw new Error('NWPS gauge location is outside the configured California scope.');
  const observed = series(hydrograph.observed, true, now), forecast = series(hydrograph.forecast, false, now);
  const datum = metadata.datums?.vertical?.value ?? [];
  return { id:station.id, name:metadata.name, longitude, latitude, county:metadata.county || station.county, basin:station.basin, note:station.note,
    observed, forecast, categories:metadata.flood?.categories || {}, stageUnits:metadata.flood?.stageUnits || '', flowUnits:metadata.flood?.flowUnits || '',
    observedStatus:metadata.status?.observed?.floodCategory || '', forecastStatus:metadata.status?.forecast?.floodCategory || '',
    inService:metadata.inService?.enabled !== false, serviceMessage:metadata.inService?.message || '',
    datum:datum.map(d=>`${d.abbrev || d.label || 'Unspecified'}${riverNumber(d.value) !== null ? `; publisher reference value ${d.value} (confirm units before elevation analysis)` : ''}`).join(' / ') || 'Not supplied',
    forecastNote:metadata.forecastReliability || '', fetched:now,
    sourceUrl:`https://water.noaa.gov/gauges/${station.id.toLowerCase()}` };
}
/** @param {object} gauge @param {string} name @param {string} units @returns {object[]} */
function thresholdsFor(gauge, name, units) {
  const field = name.toLowerCase() === 'stage' ? 'stage' : name.toLowerCase() === 'flow' ? 'flow' : null;
  if (!field) return [];
  const sourceUnits = field === 'stage' ? gauge.stageUnits : gauge.flowUnits;
  const result = LEVELS.map(level=>({level,units,value:convertRiverUnits(riverNumber(gauge.categories[level]?.[field]), sourceUnits, units)})).filter(x=>x.value !== null);
  // Contradictory categories are unknown, never silently reordered or repaired.
  return result.some((x,i)=>i && x.value < result[i-1].value) ? [] : result;
}
/** @param {object|null} gauge @param {object} config @param {number} hours @param {number} now @param {string|null} error @returns {object} */
export function assessGauge(gauge, config, hours = 72, now = Date.now(), error = null) {
  if (!gauge) return { tone:'gap', rank:0, label:'Data unavailable', gaps:['No successful station query'], observed:null, peak:null, thresholds:[], crossings:[], error, current:false, forecastUsable:false, thresholdKnown:false };
  const observed = gauge.observed.points.filter(p=>p.time<=now).at(-1) ?? null;
  const obsAge = observed ? now-observed.time : Infinity;
  const queryOld = now-gauge.fetched > config.staleMs;
  const current = !!observed && obsAge <= config.observationMaxAgeMs && !error && !queryOld && gauge.inService && gauge.observedStatus !== 'obs_not_current';
  const issueAge = gauge.forecast.issued === null ? Infinity : now-gauge.forecast.issued;
  const future = gauge.forecast.points.filter(p=>p.time>=now && p.time<=now+hours*HOUR);
  const forecastUsable = future.length>0 && issueAge>=-5*60_000 && issueAge<=config.forecastMaxAgeMs && !error && !queryOld && gauge.inService && gauge.forecastStatus !== 'fcst_not_current';
  const maximum = future.length ? Math.max(...future.map(p=>p.value)) : null;
  const peaks = future.filter(p=>p.value===maximum);
  const peak = peaks.length ? { ...peaks[0], lastTime:peaks.at(-1).time } : null;
  const forecastThresholds = thresholdsFor(gauge,gauge.forecast.name,gauge.forecast.units);
  const observedThresholds = thresholdsFor(gauge,gauge.observed.name,gauge.observed.units);
  const thresholds = forecastThresholds.length ? forecastThresholds : observedThresholds;
  const crossings = forecastUsable ? forecastThresholds.flatMap(t=>{
    const index = future.findIndex(p=>p.value>=t.value);
    return index<0 ? [] : [{...t,time:future[index].time,firstSample:index===0,priorTime:index>0?future[index-1].time:null}];
  }) : [];
  const exceeded = current ? observedThresholds.filter(t=>observed.value>=t.value) : [];
  let delta = null;
  if (current && forecastUsable && gauge.observed.name===gauge.forecast.name) {
    const comparable = convertRiverUnits(observed.value,gauge.observed.units,gauge.forecast.units);
    if (comparable !== null) delta = peak.value-comparable;
  }
  const prior = observed ? gauge.observed.points.filter(p=>p.time<=observed.time-2.5*HOUR && p.time>=observed.time-4*HOUR).at(-1) : null;
  const trend = current && prior ? { delta:observed.value-prior.value, hours:(observed.time-prior.time)/HOUR, start:prior.time } : null;
  const gaps=[];
  if (error) gaps.push('Station query failed; last result may be outdated');
  if (queryOld) gaps.push('Station check overdue');
  if (!gauge.inService) gaps.push('Publisher marks station out of service');
  if (!observed) gaps.push('No observed value');
  else if (!current) gaps.push('Observation is old or not current');
  if (!future.length) gaps.push('No future forecast in this window');
  else if (!forecastUsable) gaps.push('Forecast is old, unissued or not current');
  if (!thresholds.length) gaps.push('NWS thresholds unknown');
  // A small positive difference is reported, never elevated to a county action threshold.
  const higher = delta !== null && Math.round(delta*100)>0;
  const tone = crossings.length || exceeded.length ? 'threshold' : !current ? 'gap' : higher ? 'change' : 'monitor';
  const label = crossings.length ? `Forecast ${crossings.at(-1).level} threshold` : exceeded.length ? `Observed ${exceeded.at(-1).level} threshold` : !current ? 'Observation gap' : higher ? 'Forecast higher' : 'Monitor source';
  return { tone, rank:tone==='threshold'?4:tone==='gap'?3:tone==='change'?2:1, label, observed, current, obsAge, forecastUsable, issueAge,
    future, peak, delta, trend, thresholds, crossings, exceeded, gaps, error, thresholdKnown:thresholds.length>0,
    forecastEnd:gauge.forecast.points.at(-1)?.time ?? null, partialWindow:!!future.length && gauge.forecast.points.at(-1).time<now+hours*HOUR };
}
/** @param {number|null|undefined} value @param {string} units @returns {string} */
export function riverValue(value, units = '') { return value===null || value===undefined ? 'Unknown' : `${new Intl.NumberFormat('en-US',{maximumFractionDigits:units==='kcfs'?3:2}).format(value)} ${units}`.trim(); }
