/** NWS snow level, county snow-removal routes and forecast-discussion snow lines. Planning context, not road condition reports. */
import {forecastInterval} from './weather-model.js';
export const FT_PER_M=3.28084;
/** NWS forecast points along the county's snow-removal routes (all in the Sierra foothills and mountains). */
export const SNOW_POINTS=Object.freeze([
  {id:'shaver',name:'Shaver Lake',latitude:37.105,longitude:-119.318},
  {id:'huntington',name:'Huntington Lake',latitude:37.233,longitude:-119.22},
  {id:'dunlap',name:'Dunlap',latitude:36.735,longitude:-119.12}
]);
export const SNOW_ROUTES_URL='https://gisprod10.co.fresno.ca.us/server/rest/services/Hosted/Snow_Removal/FeatureServer/0';
/** County priority codes (Hosted/Snow_Removal). Colours run hot for "at all times" to grey for other agencies / permits. */
export const ROUTE_PRIORITIES=Object.freeze({
  1:{label:'1 · At all times',color:'#ff5d5d',width:3.5},
  2:{label:'2 · As time permits',color:'#f5a524',width:3},
  3:{label:'3 · Emergencies only',color:'#ffd27a',width:2,style:'dash'},
  4:{label:'4 · All roads by May 1',color:'#b9a6ff',width:2,style:'dash'},
  10:{label:'10 · CSA contract',color:'#6fd3e0',width:2},
  9:{label:'9 · Permit (private)',color:'#a5a9ad',width:1.5,style:'dot'},
  11:{label:'11 · Caltrans',color:'#7f8890',width:1.5,style:'dot'}
});
/** @param {object} payload NWS gridpoint JSON @returns {{start:number,end:number,meters:number}[]} Snow-level steps; unparseable steps are dropped. */
export function snowLevels(payload){
  const p=payload?.properties?.snowLevel;
  if(p?.uom!=='wmoUnit:m'||!Array.isArray(p.values))throw new Error('NWS snow level units changed.');
  return p.values.flatMap(v=>{try{return Number.isFinite(v.value)?[{...forecastInterval(v.validTime),meters:v.value}]:[];}catch{return [];}});
}
/** @returns {number|null} Snow level (m) for the step containing time t; null outside the forecast. */
export const snowLevelAt=(steps,t)=>steps.find(s=>s.start<=t&&t<s.end)?.meters??null;
/** @returns {{low:number,high:number}|null} Range (m) over [from, to). */
export function snowRange(steps,from,to){
  const m=steps.filter(s=>s.end>from&&s.start<to).map(s=>s.meters);
  return m.length?{low:Math.min(...m),high:Math.max(...m)}:null;
}
export const feet=m=>Math.round(m*FT_PER_M/100)*100;
/** @param {string} text Forecast discussion @returns {string[]} Sentences that talk about snow (at most 5), whitespace collapsed. */
export function snowLines(text){
  const flat=String(text||'').replace(/\s+/g,' ');
  return flat.split(/(?<=[.!?])\s+(?=[A-Z])/).filter(s=>/\bsnow(fall| levels?| accumulations?)?\b|\bfreezing level/i.test(s)).map(s=>s.trim()).slice(0,5);
}
