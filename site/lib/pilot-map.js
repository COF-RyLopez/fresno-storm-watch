import {countyGeometry} from './model.js';
import {PILOT_BOUNDS,collection} from './pilot-model.js';
import {waterwayStyle} from './waterway-basemap.js';

const BASE='https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_';
export const styleId=view=>view==='rivers'?'frog-waterways-0.33.0':'esri-dark-gray';
/** Both engines reference the same publisher tiles and existing cached county tiles. */
export async function pilotStyle(view){
 if(view==='watch')return {version:8,sources:{base:{type:'raster',tiles:[BASE+'Base/MapServer/tile/{z}/{y}/{x}'],tileSize:256,attribution:'Esri, HERE, Garmin, USGS, EPA, NPS'},reference:{type:'raster',tiles:[BASE+'Reference/MapServer/tile/{z}/{y}/{x}'],tileSize:256}},layers:[{id:'base',type:'raster',source:'base'},{id:'reference',type:'raster',source:'reference'}]};
 const base=new URL('../basemaps/frog-waterways-dark/',import.meta.url),r=await fetch(new URL('root.json?v=0.33.0',base),{credentials:'omit',signal:AbortSignal.timeout(15000)});
 if(!r.ok)throw Error('Waterways basemap unavailable');
 return waterwayStyle(await r.json(),base);
}
/** ArcGIS service metadata is not standard TileJSON; use its documented tile template. */
export function libreStyle(style){const s=structuredClone(style);if(s.sources.esri)s.sources.esri={type:'vector',tiles:['https://basemaps.arcgis.com/arcgis/rest/services/World_Basemap_v2/VectorTileServer/tile/{z}/{y}/{x}.pbf'],minzoom:0,maxzoom:16,attribution:'Esri, HERE, Garmin, FAO, NOAA, USGS, OpenStreetMap contributors'};return s;}
const timeout=(promise,ms)=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Map did not settle within '+ms/1000+' seconds')),ms);Promise.resolve(promise).then(value=>{clearTimeout(timer);resolve(value);},error=>{clearTimeout(timer);reject(error);});});
const rendered=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));

/** Lazy renderer: MapLibre mode never imports the ArcGIS map engine. */
export async function createPilotMap({engine,container,view,features,county,onSelect,onError}){
 const style=await pilotStyle(view);
 if(engine==='maplibre'){
  const ml=await import('../vendor/maplibre-6.15.0/maplibre-gl.mjs');
  const map=new ml.Map({container,style:libreStyle(style),bounds:[[PILOT_BOUNDS[0],PILOT_BOUNDS[1]],[PILOT_BOUNDS[2],PILOT_BOUNDS[3]]],fitBoundsOptions:{padding:20},attributionControl:{compact:true},renderWorldCopies:false,fadeDuration:0});
  map.on('error',e=>onError(e.error?.message||'Tile or map error'));
  try{await timeout(new Promise(resolve=>map.once('load',resolve)),20000);}catch(error){map.remove();throw error;}
  map.addControl(new ml.NavigationControl({showCompass:false}),'top-left');map.addControl(new ml.ScaleControl({unit:'imperial'}),'bottom-left');
  map.addSource('county',{type:'geojson',data:collection([county])});map.addLayer({id:'county-outline',type:'line',source:'county',paint:{'line-color':'#7cabb4','line-width':1.2}});
  map.addSource('records',{type:'geojson',data:features});
  map.addLayer({id:'power-fill',type:'fill',source:'records',filter:['==',['geometry-type'],'Polygon'],paint:{'fill-color':['get','color'],'fill-opacity':.16}});
  map.addLayer({id:'power-line',type:'line',source:'records',filter:['==',['geometry-type'],'Polygon'],paint:{'line-color':['get','color'],'line-width':2}});
  map.addLayer({id:'gauge-points',type:'circle',source:'records',filter:['all',['==',['geometry-type'],'Point'],['!=',['get','kind'],'area'],['!=',['get','kind'],'reservoir']],paint:{'circle-color':['get','color'],'circle-radius':6.5,'circle-stroke-color':'#17252e','circle-stroke-width':1.5}});
  for(const [name,shape]of [['area','triangle'],['reservoir','diamond']]){const canvas=document.createElement('canvas');canvas.width=32;canvas.height=32;const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.beginPath();if(shape==='triangle'){ctx.moveTo(16,3);ctx.lineTo(30,28);ctx.lineTo(2,28);}else{ctx.moveTo(16,2);ctx.lineTo(30,16);ctx.lineTo(16,30);ctx.lineTo(2,16);}ctx.closePath();ctx.fill();map.addImage(name,ctx.getImageData(0,0,32,32),{sdf:true});map.addLayer({id:name+'-points',type:'symbol',source:'records',filter:['==',['get','kind'],name],layout:{'icon-image':name,'icon-size':.47,'icon-allow-overlap':true},paint:{'icon-color':['get','color'],'icon-halo-color':'#17252e','icon-halo-width':1.5}});}
  map.addSource('selection',{type:'geojson',data:collection([])});map.addLayer({id:'selected-outline',type:'line',source:'selection',filter:['!=',['geometry-type'],'Point'],paint:{'line-color':'#e29de8','line-width':4}});map.addLayer({id:'selected-point',type:'circle',source:'selection',filter:['==',['geometry-type'],'Point'],paint:{'circle-color':'transparent','circle-radius':12,'circle-stroke-color':'#e29de8','circle-stroke-width':3}});
  map.on('click',e=>{const f=map.queryRenderedFeatures(e.point,{layers:['area-points','gauge-points','reservoir-points','power-fill']})[0];if(f)onSelect(f.properties);});
  const idle=async()=>{await rendered();return timeout(new Promise(resolve=>{if(!map.isMoving()&&map.loaded())resolve();else map.once('idle',resolve);}),15000);};
  let settledError=null;await idle().catch(error=>{settledError=error.message;onError(settledError);});
  return {settledError,setFeatures(data){map.getSource('records').setData(data);},highlight(data){map.getSource('selection').setData(data);},async fit(bounds,duration=0){map.fitBounds([[bounds[0],bounds[1]],[bounds[2],bounds[3]]],{padding:25,maxZoom:14,duration});await idle();},resize:()=>map.resize(),destroy:()=>map.remove()};
 }
 // The comparison mode uses the main app's pinned unified SDK loader.
 const {loadSdk}=await import('./map.js?v=0.73.1');const sdk=await loadSdk();
 const [Map,MapView,Basemap,TileLayer,VectorTileLayer,GraphicsLayer,Graphic,Extent,reactive]=await sdk.import(['@arcgis/core/Map.js','@arcgis/core/views/MapView.js','@arcgis/core/Basemap.js','@arcgis/core/layers/TileLayer.js','@arcgis/core/layers/VectorTileLayer.js','@arcgis/core/layers/GraphicsLayer.js','@arcgis/core/Graphic.js','@arcgis/core/geometry/Extent.js','@arcgis/core/core/reactiveUtils.js']);
 const css=document.createElement('link');css.rel='stylesheet';css.href='https://js.arcgis.com/5.1/esri/themes/dark/main.css';document.head.append(css);
 const basemap=view==='rivers'?new Basemap({baseLayers:[new VectorTileLayer({style})]}):new Basemap({baseLayers:[new TileLayer({url:BASE+'Base/MapServer'})],referenceLayers:[new TileLayer({url:BASE+'Reference/MapServer'})]});
 const records=new GraphicsLayer({title:'Identical pilot records'}),outline=new GraphicsLayer({title:'County reference'}),selection=new GraphicsLayer({title:'Selection'});
 const map=new Map({basemap,layers:[outline,records,selection]});const extent=b=>new Extent({xmin:b[0],ymin:b[1],xmax:b[2],ymax:b[3],spatialReference:{wkid:4326}});
 const display=new MapView({map,container,extent:extent(PILOT_BOUNDS),popupEnabled:false,attributionVisible:true,ui:{components:['zoom']}});
 display.on('layerview-create-error',e=>onError(e.error?.message||'Layer failed'));
 const geometry=g=>g.type==='Point'?{type:'point',longitude:g.coordinates[0],latitude:g.coordinates[1]}:g.type==='Polygon'||g.type==='MultiPolygon'?{type:'polygon',...countyGeometry(g)}:{type:'polyline',paths:g.type==='LineString'?[g.coordinates]:g.coordinates,spatialReference:{wkid:4326}};
 outline.add(new Graphic({geometry:geometry(county.geometry),symbol:{type:'simple-fill',color:[0,0,0,0],outline:{color:'#7cabb4',width:1.2}}}));
 const setFeatures=data=>{records.removeAll();records.addMany(data.features.map(f=>new Graphic({geometry:geometry(f.geometry),attributes:f.properties,symbol:f.geometry.type==='Point'?{type:'simple-marker',style:f.properties.kind==='area'?'triangle':f.properties.kind==='reservoir'?'diamond':'circle',size:13,color:f.properties.color,outline:{color:'#17252e',width:1.5}}:{type:'simple-fill',color:f.properties.color+'29',outline:{color:f.properties.color,width:2}}})));};
 setFeatures(features);try{await timeout(display.when(),20000);}catch(error){display.destroy();css.remove();throw error;}
 display.on('click',async e=>{const hits=await display.hitTest(e,{include:[records]});if(hits.results[0]?.graphic?.attributes)onSelect(hits.results[0].graphic.attributes);});
 const idle=async()=>{await rendered();return timeout(reactive.whenOnce(()=>!display.updating&&!display.navigating),15000);};let settledError=null;await idle().catch(error=>{settledError=error.message;onError(settledError);});
 return {settledError,setFeatures,highlight(data){selection.removeAll();selection.addMany(data.features.map(f=>new Graphic({geometry:geometry(f.geometry),symbol:f.geometry.type==='Point'?{type:'simple-marker',style:'circle',size:24,color:[0,0,0,0],outline:{color:'#e29de8',width:3}}:f.geometry.type.includes('Polygon')?{type:'simple-fill',color:[0,0,0,0],outline:{color:'#e29de8',width:4}}:{type:'simple-line',color:'#e29de8',width:4}})));},async fit(bounds,duration=0){await display.goTo(extent(bounds),{animate:duration>0,duration});await idle();},resize(){},destroy(){display.destroy();css.remove();}};
}
