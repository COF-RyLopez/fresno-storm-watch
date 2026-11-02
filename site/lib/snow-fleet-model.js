/** Snow fleet (County plows and blowers) from the Samsara collector's public snapshot. Samsara's own shape never reaches the
 * browser: the collector writes this schema, and validateFleet rebuilds every record from allowed fields only, so a driver
 * name or odometer that slipped into the file is never shown. Positions are at least delayMinutes old by contract. */
export const FLEET_TYPES=Object.freeze({'plow-truck':'Plow truck','snow-blower':'Snow blower',sander:'Sander',grader:'Grader',loader:'Loader','plow-attachment':'Plow attachment'});
export const FLEET_STATUS=Object.freeze({
  working:{label:'Working',color:'#2ecc71'},traveling:{label:'Traveling',color:'#4aa3ff'},idle:{label:'Idle (engine on)',color:'#f5c542'},
  parked:{label:'Parked',color:'#a5a9ad'},'in-shop':{label:'In shop for repair',color:'#ff7a59'},off:{label:'Engine off',color:'#6b7378'},unknown:{label:'Unknown',color:'#a5a9ad'}});
/** "Plow truck 43102": equipment type and County equipment ID, for sentences and popup titles. */
export const unitName=v=>`${FLEET_TYPES[v.type]||'Unit'} ${v.id}`;
/** Repair priority: a plow back from the shop clears the most road, then blowers, then the rest. */
const TYPE_ORDER=['plow-truck','snow-blower','sander','grader','loader','plow-attachment'];
const BOUNDS={west:-121,east:-118,south:35.8,north:37.6};
const MIN_DELAY=15;
const iso=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))?v:null;
const count=v=>Number.isInteger(v)&&v>=0?v:null;
const inCounty=(lon,lat)=>Number.isFinite(lon)&&Number.isFinite(lat)&&lon>=BOUNDS.west&&lon<=BOUNDS.east&&lat>=BOUNDS.south&&lat<=BOUNDS.north;

/** @param {object} data snapshot @returns {object} Clean copy; throws when the file as a whole cannot be trusted.
 * A vehicle whose position is newer than the published delay keeps its status but loses its position (tooRecent). */
export function validateFleet(data){
  if(data?.schemaVersion!==1)throw Error('Snow fleet file has an unknown schema version.');
  const generated=Date.parse(data.generatedAt);if(!Number.isFinite(generated))throw Error('Snow fleet file has no valid generation time.');
  const delayMinutes=Number(data.delayMinutes);if(!(delayMinutes>=MIN_DELAY))throw Error(`Snow fleet positions must be delayed at least ${MIN_DELAY} minutes.`);
  if(data.error&&!Array.isArray(data.vehicles))return {generatedAt:data.generatedAt,delayMinutes,source:String(data.source||''),vehicles:[],routes:[],accounting:{},error:String(data.error),sample:!!data.sample,tooRecent:0};
  if(!Array.isArray(data.vehicles)||!Array.isArray(data.routes||[]))throw Error('Snow fleet file is missing its vehicle list.');
  const latest=generated-delayMinutes*60000+60000;let tooRecent=0;const ids=new Set();
  const vehicles=data.vehicles.map(v=>{
    // id is the County equipment ID as a string ("03107" keeps its leading zero; 03107 and 3107 are different units).
    if(typeof v?.id!=='string'||!/^[A-Za-z0-9][\w .-]{0,30}$/.test(v.id))throw Error('A snow fleet vehicle has no equipment ID.');
    if(ids.has(v.id))throw Error(`Duplicate snow fleet vehicle ${v.id}.`);ids.add(v.id);
    if(!FLEET_TYPES[v.type])throw Error(`${v.id} has an unknown equipment type.`);
    if(!FLEET_STATUS[v.status])throw Error(`${v.id} has an unknown status.`);
    const seen=iso(v.seen);let lon=Number(v.lon),lat=Number(v.lat);
    if(seen&&Date.parse(seen)>latest){tooRecent++;lon=lat=NaN;}
    const placed=seen&&inCounty(lon,lat);
    const trail=placed&&Array.isArray(v.trail)?v.trail.filter(p=>Array.isArray(p)&&inCounty(Number(p[0]),Number(p[1]))&&iso(p[2])&&Date.parse(p[2])<=latest).map(p=>[Number(p[0]),Number(p[1]),p[2]]):[];
    return {id:v.id,type:v.type,status:v.status,statusBasis:typeof v.statusBasis==='string'?v.statusBasis:'',yard:typeof v.yard==='string'?v.yard:null,seen,
      lon:placed?lon:null,lat:placed?lat:null,heading:Number.isFinite(Number(v.heading))&&v.heading!==null?Number(v.heading):null,
      onRoute:typeof v.onRoute==='string'?v.onRoute:null,expectedBack:iso(v.expectedBack),trail};
  });
  const routes=(data.routes||[]).filter(r=>typeof r?.name==='string').map(r=>({name:r.name,priority:Number.isFinite(Number(r.priority))?Number(r.priority):null,lastPass:iso(r.lastPass),passes6h:count(r.passes6h)??0,by:typeof r.by==='string'?r.by:null}));
  const a=data.accounting||{},accounting=Object.fromEntries(['read','published','available','inShop','noGps'].map(k=>[k,count(a[k])]));
  return {generatedAt:data.generatedAt,delayMinutes,source:String(data.source||'Samsara (County fleet)'),vehicles,routes,accounting,error:data.error?String(data.error):null,sample:!!data.sample,tooRecent};
}

/** @returns {{available:number,inShop:number,notReporting:number|null,byType:object[]}} Available = reporting and not in the shop.
 * Units with no GPS are not reporting: their condition is unknown, not available. */
export function fleetSummary(fleet){
  const v=fleet?.vehicles||[],inShop=v.filter(x=>x.status==='in-shop').length;
  const byType=TYPE_ORDER.map(type=>({type,label:FLEET_TYPES[type],available:v.filter(x=>x.type===type&&x.status!=='in-shop').length,inShop:v.filter(x=>x.type===type&&x.status==='in-shop').length})).filter(t=>t.available+t.inShop);
  return {available:v.length-inShop,inShop,notReporting:fleet?.accounting?.noGps??null,byType};
}

/** @returns {object[]} In-shop units in repair-priority order: plows first, then by expected return (unknown last). */
export function repairPriority(fleet){
  const back=v=>v.expectedBack?Date.parse(v.expectedBack):Infinity;
  return (fleet?.vehicles||[]).filter(v=>v.status==='in-shop').sort((a,b)=>TYPE_ORDER.indexOf(a.type)-TYPE_ORDER.indexOf(b.type)||back(a)-back(b)||a.id.localeCompare(b.id,undefined,{numeric:true}));
}

/** @returns {'fresh'|'recent'|'stale'|'none'} Time since any snow unit last passed along a route. */
export function passTone(lastPass,now=Date.now()){
  const t=Date.parse(lastPass);if(!Number.isFinite(t))return 'none';
  const h=(now-t)/3600000;return h<2?'fresh':h<6?'recent':'stale';
}
export const PASS_TONES=Object.freeze({fresh:{label:'Passed under 2 h ago',color:'#2ecc71'},recent:{label:'2–6 h ago',color:'#f5c542'},stale:{label:'Over 6 h ago',color:'#ff7a59'}});

/** @returns {object[]} High-priority routes (County priority 1–2) with no pass in `hours`: where a plow is needed next. */
export function needsPass(routes,now=Date.now(),{priorities=[1,2],hours=6}={}){
  return (routes||[]).filter(r=>priorities.includes(r.priority)&&!(Date.parse(r.lastPass)>now-hours*3600000))
    .sort((a,b)=>a.priority-b.priority||(Date.parse(a.lastPass)||0)-(Date.parse(b.lastPass)||0)||a.name.localeCompare(b.name));
}

/** Arcade that colours County snow-route segments by their route's last pass. Names are data, so they are quoted safely. */
export function passExpression(routes,now=Date.now()){
  const pairs=(routes||[]).filter(r=>passTone(r.lastPass,now)!=='none').flatMap(r=>[JSON.stringify(r.name),JSON.stringify(passTone(r.lastPass,now))]);
  return pairs.length?`Decode($feature.name, ${pairs.join(', ')}, 'none')`:null;
}
