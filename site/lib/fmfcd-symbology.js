export const FMFCD_WEBMAP_DATA='https://www.arcgis.com/sharing/rest/content/items/10e99caf452e482e9e471571f9969930/data';
const PREFIX='https://services.arcgis.com/Z7HrzLV55ji5SaOw/arcgis/rest/services/FMFCD_Layers/FeatureServer/';
export const FMFCD_PALETTE=Object.freeze({pipe:[0,77,168,255],design:[115,178,255,255],master:[230,0,0,255],basin:[190,210,255],unknown:'#b3bac3'});

/** Only symbol overrides belonging to the fixed FMFCD service; no renderer expressions or external layers execute. */
export function fmfcdRendererOverrides(map){
  if(!Array.isArray(map?.operationalLayers))throw Error('FMFCD web-map styles unavailable.');
  const styles={};
  function walk(layers){for(const layer of layers){
    if(layer.url?.startsWith(PREFIX)&&/^\d+$/.test(layer.url.slice(PREFIX.length))&&layer.layerDefinition?.drawingInfo?.renderer)styles[Number(layer.url.slice(PREFIX.length))]=layer.layerDefinition.drawingInfo.renderer;
    if(Array.isArray(layer.layers))walk(layer.layers);
  }}walk(map.operationalLayers);return styles;
}

/** Exact publisher classes only; null/unknown outfall codes never inherit an existing-outfall symbol. */
export function fmfcdRendererSymbol(renderer,row){
  if(renderer?.type==='simple')return renderer.symbol;
  if(renderer?.type==='uniqueValue'){
    const value=row.attributes?.[renderer.field1];if(value===null||value===undefined)return null;
    return renderer.uniqueValueInfos?.find(info=>String(info.value)===String(value))?.symbol||null;
  }return null;
}
export const fmfcdLayerColor=id=>[1,2].includes(id)?FMFCD_PALETTE.master:[7,8].includes(id)?FMFCD_PALETTE.design:FMFCD_PALETTE.pipe;

/** Source-equivalent line-middle marker for a missing web-map style, with no inferred flow attributes. */
function fallbackPipe(id){
  const color=fmfcdLayerColor(id);
  return {type:'CIMSymbolReference',symbol:{type:'CIMLineSymbol',symbolLayers:[
    {type:'CIMVectorMarker',enable:true,size:8,frame:{xmin:0,ymin:0,xmax:17,ymax:17},markerPlacement:{type:'CIMMarkerPlacementOnLine',angleToLine:true,relativeTo:'LineMiddle'},markerGraphics:[{type:'CIMMarkerGraphic',geometry:{rings:[[[13.59,8.5],[3.41,17],[3.41,0],[13.59,8.5]]]},symbol:{type:'CIMPolygonSymbol',symbolLayers:[{type:'CIMSolidFill',enable:true,color}]}}],scaleSymbolsProportionally:true,respectFrame:true},
    {type:'CIMSolidStroke',enable:true,width:1.875,color}
  ]}};
}

/** Preserve FMFCD's hue/shape; light casing improves dark-map contrast. Unknowns get non-color qualifications. */
export function fmfcdDetailSymbol(row,renderer,{scene=false,dark=true}={}){
  const raw=fmfcdRendererSymbol(renderer,row),unknown=row.category==='unknown',color=fmfcdLayerColor(row.layerId),casing=dark?'#dfebff':'#333333';
  if(row.kind==='pipe'){
    if(scene)return {type:'simple-line',color:color.slice(0,3),width:2.5,style:unknown?'dash':'solid'};
    const data=structuredClone(raw?.type==='CIMSymbolReference'&&raw.symbol?.type==='CIMLineSymbol'?raw:fallbackPipe(row.layerId));
    const layers=data.symbol.symbolLayers,strokes=layers.filter(l=>l.type==='CIMSolidStroke');
    if(unknown)for(const stroke of strokes)stroke.effects=[...(stroke.effects||[]),{type:'CIMGeometricEffectDashes',dashTemplate:[3,3],lineDashEnding:'HalfPattern'}];
    if(dark){
      for(const marker of layers.filter(l=>l.type==='CIMVectorMarker'))for(const graphic of marker.markerGraphics||[])if(graphic.symbol?.type==='CIMPolygonSymbol')graphic.symbol.symbolLayers.unshift({type:'CIMSolidStroke',enable:true,width:.55,color:[223,235,255,255]});
      layers.push({type:'CIMSolidStroke',enable:true,width:3.1,color:[223,235,255,200],...(unknown?{effects:[{type:'CIMGeometricEffectDashes',dashTemplate:[3,3],lineDashEnding:'HalfPattern'}]}:{})});
    }
    return {type:'cim',data};
  }
  if(row.kind==='outfall'){
    if(unknown)return {type:'simple-marker',style:'diamond',size:7,color:[0,0,0,0],outline:{color:FMFCD_PALETTE.unknown,width:1.5}};
    if(raw?.type==='esriPMS'&&raw.contentType==='image/png'&&/^[A-Za-z0-9+/=]+$/.test(raw.imageData||'')&&raw.imageData.length<20000)return {type:'picture-marker',url:'data:image/png;base64,'+raw.imageData,width:6,height:6};
    return {type:'simple-marker',style:'square',size:6,color:(row.attributes.SUBTYPE===0?FMFCD_PALETTE.master:row.attributes.SUBTYPE===2?FMFCD_PALETTE.design:FMFCD_PALETTE.pipe).slice(0,3),outline:{color:casing,width:.8}};
  }
  return {type:'simple-marker',style:'square',size:5,color:unknown?[0,0,0,0]:(raw?.color||color).slice(0,3),outline:{color:unknown?FMFCD_PALETTE.unknown:casing,width:unknown?1.4:.7}};
}

/** One terrain-draped triangle per source path. Preserve vertex order across multipart gaps; never derive direction from stage. */
export function fmfcdSceneArrows(geometry,scale=10000){
  const length=Math.max(2,Math.min(60,scale*.0025)),polygons=[];
  for(const path of geometry.paths||[]){
    const segments=[];let total=0;
    for(let i=1;i<path.length;i++){
      const a=path[i-1],b=path[i],mx=111320*Math.cos((a[1]+b[1])/2*Math.PI/180),dx=(b[0]-a[0])*mx,dy=(b[1]-a[1])*111320,n=Math.hypot(dx,dy);
      if(n>0){segments.push({a,b,mx,dx,dy,n,start:total});total+=n;}
    }
    if(total<length)continue;
    const s=segments.find(s=>s.start+s.n>=total/2),f=(total/2-s.start)/s.n,x=s.a[0]+(s.b[0]-s.a[0])*f,y=s.a[1]+(s.b[1]-s.a[1])*f,ux=s.dx/s.n,uy=s.dy/s.n;
    const xy=(forward,side)=>[x+(ux*forward-uy*side)/s.mx,y+(uy*forward+ux*side)/111320];
    const tip=xy(length*.5,0);polygons.push({rings:[[tip,xy(-length*.5,length*.55),xy(-length*.5,-length*.55),tip]],spatialReference:{wkid:4326}});
  }return polygons;
}

/** FMFCD basin-fill and drainage-boundary palette, with transparency for county operational overlays. Pumps retain county review symbols. */
export function fmfcdInventorySymbol(row,{dark=true}={}){
  if(row.kind==='basin')return {type:'simple-fill',color:row.category==='existing'?[...FMFCD_PALETTE.basin,.32]:[0,0,0,0],outline:{color:row.category==='existing'?dark?'#b4c4db':'#6e6e6e':row.category==='proposed'?'#f2c572':'#b3bac3',width:row.category==='existing'?.9:1.5,style:row.category==='existing'?'solid':'dash'}};
  if(row.kind==='catchment')return {type:'simple-fill',style:'none',outline:{color:dark?'#d7e0e4':'#000000',width:1,style:'solid'}};
  const color=row.category==='existing'?'#65cad1':row.category==='proposed'?'#f2c572':'#b3bac3';
  return {type:'simple-marker',style:row.category==='existing'?'circle':row.category==='proposed'?'triangle':'x',size:12,color:row.category==='existing'?color:[0,0,0,0],outline:{color,width:2}};
}
