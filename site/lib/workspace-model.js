/** Public presentation state only. Source freshness and review rules remain in their domain models. */
export const LAYER_LABELS=Object.freeze({populationDensity:'Living Atlas ACS tract density · residents/land sq mi',populationZones:'Selected evacuation zone & optional 2020 blocks',countySandbags:'County sandbag sites · stock / access unconfirmed',dwrSupplyContext:'Selected DWR supply & watchpoints · proximity only',dwrFloodFight:'DWR flood-fight resources · Fresno',care:'Resident-care comparison',evacuations:'County evacuation status · issue times unavailable',areas:'Area review watchpoints',riverNetwork:'River network & surges · illustrative travel',gauges:'River gauges',reservoirs:'Reservoirs',waterways:'Named waterways',weather:'Selected weather overlay',wind:'NWS wind forecast samples',hrrr:'HRRR animated winds / gusts',alerts:'NWS alert polygons',power:'Power / PSPS',powerCircuits:'Utility distribution circuit lines · reference',powerLines:'Utility transmission lines · reference',powerSubstations:'Utility substations · state unknown',facilities:'Connected county assets',drainage:'FMFCD existing basins / pumps · private',drainageProposed:'FMFCD proposed / future · private',drainageOther:'FMFCD other / unclassified · private',drainageCatchments:'FMFCD drainage boundaries · private',drainageAreas:'FMFCD drainage areas · public reference',drainageNetwork:'Nearby FMFCD mapped drainage',drainageNetworkUnknown:'Nearby FMFCD classification unconfirmed',drainageNetworkPlanned:'Nearby FMFCD proposed / design',roads:'County roads',briefingLayers:'Selected live briefing layer',briefingContext:'Selected briefing context locations',fema:'FEMA reference',buildings:'Open 3D buildings',cameras:'Camera locations',powerHistory:'Reported restored / cancelled power',upstream:'Additional upstream gauges'});
export const WORKSPACES=Object.freeze({
  storm:{title:'Storm now',panel:'storm-panel',scope:'fresno',layers:['alerts','areas','gauges','roads','drainage','drainageAreas','weather','riverNetwork']},
  watch:{title:'County Watch',panel:'watch-panel',scope:'fresno',layers:['areas','power','care','countySandbags']},
  rivers:{title:'Rivers',panel:'river-panel',scope:'fresno',layers:['gauges','reservoirs','waterways','riverNetwork']},
  weather:{title:'Weather',panel:'environment-panel',scope:'weather',layers:['weather','wind','hrrr']},
  reservoirs:{title:'Reservoirs',panel:'reservoir-panel',scope:'fresno',layers:['reservoirs','gauges','waterways']},
  alerts:{title:'Weather Alerts',panel:'weather-panel',scope:'regional',layers:['alerts']},
  power:{title:'Power / PSPS',panel:'power-panel',scope:'fresno',layers:['power','facilities','powerCircuits','powerLines','powerSubstations']},
  drainage:{title:'Drainage · private',panel:'drainage-panel',scope:'fresno',layers:['drainage','weather','roads','facilities']},
  roads:{title:'Roads',panel:'roads-panel',scope:'fresno',layers:['roads']}
});
/** @param {string|URL} input @returns {string} Preserve legacy weather, release-chart and County Watch links. */
export function workspaceRoute(input){const u=new URL(input,'https://storm.invalid/');if(['MIL','PNF'].includes(u.searchParams.get('trends')))return 'reservoirs';const id=u.searchParams.get('view');if(id==='conditions'||id==='environment')return 'weather';if(WORKSPACES[id])return id;
  // Storm now is the first view. Sandbag / DWR supply / resident-care links (app.js relies on it) and
  // Planning / Briefing mission links keep County Watch underneath, as before.
  return ['sandbags','dwrSupplies','care'].some(k=>u.searchParams.get(k)==='1')||['scenarios','briefing'].includes(u.searchParams.get('mission'))?'watch':'storm';}
/** @param {string} id @returns {object} Independent, memory-only defaults. */
export function workspaceDefaults(id){return {mode:id==='power'?'3d':'2d',basemap:['rivers','reservoirs'].includes(id)?'waterways':'dark',imagery:false,cameras:false,viewpoint:null,layers:Object.fromEntries(Object.keys(LAYER_LABELS).map(k=>[k,WORKSPACES[id].layers.includes(k)]))};}
/** @param {object} state @param {string} key @param {boolean} eligible @returns {boolean} A refresh cannot enable a layer excluded by this workspace. */
export const layerVisible=(state,key,eligible=true)=>!!state.layers[key]&&!!eligible;
/** @returns {object} Independent mutable presentation state, held only in this page. */
export function workspaceMemory(){const states=new Map();let active=null;return {get:id=>{if(!WORKSPACES[id])throw new Error('Unknown workspace');if(!states.has(id))states.set(id,workspaceDefaults(id));return states.get(id);},activate:id=>{if(!WORKSPACES[id])throw new Error('Unknown workspace');active=id;},get active(){return active;}};}
