import {FMFCD_DETAIL_CATEGORIES} from './drainage-nearby-model.js?v=0.53.0';
export const DETAIL_KEYS=Object.freeze({mapped:'drainageNetwork',unknown:'drainageNetworkUnknown',planned:'drainageNetworkPlanned'});
/** Selection-bounded reference graphics. Proposed and unknown features never share the mapped-asset symbol. */
export function createDrainageDetailMap({GraphicsLayer,Graphic,registerLayer,setLayerEligibility,focusGeometry}){
  let rows=[];
  const layers=Object.fromEntries(Object.entries(DETAIL_KEYS).map(([category,key])=>{
    const layer=new GraphicsLayer({title:'FMFCD nearby · '+FMFCD_DETAIL_CATEGORIES[category].label,elevationInfo:{mode:'on-the-ground'},popupEnabled:false});registerLayer(key,layer,false);return [category,layer];
  }));
  function set(records){
    rows=records;for(const layer of Object.values(layers))layer.removeAll();
    for(const r of records){
      const color=FMFCD_DETAIL_CATEGORIES[r.category].color,planned=r.category==='planned',unknown=r.category==='unknown';
      const symbol=r.kind==='pipe'?{type:'simple-line',color,width:2.5,style:planned?'dash':unknown?'dot':'solid'}:{type:'simple-marker',style:r.kind==='outfall'?'diamond':'square',size:r.kind==='outfall'?10:7,color:planned?[0,0,0,0]:color,outline:{color:planned?color:'#202020',width:1.3}};
      layers[r.category].add(new Graphic({geometry:{...r.geometry,type:r.kind==='pipe'?'polyline':'point'},attributes:{drainageDetailKey:r.key},symbol}));
    }
    for(const [category,layer]of Object.entries(layers))setLayerEligibility(layer,layer.graphics.length>0);
  }
  return {set,clear:()=>set([]),focus(key){const row=rows.find(r=>r.key===key);if(!row)return Promise.resolve(false);return focusGeometry(new Graphic({geometry:{...row.geometry,type:row.kind==='pipe'?'polyline':'point'}}).geometry,row.kind==='pipe'?null:6000);}};
}
