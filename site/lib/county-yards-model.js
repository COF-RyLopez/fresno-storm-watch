/** County road yards and County fuel sites (both public County GIS layers). Most road yards are also fuel sites; the
 * fuel list also has a motor pool, a parking garage, the juvenile campus, two parks and a disposal site. */
export const YARDS_URL='https://gisprod10.co.fresno.ca.us/server/rest/services/CY_FRESNO/RDYARD/MapServer/0';
export const FUEL_URL='https://gisprod10.co.fresno.ca.us/server/rest/services/Hosted/Fuel_Site_Map_WFL1/FeatureServer/0';
/** A unit this close to a yard point is "at" the yard (yard points sit on the parcel, not the gate). */
export const AT_SITE_MILES=0.15;
const R_MILES=3958.8,rad=d=>d*Math.PI/180;

/** Great-circle miles between two lon/lat points. */
export function miles(lon1,lat1,lon2,lat2){
  const a=Math.sin(rad(lat2-lat1)/2)**2+Math.cos(rad(lat1))*Math.cos(rad(lat2))*Math.sin(rad(lon2-lon1)/2)**2;
  return 2*R_MILES*Math.asin(Math.min(1,Math.sqrt(a)));
}

/** @param {number} lon @param {number} lat @param {{name:string,lon:number,lat:number}[]} sites @returns {{site:object,miles:number}|null} Nearest by straight line. */
export function nearestSite(lon,lat,sites){
  if(!Number.isFinite(lon)||!Number.isFinite(lat))return null;
  let best=null;
  for(const s of sites||[]){if(!Number.isFinite(s?.lon)||!Number.isFinite(s?.lat))continue;const d=miles(lon,lat,s.lon,s.lat);if(!best||d<best.miles)best={site:s,miles:d};}
  return best;
}

/** Popup line for a unit: where it is relative to County yards and fuel. Straight-line, said so: a road route needs a routing service. */
export function siteContext(lon,lat,{yards=[],fuel=[]}={}){
  const yard=nearestSite(lon,lat,yards),pump=nearestSite(lon,lat,fuel);
  return {
    at:yard&&yard.miles<=AT_SITE_MILES?yard.site.name:null,
    fuel:pump?(pump.miles<=AT_SITE_MILES?`Fuel on site: ${pump.site.name}`:`Nearest County fuel: ${pump.site.name}, ${pump.miles.toFixed(1)} mi straight-line`):null,
  };
}

/** Title case for the County's upper-case yard names ("FRESNO/CLOVIS YARD" → "Fresno/Clovis Yard"). */
export const siteName=n=>String(n||'').toLowerCase().replace(/(^|[\s/(-])([a-z])/g,(m,p,c)=>p+c.toUpperCase()).trim();
