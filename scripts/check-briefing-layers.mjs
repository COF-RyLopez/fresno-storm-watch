import {BRIEFING_LAYERS,briefingLayerCycle,briefingLayerLegend} from '../site/lib/briefing-layer-model.js';
/** Read-only source contract smoke test; no credentials, feature geometry or private records. */
const records=await Promise.all(BRIEFING_LAYERS.map(async step=>{
  try{
  const q=new URL(`${step.service}/${step.layer}/query`);q.search=new URLSearchParams({f:'json',where:'1=1',outFields:'product,issue_time,start_time,end_time'+(step.field==='qpf'?',units':''),returnGeometry:'false',returnDistinctValues:'true'});
  const json=async u=>{const r=await fetch(u,{signal:AbortSignal.timeout(25_000)});if(!r.ok)throw new Error(`HTTP ${r.status}`);return r.json();};
  const [d,m,l]=await Promise.all([json(q),json(`${step.service}/${step.layer}?f=json`),json(`${step.service}/legend?f=json`)]);
  const c=briefingLayerCycle(d,step),legend=briefingLayerLegend(l,step);
  if(m.geometryType!=='esriGeometryPolygon'||m.drawingInfo?.renderer?.field1!==step.field)throw new Error(step.id+': schema/renderer changed');
  return {id:step.id,status:'verified',url:`${step.service}/${step.layer}`,query:q.href,product:step.product,issue:new Date(c.issue).toISOString(),start:new Date(c.start).toISOString(),end:new Date(c.end).toISOString(),sourceSpatialReference:m.extent.spatialReference,rendererField:step.field,legendLabels:legend.map(s=>s.label),relationship:step.relationship};
  }catch(e){return {id:step.id,url:`${step.service}/${step.layer}`,status:'withheld',reason:e.message};}
}));
console.log(JSON.stringify({checked:new Date().toISOString(),publisher:'NOAA / National Weather Service / Weather Prediction Center',access:'Public direct services; source geometry/CRS and publisher renderers retained by ArcGIS SDK. No data redistribution or local feature conversion.',records},null,2));
