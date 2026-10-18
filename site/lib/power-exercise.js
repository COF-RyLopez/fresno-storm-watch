import {POWER_FEEDS,deduplicatePower,normalizePower} from './power-model.js';
import {POWER_LAYERS} from './power-data.js';
/** @param {string} scenario @param {number} now @returns {object} Fictional exercise only; never submitted to a utility or persisted. */
export function powerExercise(scenario='watch',now=Date.now()){
  const polygon={rings:[[[-119.72,36.9],[-119.66,36.9],[-119.66,36.96],[-119.72,36.96],[-119.72,36.9]]],spatialReference:{wkid:4326}};
  const restored=scenario==='restored';
  const examples=[
    normalizePower({attributes:{EventID:'EXERCISE-PGE',EventName:'EXERCISE · foothill planning area',TimePeriod:'EXERCISE PERIOD',Stage:restored?'cancelled':'warning',DeEngStart:new Date(now+3600000).toISOString(),DeEngEnd:new Date(now+5*3600000).toISOString(),ETOR:'To be determined',LstUpdated:new Date(now-60000).toISOString()},geometry:polygon},POWER_LAYERS[0]),
    normalizePower({attributes:{GlobalID:'EXERCISE-SCE',CIRCUIT_NAME:'EXERCISE · mountain circuit',COUNTY:'Fresno',PSPS:restored?'Re-Energized':'De-Energized',PSPS_Details:restored?'Re-Energized':'Re-Energization Expected',StartDate:now-2*3600000,ERT:now+3*3600000,EditDate:now-120000},geometry:{rings:polygon.rings.map(r=>r.map(([x,y])=>[x+0.2,y+0.15])),spatialReference:{wkid:4326}}},POWER_LAYERS.find(l=>l.kind==='sce-psps'))
  ];
  return {schemaVersion:1,generatedAt:new Date(now).toISOString(),scope:'EXERCISE · invented locations and utility conditions',feeds:POWER_FEEDS.map(s=>({id:s.id,lastAttempt:new Date(now).toISOString(),lastSuccess:new Date(scenario==='failure'?now-3600000:now).toISOString(),error:scenario==='failure'?'EXERCISE simulated source failure':null,rows:deduplicatePower(examples.filter(r=>r.feedId===s.id)),accounting:[]}))};
}
