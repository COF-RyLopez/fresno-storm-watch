import {pilotStyle,libreStyle} from './pilot-map.js';
import {waitForTerrain} from './watch-terrain-ready.js';
import {createHanfordRadarLayer} from './hanford-radar-layer.js';
import {createHanfordVolumeLayer} from './hanford-volume-layer.js';
import {createCloudTopLayer} from './cloud-top-layer.js';
import {installCloudTopInspection} from './cloud-top-inspection.js';
import {createWatchWindTrails} from './watch-wind-trails.js';
let protocol;
/** Lazy focused map. Only in-memory authorized display features enter this renderer. */
export async function createWatchTerrain({container,onSelect,onError,onCamera=()=>{}}){
 const ml=await import('../vendor/maplibre-6.15.0/maplibre-gl.mjs');
 if(!protocol){const {Protocol}=await import('../vendor/pmtiles-4.5.0/pmtiles.js');protocol=new Protocol();ml.addProtocol('pmtiles',protocol.tile);}
 const style=libreStyle(await pilotStyle('watch','pmtiles'));
 const dem={type:'raster-dem',tiles:['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],encoding:'terrarium',tileSize:256,maxzoom:14};
 style.sources.terrain={...dem,attribution:'Terrain Tiles · Mapzen / Tilezen · reference elevation'};
 style.sources.relief=dem;
 style.terrain={source:'terrain',exaggeration:1};
 // Add the storm demo's hillshade over the shared slate basemap.
 const index=style.layers.findIndex(l=>l.type==='line'||l.type==='symbol');
 style.layers.splice(index<0?style.layers.length:index,0,{id:'terrain-shading',type:'hillshade',source:'relief',paint:{'hillshade-exaggeration':.52,'hillshade-shadow-color':'#101b20','hillshade-highlight-color':'#a8b0a1'}});
 const map=new ml.Map({container,style,center:[-119.6,36.8],zoom:8,pitch:50,maxPitch:60,attributionControl:{compact:true},renderWorldCopies:false,fadeDuration:0});
 try{await waitForTerrain(map,onError);}catch(e){map.remove();throw e;}
 map.addControl(new ml.NavigationControl({visualizePitch:true}),'bottom-left');
 map.addControl(new ml.ScaleControl({unit:'imperial'}),'bottom-right');
 const empty={type:'FeatureCollection',features:[]};
 map.addSource('watch-basin',{type:'geojson',data:empty});
 map.addLayer({id:'watch-basin-outline',type:'line',source:'watch-basin',paint:{'line-color':'#e4d8aa','line-width':2,'line-dasharray':[3,2]}});
 map.addSource('watch-records',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
 map.addLayer({id:'watch-polygons',type:'fill',source:'watch-records',filter:['==',['geometry-type'],'Polygon'],paint:{'fill-color':['get','color'],'fill-opacity':.13}});
 map.addLayer({id:'watch-alert-outline-halo',type:'line',source:'watch-records',filter:['all',['==',['geometry-type'],'Polygon'],['==',['get','kind'],'alert']],paint:{'line-color':'#edf5fb','line-width':4,'line-opacity':.85}});
 map.addLayer({id:'watch-polygon-outlines',type:'line',source:'watch-records',filter:['==',['geometry-type'],'Polygon'],paint:{'line-color':['get','color'],'line-width':2}});
 map.addLayer({id:'watch-lines',type:'line',source:'watch-records',filter:['all',['==',['geometry-type'],'LineString'],['!=',['get','detour'],true]],paint:{'line-color':['get','color'],'line-width':3}});
 map.addLayer({id:'watch-detours',type:'line',source:'watch-records',filter:['all',['==',['geometry-type'],'LineString'],['==',['get','detour'],true]],paint:{'line-color':['get','color'],'line-width':2.5,'line-dasharray':[3,2]}});
 map.addLayer({id:'watch-points',type:'circle',source:'watch-records',filter:['==',['geometry-type'],'Point'],paint:{'circle-color':['get','color'],'circle-radius':['case',['==',['get','kind'],'facility'],5,7],'circle-stroke-color':'#e8f6fb','circle-stroke-width':1.5}});
 // Facility diamonds distinguish assets from round gauge/watchpoint symbols without relying on color.
 const canvas=document.createElement('canvas');canvas.width=24;canvas.height=24;const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.beginPath();ctx.moveTo(12,1);ctx.lineTo(23,12);ctx.lineTo(12,23);ctx.lineTo(1,12);ctx.closePath();ctx.fill();map.addImage('facility',ctx.getImageData(0,0,24,24),{sdf:true});
 map.setFilter('watch-points',['all',['==',['geometry-type'],'Point'],['!=',['get','kind'],'facility'],['!=',['get','kind'],'road']]);
 ctx.clearRect(0,0,24,24);ctx.strokeStyle='#fff';ctx.lineWidth=4;ctx.beginPath();ctx.moveTo(5,5);ctx.lineTo(19,19);ctx.moveTo(19,5);ctx.lineTo(5,19);ctx.stroke();
 map.addImage('road-block',ctx.getImageData(0,0,24,24),{sdf:true});
 map.addLayer({id:'watch-road-blocks',type:'symbol',source:'watch-records',filter:['all',['==',['geometry-type'],'Point'],['==',['get','kind'],'road']],layout:{'icon-image':'road-block','icon-size':.75,'icon-allow-overlap':true},paint:{'icon-color':['get','color'],'icon-halo-color':'#15191a','icon-halo-width':1.5}});
 map.addLayer({id:'watch-facilities',type:'symbol',source:'watch-records',filter:['all',['==',['geometry-type'],'Point'],['==',['get','kind'],'facility']],layout:{'icon-image':'facility','icon-size':.6,'icon-allow-overlap':true},paint:{'icon-color':['get','color'],'icon-halo-color':'#e8f6fb','icon-halo-width':1}});
 const fonts=style.layers.find(l=>l.type==='symbol'&&l.layout?.['text-font']?.includes('Ubuntu Regular'))?.layout['text-font'];
 map.addSource('command-triggers',{type:'geojson',data:empty});
 map.addLayer({id:'command-trigger-lines',type:'line',source:'command-triggers',
  filter:['all',['!=',['geometry-type'],'Point'],['!=',['get','detour'],true]],paint:{'line-color':'#ffce91','line-width':5,'line-opacity':.85}});
 map.addLayer({id:'command-trigger-detours',type:'line',source:'command-triggers',
  filter:['all',['==',['geometry-type'],'LineString'],['==',['get','detour'],true]],paint:{'line-color':'#ffce91','line-width':5,'line-opacity':.85,'line-dasharray':[3,2]}});
 map.addLayer({id:'command-trigger-points',type:'circle',source:'command-triggers',
  filter:['==',['geometry-type'],'Point'],paint:{'circle-color':'rgba(0,0,0,0)','circle-stroke-color':'#ffce91','circle-stroke-width':3,'circle-radius':10}});
 const triggerLabel={'text-field':['get','name'],'text-size':13,...(fonts?{'text-font':fonts}:{})};
 const triggerPaint={'text-color':'#ffe5c4','text-halo-color':'#172126','text-halo-width':2};
 map.addLayer({id:'command-trigger-labels',type:'symbol',source:'command-triggers',
  filter:['==',['geometry-type'],'Point'],layout:{...triggerLabel,'text-offset':[0,-1.1],'text-anchor':'bottom','text-allow-overlap':true},paint:triggerPaint});
 map.addLayer({id:'command-trigger-road-labels',type:'symbol',source:'command-triggers',
  filter:['==',['geometry-type'],'LineString'],layout:{...triggerLabel,'symbol-placement':'line-center','text-allow-overlap':true},paint:triggerPaint});
 map.addSource('command-snow-points',{type:'geojson',data:empty});
 map.addLayer({id:'command-snow-dots',type:'circle',source:'command-snow-points',paint:{'circle-radius':6,'circle-color':'#cde8ff','circle-stroke-color':'#172126','circle-stroke-width':2,'circle-pitch-alignment':'viewport'}});
 map.addLayer({id:'command-snow-labels',type:'symbol',source:'command-snow-points',layout:{'text-field':['get','label'],'text-size':13,'text-anchor':'bottom','text-offset':[0,-.75],...(fonts?{'text-font':fonts}:{})},paint:{'text-color':'#eef8ff','text-halo-color':'#172126','text-halo-width':2}});
 map.addLayer({id:'watch-labels',type:'symbol',source:'watch-records',filter:['==',['geometry-type'],'Point'],minzoom:10,layout:{'text-field':['get','name'],'text-size':12,'text-offset':[0,1.3],'text-anchor':'top',...(fonts?{'text-font':fonts}:{})},paint:{'text-color':'#e6f5fa','text-halo-color':'#18252c','text-halo-width':2}});
 const records=['watch-points','watch-facilities','watch-road-blocks','watch-lines','watch-detours','watch-polygons'];
 const recordAt=point=>map.queryRenderedFeatures(point,{layers:records})[0]?.properties;
 let destroyed=false,overhead=false,pendingBounds=null;
 const imageUrls=new Map();
 let radarLayer;
 let cloudTopLayer;
 let cloudMetadata;
 let windTrails;
 function forecastWind(field,options){
  if(field&&!windTrails)windTrails=createWatchWindTrails(map);
  windTrails?.set(field,options);
 }
 const inspection=installCloudTopInspection({map,Popup:ml.Popup,recordAt,onSelect,getSurface:()=>cloudTopLayer,getMetadata:()=>cloudMetadata});
 function radar(samples,minDbz,options){
  if(!samples?.length){
   if(map.getLayer('watch-hanford-radar'))map.removeLayer('watch-hanford-radar');
   radarLayer=null;
   return;
  }
  if(!map.getLayer('watch-hanford-radar')){
   radarLayer=createHanfordRadarLayer(ml.MercatorCoordinate);
   map.addLayer(radarLayer,'watch-lines');
  }
  radarLayer.setSamples(samples,minDbz,options);
 }
 function volumeDisplay(id,cloud=false){
  let layer,onDrawFailure;
  return function display(volume,minDbz,onFailure,options){
  if(!volume){if(map.getLayer(id))map.removeLayer(id);layer=onDrawFailure=null;return;}
  if(onFailure)onDrawFailure=onFailure;
  if(!layer){
   const candidate=createHanfordVolumeLayer(ml.MercatorCoordinate,{cloud});
   const draw=candidate.render.bind(candidate);let failed=false;
   candidate.render=(gl,args)=>{
    if(failed)return;
    try{draw(gl,args);}catch{
     failed=true;
     queueMicrotask(()=>{
      if(destroyed||layer!==candidate)return;
      const notify=onDrawFailure;display(null);notify?.();
     });
    }
   };
   try{map.addLayer(candidate,'watch-lines');layer=candidate;}
   catch(error){if(map.getLayer(id))map.removeLayer(id);throw error;}
  }
  layer.setVolume(volume,minDbz,options);
  };
 }
 const radarVolume=volumeDisplay('watch-hanford-volume');
 const forecastClouds=volumeDisplay('watch-forecast-cloud-volume',true);
 function cloudTops(vertices,options={}){
  inspection.clear();cloudMetadata=vertices?.length?options:null;
  const id='watch-goes-cloud-tops';
  if(!vertices?.length){
   if(map.getLayer(id))map.removeLayer(id);
   cloudTopLayer=null;
   return;
  }
  if(!map.getLayer(id)){
   const candidate=createCloudTopLayer(ml.MercatorCoordinate),draw=candidate.render.bind(candidate);let failed=false;
   candidate.render=(gl,args)=>{
    if(failed)return;
    try{draw(gl,args);}catch{
     failed=true;
     queueMicrotask(()=>{
      if(destroyed||cloudTopLayer!==candidate)return;
      const notify=cloudMetadata?.onFailure;cloudTops(null);notify?.();
     });
    }
   };
   const before=map.getLayer('watch-hanford-radar')?'watch-hanford-radar':map.getLayer('watch-hanford-volume')?'watch-hanford-volume':'watch-lines';
   try{map.addLayer(candidate,before);cloudTopLayer=candidate;}
   catch(error){if(map.getLayer(id))map.removeLayer(id);throw error;}
  }
  return cloudTopLayer.setSurface(vertices,options);
 }
 function setImage(id,image,paint){
  if(map.getLayer(id))map.removeLayer(id);
  if(map.getSource(id))map.removeSource(id);
  const previous=imageUrls.get(id);
  if(previous){URL.revokeObjectURL(previous);imageUrls.delete(id);}
  if(!image?.blob)return;
  const url=URL.createObjectURL(image.blob);imageUrls.set(id,url);
  map.addSource(id,{type:'image',url,coordinates:image.coordinates});
  map.addLayer({id,type:'raster',source:id,paint:{'raster-fade-duration':0,...paint}},'frog-overview-rivers');
 }
 const fit=(bounds,animate,padding)=>{if(!container.getBoundingClientRect().width||!container.getBoundingClientRect().height){pendingBounds={bounds,padding};return;}pendingBounds=null;map.fitBounds([[bounds[0],bounds[1]],[bounds[2],bounds[3]]],{padding:padding&&container.clientHeight>480?padding:55,maxZoom:14,pitch:overhead?0:50,duration:animate&&!matchMedia('(prefers-reduced-motion: reduce)').matches?850:0});};
 const observer=new ResizeObserver(()=>{map.resize();if(pendingBounds)fit(pendingBounds.bounds,false,pendingBounds.padding);});observer.observe(container);
 map.on('moveend',()=>onCamera({center:map.getCenter().toArray(),zoom:map.getZoom(),pitch:map.getPitch(),bearing:map.getBearing()}));
 return {set(data){if(destroyed)return;inspection.clear();map.getSource('watch-records').setData(data);},focus(bounds,animate=true,padding){if(destroyed)return;map.resize();fit(bounds,animate,padding);},overhead(value){overhead=value;map.easeTo({pitch:overhead?0:50,duration:matchMedia('(prefers-reduced-motion: reduce)').matches?0:400});},
  restore(view){if(!destroyed&&view){map.resize();map.jumpTo(view);}},resize(){if(!destroyed)map.resize();},
  watershed(feature){map.getSource('watch-basin').setData(feature||empty);},radar,radarVolume,forecastClouds,forecastWind,cloudTops,
  rain(image){setImage('watch-basin-rain',image,{'raster-opacity':.34});},
  snowCover(image){setImage('command-snow-cover',image,{'raster-opacity':['interpolate',['linear'],['zoom'],9,.7,11,.25,12,0],'raster-resampling':'nearest'});},
  snowfall(image){setImage('command-snowfall',image,{'raster-resampling':'nearest'});},
  highlightTriggers(features){map.getSource('command-triggers').setData({type:'FeatureCollection',features});},
  snowPoints(features){map.getSource('command-snow-points').setData({type:'FeatureCollection',features});},
  cloud(image){setImage('watch-goes-clouds',image,{'raster-opacity':.63,'raster-contrast':.48});},
  destroy(){if(destroyed)return;destroyed=true;observer.disconnect();inspection.destroy();windTrails?.destroy();map.remove();for(const url of imageUrls.values())URL.revokeObjectURL(url);}};
}
