/** Hanford's public briefing is context, separate from CAP alerts and county decisions. */
export const HNX_BRIEFING_PAGE='https://www.weather.gov/hnx/briefing';
export const HNX_BRIEFING_PDF='https://www.weather.gov/media/hnx/smokeImages/partneremail.pdf';
export const BRIEFING_CHECK_MAX_AGE=45*60_000;
export const BRIEFING_REVIEW_AGE=36*60*60_000;
/** @param {string} text @returns {number} Parse the explicit publisher PST/PDT offset, never the browser's local zone. */
export function parseBriefingDate(text){
  const m=/^(?:Sun|Mon|Tue|Wed|Thu|Fri|Sat) ([A-Z][a-z]{2}) (\d{1,2}) (\d{2}):(\d{2}):(\d{2}) (PST|PDT) (\d{4})$/.exec(text.trim());
  if(!m)throw new Error('Hanford page update time is missing or unrecognized.');
  const month=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].indexOf(m[1]),day=+m[2],hour=+m[3],minute=+m[4],second=+m[5],year=+m[7];
  const local=Date.UTC(year,month,day,hour,minute,second),d=new Date(local);
  if(month<0||year<2020||hour>23||minute>59||second>59||d.getUTCMonth()!==month||d.getUTCDate()!==day)throw new Error('Hanford page update time is invalid.');
  return local+(m[6]==='PDT'?7:8)*3600_000;
}
/** @param {object} value @returns {object} Accept only the configured public publisher and bounded file identity. */
export function validateBriefingSnapshot(value){
  if(value?.schemaVersion!==1||value.sourcePage!==HNX_BRIEFING_PAGE||value.sourcePdf!==HNX_BRIEFING_PDF||!Number.isFinite(Date.parse(value.checkedAt)))throw new Error('Invalid Hanford briefing source metadata.');
  if(value.document){const d=value.document;if(!/^[a-f0-9]{64}$/.test(d.sha256)||!Number.isInteger(d.bytes)||d.bytes<100||d.bytes>15_000_000||!Number.isFinite(Date.parse(d.sourceUpdatedAt))||!Number.isFinite(Date.parse(d.collectedAt))||typeof d.sourceDateLabel!=='string'||d.sourceDateLabel.length>100)throw new Error('Invalid Hanford briefing document identity.');}
  if(value.document?.previews){const d=value.document;if(!Array.isArray(d.previews)||d.previews.length>40||d.previews.some((p,i)=>p.path!==`./data/briefing-previews/${d.sha256}/${i+1}.webp`||(!Number.isInteger(p.width)||p.width<1199||p.width>1201)||!Number.isInteger(p.height)||p.height<100||p.height>5000))throw new Error('Invalid Hanford briefing page previews.');}
  if(value.error!==null&&(typeof value.error!=='string'||value.error.length>300))throw new Error('Invalid Hanford briefing check result.');
  if(value.lastSuccessAt!=null&&!Number.isFinite(Date.parse(value.lastSuccessAt)))throw new Error('Invalid Hanford successful check time.');
  return value;
}
/** @param {object|null} snapshot @param {number} now @returns {object} A fresh download never makes an old briefing current. */
export function briefingState(snapshot,now=Date.now()){
  if(!snapshot?.document)return {tone:'gap',label:'Briefing unavailable',reason:snapshot?.error||'No verified public briefing has been collected.',usable:false};
  const d=snapshot.document,checked=Date.parse(snapshot.checkedAt),collected=Date.parse(d.collectedAt),success=Date.parse(snapshot.lastSuccessAt||d.collectedAt),issued=Math.min(Date.parse(d.sourceUpdatedAt),Number.isFinite(Date.parse(d.fileModifiedAt))?Date.parse(d.fileModifiedAt):Infinity);
  if(snapshot.error||checked>now+120_000||success>now+120_000||collected>now+120_000||issued>now+120_000||now-success>BRIEFING_CHECK_MAX_AGE)return {tone:'gap',label:'Retained briefing · verify source',reason:snapshot.error||'Public-source collection is overdue or its timestamp needs verification.',usable:true};
  if(now-issued>BRIEFING_REVIEW_AGE)return {tone:'gap',label:'Older briefing · verify with NWS',reason:'The source page or PDF file update is over 36 hours old. Briefings are event-driven; this is an app review cue, not an NWS expiration or an all-clear.',usable:true};
  return {tone:'current',label:'Public briefing available',reason:'Prepared for impactful weather; the source page says updates are normally published by 6 a.m. Check its stated forecast periods.',usable:true};
}
