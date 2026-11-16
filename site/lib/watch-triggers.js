const timestamp = new Intl.DateTimeFormat('en-US', {timeZone:'America/Los_Angeles',
  month:'short', day:'numeric', hour:'numeric', minute:'2-digit', timeZoneName:'short'});
const time = value => Number.isFinite(value) ? timestamp.format(value) : 'time unavailable';
const amount = value => Number.isFinite(value) ? value.toLocaleString('en-US', {maximumFractionDigits:2}) : 'unavailable';

/** Describe the evidence that actually triggered review and retain its source locations. */
export function riverTrigger(row, reservoirs = []) {
  const lines = [], points = [], firstCharts = [];
  const metric = (item, description) => {
    lines.push(`${item.name} ${description} ${amount(item.delta)} ${item.units || ''} · observed ${time(item.sample?.time)}.`);
    const station = reservoirs.find(r => r.id === item.station);
    if (station) points.push(station);
    firstCharts.push(item.label);
  };
  const gauge = (item, description) => {
    if (item.gauge) points.push({...item.gauge, id: item.id});
    lines.push(`${item.gauge?.name || item.id} · ${description}`);
    firstCharts.push(item.gauge?.name || item.id);
  };
  if (row.status?.startsWith('Forecast differences')) {
    const comparison = row.forecastDifference;
    if (comparison?.rain?.rainSpread > 0) {
      const {point, rainSpread, values, window} = comparison.rain;
      const compared = values?.filter(v => Number.isFinite(v.rain)).map(v => `${v.source} ${amount(v.rain)} in`).join(' / ');
      lines.push(`${point.name} · forecast rain differs by ${amount(rainSpread)} in${compared ? ' · '+compared : ''} · ${time(window?.start)} to ${time(window?.end)}.`);
      points.push(point);
    }
    for (const [field, label] of [['rainTiming','Rain'],['wind','Wind']]) {
      const entry = comparison?.[field], timing = entry?.[field === 'wind' ? 'windTiming' : field];
      if (!timing?.hours) continue;
      const periods = rows => rows.map(p => time(p.start)).join(' / ');
      lines.push(`${entry.point.name} · ${label} peak windows differ by ${timing.hours} h · NWS starts ${periods(timing.nwsPeriods)} · ${timing.source} starts ${periods(timing.modelPeriods)}.`);
      points.push(entry.point);
    }
  } else if (row.threshold) {
    for (const g of row.gauges.filter(g => g.assessment.tone === 'threshold')) {
      gauge(g, 'Published NWS threshold cue. Check the gauge observation and official forecast.');
    }
  } else if (row.scheduled?.length) {
    lines.push(...row.scheduled.map(n => n.label || n.title || 'Scheduled release notice requires operator confirmation.'));
    points.push(...reservoirs.filter(r => row.releases?.some(release => release.station === r.id)));
  } else {
    for (const g of row.rising || []) gauge(g, `Observed rise ${amount(g.assessment.trend.delta)} ${g.gauge?.observed.units || ''} over ${amount(g.assessment.trend.hours)} h · ${time(g.assessment.observed?.time)}.`);
    for (const g of row.higher || []) gauge(g, `Forecast peak ${amount(g.assessment.peak?.value)} ${g.gauge?.forecast.units || ''} · ${time(g.assessment.peak?.time)}.`);
    if (row.status?.includes('rising pool')) for (const pool of row.poolRising || []) metric(pool, 'pool rose');
    else if (row.status?.includes('river change')) for (const release of (row.releases || []).filter(r => r.increasing)) metric(release, 'reported release increased');
    if (row.status?.startsWith('Rain +')) {
      const rain = row.rainfall, sample = rain.samples.find(s => s.value === rain.maximum);
      if (sample) {
        lines.push(`${sample.name} · ${amount(sample.value)} in liquid-equivalent precipitation · forecast through ${time(rain.cycle?.end)}.`);
        const point = row.samplePoints.find(p => p.id === sample.id);
        if (point) points.push(point);
        firstCharts.push('Rain forecast · 72 h');
      }
    }
  }
  if (!lines.length && row.gaps?.length) lines.push(...row.gaps);
  return {
    lines: [...new Set(lines)],
    points: [...new Map(points.filter(p => Number.isFinite(p?.longitude) && Number.isFinite(p?.latitude)).map(p => [p.id, p])).values()],
    firstCharts: [...new Set(firstCharts)],
    question: row.status?.startsWith('Forecast differences')
      ? 'Would the difference change when staff should verify roads, releases or river conditions?'
      : 'Which downstream conditions need field verification, and when should staff check them?',
  };
}
import { METERS_PER_MILE } from './nearby-search.js';
import { roadInCurrentView } from './roads.js';


/** Approximate shortest horizontal distance in a one-mile Fresno vicinity, using every line part. */
export function careRoadTriggers(point, roads, now = Date.now()) {
  const xScale = 111195 * Math.cos(point.y * Math.PI / 180), yScale = 111195;
  const offset = ([x,y]) => [(x - point.x) * xScale, (y - point.y) * yScale];
  const pointDistance = xy => Math.hypot(...offset(xy));
  const pathDistance = path => path.slice(1).reduce((best, b, i) => {
    const [x,y] = offset(path[i]), [bx,by] = offset(b), dx = bx-x, dy = by-y;
    const lengthSquared = dx*dx + dy*dy;
    const t = lengthSquared ? Math.max(0, Math.min(1, -(x*dx+y*dy)/lengthSquared)) : 0;
    return Math.min(best, Math.hypot(x+t*dx,y+t*dy));
  }, Infinity);
  return roads.flatMap(({ row, feature, bounds }) => {
    if (!roadInCurrentView(row, now) || !bounds || !feature ||
      point.x < bounds[0] - .025 || point.x > bounds[2] + .025 ||
      point.y < bounds[1] - .025 || point.y > bounds[3] + .025) return [];
    const {type, coordinates} = feature.geometry;
    const distance = type === 'Point' ? pointDistance(coordinates)
      : type === 'LineString' ? pathDistance(coordinates)
      : type === 'MultiLineString' ? Math.min(...coordinates.map(pathDistance)) : Infinity;
    return distance <= METERS_PER_MILE ? [{row, feature, miles:distance / METERS_PER_MILE}] : [];
  }).sort((a,b) => a.miles - b.miles || a.row.key.localeCompare(b.row.key));
}
