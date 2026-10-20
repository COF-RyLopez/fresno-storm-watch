/** Public cached reference basemap. No private records or browser persistence. */
export const WATERWAY_BASEMAP = Object.freeze({
  key:'waterways',title:'F.R.O.G. Waterways — Dark',
  bounds:[-120.91873100010041,35.906914000095696,-118.36058599987905,37.58583700006363],
  version:'0.29.0',
  note:'Fresno County USGS reference · includes mapped named / unnamed canals and ditches; local inventory completeness unverified.'
});

/** Resolve own tile source for both localhost and project-scoped Pages URLs. */
export function waterwayStyle(style,baseUrl){
  const result=structuredClone(style);
  result.sources.frog={type:'vector',url:new URL('tilejson.json?v='+WATERWAY_BASEMAP.version,baseUrl).href,minzoom:0,maxzoom:14,bounds:WATERWAY_BASEMAP.bounds};
  return result;
}

/** Load on selection, preserving the existing map if the new style fails. */
export async function createWaterwayBasemap({Basemap,VectorTileLayer,fetchImpl=fetch}){
  const baseUrl=new URL('../basemaps/frog-waterways-dark/',import.meta.url);
  const response=await fetchImpl(new URL('root.json?v='+WATERWAY_BASEMAP.version,baseUrl),{credentials:'omit',signal:AbortSignal.timeout(12_000)});
  if(!response.ok)throw new Error(`Waterways style HTTP ${response.status}`);
  const style=waterwayStyle(await response.json(),baseUrl);
  const layer=new VectorTileLayer({id:'frog-waterways-vector',title:WATERWAY_BASEMAP.title,
    style,
    copyright:'USGS 3DHP | Esri, HERE, Garmin, FAO, NOAA, USGS, © OpenStreetMap contributors'});
  const basemap=new Basemap({id:'frog-basemap-waterways',title:WATERWAY_BASEMAP.title,
    thumbnailUrl:new URL('thumbnail.svg',baseUrl).href,baseLayers:[layer]});
  const date=style.metadata?.frog?.retrievedAt;
  const retrieved=date&&Number.isFinite(Date.parse(date))?new Intl.DateTimeFormat('en-US',{timeZone:'America/Los_Angeles',year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(new Date(date)):'retrieval time unavailable';
  return {basemap,layer,note:WATERWAY_BASEMAP.note+' Snapshot retrieved '+retrieved+'.',load:()=>layer.load()};
}
