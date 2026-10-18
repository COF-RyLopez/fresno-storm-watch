import { exerciseRivers } from './river-exercise.js';
import { HOUR } from './river-model.js';
import {scheduledRecords} from './release-model.js';

/** @param {object[]} gauges @param {object[]} points @param {object} selection @param {string} scenario @param {number} now @returns {object} Isolated, explicitly fictional cue fixtures. */
export function planningExercise(gauges,points,selection,scenario,now){
  const entries=new Map(exerciseRivers(gauges,'baseline',now).map(r=>{
    r.gauge.observed.points.forEach(p=>{p.value=10;});r.gauge.forecast.points.forEach(p=>{p.value=10;});
    if(r.id==='SJXC1'&&['combined','threshold'].includes(scenario)){
      r.gauge.observed.points.forEach((p,i)=>{p.value=9.2+i/30;});
      r.gauge.forecast.points.forEach((p,i)=>{p.value=scenario==='threshold'?10+Math.min(i,8)*0.3:10.4;});
    }
    if(scenario==='stale'){r.gauge.fetched-=2*HOUR;r.gauge.observed.points.forEach(p=>p.time-=30*HOUR);r.gauge.forecast.issued-=30*HOUR;}
    return [r.id,{gauge:r.gauge,error:scenario==='missing'?'Fictional station failure':null}];
  }));
  const cycle={hours:72,issue:now-HOUR,start:now,end:now+72*HOUR,product:'EXERCISE WPC 72h'};
  const rain={cycle,checked:scenario==='stale'?now-HOUR:now,error:null,points:Object.fromEntries(points.map(p=>[p.id,{value:scenario==='missing'?null:['combined','threshold'].includes(scenario)&&['MIL','SJXC1','RSBC1','GVAC1','SJMC1'].includes(p.id)?1.25:0,labels:[],reason:scenario==='missing'?'Fictional missing polygon':'Fictional forecast sample',error:null}]))};
  const snapshot={schemaVersion:1,generatedAt:new Date(scenario==='stale'?now-2*HOUR:now).toISOString(),stations:selection.stations.map(s=>({id:s.id,error:null,lastSuccess:new Date(now).toISOString(),metrics:Object.fromEntries(s.metrics.map(m=>{
    const value=s.id==='MIL'&&m.key==='release'&&scenario==='combined'?600:m.key==='spill'?0:400;
    const time=m.duration==='D'?Date.parse(new Date(now-8*HOUR-24*HOUR).toISOString().slice(0,10)+'T00:00:00-08:00'):now-HOUR,priorTime=time-(m.duration==='D'?24:1)*HOUR;
    const sample={time,value,flag:'',units:m.units,reportDate:new Date(time-8*HOUR).toISOString().slice(0,10)};
    const prior={...sample,time:priorTime,value:m.key==='release'?400:value,reportDate:new Date(priorTime-8*HOUR).toISOString().slice(0,10)};
    const older=Array.from({length:m.duration==='D'?6:71},(_,i)=>{const t=priorTime-(i+1)*(m.duration==='D'?24:1)*HOUR;return {...prior,time:t,reportDate:new Date(t-8*HOUR).toISOString().slice(0,10)};}).reverse();
    return [m.key,{sensor:m.sensor,duration:m.duration,units:m.units,lastValid:sample,latest:sample,samples:[...older,prior,sample]}];
  }))}))};
  for(const station of snapshot.stations){
    const row=(offset,value)=>({stationId:station.id,durCode:'E',SENSOR_NUM:7,units:'CFS',value,dataFlag:' ',obsDate:new Date(now+offset*HOUR-8*HOUR).toISOString().slice(0,16).replace('T',' ')});
    const records=scenario==='scheduled'?[row(-48,400),row(6,station.id==='MIL'?650:550),row(18,300)]:[];
    station.scheduled={...scheduledRecords(records,station.id,now),lastAttempt:new Date(now).toISOString(),lastSuccess:new Date(now).toISOString(),error:scenario==='missing'?'Fictional schedule failure':null};
  }
  return {entries,rain,reservoirs:{selection,snapshot,checked:now,error:scenario==='missing'?'Fictional collection failure':null}};
}
