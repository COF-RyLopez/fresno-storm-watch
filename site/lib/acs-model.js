const base='https://P3ePLMYs2RVChkJx.svcs.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/';
const source=(id,name,title,universe,measures)=>Object.freeze({id,url:base+name+'_View_Boundaries/FeatureServer/2',item:'https://www.arcgis.com/home/item.html?id='+id,title,universe,measures});
export const ACS_SOURCES=Object.freeze({
  population:source('60c98f20a162416ea1725b94d7297f83','ACS_Population','Living Atlas ACS Population','All residents',[
    ['Total residents','B01001_001E','B01001_001M'],['Under 18','B01001_calc_numLT18E','B01001_calc_numLT18M'],['Age 65+','B01001_calc_numGE65E','B01001_calc_numGE65M']]),
  language:source('010edcaea4e446df901c6b556e3838c9','ACS_Specific_Language_Spoken_by_English_Ability','Language & English ability','People age 5+; language spoken at home',[
    ['Speaks English less than very well · all languages','C16001_calc_numLEAE','C16001_calc_numLEAM'],
    ...[['Spanish',5],['French, Haitian or Cajun',8],['German or other West Germanic languages',11],['Russian, Polish or other Slavic languages',14],['Other Indo-European languages',17],['Korean',20],['Chinese (incl. Mandarin, Cantonese)',23],['Vietnamese',26],['Tagalog (incl. Filipino)',29],['Other Asian and Pacific Island languages',32],['Arabic',35],['Other and unspecified languages',38]].map(([name,n])=>[name+' · English less than very well',`C16001_${String(n).padStart(3,'0')}E`,`C16001_${String(n).padStart(3,'0')}M`])]),
  internet:source('c32bd037d0e0405294d9e606c03ddb0e','ACS_Internet_Connectivity','Internet access','Households, not people',[
    ['No internet access','B28002_013E','B28002_013M'],['Cellular data plan only','B28002_006E','B28002_006M']]),
  disability:source('1997766755c4465c85dbbed1974438ee','ACS_Disability_Status','Accessibility context','Civilian noninstitutionalized population; excludes institutional care residents',[
    ['Residents with a disability','B18101_calc_numDE','B18101_calc_numDM']]),
  vehicles:source('458ceeeff7e847af8257ad5ce58e0161','ACS_Vehicle_Availability','Transportation context','Households, not people',[
    ['No vehicle available','B08201_002E','B08201_002M']])
});
export const PIO_GUIDANCE=Object.freeze({
  communication:'https://www.caloes.ca.gov/office-of-the-director/policy-administration/access-functional-needs/communication/',
  templates:'https://calalerts.org/resources.html'
});
export function acsFields(key){return ['GEOID','NAME',...(key==='population'?['ALAND']:[]),...new Set(ACS_SOURCES[key].measures.flatMap(m=>m.slice(1)))];}
export function acsPeriod(description){
  const text=String(description||'').replace(/<[^>]*>/g,' ').replace(/&nbsp;/g,' ').replace(/\s+/g,' '),matches=[...text.matchAll(/Current Vintage\s*:\s*(20\d{2})\s*[-–]\s*(20\d{2})/g)];
  if(matches.length!==1||Number(matches[0][2])-Number(matches[0][1])!==4)throw Error('ACS five-year period could not be verified from publisher metadata.');
  return matches[0][1]+'–'+matches[0][2];
}
function acsNumber(value){return typeof value==='number'&&Number.isFinite(value)&&value>=0?value:null;}
export function acsMeasure(attributes,estimate,moe){return {estimate:acsNumber(attributes[estimate]),moe:acsNumber(attributes[moe])};}
const format=v=>new Intl.NumberFormat('en-US',{maximumFractionDigits:1}).format(v);
export function formatAcsMeasure({estimate,moe}){return estimate===null?'Unavailable':format(estimate)+(moe===null?' · MOE unavailable':' ± '+format(moe));}
export function normalizeAcs(feature,key){
  const a=feature.attributes||{},id=String(a.GEOID||'');if(!/^06019\d{6}$/.test(id))throw Error('ACS record is not a Fresno County tract.');
  return {id,name:typeof a.NAME==='string'?a.NAME:'Census tract '+id,geometry:feature.geometry||null,measures:ACS_SOURCES[key].measures.map(([label,e,m])=>({label,...acsMeasure(a,e,m)}))};
}
export const ACS_DENSITY_EXPRESSION="var p = $feature.B01001_001E; var a = $feature.ALAND; if (IsEmpty(p) || IsEmpty(a) || p < 0 || a <= 0) { return null; } return p / (a / 2589988.110336);";
export const ACS_LIMIT='Whole-tract five-year estimates, not evacuation-zone totals or current occupancy. ± is the publisher’s 90% margin of error (MOE); it does not cover every source of error. Do not add these groups together or attach their MOEs to the separate 2020 zone estimate.';
