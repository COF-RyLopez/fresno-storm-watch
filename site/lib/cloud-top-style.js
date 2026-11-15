/** Fixed display classes for GOES geopotential cloud-top altitude, never storm severity or AGL. */
export const CLOUD_TOP_HEIGHT_BANDS=Object.freeze([
 {id:'low',label:'0–<2 km',minMeters:0,maxMeters:2000,color:'#7d94ac',rgb:Object.freeze([125,148,172])},
 {id:'middle',label:'2–<6 km',minMeters:2000,maxMeters:6000,color:'#a99fc4',rgb:Object.freeze([169,159,196])},
 {id:'high',label:'6–20 km',minMeters:6000,maxMeters:20000,color:'#dfcfee',rgb:Object.freeze([223,207,238])}
].map(Object.freeze));

/** Return the shared legend class, with an inclusive final endpoint and no NoData class. */
export function cloudTopHeightBand(height){
 if(!Number.isFinite(height)||height<0||height>20000)return null;
 return CLOUD_TOP_HEIGHT_BANDS.find((band,index)=>height<band.maxMeters||index===CLOUD_TOP_HEIGHT_BANDS.length-1);
}
