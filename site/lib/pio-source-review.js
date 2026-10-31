import {canonical,digest,reviewState} from './eoc-model.js?v=0.74.0-helpers';
import {pioZoneNotices} from './pio-model.js?v=0.74.0-helpers';
import {CARE_SOURCES} from './care-model.js?v=0.56.0-r1';

export const PIO_SOURCE_CHECK_MS=300000;
const labels={languages:'Language / PUMA',svi:'SVI',ces:'CalEnviroScreen / SB 535',ccl:'CDSS licensing'};
const sourceKeys={languages:['puma','b16001'],svi:['svi'],ces:['ces','sb535'],ccl:['ccl']};
const version=s=>s?{url:s.url,period:s.period,collected:s.collected,edited:s.edited}:null;

/** Query dates never establish a revision. Record/approval objects are read only. */
export async function pioSourceReviews(states,{current={},checked=null,error=null}={}){
  const active=states.filter(s=>s.active),zones=Object.fromEntries(Object.entries(current).map(([id,c])=>[id,c.zone]));
  const notices=pioZoneNotices(active,zones,{checked,error});
  if(error)return notices;
  const failures=new Map();
  for(const s of active){
    const r=s.record,o=r.payload.pioOutreach,c=current[r.entity],saved=o.afnEvidence,reasons=[],changes={};
    if(!saved){reasons.push('AFN / language evidence has not been captured for this outreach version');changes.missing=true;}
    else if(c?.zone){
      if(saved.zone.revision!==c.zone.revision){reasons.push('Saved AFN evidence uses a different county zone revision');changes.zone=c.zone.revision;}
      for(const key of Object.keys(labels)){
        const before=saved.topics.find(t=>t.key===key),after=c.afn?.topics.find(t=>t.key===key);
        if(c.afnError||!after||after.error){
          if(!failures.has(key))failures.set(key,{key,source: saved.sources[sourceKeys[key][0]]?.url});
          continue;
        }
        const valuesChanged=!before||before.error||canonical(before.rows)!==canonical(after.rows);
        // An edit stamp may describe the entire publisher layer, not this zone.
        const changedSources=sourceKeys[key].filter(id=>{
          const a=saved.sources[id],b=c.afn.sources[id];
          return a?.url!==b?.url||a?.period!==b?.period||a?.collected!==b?.collected||a?.edited&&b?.edited&&a.edited!==b.edited;
        });
        if(valuesChanged||changedSources.length){
          reasons.push(valuesChanged?`${labels[key]} returned context differs from the saved evidence`:`${labels[key]} publisher source revision differs; zone values may be unchanged`);
          changes[key]={contentRevision:valuesChanged?await digest(after.rows):null,sources:Object.fromEntries(changedSources.map(id=>[id,version(c.afn.sources[id])]))};
        }
      }
    }
    if(reasons.length)notices.push({key:'pio-afn:'+r.entity,revision:r.id+':'+await digest(changes),category:'Planning review cues',location:'PIO · '+r.payload.location,
      change:reasons.join('; '),sourceTime:checked,verification:'Applicability review needed · approved message unchanged',owner:r.payload.owner,
      nextReview:'Inspect current zone and AFN context. Update evidence in a new outreach version only after review; retain documented message approval history.',
      evidence:{outreachEvent:r.id,zoneKey:o.zone.key,source:CARE_SOURCES.zones,issueTime:null,reasons,changes}});
  }
  for(const f of failures.values())notices.push({key:'pio:afn-source:'+f.key,revision:'unavailable',category:'Data failures',location:'PIO · '+labels[f.key]+' source',
    change:labels[f.key]+' source could not be compared; current applicability is unknown',sourceTime:checked,verification:'Unverified',owner:'County PIO / GIS',
    nextReview:'Retry the source check. Retained evidence and approved messages have not changed.',evidence:{topic:f.key,source:f.source,issueTime:null}});
  return notices;
}

/** One affected outreach is one review, even when zone and AFN both changed. */
export function pioReviewCount(notices){return new Set(notices.filter(n=>n.evidence?.outreachEvent).map(n=>n.evidence.outreachEvent)).size;}

/** Team acknowledgement clears that revision's review need, never a failed feed. */
export function pendingPioSourceReviews(notices,reviews,team){return notices.filter(n=>n.category==='Data failures'||reviewState(n,reviews,team)!=='Acknowledged');}
