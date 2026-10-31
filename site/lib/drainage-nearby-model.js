import {searchGeometry} from './nearby-search.js';

export const FMFCD_DETAIL_URL='https://services.arcgis.com/Z7HrzLV55ji5SaOw/arcgis/rest/services/FMFCD_Layers/FeatureServer';
export const FMFCD_DETAIL_LIMIT=1200;
export const FMFCD_DETAIL_CATEGORIES=Object.freeze({mapped:{label:'Mapped assets · operation unconfirmed',color:'#65cad1'},unknown:{label:'Classification unconfirmed',color:'#b3bac3'},planned:{label:'Proposed / design · not confirmed built',color:'#f2c572'}});
export const FMFCD_DETAIL_LAYERS=Object.freeze([
  {id:6,kind:'pipe',name:'Pipes',geometry:'esriGeometryPolyline',fields:['AS_BUILT','CONTRACT','AGENCY','DA','FL_UP','FL_DN','DIAMETER','SLOPE']},
  {id:3,kind:'inlet',name:'Inlets',geometry:'esriGeometryPoint',fields:['CONTRACT','AS_BUILT','AGENCY','TYPE','ELEV']},
  {id:5,kind:'outfall',name:'Outfalls',geometry:'esriGeometryPoint',fields:['CONTRACT','AS_BUILT','TYPE','SUBTYPE','TS','BASIN','AGENCY']},
  {id:2,kind:'pipe',name:'Master-plan pipes',planned:true,geometry:'esriGeometryPolyline',fields:['DA','DIAMETER','TYPE','DESIGN','BASIN']},
  {id:1,kind:'inlet',name:'Master-plan inlets',planned:true,geometry:'esriGeometryPoint',fields:['INLET_NO','DA']},
  {id:8,kind:'pipe',name:'Design pipes',planned:true,geometry:'esriGeometryPolyline',fields:['DIAMETER','CONTRACT']},
  {id:7,kind:'inlet',name:'Design inlets',planned:true,geometry:'esriGeometryPoint',fields:['CONTRACT','TYPE']}
]);

/** Fixed distances in metres around the complete selected outline; never a travel or drainage trace. */
export function drainageDetailScope(record,radius){
  if(!['basin','pump'].includes(record?.kind)||!searchGeometry(record.geometry)||!record.key||record.kind==='basin'&&!record.geometry.rings||record.kind==='pump'&&!Number.isFinite(record.geometry.x))throw Error('A valid basin or pump selection is required.');
  if(![250,500,1000].includes(radius))throw Error('Choose 250, 500 or 1,000 metres.');
  const {shape}=searchGeometry(record.geometry);
  return {where:'1=1',geometry:JSON.stringify(record.geometry),geometryType:shape.type==='polygon'?'esriGeometryPolygon':'esriGeometryPoint',inSR:4326,spatialRel:'esriSpatialRelIntersects',distance:radius,units:'esriSRUnit_Meter'};
}

/** Conservative display fit around the query area; not an analytical buffer or inundation outline. */
export function drainageDetailExtent(record,radius){
  drainageDetailScope(record,radius);const {bounds}=searchGeometry(record.geometry);
  const latitude=(bounds[1]+bounds[3])/2,dy=radius/110000,dx=dy/Math.cos(latitude*Math.PI/180);
  return {xmin:bounds[0]-dx,ymin:bounds[1]-dy,xmax:bounds[2]+dx,ymax:bounds[3]+dy,spatialReference:{wkid:4326}};
}

/** Unknown source codes, missing as-built years and implausible dates never become existing assets. */
export function drainageDetailCategory(spec,a,year=new Date().getFullYear()){
  if(spec.planned||/FUTURE|PROPOSED|DESIGN/i.test(String(a.CONTRACT||'')))return 'planned';
  if(spec.kind==='outfall')return a.SUBTYPE===1?'mapped':[0,2].includes(a.SUBTYPE)?'planned':'unknown';
  const text=String(a.AS_BUILT??'').trim(),built=/^\d{4}$/.test(text)?Number(text):null;
  return built>=1900&&built<=year?'mapped':built>year&&built<=2100?'planned':'unknown';
}

export function drainageDetailSchema(spec,m){
  const oid=m.objectIdField||m.fields?.find(f=>f.type==='esriFieldTypeOID')?.name;
  if(m.geometryType!==spec.geometry||!oid||spec.fields.some(name=>!m.fields?.some(f=>f.name===name))||m.advancedQueryCapabilities?.supportsQueryWithDistance!==true)throw Error('Publisher schema or proximity-query support changed.');
  return oid;
}

export function drainageDetailRecord(spec,feature,oid){
  const a=feature.attributes,g={...feature.geometry,spatialReference:{wkid:4326}};
  if(!Number.isSafeInteger(a?.[oid])||a[oid]<0||!searchGeometry(g)||spec.geometry==='esriGeometryPolyline'&&!g.paths||spec.geometry==='esriGeometryPoint'&&!Number.isFinite(g.x))throw Error('Publisher record identity or geometry is invalid.');
  const attributes=Object.fromEntries(spec.fields.map(name=>[name,a[name]??null]));
  return {key:`fmfcd-detail:${spec.id}:${a[oid]}`,id:a[oid],layerId:spec.id,kind:spec.kind,name:`${spec.name} · ${a[oid]}`,category:drainageDetailCategory(spec,a),geometry:g,attributes,source:FMFCD_DETAIL_URL+'/'+spec.id};
}
