import {POWER_FEEDS} from './power-model.js';
const HOUR=3_600_000;

/** @param {object[]} sites @param {string} scenario @param {number} now @returns {object} Explicitly fictional area-watch data, isolated from live feeds and storage. */
export function areaConcernExercise(sites,scenario,now=Date.now()){
  const stale=scenario==='stale',missing=scenario==='missing',overlap=['overlap','timing'].includes(scenario);
  const snapshot={schemaVersion:1,generatedAt:new Date(stale?now-2*HOUR:now).toISOString(),sourceMode:'exercise',sites:sites.map(s=>({...s,lastSuccess:new Date(now).toISOString(),error:missing?'EXERCISE missing forecast':null,
    forecast:{issued:now-HOUR,units:'mph',heightMeters:10,series:{
      windSpeed:[{start:now-HOUR,end:now+74*HOUR,value:12}],
      windGust:[{start:now-HOUR,end:now+6*HOUR,value:18},{start:now+6*HOUR,end:now+9*HOUR,value:overlap&&s.id==='SJ41'?40:22},{start:now+9*HOUR,end:now+74*HOUR,value:15}],
      windDirection:[{start:now-HOUR,end:now+74*HOUR,value:315}]
    }}}))};
  const s=sites.find(s=>s.id==='SJ41'),x=s.longitude,y=s.latitude;
  const row={key:'exercise:area-psps',revision:'fictional-v1',feedId:'pge-psps',utility:'PG&E',name:'EXERCISE · San Joaquin watchpoint PSPS',kind:'pge-psps',status:'warning',issues:[],
    updated:{time:now-60_000},start:{time:scenario==='timing'?null:now+5*HOUR},end:{time:scenario==='timing'?null:now+10*HOUR},restoration:{time:null},official:'https://pgealerts.alerts.pge.com/psps-updates/',
    geometries:[{rings:[[[x-.01,y-.01],[x+.01,y-.01],[x+.01,y+.01],[x-.01,y+.01],[x-.01,y-.01]]],spatialReference:{wkid:4326}}]};
  const feeds=POWER_FEEDS.map(f=>({id:f.id,lastSuccess:new Date(now).toISOString(),error:missing?'EXERCISE source failure':null}));
  return {wind:{snapshot,checked:now,error:null},power:{rows:overlap?[row]:[],feeds,checked:now,error:null}};
}
