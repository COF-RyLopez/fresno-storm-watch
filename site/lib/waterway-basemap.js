/** Public cached reference basemap. No private records or browser persistence. */
export const WATERWAY_PILOT = Object.freeze({
  key:'waterways',title:'F.R.O.G. Waterways — Dark · pilot',
  bounds:[-119.86,36.72,-119.13,37.16],
  note:'Waterways pilot · Friant / Millerton + Pine Flat only · USGS snapshot Oct 19, 2026 (PDT). Esri context outside pilot; local ditch coverage unverified.'
});

/** Resolve own tile source for both localhost and project-scoped Pages URLs. */
export function pilotStyle(style,baseUrl){
  const result=structuredClone(style);
  result.sources.frog={type:'vector',url:new URL('tilejson.json',baseUrl).href,minzoom:10,maxzoom:14,bounds:WATERWAY_PILOT.bounds};
  return result;
}

/** Load on selection, preserving the existing map if the new style fails. */
export async function createWaterwayBasemap({Basemap,VectorTileLayer,fetchImpl=fetch}){
  const baseUrl=new URL('../basemaps/frog-waterways-dark/',import.meta.url);
  const response=await fetchImpl(new URL('root.json',baseUrl),{credentials:'omit',signal:AbortSignal.timeout(12_000)});
  if(!response.ok)throw new Error(`Waterways style HTTP ${response.status}`);
  const style=pilotStyle(await response.json(),baseUrl);
  const layer=new VectorTileLayer({id:'frog-waterways-vector',title:WATERWAY_PILOT.title,
    style,
    copyright:'USGS 3DHP | Esri, HERE, Garmin, FAO, NOAA, USGS, © OpenStreetMap contributors'});
  const basemap=new Basemap({id:'frog-basemap-waterways',title:WATERWAY_PILOT.title,
    thumbnailUrl:new URL('thumbnail.svg',baseUrl).href,baseLayers:[layer]});
  return {basemap,layer,load:()=>layer.load()};
}
