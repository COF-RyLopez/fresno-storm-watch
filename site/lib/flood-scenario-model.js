/** Pure helpers for the flood-scenario animation: fractional hours between model frames (frame times may be uneven). */

/** @param {number} t hours @param {number[]} hours ascending frame times @returns {{i0:number,i1:number,w:number}} */
export function blend(t, hours) {
  const last = hours.length - 1;
  const c = Math.min(Math.max(Number(t) || 0, hours[0]), hours[last]);
  let i0 = 0;
  while (i0 < last && hours[i0 + 1] <= c) i0 += 1;
  const i1 = Math.min(i0 + 1, last);
  return { i0, i1, w: i1 === i0 ? 0 : (c - hours[i0]) / (hours[i1] - hours[i0]) };
}

/**
 * Depth at the building (ft above ground). Two models:
 * - samples: linear between per-frame samples d0..dN (N = frame index), from a model's time series;
 * - ramp (published maps with arrival and peak times only): dry before arrival_hr, 1 ft (or the maximum if
 *   shallower) at arrival, linear to depth_max at peak_hr, then held. Recession is not published, so it is not shown.
 */
export function depthAt(props, t, hours) {
  if (props.d0 === undefined) return rampDepth(props.arrive_hr, props.peak_hr, props.depth_max, t);
  const { i0, i1, w } = blend(t, hours);
  return (props[`d${i0}`] ?? 0) * (1 - w) + (props[`d${i1}`] ?? 0) * w;
}

export function rampDepth(arrive, peak, max, t) {
  if (arrive == null || !(max > 0) || t < arrive) return 0;
  const first = Math.min(1, max);
  if (t >= peak || peak <= arrive) return max;
  return first + ((max - first) * (t - arrive)) / (peak - arrive);
}

/** Columnar {fields, rows} -> one object per building. */
export function rowsToObjects({ fields, rows }) {
  return rows.map(r => Object.fromEntries(fields.map((f, i) => [f, r[i]])));
}

/** @param {object[]} buildings feature properties @returns {{wet:number,inside:number,people:number,loss:number}} */
export function summarize(buildings, t, hours) {
  const out = { wet: 0, inside: 0, people: 0, loss: 0 };
  for (const p of buildings) {
    const d = depthAt(p, t, hours);
    if (!(d > 0)) continue;
    out.wet += 1;
    out.people += p.pop_night || 0;
    if (d > (p.found_ht || 0)) out.inside += 1;
    if (p.peak_hr >= 0 && t >= p.peak_hr) out.loss += p.loss_usd || 0; // ponytail: loss counted once the building has peaked
  }
  return out;
}

/** "T+7 h 30 min" for the scenario clock. */
export function clockLabel(t) {
  const m = Math.round(t * 60);
  return `T+${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
}
