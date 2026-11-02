/** Name labels for point GraphicsLayers. GraphicsLayer has no labelingInfo, so each one gets an invisible client-side
 * FeatureLayer that only draws labels: the SDK applies the scale limit and drops overlapping labels (deconfliction).
 * Register it under the same workspace key as its GraphicsLayer so the two switch on and off together.
 * ponytail: labels only; switch to AnnotationFeatureLayer if hand-placed, published annotation is ever needed. */
/** Labels from about one zoom step in from the county view. Further out the basemap's own lake and place names already crowd the map. */
export const LABEL_MIN_SCALE=1_000_000;
const labelLayers=new Set();let labelsShown=true;
const TEXT=Object.freeze({type:'text',color:'#e5f6ff',haloColor:'#17232b',haloSize:1.5,lineWidth:220,font:{size:10,family:'Arial',weight:'bold'}});
/** Map tools "Map labels" switch: hides every name label without changing which layers are on. Page memory only. */
export function setMapLabels(on){labelsShown=!!on;for(const layer of labelLayers)layer.labelsVisible=labelsShown;}

/** @param {{FeatureLayer:Function,Graphic:Function}} sdk @param {{title:string,below?:boolean,minScale?:number}} options below: under the symbol (reservoirs, so basemap lake names centred on the water stay readable); minScale: tighter for dense layers. */
export function createLabelLayer({FeatureLayer,Graphic},{title,below=false,minScale=LABEL_MIN_SCALE}){
  const layer=new FeatureLayer({title,source:[],objectIdField:'oid',fields:[{name:'oid',type:'oid'},{name:'label',type:'string'}],
    geometryType:'point',spatialReference:{wkid:4326},popupEnabled:false,labelsVisible:labelsShown,listMode:'hide',elevationInfo:{mode:'relative-to-ground'},
    renderer:{type:'simple',symbol:{type:'simple-marker',size:1,color:[0,0,0,0],outline:{width:0}}},
    labelingInfo:[{labelExpressionInfo:{expression:'$feature.label'},labelPlacement:below?'below-center':'above-center',deconflictionStrategy:'static',minScale,maxScale:0,
      symbol:{...TEXT,yoffset:below?-9:9}}]});
  labelLayers.add(layer);let queue=Promise.resolve(),last='';
  /** @param {{longitude:number,latitude:number,label:string}[]} rows Replaces every label; unchanged rows are skipped. */
  function set(rows){
    const next=JSON.stringify(rows);if(next===last)return queue;last=next;
    queue=queue.then(async()=>{
      const old=await layer.queryFeatures();
      await layer.applyEdits({deleteFeatures:old.features,addFeatures:rows.map(r=>new Graphic({geometry:{type:'point',longitude:r.longitude,latitude:r.latitude,spatialReference:{wkid:4326}},attributes:{label:r.label}}))});
    }).catch(()=>{/* Labels are optional; the symbols and their panels still work. */});
    return queue;
  }
  return {layer,set};
}

/** Labels on a polygon FeatureLayer (it has labelingInfo itself), joined to the Map labels switch.
 * @param {object} layer FeatureLayer @param {{expression:string,minScale:number,color?:string}} options Arcade label (empty string = no label); polygons label only when zoomed in this far. */
export function labelPolygons(layer,{expression,minScale,color=TEXT.color}){
  layer.labelingInfo=[{labelExpressionInfo:{expression},labelPlacement:'always-horizontal',deconflictionStrategy:'static',minScale,maxScale:0,symbol:{...TEXT,color,font:{...TEXT.font,size:9}}}];
  layer.labelsVisible=labelsShown;labelLayers.add(layer);return layer;
}

/** Road closures and cameras are dense along the highways, so they label only when zoomed in this far. */
export const DENSE_LABEL_MIN_SCALE=250_000;
/** @param {{x?:number,y?:number,paths?:number[][][]}} geometry lon/lat point or polyline @returns {{longitude:number,latitude:number}|null} Point, or the middle vertex of the first path. */
export function labelPoint(geometry){
  if(Number.isFinite(geometry?.x)&&Number.isFinite(geometry?.y))return {longitude:geometry.x,latitude:geometry.y};
  const path=geometry?.paths?.[0],p=path?.[Math.floor((path.length-1)/2)];
  return p&&Number.isFinite(p[0])&&Number.isFinite(p[1])?{longitude:p[0],latitude:p[1]}:null;
}

/** @param {string} name @returns {string} Map label: drops the "(USGS)" suffix the list keeps for source clarity. */
export const gaugeLabel=name=>String(name||'').replace(/\s*\(USGS\)\s*$/,'');
