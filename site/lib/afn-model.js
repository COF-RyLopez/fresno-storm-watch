import {acsMeasure as measure} from './acs-model.js';

/** Fixed public endpoints. Every value is whole-geography context; nothing here is allocated to a zone. */
export const AFN_SOURCES=Object.freeze({
  puma:Object.freeze({url:'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_ACS2024/MapServer/0',where:"STATE = '06' AND GEOID LIKE '06019%'",fields:['GEOID','NAME'],limit:20}),
  svi:Object.freeze({url:'https://services3.arcgis.com/ZvidGQkLaDJxRSJ2/arcgis/rest/services/CDC_ATSDR_Social_Vulnerability_Index_2022_USA/FeatureServer/2',item:'https://www.arcgis.com/home/item.html?id=414c0b43a0ec4adc829d5815bc621750',where:"STCNTY = '06019'",fields:['FIPS','RPL_THEMES','RPL_THEME2','E_LIMENG','M_LIMENG'],limit:500}),
  ces:Object.freeze({url:'https://services1.arcgis.com/PCHfdHz4GlDNAhBb/arcgis/rest/services/CalEnviroScreen_4_0_Results_/FeatureServer/0',item:'https://www.arcgis.com/home/item.html?id=b6e0a01c423b489f8d98af641445da28',where:'tract >= 6019000000 AND tract < 6020000000',fields:['tract','CIscoreP','lingP'],limit:500}),
  sb535:Object.freeze({url:'https://services1.arcgis.com/PCHfdHz4GlDNAhBb/arcgis/rest/services/SB535_DACupdate20232024/FeatureServer/1',item:'https://www.arcgis.com/home/item.html?id=15b93bb7650943dab83038359b6240ec',where:"County = 'Fresno'",fields:['Tract','DAC_category'],limit:500}),
  // Phone, licensee and address fields are never requested.
  ccl:Object.freeze({url:'https://services.arcgis.com/XLPEppdz2H9dOiqp/arcgis/rest/services/CDSS_CCL_Facilities/FeatureServer/0',item:'https://www.arcgis.com/home/item.html?id=db31b0884a074cff9260facb3f2ade45',where:"COUNTY = 'Fresno County' AND PROGRAM_TYPE = 'ADULT AND SENIOR'",fields:['ObjectId','FAC_NBR','NAME','FAC_TYPE_DESC','STATUS','CAPACITY','RES_CITY'],limit:1000}),
  b16001:'https://www.census.gov/acs/www/data/data-tables-and-tools/subject-tables/',
  cclSearch:'https://www.ccld.dss.ca.gov/carefacilitysearch/'
});
/** B16001 line numbers: population 5+, Punjabi, Hmong, and each language's "speaks English less than very well". */
export const B16001=Object.freeze({age5:'001',punjabi:'054',punjabiLep:'056',hmong:'084',hmongLep:'086'});
export const AFN_LIMIT='Whole-area context for places that intersect the selected zone, not zone totals, current occupancy or individual needs. Language counts are Census PUMAs (about 100,000+ residents each); SVI uses 2020 tracts and ACS 2018–2022; CalEnviroScreen 4.0 and SB 535 use 2010 tracts. Do not add, average or compare these across sources.';
export const CCL_LIMIT='CDSS licensed capacity, not current residents, occupancy or transport need. CDSS publishes status as an undocumented numeric code, so records are shown by code and capacity is never added across codes. Confirm a facility’s license with the CDSS facility search.';

const tract=(v,digits=11)=>{const id=String(v??'').padStart(digits,'0');return /^06019\d{6}$/.test(id)?id:null;};
const percentile=(v,scale)=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=scale?v/scale:null;

export function validateLanguageAreas(d){
  if(d?.schemaVersion!==1||d.table!=='B16001'||!/^20\d{2}–20\d{2}$/.test(d.period||'')||!Array.isArray(d.rows)||d.rows.length<1||d.rows.length>20)throw Error('Language reference is invalid.');
  const seen=new Set();
  for(const r of d.rows){
    if(!/^06019\d{2}$/.test(r.puma)||seen.has(r.puma))throw Error('Language reference has a duplicate or outside-county PUMA.');seen.add(r.puma);
    for(const key of Object.keys(B16001)){const m=r[key];if(!m||[m.estimate,m.moe].some(v=>v!==null&&!(Number.isFinite(v)&&v>=0)))throw Error('Language reference value is invalid.');}
    if(r.age5.estimate===null||[r.hmong,r.punjabi].some(m=>m.estimate!==null&&m.estimate>r.age5.estimate))throw Error('Language reference totals are inconsistent.');
  }
  return d;
}
export function normalizePuma(f){const a=f.attributes||{};if(!/^06019\d{2}$/.test(a.GEOID||''))throw Error('PUMA is not in Fresno County.');return {id:a.GEOID,name:String(a.NAME||'PUMA '+a.GEOID)};}
// SVI uses -999 for unavailable; percentiles are 0–1.
export function normalizeSvi(f){const a=f.attributes||{},id=tract(a.FIPS);if(!id)throw Error('SVI record is not a Fresno County tract.');return {id,overall:percentile(a.RPL_THEMES,1),household:percentile(a.RPL_THEME2,1),limitedEnglish:measure(a,'E_LIMENG','M_LIMENG')};}
// CalEnviroScreen stores the 2010 tract as a 10-digit number without the leading zero; percentiles are 0–100.
export function normalizeCes(f){const a=f.attributes||{},id=tract(a.tract);if(!id)throw Error('CalEnviroScreen record is not a Fresno County tract.');return {id,overall:percentile(a.CIscoreP,100),linguistic:percentile(a.lingP,100)};}
export function normalizeDac(f){const a=f.attributes||{},id=tract(a.Tract);if(!id||!String(a.DAC_category||'').trim())throw Error('SB 535 record is not a designated Fresno County tract.');return {id,category:a.DAC_category.trim()};}
export function normalizeCcl(f){
  const a=f.attributes||{};if(!Number.isInteger(a.ObjectId)||!String(a.NAME||'').trim())throw Error('Invalid CDSS facility record.');
  return {key:'ccl:'+a.ObjectId,number:String(a.FAC_NBR??''),name:a.NAME.trim(),type:String(a.FAC_TYPE_DESC||'Not supplied').trim(),status:Number.isInteger(a.STATUS)?a.STATUS:null,capacity:Number.isInteger(a.CAPACITY)&&a.CAPACITY>=0?a.CAPACITY:null,city:String(a.RES_CITY||'').trim()};
}

/** Count and range only. Percentiles describe tracts; averaging them would not describe the zone. */
export function summarizePercentiles(rows,field,threshold=.75){
  const known=rows.map(r=>r[field]).filter(v=>v!==null);
  return {tracts:rows.length,known:known.length,atLeast:known.filter(v=>v>=threshold).length,max:known.length?Math.max(...known):null};
}
/** One row per facility type and status code; capacity unknown when any record lacks it. */
export function summarizeFacilities(rows){
  const groups=new Map();
  for(const r of rows){const k=r.type+'\u0000'+r.status,g=groups.get(k)||{type:r.type,status:r.status,facilities:0,capacity:0};g.facilities++;g.capacity=g.capacity===null||r.capacity===null?null:g.capacity+r.capacity;groups.set(k,g);}
  return [...groups.values()].sort((a,b)=>a.type.localeCompare(b.type)||(a.status??99)-(b.status??99));
}
const ordinal=new Intl.PluralRules('en-US',{type:'ordinal'}),suffix={one:'st',two:'nd',few:'rd',other:'th'};
export const formatPercentile=v=>{if(v===null)return 'Unavailable';const n=Math.round(v*100);return n+suffix[ordinal.select(n)]+' percentile';};
