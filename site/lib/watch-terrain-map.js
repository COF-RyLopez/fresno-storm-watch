import {pilotStyle,libreStyle} from './pilot-map.js';
import {waitForTerrain} from './watch-terrain-ready.js';
let protocol;
/** Lazy focused map. Only in-memory authorized display features enter this renderer. */
export async function createWatchTerrain({container,onSelect,onError}){
 const ml=await import('../vendor/maplibre-6.15.0/maplibre-gl.mjs');
 if(!protocol){const {Protocol}=await import('../vendor/pmtiles-4.5.0/pmtiles.js');protocol=new Protocol();ml.addProtocol('pmtiles',protocol.tile);}
 const style=libreStyle(await pilotStyle('watch','pmtiles'));
 style.sources.terrain={type:'raster-dem',tiles:['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],encoding:'terrarium',tileSize:256,maxzoom:14,attribution:'Terrain Tiles · Mapzen / Tilezen · reference elevation'};
 style.terrain={source:'terrain',exaggeration:1};
 const index=style.layers.findIndex(l=>l.type==='line'||l.type==='symbol');
 style.layers.splice(index<0?style.layers.length:index,0,{id:'terrain-shading',type:'hillshade',source:'terrain',paint:{'hillshade-exaggeration':.35,'hillshade-shadow-color':'#07131e','hillshade-highlight-color':'#a0b4b4','hillshade-accent-color':'#243340'}});
 const map=new ml.Map({container,style,center:[-119.6,36.8],zoom:8,pitch:50,maxPitch:60,attributionControl:{compact:true},renderWorldCopies:false,fadeDuration:0});
 try{await waitForTerrain(map,onError);}catch(e){map.remove();throw e;}
 map.addControl(new ml.NavigationControl({visualizePitch:true}),'bottom-left');
 map.addSource('watch-records',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
 map.addLayer({id:'watch-lines',type:'line',source:'watch-records',filter:['==',['geometry-type'],'LineString'],paint:{'line-color':['get','color'],'line-width':3}});
 map.addLayer({id:'watch-points',type:'circle',source:'watch-records',filter:['==',['geometry-type'],'Point'],paint:{'circle-color':['get','color'],'circle-radius':['case',['==',['get','kind'],'facility'],5,7],'circle-stroke-color':'#e8f6fb','circle-stroke-width':1.5}});
 // Facility diamonds distinguish assets from round gauge/watchpoint symbols without relying on color.
 const canvas=document.createElement('canvas');canvas.width=24;canvas.height=24;const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.beginPath();ctx.moveTo(12,1);ctx.lineTo(23,12);ctx.lineTo(12,23);ctx.lineTo(1,12);ctx.closePath();ctx.fill();map.addImage('facility',ctx.getImageData(0,0,24,24),{sdf:true});
 map.setFilter('watch-points',['all',['==',['geometry-type'],'Point'],['!=',['get','kind'],'facility']]);
 map.addLayer({id:'watch-facilities',type:'symbol',source:'watch-records',filter:['all',['==',['geometry-type'],'Point'],['==',['get','kind'],'facility']],layout:{'icon-image':'facility','icon-size':.6,'icon-allow-overlap':true},paint:{'icon-color':['get','color'],'icon-halo-color':'#e8f6fb','icon-halo-width':1}});
 const fonts=style.layers.find(l=>l.type==='symbol'&&l.layout?.['text-font']?.includes('Ubuntu Regular'))?.layout['text-font'];
 map.addLayer({id:'watch-labels',type:'symbol',source:'watch-records',filter:['==',['geometry-type'],'Point'],minzoom:10,layout:{'text-field':['get','name'],'text-size':12,'text-offset':[0,1.3],'text-anchor':'top',...(fonts?{'text-font':fonts}:{})},paint:{'text-color':'#e6f5fa','text-halo-color':'#18252c','text-halo-width':2}});
 map.on('click',e=>{const f=map.queryRenderedFeatures(e.point,{layers:['watch-points','watch-facilities','watch-lines']})[0];if(f)onSelect(f.properties);});
 let destroyed=false,overhead=false,pendingBounds=null;
 const fit=(bounds,animate)=>{if(!container.getBoundingClientRect().width||!container.getBoundingClientRect().height){pendingBounds=bounds;return;}pendingBounds=null;map.fitBounds([[bounds[0],bounds[1]],[bounds[2],bounds[3]]],{padding:55,maxZoom:14,pitch:overhead?0:50,duration:animate&&!matchMedia('(prefers-reduced-motion: reduce)').matches?850:0});};
 const observer=new ResizeObserver(()=>{map.resize();if(pendingBounds)fit(pendingBounds,false);});observer.observe(container);
 return {set(data){if(destroyed)return;map.getSource('watch-records').setData(data);},focus(bounds,animate=true){if(destroyed)return;map.resize();fit(bounds,animate);},overhead(value){overhead=value;map.easeTo({pitch:overhead?0:50,duration:matchMedia('(prefers-reduced-motion: reduce)').matches?0:400});},destroy(){if(destroyed)return;destroyed=true;observer.disconnect();map.remove();}};
}
