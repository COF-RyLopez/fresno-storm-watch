import {AFN_SOURCES,AFN_LIMIT,CCL_LIMIT,B16001,validateLanguageAreas,summarizeFacilities,formatPercentile} from './afn-model.js?v=0.69.0';
import {formatAcsMeasure} from './acs-model.js?v=0.65.0-r1';
import {CARE_SOURCES} from './care-model.js?v=0.74.0-helpers';

export const AFN_TOPIC_KEYS=['languages','svi','ces','ccl'];
export const AFN_EVIDENCE_MAX=24000;
const languageSource='https://www2.census.gov/programs-surveys/acs/summary_file/2024/table-based-SF/data/5YRData/acsdt5y2024-b16001.dat';
const references={
  puma:{title:'Census PUMA analysis boundaries',url:AFN_SOURCES.puma.url,item:null,period:'2020 Census boundaries / ACS2024 service',geography:'Whole 2020 Census PUMA'},
  b16001:{title:'Census ACS B16001',url:languageSource,item:null,period:'2020–2024',geography:'Whole Census PUMA · people age 5+'},
  svi:{title:'CDC/ATSDR SVI 2022',url:AFN_SOURCES.svi.url,item:AFN_SOURCES.svi.item,period:'SVI 2022 · ACS 2018–2022',geography:'Whole 2020 Census tract · national percentile'},
  ces:{title:'CalEnviroScreen 4.0',url:AFN_SOURCES.ces.url,item:AFN_SOURCES.ces.item,period:'CalEnviroScreen 4.0 · indicator periods vary',geography:'Whole 2010 Census tract · statewide percentile'},
  sb535:{title:'SB 535 disadvantaged designation',url:AFN_SOURCES.sb535.url,item:AFN_SOURCES.sb535.item,period:'2022 designation · published update service 2023/2024',geography:'2010 Census tracts; no join to 2020 tract IDs'},
  ccl:{title:'CDSS adult and senior licensing reference',url:AFN_SOURCES.ccl.url,item:AFN_SOURCES.ccl.item,period:'Publisher licensing reference; individual effective times unavailable',geography:'Facility points intersecting the zone'}
};
const limits={wholeArea:AFN_LIMIT,facilities:CCL_LIMIT,language:'Language estimates describe people age 5+ in entire PUMAs, not speakers inside this evacuation zone or confirmed preferred languages. B16001 English proficiency is less than very well; the SVI limited-English field uses the publisher’s less-than-well definition. Do not combine them.',freshness:'Capture and query times are not population observations, license-effective times or evacuation-order issue times. Publisher publication/issue times are not supplied. Missing values remain unknown.'};
const stamp=v=>v===undefined||v===0?null:v;
const date=v=>v===null||Number.isFinite(v)&&v>0&&v<=Date.now()+300000;
const count=v=>v===null||Number.isFinite(v)&&v>=0;
const rank=v=>v===null||Number.isFinite(v)&&v>=0&&v<=1;
const text=(v,max)=>typeof v==='string'&&v.trim().length>0&&v.length<=max;
const measure=m=>!!m&&count(m.estimate)&&count(m.moe);
const copyMeasure=m=>({estimate:m.estimate,moe:m.moe});
const isoDay=v=>v===null||typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
const unique=(rows,key)=>new Set(rows.map(r=>r[key])).size===rows.length;

/** Explicit public-field whitelist. No geometry, private form fields or full query responses. */
export function freezeAfnEvidence({zone,topics,exercise=false,captured=Date.now()}){
  const byKey=new Map(topics.map(t=>[t.key,t]));
  if(topics.length!==4||byKey.size!==4||AFN_TOPIC_KEYS.some(key=>!byKey.has(key)))throw Error('AFN capture needs all four topic outcomes.');
  const language=byKey.get('languages'),ces=byKey.get('ces');
  if(!language.error&&(language.period!=='2020–2024'||language.source!==languageSource))throw Error('AFN language period/source changed; update its documented snapshot contract.');
  const metadata={puma:language,b16001:{checked:language.error?null:language.referenceChecked,collected:language.error?null:language.collected},svi:byKey.get('svi'),ces,sb535:{checked:ces.error?null:ces.designationChecked,edited:ces.error?null:ces.designationEdited},ccl:byKey.get('ccl')};
  const sources=Object.fromEntries(Object.entries(references).map(([key,ref])=>{const t=metadata[key];return [key,{...ref,checked:t.error?null:stamp(t.checked),edited:t.error?null:stamp(t.edited),collected:key==='b16001'?t.collected??null:null}];}));
  const selected=Object.fromEntries(['source','key','oid','name','status','checked','revision'].map(key=>[key,zone[key]]));
  const saved=AFN_TOPIC_KEYS.map(key=>{const t=byKey.get(key);if(t.error)return {key,error:String(t.error).slice(0,500),rows:null};
    const rows=t.rows.map(r=>key==='languages'?{id:r.id,name:r.name,...Object.fromEntries(Object.keys(B16001).map(k=>[k,copyMeasure(r[k])]))}:key==='svi'?{id:r.id,overall:r.overall,household:r.household,limitedEnglish:copyMeasure(r.limitedEnglish)}:key==='ces'?{id:r.id,overall:r.overall,linguistic:r.linguistic,dac:r.dac}:{key:r.key,number:r.number,name:r.name,type:r.type,status:r.status,capacity:r.capacity,city:r.city});
    rows.sort((a,b)=>(a.id||a.key).localeCompare(b.id||b.key));return {key,error:null,rows};
  });
  const snapshot={schema:1,methodVersion:'frog-zone-afn/1',exercise,captured,zone:selected,sources,limits:{...limits},topics:saved};
  validateAfnEvidence(snapshot,zone);return structuredClone(snapshot);
}

/** Saved versions validate without fetching, rejoining geographies or recalculating live values. */
export function validateAfnEvidence(s,zone){
  if(s?.schema!==1||s.methodVersion!=='frog-zone-afn/1'||typeof s.exercise!=='boolean'||!date(s.captured)||s.captured===null)throw Error('AFN evidence version or capture time is invalid.');
  const z=s.zone;
  if(z?.source!==CARE_SOURCES.zones||z.key!==zone.key||z.oid!==zone.oid||z.name!==zone.name||!Number.isSafeInteger(z.oid)||z.key!==`county-zone:${z.oid}`||!text(z.name,160)||!['Order','Warn','Lifted','unknown'].includes(z.status)||!date(z.checked)||z.checked===null||!/^[a-f0-9]{64}$/.test(z.revision||''))throw Error('AFN evidence must retain the same county zone.');
  for(const [key,ref]of Object.entries(references)){
    const source=s.sources?.[key];if(!source||Object.keys(ref).some(field=>source[field]!==ref[field])||!date(source.checked)||!date(source.edited)||!isoDay(source.collected))throw Error('AFN source reference, period or date is invalid.');
  }
  if(Object.keys(limits).some(key=>!text(s.limits?.[key],2000)))throw Error('AFN evidence needs saved whole-area and source limitations.');
  if(!Array.isArray(s.topics)||s.topics.length!==4||!unique(s.topics,'key')||AFN_TOPIC_KEYS.some(key=>!s.topics.some(t=>t.key===key)))throw Error('AFN topic outcomes are incomplete.');
  for(const t of s.topics){
    if(t.error!==null){if(!text(t.error,500)||t.rows!==null)throw Error('Unavailable AFN topics must retain their failure and unknown rows.');continue;}
    const cap=t.key==='languages'?20:AFN_SOURCES[t.key].limit;
    if(!Array.isArray(t.rows)||t.rows.length>cap||!unique(t.rows,t.key==='ccl'?'key':'id'))throw Error('AFN records are incomplete, duplicated or exceed the bounded capture.');
    const sourceKeys=t.key==='languages'?['puma','b16001']:t.key==='ces'?['ces','sb535']:[t.key];
    if(sourceKeys.some(key=>s.sources[key].checked===null))throw Error('Available AFN evidence needs source query times.');
    if(t.key==='languages'){
      if(t.rows.length)validateLanguageAreas({schemaVersion:1,table:'B16001',period:s.sources.b16001.period,rows:t.rows.map(r=>({...r,puma:r.id}))});
      if(t.rows.some(r=>!text(r.name,200)||[r.hmong,r.punjabi].some((m,i)=>!measure(m)||!measure(i?r.punjabiLep:r.hmongLep)||(i?r.punjabiLep:r.hmongLep).estimate!==null&&m.estimate!==null&&(i?r.punjabiLep:r.hmongLep).estimate>m.estimate)))throw Error('AFN language values or names are invalid.');
    }else if(t.key==='svi'||t.key==='ces'){
      for(const r of t.rows)if(!/^06019\d{6}$/.test(r.id)||!rank(r.overall)||(t.key==='svi'?!rank(r.household)||!measure(r.limitedEnglish):!rank(r.linguistic)||r.dac!==null&&!text(r.dac,200)))throw Error('AFN tract, percentile or margin of error is invalid.');
    }else for(const r of t.rows)if(!/^ccl:\d+$/.test(r.key)||typeof r.number!=='string'||r.number.length>30||!text(r.name,240)||!text(r.type,100)||typeof r.city!=='string'||r.city.length>100||r.status!==null&&!Number.isInteger(r.status)||r.capacity!==null&&(!Number.isInteger(r.capacity)||r.capacity<0))throw Error('AFN facility licensing evidence is invalid.');
  }
  if(JSON.stringify(s).length>AFN_EVIDENCE_MAX)throw Error('AFN evidence exceeds the private record size budget. No evidence was truncated.');
  return s;
}

export function afnEvidenceSummary(s){
  if(!s)return 'AFN / language evidence not captured for this version; no zone language or support-needs count is inferred.';
  const n=key=>{const t=s.topics.find(t=>t.key===key);return t.error?'unavailable':t.rows.length;};
  const pumas=n('languages');
  return `${s.exercise?'EXERCISE illustrative · ':''}Saved whole-area context · ${pumas} whole PUMA${pumas===1?'':'s'} · ${n('svi')} SVI tracts · ${n('ces')} CalEnviroScreen tracts · ${n('ccl')} CDSS records. Not zone population or confirmed needs.`;
}

/** Printable handoffs consume frozen values only; no live source is consulted. */
export function afnEvidenceLines(s,zone,time){
  if(!s)return [afnEvidenceSummary(null)];
  const lines=[afnEvidenceSummary(s),`AFN / language evidence captured ${time(s.captured)} · ${s.methodVersion} · county zone ${s.zone.name} / ${s.zone.key} · queried ${time(s.zone.checked)} · revision ${s.zone.revision}`,
    ...(s.zone.revision!==zone.revision?['REVIEW: AFN evidence uses an older county zone revision; verify applicability before using it with the current boundary/status.']:[]),...Object.values(s.limits)];
  for(const source of Object.values(s.sources))lines.push(`${source.title} · ${source.period} · ${source.geography} · queried ${time(source.checked)} · publisher layer edited ${time(source.edited)}${source.collected?' · public reference collected '+source.collected+' (UTC date)':''}`,source.item||source.url,...(source.item?[source.url]:[]));
  for(const t of s.topics){
    if(t.error){lines.push(`UNAVAILABLE ${t.key}: ${t.error}. No zero count is inferred.`);continue;}
    if(!t.rows.length){lines.push(`${t.key}: no intersecting records returned by this query; not confirmation of no needs.`);continue;}
    for(const r of t.rows){
      if(t.key==='languages')lines.push(`Whole PUMA ${r.id} · ${r.name}: age 5+ ${formatAcsMeasure(r.age5)}; Hmong ${formatAcsMeasure(r.hmong)} / English less than very well ${formatAcsMeasure(r.hmongLep)}; Punjabi ${formatAcsMeasure(r.punjabi)} / English less than very well ${formatAcsMeasure(r.punjabiLep)}. All ± values are 90% MOEs for the whole PUMA, not this zone.`);
      if(t.key==='svi')lines.push(`Whole 2020 tract ${r.id}: SVI overall ${formatPercentile(r.overall)}; household characteristics ${formatPercentile(r.household)}; limited-English persons ${formatAcsMeasure(r.limitedEnglish)} (90% MOE; ACS 2018–2022). Not zone counts.`);
      if(t.key==='ces')lines.push(`Whole 2010 tract ${r.id}: CalEnviroScreen ${formatPercentile(r.overall)}; linguistic isolation ${formatPercentile(r.linguistic)}; SB 535 ${r.dac||'not designated in returned reference'}. Not combined with 2020 tract IDs.`);
    }
    if(t.key==='ccl')for(const g of summarizeFacilities(t.rows))lines.push(`CDSS ${g.type} · status code ${g.status??'Unknown'}: ${g.facilities} records; licensed capacity ${g.capacity??'Unknown'}. Codes are not added together; not current residents.`);
  }
  return lines;
}
