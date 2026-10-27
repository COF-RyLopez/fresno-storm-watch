import {FMFCD_DETAIL_CATEGORIES} from './drainage-nearby-model.js?v=0.53.0';
import {fmfcdDetailSymbol,fmfcdSceneArrows,fmfcdLayerColor} from './fmfcd-symbology.js?v=0.54.0';
import {CONNECTION_GROUPS,connectionShown} from './drainage-connections.js?v=0.55.0';
export const DETAIL_KEYS=Object.freeze({mapped:'drainageNetwork',unknown:'drainageNetworkUnknown',planned:'drainageNetworkPlanned'});
/** Selection-bounded reference graphics. Proposed and unknown features never share the mapped-asset symbol. */
export function createDrainageDetailMap({GraphicsLayer,Graphic,registerLayer,setLayerEligibility,focusGeometry,getView=()=>({type:'2d',scale:10000}),isDark=()=>true}){
  let rows=[],renderers={},trace=null,mode='nearby';
  const layers=Object.fromEntries(Object.entries(DETAIL_KEYS).map(([category,key])=>{
    const layer=new GraphicsLayer({title:'FMFCD nearby · '+FMFCD_DETAIL_CATEGORIES[category].label,elevationInfo:{mode:'on-the-ground'},popupEnabled:false});registerLayer(key,layer,false);return [category,layer];
  }));
  const connections=new GraphicsLayer({title:'FMFCD candidate connections · unverified',elevationInfo:{mode:'on-the-ground'},popupEnabled:false});registerLayer('drainageNetwork',connections,false);
  function sync(){
    const scene=getView().type==='3d',dark=isDark(),focused=mode!=='nearby'&&trace?.items.length>0;connections.removeAll();for(const layer of Object.values(layers)){layer.removeAll();layer.opacity=focused ? 0.22 : 1;}
    for(const r of rows){
      const symbol=fmfcdDetailSymbol(r,renderers[r.layerId],{scene,dark});
      if(scene&&dark&&r.kind==='pipe')layers[r.category].add(new Graphic({geometry:{...r.geometry,type:'polyline'},attributes:{drainageDetailKey:r.key},symbol:{type:'simple-line',color:'#dfebff',width:3.7,style:r.category==='unknown'?'dash':'solid'}}));
      layers[r.category].add(new Graphic({geometry:{...r.geometry,type:r.kind==='pipe'?'polyline':'point'},attributes:{drainageDetailKey:r.key},symbol}));
      if(scene&&r.kind==='pipe'){
        // CIM line symbols are 2D-only in SDK 5.1; preserve mapped orientation with draped triangles.
        for(const polygon of fmfcdSceneArrows(r.geometry,getView().scale))layers[r.category].add(new Graphic({geometry:{...polygon,type:'polygon'},attributes:{drainageDetailKey:r.key},symbol:{type:'simple-fill',color:fmfcdLayerColor(r.layerId).slice(0,3),outline:{color:dark?'#dfebff':'#333333',width:.7}}}));
      }
    }
    if(focused){
      const byKey=new Map(rows.map(r=>[r.key,r]));
      for(const line of trace.lines.filter(l=>connectionShown(l.group,mode))){
        const row=byKey.get(line.key);if(!row)continue;
        const hex=CONNECTION_GROUPS[line.group].color,rgb=hex.match(/[a-f\d]{2}/gi).map(v=>parseInt(v,16));
        const symbol=fmfcdDetailSymbol({...row,category:'unknown'},null,{scene,dark});
        if(scene){symbol.color=rgb;symbol.width=4;}else{
          for(const stroke of symbol.data.symbol.symbolLayers.filter(l=>l.type==='CIMSolidStroke'&&l.color?.[0]===0)){stroke.color=[...rgb,255];stroke.width=3;}
          for(const marker of symbol.data.symbol.symbolLayers.filter(l=>l.type==='CIMVectorMarker'))for(const graphic of marker.markerGraphics||[])for(const fill of graphic.symbol?.symbolLayers||[])if(fill.type==='CIMSolidFill')fill.color=[...rgb,255];
        }
        connections.add(new Graphic({geometry:{...line.geometry,type:'polyline'},attributes:{drainageDetailKey:row.key},symbol}));
        if(scene)for(const polygon of fmfcdSceneArrows(line.geometry,getView().scale))connections.add(new Graphic({geometry:{...polygon,type:'polygon'},attributes:{drainageDetailKey:row.key},symbol:{type:'simple-fill',color:rgb,outline:{color:dark?'#ffffff':'#202427',width:.8}}}));
      }
      for(const item of trace.items.filter(i=>i.row.kind!=='pipe'&&connectionShown(i.group,mode)))connections.add(new Graphic({geometry:{...item.row.geometry,type:'point'},attributes:{drainageDetailKey:item.row.key},symbol:{type:'simple-marker',style:item.row.kind==='inlet'?'square':'diamond',size:9,color:[0,0,0,0],outline:{color:CONNECTION_GROUPS[item.group].color,width:2.5}}}));
      if(trace.seedLink)connections.add(new Graphic({geometry:{...trace.seedLink.geometry,type:'polyline'},attributes:{drainageDetailKey:trace.seedLink.key},symbol:{type:'simple-line',color:CONNECTION_GROUPS.unknown.color,width:3,style:'dash'}}));
    }
    for(const [category,layer]of Object.entries(layers))setLayerEligibility(layer,layer.graphics.length>0);
    setLayerEligibility(connections,connections.graphics.length>0);
  }
  function set(records,styles={},options={}){rows=records;renderers=styles;trace=options.trace||null;mode=options.mode||'nearby';sync();}
  return {set,sync,clear:()=>set([]),focus(key){const row=rows.find(r=>r.key===key);if(!row)return Promise.resolve(false);return focusGeometry(new Graphic({geometry:{...row.geometry,type:row.kind==='pipe'?'polyline':'point'}}).geometry,row.kind==='pipe'?null:6000);}};
}
