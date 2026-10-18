import {fetchRoads,roadInCurrentView,roadConflictBacklog,missingRoadRecords,roadFailureReason,ROAD_MAP} from './roads.js';
import {loadCounties,fetchRegionalAlerts} from './nws.js';
import {fetchRiverWatch} from './nwps.js';
import {environmentalJson} from './environment-data.js';
import {validateReservoirSnapshot} from './environment-model.js';
import {planningPoints,evaluateAreas} from './planning-model.js';
import {fetchPlanningRain} from './planning-data.js';
import {digest,canonical} from './eoc-model.js';
import {COUNTIES} from './model.js';

export function exerciseSources(now=Date.now()){
  return {health:[{name:'Fictional tabletop sources',status:'Exercise only — no live measurements',checked:now}],notifications:[
    {key:'exercise:alert',revision:'alert-v1',category:'Official agency alerts',location:'FICTIONAL Fresno river reach',change:'EXERCISE: example flood watch for a practice operational period',sourceTime:now-600000,verification:'Fictional agency product',owner:'Planning / Intelligence',nextReview:'Brief the exercise watch and verify NWS guidance'},
    {key:'exercise:rise',revision:'rise-v1',category:'Planning review cues',location:'FICTIONAL San Joaquin exercise reach',change:'EXERCISE: gauge +0.4 ft over 2 h; release +100 cfs; rainfall sample 0.5 in / 72 h. No real threshold or arrival time.',sourceTime:now-120000,verification:'Fictional planning cue',owner:'Planning / Intelligence',nextReview:'Verify with the exercise river operator before proposing staging'},
    {key:'exercise:road',revision:'road-v1',category:'Official road records',location:'FICTIONAL Exercise Crossing',change:'EXERCISE: published road closure; detour/access require confirmation',sourceTime:now-300000,verification:'Fictional county source',owner:'Operations',nextReview:'Confirm access with the exercise road owner'}]};
}

/** Public context is independently refreshed; private records are never passed to public feeds. */
export function createEocSources(config,onChange){
  let inventory=null,busy=false,missingRoads=new Map();
  const values={},health=new Map();
  const emit=async()=>{
    const now=Date.now(),notifications=[];
    for(const a of values.nws||[])if(!a.expires||a.expires>now)notifications.push({key:`nws:${a.key}`,revision:a.signature,category:'Official agency alerts',location:a.counties.map(id=>COUNTIES[id]||id).join(', '),change:a.event||a.title||a.product||a.type||'NWS product',sourceTime:a.issued,verification:'Official NWS product — review local implications',link:a.sourceUrl,evidence:{issued:a.issued,onset:a.onset,expires:a.expires,office:a.office}});
    if(values.roads){for(const r of values.roads.rows.filter(r=>roadInCurrentView(r,now))){const facts={name:r.name,location:r.location,active:r.active,start:r.start,end:r.end,sourceTime:r.sourceTime,edited:r.edited,comment:r.comment,alternateRoute:r.alternateRoute};notifications.push({key:r.key,revision:await digest(facts),category:r.issues.length?'Verification queue':'Official road records',location:r.location,change:`${r.kind} · ${r.status}${r.comment?' · '+r.comment:''}`,sourceTime:r.sourceTime||r.edited,verification:r.issues.join('; ')||'Publisher record — access not independently verified',link:ROAD_MAP,evidence:facts});}}
    const backlog=roadConflictBacklog(values.roads?.rows||[],now);
    if(backlog.length){const facts=backlog.map(r=>({id:r.key,end:r.end,edited:r.edited}));notifications.push({key:'county-roads:conflict-backlog',revision:await digest(facts),category:'Verification queue',location:'County road status reconciliation',change:`${backlog.length} elapsed-date records still carry active flags. These historical contradictions need Road Maintenance confirmation; they are not displayed as current closures.`,sourceTime:null,verification:'Publisher field meanings / disposition unresolved',link:'./?view=roads',evidence:{count:backlog.length,records:facts},nextReview:'Review elapsed-date records with Road Maintenance; do not infer that roads reopened'});}
    for(const {row,detected} of missingRoads.values())notifications.push({key:`missing:${row.key}`,revision:String(detected),category:'Verification queue',location:row.location,change:'Previously returned county road record is absent — verify disposition; road access is not confirmed',sourceTime:row.sourceTime||row.edited,verification:'Disappearance detected during this open session',link:ROAD_MAP,evidence:{lastRecord:row.key,detected,lastActive:row.active,start:row.start,end:row.end}});
    if(inventory){
      const entries=new Map((values.gauges||[]).map(g=>[g.id,{gauge:g.gauge,error:g.error}]));
      const rows=evaluateAreas({areas:inventory.areas.areas,points:inventory.points,gaugeEntries:entries,riverConfig:config.rivers,reservoirs:{selection:inventory.reservoirs,snapshot:values.reservoirs,error:health.get('reservoirs')?.error,checked:health.get('reservoirs')?.checked},rain:values.rain?{...values.rain,error:health.get('rain')?.error}:null,environmentConfig:config.environment},now);
      for(const r of rows){
        const evidence={status:r.status,gaps:r.gaps,rain:{issue:r.rainfall.cycle?.issue,start:r.rainfall.cycle?.start,end:r.rainfall.cycle?.end,samples:r.rainfall.samples},gauges:r.gauges.map(g=>({id:g.id,observed:g.assessment.observed,units:g.gauge?.observed.units,forecastUnits:g.gauge?.forecast.units,forecastIssued:g.gauge?.forecast.issued,peak:g.assessment.peak,trend:g.assessment.trend,usable:g.assessment.current&&g.assessment.forecastUsable,thresholds:g.assessment.crossings})),releases:r.releases.map(s=>({station:s.station,label:s.label,value:s.sample?.value,time:s.sample?.time,units:'cfs',delta:s.delta,hours:s.hours,current:s.current,reason:s.reason,source:s.source}))};
        const dates=[r.rainfall.cycle?.issue,...r.gauges.map(g=>g.assessment.observed?.time),...r.releases.map(s=>s.sample?.time)].filter(Number.isFinite);
        const changes=[r.status,...r.rising.map(g=>`${g.id} +${g.assessment.trend.delta.toFixed(2)} ${g.gauge.observed.units} / ${g.assessment.trend.hours.toFixed(1)} h`),...r.increased.map(s=>`${s.station} ${s.label} +${s.delta.toFixed(0)} cfs / ${s.hours.toFixed(1)} h`),r.rainfall.maximum===null?'Rain amount unknown':`Rain sample max ${r.rainfall.maximum.toFixed(2)} in / 72 h`,`${r.gaps.length} information gaps`];
        notifications.push({key:`area:${r.area.id}`,revision:await digest(evidence),category:'Planning review cues',location:r.area.name,change:changes.join(' · '),sourceTime:dates.length?Math.max(...dates):null,verification:'Planning cue; no county action threshold or safe-access inference',link:'./?view=watch',evidence});
      }
    }
    const status=[...health.values()].map(h=>({...h,status:h.error?`FAILED — retained evidence needs verification${h.detail?' · '+h.detail:''}`:now-h.checked>420000?'STALE — refresh overdue':h.detail||'Query succeeded'}));
    for(const h of status)if(h.error||now-h.checked>420000)notifications.push({key:`health:${h.key}`,revision:canonical([h.error||'stale',h.checked]),category:'Data failures',location:h.name,change:h.status,sourceTime:h.checked,verification:'Source coverage incomplete',nextReview:'Open publisher source and assign a verification follow-up'});
    onChange({notifications,health:status,checked:now});
  };
  async function check(key,name,fn){try{values[key]=await fn();health.set(key,{key,name,checked:Date.now(),error:null});}catch(error){const old=health.get(key);health.set(key,{key,name,checked:old?.checked||null,error:true,detail:key==='roads'?roadFailureReason(error):null});}}
  async function refresh(){if(busy)return;busy=true;try{
    if(!inventory){const [areas,gauges,reservoirs,counties]=await Promise.all([environmentalJson('./data/river-areas.json'),environmentalJson('./data/river-watchlist.json'),environmentalJson('./data/reservoir-watchlist.json'),loadCounties('./data/counties.geojson')]);inventory={areas,gauges,reservoirs,counties,points:planningPoints(areas,gauges.stations,reservoirs.stations)};}
    await Promise.allSettled([
      check('roads','County road records',async()=>{const result=await fetchRoads();missingRoads=missingRoadRecords(values.roads?.rows||[],result.rows,missingRoads);return result;}),check('nws','Regional NWS alerts',()=>fetchRegionalAlerts(inventory.counties,config)),
      check('gauges','NWPS gauges',()=>fetchRiverWatch(inventory.gauges.stations,config.rivers)),check('rain','WPC 72-hour rainfall samples',()=>fetchPlanningRain(inventory.points)),
      check('reservoirs','CDEC reservoir collection',async()=>validateReservoirSnapshot(await environmentalJson('./data/reservoir-latest.json')))
    ]);
    if(health.get('nws')&&!health.get('nws').error&&!values.nws.length)health.get('nws').detail='No alerts returned — does not establish safe conditions';
    if(values.gauges?.some(g=>g.error))health.get('gauges').error=true;
    if(values.rain&&Object.values(values.rain.points).some(p=>p.error))health.get('rain').error=true;
    if(values.reservoirs&&(Date.now()-Date.parse(values.reservoirs.generatedAt)>config.environment.collectorMaxAgeMs||values.reservoirs.stations.some(s=>s.error)))health.get('reservoirs').error=true;
    await emit();
  }catch{health.set('inventory',{key:'inventory',name:'Source inventory',checked:null,error:true});await emit();}finally{busy=false;}}
  void refresh();setInterval(()=>{if(!document.hidden)void refresh();},300000);setInterval(()=>{if(!busy)void emit();},30000);
  return {refresh};
}
