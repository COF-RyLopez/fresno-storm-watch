/** Shared schedule presentation for reservoir cards and river-area evidence. */
import {elClass as el} from './dom.js';
const amount=value=>new Intl.NumberFormat('en-US',{maximumFractionDigits:0}).format(value);

/** @param {object} notice @param {Function} time @returns {string} Show effective time, not an invented issuance or arrival time. */
export function noticeSummary(notice,time){
  return `${notice.station} · ${notice.direction.toLowerCase()} to ${amount(notice.value)} cfs${notice.delta===null?' · previous schedule unknown':` (${notice.delta>0?'+':''}${amount(notice.delta)} cfs)`} · ${notice.phase==='upcoming'?'effective':'effective time passed'} ${time(notice.time)}`;
}

/** @param {HTMLElement} host @param {object} evidence @param {Function} time @returns {void} Retained or flagged notices never appear as current schedule evidence. */
export function appendScheduledReleases(host,evidence,time){
  const section=el('section','','scheduled-releases');
  section.append(el('h5',`Scheduled release notices · ${evidence.station}`));
  const status=el('p',!evidence.current?evidence.reason:evidence.pending.length?'Some notices need verification':evidence.upcoming.length?`${evidence.upcoming.length} upcoming notice${evidence.upcoming.length===1?'':'s'}`:`No upcoming notices returned through ${time(evidence.windowEnd)}`,'environment-health');
  status.dataset.tone=!evidence.current||evidence.pending.length?'gap':'normal';section.append(status);
  if(evidence.last){const n=evidence.last;section.append(el('p',`Last past schedule: ${n.valid?amount(n.value)+' cfs':'value unverified'} · effective ${time(n.time)}. This is not a measured release.`,'environment-note'));}
  for(const [title,rows] of [['Upcoming · next 7 days',evidence.upcoming],['Effective within the last 24 hours · verify actual release',evidence.recent]]){
    if(!rows.length)continue;
    section.append(el('strong',title));const list=el('ul','','scheduled-release-list');
    for(const n of rows){const li=el('li');li.append(el('p',n.valid?noticeSummary(n,time):`${n.station} · effective ${time(n.time)} · missing, flagged or conflicting scheduled value`,n.valid?'':'watch-gap'));
      if(!evidence.current)li.append(el('small','Retained notice · excluded from current review cues','watch-gap'));
      list.append(li);
    }section.append(list);
  }
  section.append(el('p',`Schedule last collected ${time(evidence.collected)}. Notice issuance time is not supplied. Unscheduled changes can occur; confirm with the operator. Effective time is at the reservoir, not downstream arrival.`,'environment-note'));
  const source=el('a','Official CDEC release notices');source.href=evidence.source;source.target='_blank';source.rel='noopener noreferrer';section.append(source);host.append(section);
}
