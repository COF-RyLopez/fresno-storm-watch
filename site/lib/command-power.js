/** Utility estimates are not confirmations. Preserve text when its time zone is unspecified. */
export function restorationEstimate(value, utility, now = Date.now()) {
  const text = String(value?.text || '').trim();
  const hasZone = /(?:\b(?:PST|PDT|UTC|GMT)\b|Z$|[+-]\d{2}:?\d{2}$)/i.test(text);
  const ambiguous = utility === 'SCE' && text && !hasZone;
  const time = !ambiguous && Number.isFinite(value?.time) ? value.time : null;
  return {
    key: time !== null ? `time:${time}` : `text:${text.replace(/\s+/g,' ').toLowerCase()}`,
    label: time !== null ? new Date(time).toLocaleString('en-US', {
      timeZone:'America/Los_Angeles', month:'short', day:'numeric', year:'numeric',
      hour:'numeric', minute:'2-digit', timeZoneName:'short',
    }) : text ? text + (ambiguous && /\d/.test(text) ? ' · time zone not supplied' : '') : 'Not supplied',
    passed: time !== null && time < now,
  };
}

/** Session-only comparison by stable outage ID and utility update time; never treats disappearance as restoration. */
export function createEstimateTracker() {
  const known = new Map();
  const retention = 24 * 60 * 60 * 1000;
  return {
    apply(rows, now = Date.now()) {
      for (const [id, old] of known) if (now - old.seen > retention) known.delete(id);
      const result = rows.map(row => {
        if (!row.utilityUpdate) return row;
        const previous = known.get(row.id);
        const comparable = Number.isFinite(row.time) && row.time <= now + 120000;
        if (!comparable) return row;
        if (previous && row.time < previous.row.time) {
          previous.seen = now;
          return {...previous.row, quality:`${row.quality} · newer utility update retained`};
        }
        const old = previous?.row.utilityUpdate;
        let estimateChange = old?.estimateChange;
        if (old && old.restoration.key !== row.utilityUpdate.restoration.key) {
          estimateChange = {
            type: row.time === previous.row.time ? 'conflict' : 'changed',
            previous: old.restoration.label,
            current: row.utilityUpdate.restoration.label,
            detected: now,
          };
        }
        const next = {...row, utilityUpdate:{...row.utilityUpdate, ...(estimateChange ? {estimateChange} : {})}};
        known.delete(row.id);
        known.set(row.id,{row:next,seen:now});
        return next;
      });
      while (known.size > 2000) known.delete(known.keys().next().value);
      return result;
    },
    clear() { known.clear(); },
  };
}
