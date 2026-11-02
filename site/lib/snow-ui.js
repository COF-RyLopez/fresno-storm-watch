import {loadSdk} from './map.js';
import {reportHealth} from './source-health.js';
import {labelPolygons} from './map-labels.js';
import {SNOW_POINTS,SNOW_ROUTES_URL,ROUTE_PRIORITIES,snowLevels,snowLevelAt,snowRange,feet,snowLines} from './snow-model.js';

const $=id=>document.getElementById(id);
const ELEVATION_URL='https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer';
const NWS={Accept:'application/geo+json,application/json'};
const HOUR=3_600_000;
/** Snow level (NWS gridpoints) shaded on USGS 3DEP terrain at the weather timeline time, plus the county's snow-removal routes. */
export function createSnowLevel({time,exercise,target}){
  let controller=null,point='shaver',series=new Map(),errors=new Map(),checked=null,threshold=null,terrain=null,afd=null,afdError=null,busy=false;
  const json=async url=>{const r=await fetch(url,{headers:NWS,cache:'no-store',signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error(`NWS HTTP ${r.status}`);return r.json();};
  /** Mask the 3DEP elevation tile to cells at or above the snow level and paint them pale blue-white (ArcGIS client-side pixelFilter). */
  function pixelFilter(data){
    const pb=data?.pixelBlock;if(!pb?.pixels||threshold===null)return;
    const elev=pb.pixels[0],n=pb.width*pb.height,mask=new Uint8Array(n),r=new Uint8Array(n),g=new Uint8Array(n),b=new Uint8Array(n);
    for(let i=0;i<n;i++)if(elev[i]>=threshold&&(!pb.mask||pb.mask[i])){mask[i]=1;r[i]=226;g[i]=240;b[i]=255;}
    pb.pixels=[r,g,b];pb.mask=mask;pb.pixelType='u8';pb.statistics=null;
  }
  function render(){
    const t=target(),steps=series.get(point)||[],m=snowLevelAt(steps,t),name=SNOW_POINTS.find(p=>p.id===point).name;
    const next=threshold;threshold=m;if(terrain&&next!==threshold)terrain.redraw();
    const err=exercise?'Exercise · live NWS snow level disabled':errors.get(point);
    $('snow-level').textContent=err||(m===null?`No NWS snow level for ${name} at ${time(t)}`:`${feet(m).toLocaleString()} ft (${Math.round(m).toLocaleString()} m) · ${name} · ${time(t)}`);
    const r=snowRange(steps,t,t+24*HOUR);
    $('snow-range').textContent=r?`Next 24 h at ${name}: ${feet(r.low).toLocaleString()}–${feet(r.high).toLocaleString()} ft`:'';
    $('snow-legend-text').textContent=m===null?'No snow level for this time · shading hidden':`Shaded: terrain at or above ${feet(m).toLocaleString()} ft, the NWS snow level at ${name} for ${time(t)}`;
    $('snow-afd').replaceChildren(...(afd?.lines.length?afd.lines.map(l=>{const li=document.createElement('li');li.textContent=l;return li;}):[]));
    $('snow-afd-status').textContent=afdError||(afd?`NWS Hanford forecast discussion issued ${time(Date.parse(afd.issued))}${afd.lines.length?'':' · no snow mentioned'}`:'Checking NWS Hanford forecast discussion…');
    if(afd)$('snow-afd-link').href=afd.link;
    if(!exercise)reportHealth('snow-level','NWS snow level',{checked,error:errors.get(point)||null,maxAgeMs:3*HOUR,detail:'Gridpoint snow level at three Sierra points; AFD text is shown separately.'});
  }
  async function refresh(){
    if(busy||exercise||document.hidden)return;busy=true;
    await Promise.all(SNOW_POINTS.map(async p=>{try{const pt=await json(`https://api.weather.gov/points/${p.latitude},${p.longitude}`);series.set(p.id,snowLevels(await json(pt.properties.forecastGridData)));errors.delete(p.id);}catch(e){errors.set(p.id,`NWS snow level unavailable · ${e.message}`);}}));
    checked=Date.now();
    try{const list=await json('https://api.weather.gov/products/types/AFD/locations/HNX'),latest=list['@graph']?.[0];if(!latest)throw Error('no discussion listed');const prod=await json(`https://api.weather.gov/products/${latest.id}`);afd={issued:prod.issuanceTime,lines:snowLines(prod.productText),link:`https://forecast.weather.gov/product.php?site=HNX&issuedby=HNX&product=AFD`};afdError=null;}
    catch(e){afdError=`Forecast discussion unavailable · ${e.message}`;}
    busy=false;render();
  }
  $('snow-point').addEventListener('calciteSelectChange',e=>{point=e.target.value;render();});
  for(const [id,key] of [['snow-terrain-toggle','snowLevel'],['snow-routes-toggle','snowRoutes']])$(id).addEventListener('calciteCheckboxChange',e=>controller?.setLayerPreference(key,e.target.checked));
  $('snow-refresh').addEventListener('click',()=>void refresh());
  setInterval(()=>{if(!document.hidden)void refresh();},30*60000);
  queueMicrotask(()=>{render();void refresh();});
  return {update:render,async setMap(map){controller=map;try{
    const sdk=await loadSdk();const [ImageryLayer,FeatureLayer]=await sdk.import(['@arcgis/core/layers/ImageryLayer.js','@arcgis/core/layers/FeatureLayer.js']);
    // rasterFunction None: raw metres. The service's default display function is a hillshade (0-255), which never reaches a snow level.
    terrain=new ImageryLayer({url:ELEVATION_URL,title:'Terrain above NWS snow level · USGS 3DEP',format:'lerc',rasterFunction:{functionName:'None'},pixelFilter,opacity:.45,popupEnabled:false,legendEnabled:false});
    map.registerLayer('snowLevel',terrain);
    const routes=new FeatureLayer({url:SNOW_ROUTES_URL,title:'County snow removal routes',outFields:['name','maintainedby','priority','prioritydescription','limits','description'],
      renderer:{type:'unique-value',field:'priority',defaultSymbol:{type:'simple-line',color:'#a5a9ad',width:1.5},uniqueValueInfos:Object.entries(ROUTE_PRIORITIES).map(([v,p])=>({value:Number(v),label:p.label,symbol:{type:'simple-line',color:p.color,width:p.width,style:p.style||'solid'}}))},
      // Contact name/phone in the source are for permit holders; they are deliberately not requested.
      popupTemplate:{title:'{name} · snow removal',content:[{type:'fields',fieldInfos:[{fieldName:'prioritydescription',label:'County priority'},{fieldName:'maintainedby',label:'Maintained by'},{fieldName:'limits',label:'Limits'},{fieldName:'description',label:'Road class'}]},{type:'text',text:'County snow-removal plan, not current road conditions or plow status. Check closures and chain controls before travel.'}]}});
    labelPolygons(routes,{expression:'Proper($feature.name)',minScale:150_000,placement:'center-along'});
    map.registerLayer('snowRoutes',routes);render();
  }catch(e){errors.set(point,`Snow map unavailable · ${e.message}`);render();}}};
}
