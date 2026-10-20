/** Reviewed page associations apply only to this exact archived Hanford PDF. */
export const FOLLOW_DOCUMENT='28b42dc4cfc6c0e8890d2fe9e3c0466aec01fe469f00404eb4d35f46c3b8d5b4';
const mappings=Object.freeze({
  3:{ids:['ero-day-1','ero-day-2','ero-day-3'],start:'2026-10-21T12:00:00Z',end:'2026-10-22T12:00:00Z',match:'exact',note:'WPC excessive rainfall · same valid period; latest issue may differ from this archived slide.'},
  4:{ids:['rain-day-1','rain-day-2','rain-day-3'],start:'2026-10-21T12:00:00Z',end:'2026-10-22T12:00:00Z',match:'overlap',note:'Related WPC rainfall amount, not Hanford’s precipitation range. The live window can differ from the slide; compare both dates.'},
  5:{ids:['rain-day-1','rain-day-2','rain-day-3'],start:'2026-10-22T12:00:00Z',end:'2026-10-23T12:00:00Z',match:'overlap',note:'Related WPC rainfall amount, not Hanford’s precipitation range. The live window can differ from the slide; compare both dates.'},
  6:{ids:['prob-0p25-1','prob-0p25-2','prob-0p25-3'],start:'2026-10-21T00:00:00Z',end:'2026-10-22T00:00:00Z',match:'exact',note:'Quarter-inch probability · same threshold and valid period. Latest WPC issue and palette can differ from the archived Hanford graphic.'},
  7:{ids:['prob-0p50-1','prob-0p50-2','prob-0p50-3'],start:'2026-10-22T00:00:00Z',end:'2026-10-23T00:00:00Z',match:'exact',note:'Half-inch probability · same threshold and valid period. Latest WPC issue and palette can differ from the archived Hanford graphic.'},
  14:{ids:['winter'],start:'2026-10-19T12:00:00Z',end:'2026-10-22T12:00:00Z',match:'overlap',note:'Latest WSSI winter impacts. Its overall forecast window can differ from the archived slide.'}
});
/** A page number alone cannot authorize a source association after a PDF revision. */
export function slideMapping({sha256,page,verified}={}){
  if(!verified)return {mapping:null,reason:'Document verification pending or failed · automatic live layer withheld.'};
  if(sha256!==FOLLOW_DOCUMENT)return {mapping:null,reason:'No reviewed slide-to-layer associations for this document revision.'};
  const m=mappings[page];
  return m?{mapping:{...m,page,start:Date.parse(m.start),end:Date.parse(m.end)},reason:null}:{mapping:null,reason:`Slide ${page} has no verified matching live layer. Context map only; the previous forecast overlay is cleared.`};
}
/** Prefer matching dates, never reuse a day/period index after the source cycle rolls. */
export function chooseSlideLayer(mapping,cycles){
  const matches=cycles.filter(c=>mapping.ids.includes(c.id)&&Number.isFinite(c.start)&&Number.isFinite(c.end)&&c.end>c.start).map(c=>({...c,overlap:Math.max(0,Math.min(c.end,mapping.end)-Math.max(c.start,mapping.start))})).filter(c=>mapping.match==='exact'?c.start===mapping.start&&c.end===mapping.end:c.overlap>0);
  matches.sort((a,b)=>b.overlap-a.overlap||Math.abs(a.start-mapping.start)-Math.abs(b.start-mapping.start)||a.start-b.start||a.id.localeCompare(b.id));
  if(!matches.length)throw new Error('No verified current forecast window matches this slide. The dated slide is retained; a different date is not substituted.');
  return matches[0];
}
