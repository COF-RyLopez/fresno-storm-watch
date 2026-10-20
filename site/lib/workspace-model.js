/** Public presentation state only. Source freshness and review rules remain in their domain models. */
export const LAYER_LABELS=Object.freeze({areas:'Area review watchpoints',gauges:'River gauges',reservoirs:'Reservoirs',waterways:'Named waterways',weather:'Selected weather overlay',wind:'Wind forecast samples',alerts:'NWS alert polygons',power:'Power / PSPS',facilities:'Connected county assets',roads:'County roads',briefingLayers:'Selected live briefing layer',briefingContext:'Selected briefing context locations',fema:'FEMA reference',buildings:'Open 3D buildings',cameras:'Camera locations',powerHistory:'Reported restored / cancelled power',upstream:'Additional upstream gauges'});
export const WORKSPACES=Object.freeze({
  watch:{title:'Area Watch',panel:'watch-panel',scope:'fresno',layers:['areas','power'],description:'Review cues at configured watchpoints · not predicted inundation'},
  rivers:{title:'Rivers',panel:'river-panel',scope:'fresno',layers:['gauges','reservoirs','waterways'],description:'River observations and forecasts · fixed Fresno watchlist'},
  weather:{title:'Weather',panel:'environment-panel',scope:'weather',layers:['weather','wind'],description:'Observed weather and published forecasts · independent source times'},
  reservoirs:{title:'Reservoirs',panel:'reservoir-panel',scope:'fresno',layers:['reservoirs','gauges','waterways'],description:'Millerton / Pine Flat releases and connected downstream watchpoints'},
  alerts:{title:'Weather Alerts',panel:'weather-panel',scope:'regional',layers:['alerts'],description:'Official NWS products · Fresno, Madera, Merced, Kings and Tulare'},
  power:{title:'Power / PSPS',panel:'power-panel',scope:'fresno',layers:['power','facilities'],description:'Utility records and connected county sites · site power unconfirmed'},
  roads:{title:'Roads',panel:'roads-panel',scope:'fresno',layers:['roads'],description:'Official road records · verify status and safe access'}
});
/** @param {string|URL} input @returns {string} Preserve legacy weather and release-chart links. */
export function workspaceRoute(input){const u=new URL(input,'https://storm.invalid/');if(['MIL','PNF'].includes(u.searchParams.get('trends')))return 'reservoirs';const id=u.searchParams.get('view');return id==='conditions'||id==='environment'?'weather':WORKSPACES[id]?id:'watch';}
/** @param {string} id @returns {object} Independent, memory-only defaults. */
export function workspaceDefaults(id){return {mode:'2d',basemap:['rivers','reservoirs'].includes(id)?'waterways':'dark',imagery:false,cameras:false,viewpoint:null,layers:Object.fromEntries(Object.keys(LAYER_LABELS).map(k=>[k,WORKSPACES[id].layers.includes(k)]))};}
/** @param {object} state @param {string} key @param {boolean} eligible @returns {boolean} A refresh cannot enable a layer excluded by this workspace. */
export const layerVisible=(state,key,eligible=true)=>!!state.layers[key]&&!!eligible;
/** @returns {object} Independent mutable presentation state, held only in this page. */
export function workspaceMemory(){const states=new Map();let active=null;return {get:id=>{if(!WORKSPACES[id])throw new Error('Unknown workspace');if(!states.has(id))states.set(id,workspaceDefaults(id));return states.get(id);},activate:id=>{if(!WORKSPACES[id])throw new Error('Unknown workspace');active=id;},get active(){return active;}};}
/** @param {Map} checks @returns {object[]} Count an underlying check once, never once per area association. */
export const unhealthyChecks=checks=>[...checks.values()].filter(s=>s.status!=='current').sort((a,b)=>a.label.localeCompare(b.label));
