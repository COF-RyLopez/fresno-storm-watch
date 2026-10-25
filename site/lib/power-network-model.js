/** Public planning references. Identifier agreement never establishes a fault or energized state. */
export const NETWORK_MAX_AGE=72*3600000;
const PGE='https://services2.arcgis.com/mJaJSax0KPHoCNB6/arcgis/rest/services/DRPComplianceRelProd/FeatureServer/';
const SCE='https://drpep.sce.com/arcgis_server/rest/services/Hosted/';
export const NETWORK_SOURCES=Object.freeze([
  {id:'pge-circuits',utility:'PG&E',kind:'circuit',label:'PG&E distribution feeder lines',url:PGE+'2',fields:'OBJECTID,FeederID,Feeder_Name,Substation,Nominal_Voltage,Last_Update_On_Map'},
  {id:'pge-lines',utility:'PG&E',kind:'line',label:'PG&E transmission lines',url:PGE+'5',fields:'OBJECTID,SAP_FUNC_LOC_NO,TLINE_NAME,RATEDKV,Last_Update_On_Map'},
  {id:'pge-substations',utility:'PG&E',kind:'substation',label:'PG&E distribution substations',url:PGE+'0',fields:'OBJECTID,SubstationID,SubstationName,Voltage_kV,REDACTED,Last_Update_On_Map'},
  {id:'pge-transmission-substations',utility:'PG&E',kind:'substation',label:'PG&E transmission substations',url:PGE+'1',fields:'OBJECTID,substation_name,substation_id,voltage_kv'},
  {id:'sce-circuits',utility:'SCE',kind:'circuit',label:'SCE distribution circuit lines',url:SCE+'Distribution_circuits/FeatureServer/0',fields:'objectid,circuit_id,circuit_no,circt_nam,circuit_voltage,sub_name,note'},
  {id:'sce-lines',utility:'SCE',kind:'line',label:'SCE transmission circuits',url:SCE+'ICA_Layer/FeatureServer/19',fields:'objectid,circuit_id,circuit_no,circuit_type_desc,circuit_voltage'},
  {id:'sce-substations',utility:'SCE',kind:'substation',label:'SCE substations',url:SCE+'ICA_Layer/FeatureServer/18',fields:'objectid,subst_id,sub_name,substation_voltage,note'}
]);
export const NETWORK_LAYER_KEYS={circuit:'powerCircuits',line:'powerLines',substation:'powerSubstations'};
export const NETWORK_SCALES=Object.freeze({circuit:75000,line:250000,substation:250000});
const text=v=>v===null||v===undefined?'':String(v).trim().slice(0,1000);
export const networkIdentifier=v=>text(v).normalize('NFKC').replace(/\s+/g,' ').toUpperCase();
const validPoint=p=>Array.isArray(p)&&p.length>=2&&Number.isFinite(p[0])&&Number.isFinite(p[1])&&Math.abs(p[0])<=180&&Math.abs(p[1])<=90;
/** Validate display geometry; no rounding, repair, snapping or topology inference in the browser. */
export function networkGeometry(g){
  if((g?.spatialReference?.latestWkid||g?.spatialReference?.wkid)!==4326)throw Error('Utility network CRS must be WGS84.');
  if(validPoint([g.x,g.y]))return {x:g.x,y:g.y,spatialReference:{wkid:4326}};
  if(!Array.isArray(g.paths)||!g.paths.length||g.paths.some(p=>p.length<2||p.some(v=>!validPoint(v))))throw Error('Utility network geometry is incomplete.');
  return {paths:g.paths.map(p=>p.map(v=>v.slice(0,2))),spatialReference:{wkid:4326}};
}
/** Keep only the public identifiers needed by the map; customer/engineering capacity fields are omitted. */
export function normalizeNetworkFeature(f,spec,oid){
  const a=f.attributes||{},id=a[oid];if(!Number.isSafeInteger(id)||id<0)throw Error('Utility reference identity is invalid.');
  const pge=spec.utility==='PG&E',station=spec.kind==='substation';
  const code=text(station?(pge?(a.SubstationID??a.substation_id):a.subst_id):(pge?(a.FeederID??a.SAP_FUNC_LOC_NO):a.circuit_id));
  const name=text(station?(pge?(a.SubstationName??a.substation_name):a.sub_name):(pge?(a.Feeder_Name||a.TLINE_NAME):a.circt_nam));
  return {key:spec.id+':'+id,sourceId:spec.id,utility:spec.utility,kind:spec.kind,code,name:name||code||spec.label,matchName:name,number:text(a.circuit_no),substation:text(station?name:(pge?a.Substation:a.sub_name)),voltage:text(a.Nominal_Voltage??a.Voltage_kV??a.circuit_voltage??a.substation_voltage??a.voltage_kv??a.RATEDKV),note:text(a.note||(a.REDACTED?'Publisher redaction flag: '+a.REDACTED:'')),published:typeof a.Last_Update_On_Map==='number'&&Number.isFinite(new Date(a.Last_Update_On_Map).getTime())?new Date(a.Last_Update_On_Map).toISOString():text(a.Last_Update_On_Map),geometry:networkGeometry(f.geometry)};
}
/** Reject mixed sources, duplicated records, partial inventories and malformed cached geometry. */
export function validateNetworkSnapshot(data){
  if(data?.schemaVersion!==1||data.scope!=='Fresno County 06019; whole intersecting features'||!Number.isFinite(Date.parse(data.generatedAt))||data.sources?.length!==NETWORK_SOURCES.length)throw Error('Utility network snapshot is invalid.');
  const allKeys=new Set();let vertices=0;
  for(const spec of NETWORK_SOURCES){
    const list=data.sources.filter(s=>s.id===spec.id);if(list.length!==1)throw Error('Utility network sources are incomplete.');const s=list[0];
    if(s.url!==spec.url||!Array.isArray(s.features)||s.features.length>5000||s.lastSuccess!==null&&!Number.isFinite(Date.parse(s.lastSuccess))||s.lastSuccess&&s.accounting?.returned!==s.features.length||s.lastSuccess&&s.accounting?.selected!==s.features.length)throw Error('Utility network accounting is incomplete.');
    for(const f of s.features){if(allKeys.has(f.key)||f.sourceId!==s.id||f.utility!==spec.utility||f.kind!==spec.kind||!f.key.startsWith(s.id+':')||['name','matchName','code','number','substation','voltage','note','published'].some(k=>typeof f[k]!=='string'||f[k].length>1000))throw Error('Utility network feature contract is invalid.');allKeys.add(f.key);const g=networkGeometry(f.geometry);if((spec.kind==='substation')!==!g.paths)throw Error('Utility network feature type changed.');vertices+=g.paths?.reduce((n,p)=>n+p.length,0)||1;}
  }
  if(vertices>1500000)throw Error('Utility network exceeds the display budget.');return data;
}
/** Retrieval health is separate from the publication date of planning data. */
export function networkSourceProblem(s,now=Date.now()){
  if(!s?.lastSuccess)return 'No successful reference check';if(s.error)return 'Reference check failed; retained data';const age=now-Date.parse(s.lastSuccess);return age< -120000?'Reference check time is in the future':age>NETWORK_MAX_AGE?'Reference check overdue; retained data':null;
}
/** Exact utility + publisher field match only. Names/numbers are not padded, truncated or guessed from geometry. */
export function matchPowerCircuit(row,snapshot,now=Date.now()){
  const none=(reason,state='unverified')=>({state,reason,circuits:[],substations:[],sourceField:row?.networkCircuit?.sourceField||'',value:row?.networkCircuit?.value||''});
  if(!snapshot)return none('Network reference is not loaded.','unavailable');
  if(row.health)return none('The outage / PSPS source check failed or is overdue. Verify with the utility.');
  if(row.issues?.some(s=>s.startsWith('Source representations differ')))return none('Utility representations disagree; verify the circuit with the utility.');
  const ref=row.networkCircuit;
  const approved=row.utility==='SCE'&&(row.kind==='sce-outage'&&ref?.type==='number'&&ref.sourceField==='Circuit_Number'||row.kind==='sce-psps'&&ref?.type==='name'&&ref.sourceField==='CIRCUIT_NAME');
  if(!approved||!networkIdentifier(ref.value))return none('This utility record supplies no supported circuit identifier. Nearby lines are reference context only.');
  const source=snapshot.sources.find(s=>s.id===(row.utility==='SCE'?'sce-circuits':'pge-circuits'));
  if(networkSourceProblem(source,now))return none('Circuit reference is unavailable, failed or overdue.','unavailable');
  const field=ref.type==='number'?'number':'matchName',value=networkIdentifier(ref.value);
  const found=source.features.filter(f=>f.utility===row.utility&&networkIdentifier(f[field])===value);
  const codes=new Set(found.map(f=>f.code));
  if(!found.length)return none('No exact circuit match in the Fresno reference coverage.');
  if(codes.size!==1||codes.has(''))return none('The published circuit value is ambiguous; no verified association is shown.');
  if(source.features.some(f=>f.code===found[0].code&&networkIdentifier(f[field])!==value))return none('Reference records disagree on the circuit identifier; verify with the utility.');
  if(new Set(found.map(f=>networkIdentifier(f.substation))).size>1)return none('Circuit records disagree on their substation; verify with the utility.');
  const stationSource=snapshot.sources.find(s=>s.id===(row.utility==='SCE'?'sce-substations':'pge-substations'));
  const stationName=networkIdentifier(found[0].substation),stations=!networkSourceProblem(stationSource,now)&&stationName?stationSource.features.filter(f=>f.utility===row.utility&&networkIdentifier(f.matchName)===stationName):[];
  const stationIds=new Set(stations.map(f=>f.code));if(new Set(stations.map(f=>JSON.stringify(f.geometry))).size>1)stationIds.add('ambiguous-location');
  return {state:'matched',reason:`Verified ${ref.type==='number'?'circuit-number':'circuit-name'} match in utility publications. This does not establish a fault, live switching or the full de-energized extent.`,sourceField:ref.sourceField,value:ref.value,circuits:found,substations:stationIds.size===1&&!stationIds.has('')?stations:[],stationNote:stations.length&&stationIds.size!==1?'Substation name is ambiguous.':!stations.length?'Associated substation point is not verified in this county reference.':''};
}
/** Violet identifies electrical infrastructure; weight identifies line type, not capacity or operating state. */
export function networkSymbol(f,{highlight=false,selected=false,stale=false,dark=true}={}){
  const color=highlight?(dark?'#82e6c3':'#00795d'):stale?(dark?'#a5afb8':'#67737c'):(dark?'#d6a6ff':'#7931ad');
  if(f.kind==='substation'){
    // A hexagonal station badge is distinct from outage squares, asset diamonds and gauge circles.
    const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28"><path d="M8 3h12l6 11-6 11H8L2 14Z" fill="${dark?'#241b31':'#faf5ff'}" stroke="${color}" stroke-width="2.5"${stale?' stroke-dasharray="3 2"':''}/><path d="m16 6-7 10h5l-2 6 8-11h-5Z" fill="${color}"/></svg>`;
    return {type:'picture-marker',url:'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg),width:22,height:22};
  }
  return {type:'simple-line',color,width:highlight?4:selected?3.5:f.kind==='line'?2.7:1.5,style:stale?'dot':f.utility==='SCE'?'dash':'solid'};
}
