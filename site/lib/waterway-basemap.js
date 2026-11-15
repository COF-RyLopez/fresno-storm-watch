/** Public cached reference basemap. No private records or browser persistence. */
export const WATERWAY_BASEMAP = Object.freeze({
  key:'waterways',title:'F.R.O.G. Waterways — Dark',
  bounds:[-120.91873100010041,35.906914000095696,-118.36058599987905,37.58583700006363],
  version:'0.33.0',styleRevision:'0.87.0',flowlineVersion:'0.29.0',
  note:'Fresno County and Millerton / Pine Flat upstream watersheds · USGS mapped water bodies, named / unnamed canals and ditches; local inventory completeness unverified.'
});

/** Resolve own tile source for both localhost and project-scoped Pages URLs. */
export function waterwayStyle(style,baseUrl){
  const result=structuredClone(style);
  const bounds=style.metadata?.frog?.bounds??WATERWAY_BASEMAP.bounds;
  result.sources.frog={type:'vector',url:new URL('tilejson.json?v='+encodeURIComponent(style.metadata?.frog?.revision??style.metadata?.frog?.retrievedAt??WATERWAY_BASEMAP.flowlineVersion),baseUrl).href,minzoom:0,maxzoom:14,bounds};
  if(result.sources.frogWaterbodies)result.sources.frogWaterbodies={type:'vector',url:new URL('waterbodies-tilejson.json?v='+encodeURIComponent(style.metadata?.frog?.waterbodies?.revision??style.metadata?.frog?.waterbodies?.retrievedAt??WATERWAY_BASEMAP.version),baseUrl).href,minzoom:0,maxzoom:12,bounds};
  return result;
}

/** Load on selection, preserving the existing map if the new style fails. */
export async function createWaterwayBasemap({Basemap,VectorTileLayer,fetchImpl=fetch}){
  const baseUrl=new URL('../basemaps/frog-waterways-dark/',import.meta.url);
  const response=await fetchImpl(new URL('root.json?v='+WATERWAY_BASEMAP.styleRevision,baseUrl),{credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(12_000)});
  if(!response.ok)throw new Error(`Waterways style HTTP ${response.status}`);
  const style=waterwayStyle(await response.json(),baseUrl);
  const layer=new VectorTileLayer({id:'frog-waterways-vector',title:WATERWAY_BASEMAP.title,
    style,
    copyright:'USGS 3DHP | Esri, HERE, Garmin, FAO, NOAA, USGS, © OpenStreetMap contributors'});
  const basemap=new Basemap({id:'frog-basemap-waterways',title:WATERWAY_BASEMAP.title,
    thumbnailUrl:new URL('thumbnail.svg?v='+WATERWAY_BASEMAP.version,baseUrl).href,baseLayers:[layer]});
  const date=style.metadata?.frog?.retrievedAt;
  const retrieved=date&&Number.isFinite(Date.parse(date))?new Intl.DateTimeFormat('en-US',{timeZone:'America/Los_Angeles',year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(new Date(date)):'retrieval time unavailable';
  const bodyDate=style.metadata?.frog?.waterbodies?.retrievedAt;
  const bodyRetrieved=bodyDate&&Number.isFinite(Date.parse(bodyDate))?new Intl.DateTimeFormat('en-US',{timeZone:'America/Los_Angeles',year:'numeric',month:'short',day:'numeric'}).format(new Date(bodyDate)):'unavailable';
  return {basemap,layer,note:WATERWAY_BASEMAP.note+' Flowline snapshot retrieved '+retrieved+'. Waterbody snapshot: '+bodyRetrieved+'.',load:()=>layer.load()};
}
