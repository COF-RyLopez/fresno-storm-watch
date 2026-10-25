import {NETWORK_SOURCES,NETWORK_LAYER_KEYS,NETWORK_MAX_AGE,networkIdentifier,networkSourceProblem,validateNetworkSnapshot,matchPowerCircuit} from './power-network-model.js';
import {reportHealth} from './source-health.js';
const $=id=>document.getElementById(id),el=(tag,text='')=>{const n=document.createElement(tag);n.textContent=text;return n;};
const link=(text,url)=>{const n=el('a',text);n.href=url;n.target='_blank';n.rel='noopener noreferrer';return n;};
const button=(text,action)=>{const n=el('calcite-button',text);n.scale='s';n.appearance='outline';n.onclick=action;return n;};
/** Lazy public network evidence. Closing/replacing evidence clears its selection; refresh never moves the map. */
export function createPowerNetwork({timeZone,exercise=false,exerciseNow=Date.now(),onMap=()=>{},onFeatureOpen=()=>{}}={}){
  let snapshot=null,map=null,selected=null,associationHost=null,busy=false,checked=null,lastAttempt=0,loadError=null;
  const time=t=>Number.isFinite(t)?new Date(t).toLocaleString('en-US',{timeZone,timeZoneName:'short'}):'Not supplied';
  const all=()=>snapshot?.sources.flatMap(s=>s.features)||[];
  function renderAssociation(){
    if(!selected||!associationHost?.isConnected)return;const m=matchPowerCircuit(selected,snapshot,exercise?exerciseNow:Date.now());associationHost.replaceChildren(el('h3','Circuit association'));
    const status=el('p',m.reason);status.setAttribute('role','status');associationHost.append(status);associationHost.dataset.match=m.state;
    if(m.sourceField)associationHost.append(el('p',`Publisher ${m.sourceField}: ${m.value}`));
    const source=snapshot?.sources.find(s=>s.id===(selected.utility==='SCE'?'sce-circuits':'pge-circuits'));
    if(source)associationHost.append(el('p',`Circuit reference retrieved ${time(Date.parse(source.lastSuccess))}${source.publisherEdited?' · publisher service edited '+time(source.publisherEdited):' · publisher edit time not supplied'}.`),link('Circuit reference source',source.url));
    for(const f of m.circuits.slice(0,1)){associationHost.append(el('p',`${f.utility} · ${f.name} · circuit ID ${f.code}${f.number?' · number '+f.number:''}`),el('p',`Published substation association: ${f.substation||'Not supplied'}`));if(f.note&&f.note!=='NA')associationHost.append(el('p',f.note));}
    if(m.stationNote)associationHost.append(el('p',m.stationNote));
    if(m.state==='matched'){associationHost.append(button('Show matched circuit',()=>{onMap();map?.setLayerPreference('powerCircuits',true);map?.focusPowerNetwork(m.circuits.map(f=>f.key));}));}
    if(m.substations.length)associationHost.append(el('p',`Substation point matched by published name: ${m.substations[0].name} · ${m.substations[0].code}.`),button('Show associated substation',()=>{onMap();map?.setLayerPreference('powerSubstations',true);map?.focusPowerNetwork(m.substations.map(f=>f.key));}));
    associationHost.append(el('p','Fault location: not supplied by these feeds. A circuit match does not prove that every line is de-energized or that a nearby site is served by it.'));
    map?.setPowerNetworkMatch(m);
  }
  function showFeature(f){
    onFeatureOpen();selected=null;associationHost=null;map?.clearPowerNetworkMatch();const host=$('power-detail');host.replaceChildren(el('h3',f.utility+' · '+f.name));
    for(const [key,value]of [['Reference type',f.kind==='circuit'?'Distribution circuit line':f.kind==='line'?'Transmission line':'Substation point'],['Published identifier',f.code||'Not supplied'],['Circuit number',f.number||'Not supplied'],['Published substation association',f.substation||'Not supplied'],['Voltage',f.voltage?f.voltage+(f.utility==='PG&E'?' kV':' (publisher value; see source)'):'Not supplied'],['Published record date',f.published&&/Z$/.test(f.published)&&Number.isFinite(Date.parse(f.published))?time(Date.parse(f.published)):f.published||'Not supplied']])host.append(el('dt',key),el('dd',value));
    const s=snapshot.sources.find(s=>s.id===f.sourceId);host.append(el('p',`Reference retrieved ${time(Date.parse(s.lastSuccess))}${s.publisherEdited?' · service edited '+time(s.publisherEdited):''}. ${networkSourceProblem(s)||''}`));
    if(f.note&&f.note!=='NA')host.append(el('p',f.note));host.append(el('p','Reference network—connection to a selected outage or facility is unverified. Live switching, energized state and fault location are not provided. Geometry may be generalized or redacted.'),link('Open utility reference service',s.url),button('Show reference on map',()=>{onMap();map?.setLayerPreference(NETWORK_LAYER_KEYS[f.kind],true);map?.focusPowerNetwork([f.key]);}));
    $('power-dialog').setAttribute('heading','Utility network reference');$('power-dialog').setAttribute('open','');onMap();
  }
  function render(){
    $('power-network-refresh').loading=busy;$('power-network-refresh').disabled=busy||exercise;
    const features=all(),counts=kind=>features.filter(f=>f.kind===kind).length,quantity=(kind,label)=>`${counts(kind)} ${label}${counts(kind)===1?'':'s'}`,issues=snapshot?.sources.filter(s=>networkSourceProblem(s,exercise?exerciseNow:Date.now())).length||0;
    $('power-network-block').description=snapshot?`${quantity('circuit','circuit record')} · ${quantity('line','line')} · ${quantity('substation','point')}${issues?' · coverage needs review':''}`:'Public planning references · loading';
    $('power-network-summary').textContent=snapshot?`${exercise?'FICTIONAL EXERCISE · ':''}${quantity('circuit','circuit record')} · ${quantity('line','transmission record')} · ${quantity('substation','substation point')}. These are planning references, not live electrical status.${issues?` ${issues} source checks failed, missing or overdue; coverage is incomplete.`:''}`:busy?'Loading public utility network references…':'Network reference not loaded. Open Power / PSPS to load it.';
    $('power-network-status').textContent=loadError||`Application checked ${time(checked)}. Circuit lines appear below 1:350,000; matched circuits remain highlighted at wider scales.`;
    const status=$('power-network-sources');status.replaceChildren();for(const spec of NETWORK_SOURCES){const s=snapshot?.sources.find(v=>v.id===spec.id);status.append(el('p',`${spec.label}: ${s?s.features.length+' records':'unknown'} · ${networkSourceProblem(s)||'Reference check current'} · retrieved ${time(Date.parse(s?.lastSuccess))}${s?.publisherEdited?' · publisher service edit '+time(s.publisherEdited):' · publisher edit time not supplied'}`),link('Publisher source',spec.url));if(!exercise)reportHealth('power-network:'+spec.id,spec.label,{checked:Date.parse(s?.lastSuccess),error:loadError||s?.error,maxAgeMs:NETWORK_MAX_AGE,detail:'Planning reference; not current switching or energized status.'});}
    const filter=networkIdentifier($('power-network-search').value),list=$('power-network-results');list.replaceChildren();if(filter){const rows=features.filter(f=>networkIdentifier([f.utility,f.name,f.code,f.number,f.substation].join(' ')).includes(filter));list.append(el('p',`${rows.length} reference records match${rows.length>8?' · first 8 shown; refine the name or ID':''}.`));for(const f of rows.slice(0,8))list.append(button(`${f.utility} · ${f.name} · ${f.kind}`,()=>{showFeature(f);map?.setLayerPreference(NETWORK_LAYER_KEYS[f.kind],true);map?.focusPowerNetwork([f.key]);}));}
    renderAssociation();
  }
  async function refresh(){
    if(busy||exercise)return;busy=true;lastAttempt=Date.now();render();
    try{const response=await fetch(new URL('../data/power-network.json?check='+Date.now(),import.meta.url),{credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(25000)});if(!response.ok)throw Error();snapshot=validateNetworkSnapshot(await response.json());loadError=null;}catch{loadError='Public utility network check failed. Retained references are unverified; retry or open the publisher sources.';if(snapshot)snapshot={...snapshot,sources:snapshot.sources.map(s=>({...s,error:loadError}))};}
    checked=Date.now();busy=false;map?.setPowerNetwork(snapshot);render();
  }
  const active=()=>new URL(location.href).searchParams.get('view')==='power'&&!['scenarios','briefing'].includes(new URL(location.href).searchParams.get('mission'));
  const activate=()=>{if(active()&&!exercise&&Date.now()-lastAttempt>300000)void refresh();};
  $('power-network-refresh').onclick=()=>void refresh();$('power-network-search').addEventListener('calciteInputInput',render);
  for(const [kind,key]of Object.entries(NETWORK_LAYER_KEYS))$('network-'+kind).addEventListener('calciteCheckboxChange',()=>map?.setLayerPreference(key,$('network-'+kind).checked));
  document.addEventListener('frogLayerPreference',e=>{for(const [kind,key]of Object.entries(NETWORK_LAYER_KEYS))if(e.detail.key===key)$('network-'+kind).checked=!!e.detail.wanted;});
  $('power-dialog').addEventListener('stormEvidenceClose',()=>{selected=null;associationHost=null;map?.clearPowerNetworkMatch();});
  window.addEventListener('stormWorkspaceChange',activate);window.addEventListener('popstate',activate);setInterval(()=>{if(!document.hidden&&active())activate();},60000);
  if(exercise){snapshot=networkExercise(exerciseNow);checked=exerciseNow;}render();queueMicrotask(activate);
  return {setMap(value){map=value;if(snapshot)map.setPowerNetwork(snapshot);renderAssociation();},select(row,host){selected=row;associationHost=host;renderAssociation();activate();},clearSelection(){selected=null;associationHost=null;map?.clearPowerNetworkMatch();},showFeature:key=>{const f=all().find(f=>f.key===key);if(f)showFeature(f);}};
}
/** Fully fictional geometry for the existing no-write exercise, including an exact SCE name match. */
export function networkExercise(now=Date.now()){
  const sources=NETWORK_SOURCES.map(s=>({...s,features:[],lastAttempt:new Date(now).toISOString(),lastSuccess:new Date(now).toISOString(),error:null,publisherEdited:null,accounting:{selected:0,returned:0}}));
  const circuit={key:'sce-circuits:1',sourceId:'sce-circuits',utility:'SCE',kind:'circuit',code:'EXERCISE-C1',name:'EXERCISE · mountain circuit',matchName:'EXERCISE · mountain circuit',number:'EXERCISE-01',substation:'EXERCISE · invented substation',voltage:'12',note:'Fictional circuit and location. No utility operating condition is represented.',published:'EXERCISE',geometry:{paths:[[[-119.52,37.05],[-119.49,37.07],[-119.46,37.11]]],spatialReference:{wkid:4326}}};
  const station={...circuit,key:'sce-substations:1',sourceId:'sce-substations',kind:'substation',code:'EXERCISE-S1',name:circuit.substation,matchName:circuit.substation,number:'',geometry:{x:-119.52,y:37.05,spatialReference:{wkid:4326}}};
  for(const f of [circuit,station]){const s=sources.find(s=>s.id===f.sourceId);s.features.push(f);s.accounting={selected:s.features.length,returned:s.features.length};}
  return {schemaVersion:1,scope:'Fresno County 06019; whole intersecting features',generatedAt:new Date(now).toISOString(),sources};
}
