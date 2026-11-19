// Source calendar dates encoded at UTC midnight must not move to the prior local day.
const date=value=>Number.isFinite(value)?new Intl.DateTimeFormat('en-US',{timeZone:'UTC',dateStyle:'medium'}).format(value):'Not supplied';

/** Reference outlines support rainfall review, not a current danger classification or partner decision matrix. */
export function contextRecords(data,now=Date.now()) {
 const checked=Date.parse(data?.generatedAt);
 if(data?.schemaVersion!==1||!Number.isFinite(checked)||checked>now+120000||!Array.isArray(data.cities?.features)||
  !Array.isArray(data.burnScars?.features)||data.burnScars.features.length>500)throw Error('Context schema or timestamp invalid');
 const old=now-checked>48*3600000;
 const sourceUrls=new Map((data.sources||[]).map(source=>[source.id,source.url]));
 const quality=(old?'Reference refresh overdue · ':'')+'Fire perimeter reference; not a current debris-flow hazard map';
 const features=data.burnScars.features.map(f=>({...f,properties:{...f.properties,kind:'burn-scar',color:'#cda986',
  hoverText:`${f.properties.name} · ${f.properties.year} burn perimeter\n${f.properties.geometryStatus}\nNot burn severity or an inundation boundary`}}));
 const common={kind:'burn-scar',group:3,review:false,time:checked,timeLabel:'Reference checked',quality,nextAction:'Review short-duration rainfall and NWS instructions; verify road, culvert and downstream conditions with responsible operators',evidence:[],revision:data.generatedAt};
 const rows=features.map(f=>{
  const p=f.properties,a=p.assessment;
  return {...common,id:p.id,name:`${p.name} · ${p.year} burn perimeter`,change:p.geometryStatus,features:[f],
   details:[`${p.publisher} · fire date ${date(p.discovered)} · ${p.geometryStatus==='Historical perimeter'?'containment date':'perimeter update'} ${date(p.updated)}`,
    'A perimeter is not burn severity, debris-flow runout, flood extent, or confirmation of current danger. Inventory coverage is incomplete.',
    'Six-hour/hourly rainfall cannot establish a 15-minute debris-flow trigger. Use current NWS guidance and qualified local review.',
    ...(a?[`USGS assessment ${date(a.issued)} · ${a.storm}. ${a.note}`]:['No linked USGS assessment is configured for this fire.']),
    ...(data.warnings||[])],
   links:[{label:`${p.publisher} perimeter source`,url:sourceUrls.get(p.source)||p.source},...(a?[{label:'Dated USGS assessment',url:a.source}]:[]),
    {label:'NWS Hanford',url:'https://www.weather.gov/hnx/'},
    {label:'USGS assessment limits',url:'https://www.usgs.gov/programs/landslide-hazards/hazard-assessment-faq-frequently-asked-questions'}]};
 });
 return [{...common,id:'burn-scars',name:'Recent burn scars & rainfall',change:features.length?`${features.length} recent mapped fire perimeters`:'No fire perimeters returned · coverage unassessed',features,
  details:['Recent county-intersecting fire perimeters from CAL FIRE and NIFC. Whole outlines may extend into neighboring counties.',
   'Historical and provisional perimeters are reference context. Fire year alone does not establish present debris-flow susceptibility.',
   'Basin and Garnet have different dated USGS assessment storms; do not compare them as one uniform rain scenario.',...(data.warnings||[])],
  links:(data.sources||[]).map(s=>({label:s.publisher+' source',url:s.url}))},...rows];
}
