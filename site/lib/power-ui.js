import {createPowerNetwork} from './power-network-ui.js?v=0.59.0';
import {createPowerBuildings} from './power-buildings-ui.js?v=0.52.1';
import {reportHealth} from './source-health.js?v=0.59.0';
import {POWER_FEEDS,POWER_LINKS,POWER_STATES,POWER_COLORS,powerHealth,powerRowIssues,powerChanges,validatePowerSnapshot} from './power-model.js?v=0.49.0';
import {collectPower} from './power-data.js?v=0.49.0';
import {formatTime} from './model.js';
import {powerExercise} from './power-exercise.js?v=0.49.0';
import {powerMarkerUrl,renderPowerLegend} from './power-symbols.js';

const $=id=>document.getElementById(id);
const el=(tag,text='',css='')=>{const n=document.createElement(tag);n.textContent=text;n.className=css;return n;};
const button=(text,fn)=>{const b=el('calcite-button',text);b.setAttribute('scale','s');b.setAttribute('appearance','outline');b.onclick=fn;return b;};
const link=(text,url)=>{const a=el('a',text);a.href=url;a.target='_blank';a.rel='noopener noreferrer';return a;};

/** @param {object} options @returns {object} Fixed county power status, independent of the map extent and selected workspace. */
export function createPowerWatch({timeZone,exercise=false,exerciseNow=Date.now(),exerciseData,onLoadFacilities,onOpen=()=>{},onMap=()=>{},onData=()=>{}}={}){
  for(const host of document.querySelectorAll('[data-power-key]'))renderPowerLegend(host);
  for(const id of ['power-key-open','map-power-key-open'])$(id).onclick=()=>$('power-key-dialog').setAttribute('open','');
  $('power-key-close').onclick=()=>$('power-key-dialog').removeAttribute('open');
  let snapshot=null,county=null,map=null,busy=false,loadError=null,lastDirect=0,checked=null,selectedKey=null;
  let changes=null;
  const disclosures=new Set();
  const buildings=createPowerBuildings({onMap,exercise});
  const network=createPowerNetwork({timeZone,exercise,exerciseNow,exerciseData,onLoadFacilities,onMap,onFeatureOpen:()=>{selectedKey=null;buildings.clear();}});
  $('power-dialog').addEventListener('stormEvidenceClose',()=>{selectedKey=null;buildings.clear();});
  window.addEventListener('stormWorkspaceChange',()=>{if(new URL(location.href).searchParams.get('view')!=='power'){selectedKey=null;buildings.clear();}});
  const time=t=>t?formatTime(t,timeZone):'Not supplied';
  const stamp=d=>d?.time?time(d.time):d?.text?`${d.text} (publisher text; time zone unconfirmed)`:'Not supplied';
  function rows(){return (snapshot?.feeds||[]).flatMap(f=>f.rows.map(r=>({...r,health:powerHealth(f),issues:powerRowIssues(r)})));}
  function accept(next){
    snapshot=validatePowerSnapshot(next);
    changes=powerChanges(changes,rows());
  }
  function showDetail(row,locate=true){
    if(selectedKey!==row.key)disclosures.clear();
    selectedKey=row.key;
    const root=$('power-detail'),host=el('dl'),buildingHost=el('div');host.className='power-utility-fields';root.replaceChildren(host);
    const feed=snapshot.feeds.find(f=>f.id===row.feedId);
    const published=d=>d?.time?time(d.time):d?.text||'Not supplied';
    const location=/^(Mapped location|Mapped point|PSPS area intersecting|Area intersecting)/i.test(row.location||'')?null:row.location;
    const values=[['Utility status',row.rawStatus||POWER_STATES[row.status]],['Location',location],['Customers reported',row.customers===null?'Not supplied':row.customers.toLocaleString('en-US')],['Utility details',row.details],['Start / potential shutoff',published(row.start)],['Estimated restoration',published(row.restoration)],['Published window end',row.end.time||row.end.text?published(row.end):null],['Updated by utility',published(row.updated)]];
    for(const [label,value] of values)if(value)host.append(el('dt',label),el('dd',value));
    const issues=powerRowIssues(row),health=powerHealth(feed),urgent=issues.filter(s=>/passed|ended|24 hours|future|conflict|Unrecognized|differ/i.test(s));
    for(const issue of [...new Set([health,...urgent].filter(Boolean))])root.append(el('p',issue,'power-gap'));
    const actions=el('div','','power-nearby-controls');actions.append(link(`Open ${row.utility} outage map`,row.official),button('Locate outage',()=>{onMap();map?.focusPower(row.key);}));root.append(actions,buildingHost);
    const fold=(label,content)=>{const details=el('details');details.className='power-detail-disclosure';details.open=disclosures.has(label);details.append(el('summary',label),content);details.addEventListener('toggle',()=>{if(details.isConnected){if(details.open)disclosures.add(label);else disclosures.delete(label);}});root.append(details);return details;};
    const networkHost=el('div');fold('Circuits and nearby county places',networkHost);network.select(row,networkHost);
    const checks=el('div');checks.append(el('p',`Source retrieved ${time(Date.parse(feed.lastSuccess))} · record ${row.key}`));for(const issue of issues)checks.append(el('p',issue));checks.append(el('p','Customer counts belong to this utility record and may span counties. Free-text times are preserved as published; no time zone is assumed. Utility areas and estimates are approximate. Confirm critical-site power with the utility and site owner.'));fold('Source checks',checks);
    $('power-dialog').setAttribute('heading',`${row.utility} · ${row.name}`);$('power-dialog').setAttribute('open','');if(locate)onMap();const ready=locate?map?.focusPower(row.key):undefined;buildings.select(row,buildingHost,{ready,locate});
  }
  function render(){
    const pending=changes?.pending||new Set(),missing=changes?.missing.size||0;
    const all=rows(),active=all.filter(r=>['psps','outage'].includes(r.status)),notices=all.filter(r=>['consideration','warning'].includes(r.status));
    const gaps=POWER_FEEDS.filter(s=>powerHealth(snapshot?.feeds.find(f=>f.id===s.id))).length;
    const unknown=all.filter(r=>r.status==='unknown').length;
    const prefix=exercise?'EXERCISE · ':'';
    $('power-banner-title').textContent=prefix+(snapshot?`${active.length} outage record${active.length===1?'':'s'} · ${notices.length} PSPS watch / warning area${notices.length===1?'':'s'}${unknown?` · ${unknown} statuses to verify`:''}`:'Checking Fresno County power feeds');
    $('power-banner-detail').textContent=[loadError?'Power snapshot unavailable · check official utility maps':gaps?`${gaps} source checks unavailable or overdue · review power status`:`Fresno County · ${pending.size} new / changed records in this tab`,missing?`${missing} previous records no longer returned; restoration unconfirmed`:'Utility estimates may change'].join(' · ');
    $('power-banner').setAttribute('kind',active.length?'danger':notices.length||gaps||loadError||unknown||missing?'warning':'info');
    $('view-power').setAttribute('text',`Power / PSPS${snapshot?` · ${all.length}`:''}`);$('view-power').toggleAttribute('indicator',!!(active.length||notices.length||gaps||loadError));
    $('power-summary').textContent=snapshot?`${all.length} utility record${all.length===1?'':'s'} returned for Fresno County. Filters do not change the banner.`:'Power status unknown until source checks complete.';
    $('power-check-time').textContent=`Application checked ${time(checked)}. ${loadError||''}`;
    $('power-clear').toggleAttribute('disabled',!pending.size&&!missing);
    const health=$('power-health');health.replaceChildren();
    for(const spec of POWER_FEEDS){
      const f=snapshot?.feeds.find(f=>f.id===spec.id),problem=powerHealth(f);
      const card=el('div','','power-source');card.dataset.tone=problem?'gap':'current';
      card.append(el('strong',spec.label),el('span',problem||`${f.rows.length} record${f.rows.length===1?'':'s'} returned`),el('small',`Source retrieved ${time(Date.parse(f?.lastSuccess))}`));
      card.append(el('small',spec.direct?'Direct PG&E check every 5 minutes; dated snapshot fallback':'Scheduled SCE snapshot · 15-minute target, may be delayed'));
      if(f?.error)card.append(el('small',f.error));health.append(card);
    }
    const filter=$('power-filter').value||'all',list=$('power-list');list.replaceChildren();
    const visible=all.filter(r=>filter==='all'||(filter==='psps'?r.kind.includes('psps')||r.status==='psps':r.utility===filter)).sort((a,b)=>['psps','outage','warning','consideration','unknown','restored','cancelled'].indexOf(a.status)-['psps','outage','warning','consideration','unknown','restored','cancelled'].indexOf(b.status));
    if(!visible.length)list.append(el('p',snapshot?'No records returned in this filter. This is not an all-clear; check source health and official maps.':'Waiting for power data.','power-empty'));
    for(const row of visible){
      const card=el('article','','power-card');card.style.setProperty('--power-color',POWER_COLORS[row.status]);
      const status=el('div','','power-card-status'),icon=document.createElement('img');icon.src=powerMarkerUrl(row.status,!!row.health);icon.alt='';icon.width=34;icon.height=34;
      status.append(icon,el('strong',`${row.utility} · ${POWER_STATES[row.status]}`));const title=el('h3');title.append(button(row.name,()=>showDetail(row)));card.append(status,title,el('p',row.location));
      if(pending.has(`${row.key}|${row.revision}`))card.append(el('span','New / changed','power-new'));
      if(row.health)card.append(el('p',row.health,'power-gap'));
      for(const issue of row.issues.filter(s=>/passed|ended|24 hours|Unrecognized|differ|future/.test(s)))card.append(el('p',issue,'power-gap'));
      card.append(el('p',`Utility updated ${stamp(row.updated)}`));
      if(row.start.time||row.start.text)card.append(el('p',`${row.kind.includes('psps')?'Potential shutoff / start':'Outage start'} ${stamp(row.start)}`));
      card.append(el('p',`Estimated restoration ${stamp(row.restoration)}`),button('Review power record',()=>showDetail(row)));list.append(card);
    }
    map?.setPower(all);
    if(!exercise)for(const spec of POWER_FEEDS){const f=snapshot?.feeds.find(f=>f.id===spec.id);reportHealth('power:'+spec.id,spec.label,{checked:Date.parse(f?.lastSuccess),error:loadError||f?.error,maxAgeMs:45*60000});}
    onData(all,snapshot?.feeds||[],{checked,error:loadError});
    if($('power-dialog').hasAttribute('open')&&selectedKey){
      const selected=all.find(r=>r.key===selectedKey);
      if(selected)showDetail(selected,false);
      else {network.clearSelection();buildings.clear();selectedKey=null;$('power-detail').replaceChildren(el('p','This record is no longer returned by the latest check. Removal does not confirm restored power. Verify the official utility map.','power-gap'),link('PG&E official map',POWER_LINKS.pge),link('SCE official map',POWER_LINKS.sce));}
    }
  }
  async function refresh(force=false){
    if(busy||exercise)return;busy=true;$('power-refresh').setAttribute('loading','');
    try{
      const r=await fetch(new URL(`../data/power-latest.json?check=${Date.now()}`,import.meta.url),{cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(20000)});
      if(!r.ok)throw new Error(`Power snapshot HTTP ${r.status}`);
      const next=validatePowerSnapshot(await r.json());
      if(snapshot)next.feeds=next.feeds.map(f=>{const old=snapshot.feeds.find(o=>o.id===f.id);return Date.parse(old?.lastAttempt)>Date.parse(f.lastAttempt)?old:f;});
      accept(next);loadError=null;
    }catch(e){loadError=e.message;}
    if(county&&(force||Date.now()-lastDirect>=300000)){
      lastDirect=Date.now();accept(await collectPower({county,previous:snapshot,only:['pge-psps','pge-outages']}));
    }
    checked=Date.now();busy=false;$('power-refresh').removeAttribute('loading');render();
  }
  $('power-refresh').onclick=()=>void refresh(true);$('power-clear').onclick=()=>{changes?.pending.clear();changes?.missing.clear();render();};
  $('review-power').onclick=onOpen;$('power-filter').addEventListener('calciteSelectChange',render);$('power-map-toggle').addEventListener('calciteCheckboxChange',()=>{map?.setLayerPreference('power',$('power-map-toggle').checked);render();});
  for(const [id,key] of [['pge-map-link','pge'],['sce-map-link','sce']])$(id).setAttribute('href',POWER_LINKS[key]);
  if(exercise){
    $('power-refresh').setAttribute('disabled','');const controls=el('div','','power-actions');controls.append(el('strong','EXERCISE · fictional power records'));
    for(const [name,label] of [['watch','Watch / shutoff'],['symbols','All symbols'],['restored','Restoration / cancellation'],['failure','Feed failure']])controls.append(button(label,()=>{accept(powerExercise(name,exerciseNow));checked=exerciseNow;render();}));
    $('power-panel').prepend(controls);accept(powerExercise("watch",exerciseNow));checked=exerciseNow;render();
  }
  else{void refresh();setInterval(()=>{if(!document.hidden)void refresh();},60000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)void refresh();});setInterval(render,30000);}
  return {setFacilities:network.setFacilities,setReadiness:network.setReadiness,setSession:network.setSession,setCounty(c){county=c;if(!exercise)void refresh(true);},setMap(m){map=m;network.setMap(m);buildings.setMap(m);render();},selectNetwork(key){network.showFeature(key);},select(key,{keepWorkspace=false}={}){const row=rows().find(r=>r.key===key);if(row){if(!keepWorkspace)onOpen();map?.setLayerPreference('power',true);showDetail(row);}}};
}
