/** Pure helpers for the flood-scenario animation: fractional hours between hourly model frames. */

/** @param {number} t hours @param {number} n frame count @returns {{i0:number,i1:number,w:number}} */
export function blend(t, n) {
  const c = Math.min(Math.max(Number(t) || 0, 0), n - 1);
  const i0 = Math.floor(c);
  const i1 = Math.min(i0 + 1, n - 1);
  return { i0, i1, w: c - i0 };
}

/** Depth at the building (ft above ground), linear between hourly samples d0..dN. */
export function depthAt(props, t, n) {
  const { i0, i1, w } = blend(t, n);
  return (props[`d${i0}`] ?? 0) * (1 - w) + (props[`d${i1}`] ?? 0) * w;
}

/** @param {object[]} buildings feature properties @returns {{wet:number,inside:number,people:number,loss:number}} */
export function summarize(buildings, t, n) {
  const out = { wet: 0, inside: 0, people: 0, loss: 0 };
  for (const p of buildings) {
    const d = depthAt(p, t, n);
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
