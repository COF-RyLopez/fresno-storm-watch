import {powerGeometry} from './power-geometry.js';
import {ACS_SOURCES} from './acs-model.js?v=0.65.0-r1';

export const POPULATION_SOURCES=Object.freeze({
  blocksItem:'https://www.arcgis.com/home/item.html?id=903453c84ade4f11aa3bce393af172d3',
  countyWebMap:'https://www.arcgis.com/home/item.html?id=b60b27d16eac4a078c406030abd267ad',
  blocks:'https://services.arcgis.com/P3ePLMYs2RVChkJx/ArcGIS/rest/services/California_Census_2020_Redistricting_Blocks/FeatureServer/0',
  acs:ACS_SOURCES.population.url,
  acsItem:ACS_SOURCES.population.item,
  countyMap:'https://cofgisonline.maps.arcgis.com/apps/webappviewer/index.html?id=22c8df4e3d854b39bbbf36b8042ba08d'
});
export const POPULATION_METHOD='2020 Census block population × fraction of each block polygon inside the selected county zone, measured with geodetic square-metre areas. Boundary blocks assume evenly distributed residents, including across water; this can be inaccurate, especially in large rural blocks.';
export const POPULATION_LIMIT='Baseline residents, not people currently present, evacuees, confirmed impacts or shelter demand. The estimate is not an official Census zone count or a statistical confidence interval. No population is assigned to individual buildings.';

/** Keep missing/suppressed population distinct from an observed zero. */
export function normalizePopulationFeature(feature){
  const a=feature.attributes||{},id=String(a.GEOID??''),raw=a.P0010001;
  if(!/^06019\d{10}$/.test(id))throw Error('Population geography is not a Fresno County census record.');
  const population=typeof raw==='number'&&Number.isFinite(raw)&&raw>=0&&Number.isInteger(raw)?raw:null;
  const geometry=powerGeometry(feature.geometry);if(!geometry.rings)throw Error('Census polygon missing.');
  return {id,population,geometry};
}

/** Summarize positive-area overlaps once per GEOID; never sum whole intersecting tracts as zone population. */
export function summarizePopulation(shares){
  const seen=new Map();let weighted=0,wholePopulation=0,boundaryPopulation=0,wholeBlocks=0,boundaryBlocks=0,missing=0;
  for(const r of shares){
    if(typeof r.id!=='string'||!r.id||!Number.isFinite(r.fraction)||r.fraction<0||r.fraction>1.000001)throw Error('Invalid census overlap fraction.');
    if(r.population!==null&&(!Number.isInteger(r.population)||r.population<0))throw Error('Invalid population count.');
    const value={population:r.population,fraction:Math.min(1,r.fraction)};
    if(seen.has(r.id)){if(JSON.stringify(seen.get(r.id))!==JSON.stringify(value))throw Error('Conflicting duplicate census record.');continue;}
    seen.set(r.id,value);if(value.fraction<=0)continue;
    const whole=value.fraction>=1-1e-7;if(whole)wholeBlocks++;else boundaryBlocks++;
    if(value.population===null){missing++;continue;}
    weighted+=value.population*value.fraction;
    if(whole)wholePopulation+=value.population;else boundaryPopulation+=value.population;
  }
  const blocks=wholeBlocks+boundaryBlocks;
  return {estimate:blocks&&!missing?weighted:null,knownWeightedSubtotal:weighted,wholePopulation,boundaryPopulation,wholeBlocks,boundaryBlocks,blocks,missing};
}

export function approximatePopulation(value){
  if(!Number.isFinite(value)||value<0)return 'Unavailable';
  if(value>0&&value<1)return 'Less than 1';
  const step=value>=10000?100:value>=100?10:1;
  return '≈ '+new Intl.NumberFormat('en-US').format(Math.round(value/step)*step);
}

export function populationZoneRows(rows,{query='',status='all'}={}){
  const term=query.trim().toLowerCase();return rows.filter(r=>(status==='all'||status==='active'&&['Order','Warn'].includes(r.status)||status===r.status)&&(!term||r.name.toLowerCase().includes(term))).sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true})||a.oid-b.oid);
}
