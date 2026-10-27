import {FMFCD_DETAIL_CATEGORIES} from './drainage-nearby-model.js?v=0.53.0';
import {fmfcdDetailSymbol,fmfcdSceneArrows,fmfcdLayerColor} from './fmfcd-symbology.js?v=0.54.0';
export const DETAIL_KEYS=Object.freeze({mapped:'drainageNetwork',unknown:'drainageNetworkUnknown',planned:'drainageNetworkPlanned'});
/** Selection-bounded reference graphics. Proposed and unknown features never share the mapped-asset symbol. */
export function createDrainageDetailMap({GraphicsLayer,Graphic,registerLayer,setLayerEligibility,focusGeometry,getView=()=>({type:'2d',scale:10000}),isDark=()=>true}){
  let rows=[],renderers={};
  const layers=Object.fromEntries(Object.entries(DETAIL_KEYS).map(([category,key])=>{
    const layer=new GraphicsLayer({title:'FMFCD nearby · '+FMFCD_DETAIL_CATEGORIES[category].label,elevationInfo:{mode:'on-the-ground'},popupEnabled:false});registerLayer(key,layer,false);return [category,layer];
  }));
  function sync(){
    const scene=getView().type==='3d',dark=isDark();for(const layer of Object.values(layers))layer.removeAll();
    for(const r of rows){
      const symbol=fmfcdDetailSymbol(r,renderers[r.layerId],{scene,dark});
      if(scene&&dark&&r.kind==='pipe')layers[r.category].add(new Graphic({geometry:{...r.geometry,type:'polyline'},attributes:{drainageDetailKey:r.key},symbol:{type:'simple-line',color:'#dfebff',width:3.7,style:r.category==='unknown'?'dash':'solid'}}));
      layers[r.category].add(new Graphic({geometry:{...r.geometry,type:r.kind==='pipe'?'polyline':'point'},attributes:{drainageDetailKey:r.key},symbol}));
      if(scene&&r.kind==='pipe'){
        // CIM line symbols are 2D-only in SDK 5.1; preserve mapped orientation with draped triangles.
        for(const polygon of fmfcdSceneArrows(r.geometry,getView().scale))layers[r.category].add(new Graphic({geometry:{...polygon,type:'polygon'},attributes:{drainageDetailKey:r.key},symbol:{type:'simple-fill',color:fmfcdLayerColor(r.layerId).slice(0,3),outline:{color:dark?'#dfebff':'#333333',width:.7}}}));
      }
    }
    for(const [category,layer]of Object.entries(layers))setLayerEligibility(layer,layer.graphics.length>0);
  }
  function set(records,styles={}){rows=records;renderers=styles;sync();}
  return {set,sync,clear:()=>set([]),focus(key){const row=rows.find(r=>r.key===key);if(!row)return Promise.resolve(false);return focusGeometry(new Graphic({geometry:{...row.geometry,type:row.kind==='pipe'?'polyline':'point'}}).geometry,row.kind==='pipe'?null:6000);}};
}
