import {AFN_SOURCES,AFN_LIMIT,CCL_LIMIT,summarizePercentiles,summarizeFacilities,formatPercentile} from './afn-model.js';
import {formatAcsMeasure} from './acs-model.js';
import {readAfnContext} from './afn-data.js';
import {reportHealth} from './source-health.js';
import {node,nodeLink as link,dataTable} from './dom.js';
const number=v=>v===null?'Unknown':new Intl.NumberFormat('en-US').format(v);
// Values after the row header are end-aligned, as the native table's cells were.
const grid=(caption,head,rows)=>dataTable(caption,head,rows,{rowHeader:true,end:head.map((_,i)=>i).slice(1)});
const TITLES={languages:'Hmong & Punjabi · Census PUMA',svi:'CDC/ATSDR Social Vulnerability Index 2022',ces:'CalEnviroScreen 4.0 & SB 535 disadvantaged communities',ccl:'CDSS community care · adult & senior'};
const render={
  languages(t,s){
    s.append(node('p',`ACS ${t.period} table B16001 · people age 5+ · ${t.rows.length} PUMA${t.rows.length===1?'':'s'} intersecting this zone. Each PUMA covers about 100,000+ residents; these are area totals, not zone counts.`),
      grid('Estimate ± 90% MOE · all speakers / of them, English less than “very well”',['PUMA','Age 5+','Hmong','Punjabi'],t.rows.map(r=>[r.name,number(r.age5.estimate),`${formatAcsMeasure(r.hmong)} / ${formatAcsMeasure(r.hmongLep)}`,`${formatAcsMeasure(r.punjabi)} / ${formatAcsMeasure(r.punjabiLep)}`])),
      link('Census summary file',t.source));
  },
  svi(t,s){
    const sum=summarizePercentiles(t.rows,'overall');
    s.append(node('p',`${sum.tracts} intersecting 2020 tracts · ${sum.atLeast} at or above the 75th national percentile (CDC’s high-vulnerability convention) · highest ${formatPercentile(sum.max)}. ACS 2018–2022 inputs; not combined with the 2020–2024 counts above.`));
    if(t.rows.length){const more=node('details');more.append(node('summary','Tracts'),grid('National percentile; limited-English persons ± 90% MOE',['Tract','Overall','Household characteristics','Limited English'],t.rows.map(r=>[r.id,formatPercentile(r.overall),formatPercentile(r.household),formatAcsMeasure(r.limitedEnglish)])));s.append(more);}
    s.append(link('CDC/ATSDR SVI source',AFN_SOURCES.svi.item));
  },
  ces(t,s){
    const sum=summarizePercentiles(t.rows,'overall'),dac=t.rows.filter(r=>r.dac).length;
    s.append(node('p',`${sum.tracts} intersecting 2010 tracts · ${dac} designated SB 535 disadvantaged · ${sum.atLeast} at or above the 75th statewide CalEnviroScreen percentile · highest ${formatPercentile(sum.max)}. 2010 tracts are matched to the zone by overlap, not to 2020 tract IDs.`));
    if(t.rows.length){const more=node('details');more.append(node('summary','Tracts'),grid('Statewide percentile',['2010 tract','CalEnviroScreen','Linguistic isolation','SB 535'],t.rows.map(r=>[r.id,formatPercentile(r.overall),formatPercentile(r.linguistic),r.dac||'Not designated'])));s.append(more);}
    s.append(link('CalEnviroScreen 4.0 source',AFN_SOURCES.ces.item),node('br'),link('SB 535 designation source',AFN_SOURCES.sb535.item));
  },
  ccl(t,s){
    if(!t.rows.length){s.append(node('p','No CDSS adult or senior care records intersect this zone. This is not confirmation that no one receiving care lives here.'));}
    else{
      s.append(grid('Records and licensed capacity by CDSS status code; codes are not added together',['Facility type','Status code','Records','Licensed capacity'],summarizeFacilities(t.rows).map(g=>[g.type,g.status===null?'Not supplied':String(g.status),String(g.facilities),number(g.capacity)])));
      const more=node('details');more.append(node('summary','Facilities'),grid('CDSS public licensing records',['Facility','Type','City','Capacity','Status code'],t.rows.map(r=>[r.name,r.type,r.city||'Not supplied',number(r.capacity),r.status===null?'Not supplied':String(r.status)])));s.append(more);
    }
    s.append(node('p',CCL_LIMIT+' Skilled nursing and other CDPH-licensed facilities are in Resident care.'),link('CDSS facility source',AFN_SOURCES.ccl.item),node('br'),link('CDSS facility search',AFN_SOURCES.cclSearch));
  }
};

/** Read-only, loaded on first open; nothing is stored or written. */
export function afnContext(zone,{isCurrent=()=>true,readContext=readAfnContext,onHealth=reportHealth}={}){
  const details=node('details'),host=node('div'),retry=node('calcite-button','Retry AFN sources');
  let loaded=false,pending=null,controller=null,disposed=false,generation=0;
  retry.scale='s';retry.appearance='outline';retry.hidden=true;
  host.setAttribute('aria-live','polite');
  details.append(node('summary','AFN & language context · whole areas'),host,retry);
  const current=value=>!disposed&&value===generation&&isCurrent();
  function refresh(){
    if(disposed||!isCurrent())return Promise.resolve();
    if(pending)return pending;
    const value=++generation;controller=new AbortController();
    retry.hidden=true;retry.disabled=true;host.setAttribute('aria-busy','true');
    host.replaceChildren(node('p','Checking public CDC, OEHHA, CDSS and Census sources…'));
    pending=(async()=>{
      try{
        const topics=await readContext(zone.geometry,{signal:controller.signal});
        if(!current(value))return;
        host.replaceChildren();loaded=!topics.some(t=>t.error);
        for(const t of topics){
          const s=node('section');s.append(node('h4',TITLES[t.key]));
          if(t.error){s.append(node('p','Unavailable: '+t.error));onHealth('population:afn:'+t.key,TITLES[t.key],{error:t.error});}
          else{render[t.key](t,s);onHealth('population:afn:'+t.key,TITLES[t.key],{checked:t.checked,maxAgeMs:Infinity,detail:'Whole-area context for the selected zone; not allocated.'});}
          host.append(s);
        }
        host.append(node('p',AFN_LIMIT));
      }catch(e){if(current(value)&&e.name!=='AbortError'){loaded=false;host.replaceChildren(node('p','AFN context unavailable: '+e.message+'. Retry AFN sources to check again.'));}}
      finally{if(value===generation){pending=null;host.setAttribute('aria-busy','false');retry.disabled=false;retry.hidden=loaded||disposed;}}
    })();
    return pending;
  }
  details.addEventListener('toggle',()=>{if(details.open&&!loaded)return refresh();});
  retry.addEventListener('click',()=>refresh());
  return {element:details,refresh,dispose(){disposed=true;generation++;controller?.abort();retry.disabled=true;}};
}
