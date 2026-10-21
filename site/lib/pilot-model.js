import {CONFIG} from '../config.js';
import {evaluateAreas} from './planning-model.js';
import {assessGauge} from './river-model.js';
import {combineAreaConcerns} from './area-concern-model.js';
import {areaDifferences,mergeForecastReviews} from './forecast-review-model.js';
import {comparisonAreas} from './forecast-comparison-model.js';
import {POWER_COLORS,powerHealth,powerRowIssues} from './power-model.js';

export const PILOT_BOUNDS=[-120.94,35.89,-118.34,37.61];
export const PILOT_TARGETS=[[-119.98,36.78,-119.47,37.2],[-120.65,36.65,-119.95,37.02],[-119.59,36.67,-119.07,37.02]];
export const PILOT_COLORS={threshold:'#ef8d87',change:'#e0b663',monitor:'#75bddd',gap:'#a5afb8'};
export const collection=features=>({type:'FeatureCollection',features});
/** Reject incomplete inventories before publishing counts or comparison metrics. */
export function validatePilot(s,now=Date.now()){
 if(s?.error)throw Error(s.error);
 const i=s?.input;
 if(s?.schemaVersion!==1||!/^[a-f0-9]{64}$/.test(s.dataId)||!Number.isFinite(Date.parse(s.generatedAt))||Date.parse(s.generatedAt)>now+120000||i?.areas?.areas?.length!==6||i.gauges?.stations?.length!==9||i.entries?.length!==9||new Set(i.entries.map(e=>e.id)).size!==9||i.entries.some(e=>!i.gauges.stations.some(p=>p.id===e.id))||!Array.isArray(i.utilityFeatures))throw Error('Public pilot bundle is incomplete or changed.');
 return s;
}
/** Share current operational logic; no map engine or display filter enters evaluation. */
export function pilotAssessment(s,now=Date.now(),previous=[]){
 const i=s.input,checked=Date.parse(s.generatedAt),old=now-checked>45*60000;
 const entries=new Map(i.entries.map(e=>[e.id,old?{...e,error:'Pilot collection overdue'}:e]));
 const reservoirs={selection:i.reservoirSettings,snapshot:i.reservoirs,checked,error:old?'Pilot collection overdue':null};
 const rain=old?{...i.rain,error:'Pilot collection overdue'}:i.rain;
 const rows=evaluateAreas({areas:i.areas.areas,points:i.points,gaugeEntries:entries,riverConfig:CONFIG.rivers,reservoirs,rain,environmentConfig:CONFIG.environment},now);
 const powerRows=i.power.feeds.flatMap(f=>f.rows.map(r=>({...r,health:powerHealth(f,now),issues:powerRowIssues(r,now)})));
 const combined=combineAreaConcerns({rows,associations:i.associations,windSites:i.windSettings.sites,points:i.points,wind:{snapshot:i.wind,checked,error:old?'Pilot collection overdue':null},power:{rows:powerRows,feeds:i.power.feeds,checked,error:old?'Pilot collection overdue':null},previous},now);
 const comparisons=comparisonAreas(i.areas.areas,i.associations.areas,i.windSettings.sites,i.gauges.stations);
 return {old,checked,areas:mergeForecastReviews(combined,areaDifferences(comparisons,i.comparisons,now)),gauges:i.gauges.stations.map(station=>{const e=entries.get(station.id);return {station,gauge:e?.gauge,assessment:assessGauge(e?.gauge,CONFIG.rivers,72,now,e?.error)};}),reservoirs,powerRows};
}
/** Same GeoJSON IDs, geometry and colors feed both rendering engines. */
export function pilotFeatures(s,assessment,view,filter='all',basin='All'){
 const features=[];
 const point=(id,kind,name,longitude,latitude,tone,extra={})=>({type:'Feature',id,properties:{id,kind,name,color:PILOT_COLORS[tone]||PILOT_COLORS.gap,tone,...extra},geometry:{type:'Point',coordinates:[longitude,latitude]}});
 if(view==='watch'){
  const rows=assessment.areas.filter(r=>filter==='all'||r.review),seen=new Set();
  for(const r of rows)for(const p of r.samplePoints){const key=p.longitude+':'+p.latitude;if(seen.has(key))continue;seen.add(key);features.push(point('area:'+p.id,'area',p.name,p.longitude,p.latitude,r.threshold?'threshold':r.review?'change':r.gaps.length?'gap':'monitor',{areaId:r.area.id,review:r.review}));}
  const keys=new Set(rows.flatMap(r=>[...r.power.matches,...r.power.followups].map(m=>m.row.key)));
  for(const f of s.input.utilityFeatures)if(keys.has(f.properties.powerKey)){const row=assessment.powerRows.find(r=>r.key===f.properties.powerKey);if(!row||['restored','cancelled'].includes(row.status))continue;features.push({...f,properties:{...f.properties,id:String(f.id),kind:'power',name:row.utility+' · '+row.name,color:POWER_COLORS[row.status]||POWER_COLORS.unknown}});}
 }else{
  for(const r of assessment.gauges){if(basin!=='All'&&r.station.basin!==basin)continue;const p=r.gauge||r.station;features.push(point('gauge:'+r.station.id,'gauge',p.name,p.longitude,p.latitude,r.assessment.tone,{gaugeId:r.station.id}));}
  for(const p of s.input.reservoirSettings.stations)features.push(point('reservoir:'+p.id,'reservoir',p.name,p.longitude,p.latitude,'monitor',{reservoirId:p.id}));
 }
 if(new Set(features.map(f=>String(f.id))).size!==features.length)throw Error('Pilot feature IDs are duplicated.');
 return collection(features);
}
/** Standard evidence destinations; only reviewed source coordinates/bounds. */
export function featureBounds(features){
 const points=[];function walk(c){if(Array.isArray(c)&&typeof c[0]==='number')points.push(c);else if(Array.isArray(c))c.forEach(walk);}
 for(const f of features)walk(f.geometry?.coordinates);
 if(!points.length)return null;
 return points.reduce((b,p)=>[Math.min(b[0],p[0]),Math.min(b[1],p[1]),Math.max(b[2],p[0]),Math.max(b[3],p[1])],[Infinity,Infinity,-Infinity,-Infinity]);
}
/** Comparison eligibility is explicit; never average unlike data, modes or views. */
export function comparableRuns(a,b){return !!a&&!!b&&a.engine!==b.engine&&a.complete===true&&b.complete===true&&!a.errors?.length&&!b.errors?.length&&a.dataId===b.dataId&&a.view===b.view&&a.filter===b.filter&&a.basin===b.basin&&a.featureSignature===b.featureSignature&&a.width===b.width&&a.height===b.height&&a.pixelRatio===b.pixelRatio&&a.symbolVersion===b.symbolVersion&&a.styleId===b.styleId;}
