/** Fixed-weight allocation, not a Census-published zone count or an occupancy model. */
export const ZONE_ACS_METHOD='For each intersecting ACS tract, allocate its published total using the share of its 2020 Census block population inside the selected county zone. Blocks cut by the tract or zone boundary are apportioned by geodetic area. This assumes the within-tract population pattern has remained like 2020; it cannot locate subsequent development or population movement. Only Fresno County tracts are included, including for zones that cross the county line.';
export const ZONE_ACS_LIMIT='A five-year planning estimate, not a 2026 headcount, current occupancy, confirmed evacuees or shelter demand. Newer source totals do not guarantee a more accurate zone estimate. Do not add overlapping zones together.';
export const ZONE_ACS_ERROR='Sampling-only component = square root of the sum of squared (tract allocation weight × published 90% MOE). This approximation treats the weights as fixed and ignores covariance between tracts. It excludes allocation, boundary, 2020 Census and population-change errors; it is not a complete 90% confidence interval for this zone.';
export const ZONE_ACS_MOE_SOURCE='https://www.census.gov/content/dam/Census/library/publications/2020/acs/acs_general_handbook_2020_ch08.pdf';
export const ZONE_ACS_BOUNDARIES=Object.freeze({period:'2020–2024',vintage:'January 1, 2024',url:'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_ACS2024/MapServer/8'});

export function formatAllocationWeight(weight){
  if(weight===null)return 'Unavailable';
  if(weight>0&&weight<.001)return '<0.1%';
  if(weight<1&&weight>.999)return '>99.9%';
  return new Intl.NumberFormat('en-US',{style:'percent',maximumFractionDigits:1}).format(weight);
}

/** Reconcile one contribution per positive-area tract; incomplete estimates stay unknown. */
export function summarizeZoneAcs(rows){
  const seen=new Set();let total=0,squaredMoe=0,missing=0,missingMoe=0;
  for(const row of rows){
    if(!/^06019\d{6}$/.test(row.id)||seen.has(row.id))throw Error('Missing, duplicate or outside-county ACS tract.');
    seen.add(row.id);
    for(const key of ['weight','population','moe'])if(row[key]!==null&&(!Number.isFinite(row[key])||row[key]<0||key==='weight'&&row[key]>1))throw Error('Invalid ACS allocation input.');
    if(row.weight===null||row.population===null){missing++;continue;}
    total+=row.weight*row.population;
    if(row.moe===null)missingMoe++;else squaredMoe+=(row.weight*row.moe)**2;
  }
  return {estimate:rows.length&&!missing?total:null,samplingMoe:rows.length&&!missing&&!missingMoe?Math.sqrt(squaredMoe):null,tracts:rows.length,missing,missingMoe,rows};
}
