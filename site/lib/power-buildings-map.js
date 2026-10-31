import {BUILDING_LIMITS} from './power-buildings-model.js?v=0.74.0-helpers';
import {powerFocusExtent} from './power-focus.js?v=0.74.0-helpers';

/** Small selected-footprint layers; only published positive metre heights receive extrusion. */
export function createPowerBuildingsMap({FeatureLayer,Graphic,Extent,registerLayer,removeLayer,getView,focusGeometry}){
  let layers=[],records=[],labels=true;
  const fields=[{name:'ObjectID',type:'oid'},{name:'building_id',type:'string'},{name:'address_label',type:'string'},{name:'height_m',type:'double'}];
  function renderer(extrude,unknown){return {type:'simple',symbol:extrude?{type:'polygon-3d',symbolLayers:[{type:'extrude',material:{color:'#efc974'},edges:{type:'solid',color:'#573f21',size:.6}}]}:{type:'simple-fill',color:[239,201,116,unknown ? 0.15 : 0.45],outline:{color:'#efc974',width:1,style:unknown?'dash':'solid'}},...(extrude?{visualVariables:[{type:'size',field:'height_m',valueUnit:'meters'}]}:{})};}
  function sync(){
    const scene=getView().type==='3d';
    for(const layer of layers){layer.renderer=renderer(scene&&layer.id.endsWith('-height'),layer.id.endsWith('-flat'));layer.labelsVisible=labels;layer.labelingInfo=[{labelExpressionInfo:{expression:"IIf(IsEmpty($feature.address_label), '', $feature.address_label)"},labelPlacement:scene?'above-center':'always-horizontal',minScale:BUILDING_LIMITS.labelsScale,symbol:scene?{type:'label-3d',symbolLayers:[{type:'text',material:{color:'#fff3d6'},halo:{color:'#252525',size:1.5},size:10}],verticalOffset:{screenLength:18,minWorldLength:6,maxWorldLength:40},callout:{type:'line',color:'#efc974',size:.6}}:{type:'text',color:'#fff3d6',haloColor:'#252525',haloSize:1.5,font:{size:10,family:'Arial'}}}];}
  }
  function clear(){for(const l of layers){removeLayer(l);l.destroy();}layers=[];records=[];}
  async function set(rows){
    clear();records=rows;
    for(const known of [true,false]){
      const subset=rows.filter(r=>(r.height!==null)===known);if(!subset.length)continue;
      const layer=new FeatureLayer({id:known?'power-overlap-buildings-height':'power-overlap-buildings-flat',title:known?'Overture footprints overlapping selected power area · approximate height':'Overture overlap footprints · height unknown (flat)',copyright:'© OpenStreetMap contributors, Overture Maps Foundation; Microsoft, Esri. Addresses: County of Fresno via OpenAddresses / Overture.',source:subset.map((r,i)=>new Graphic({geometry:{...r.geometry,type:'polygon'},attributes:{ObjectID:i+1,building_id:r.id,height_m:r.height,address_label:r.addresses.length===1?r.addresses[0]:r.addresses.length>1?`${r.addresses.length} addresses · inspect list`:''}})),objectIdField:'ObjectID',fields,geometryType:'polygon',spatialReference:{wkid:4326},elevationInfo:{mode:'on-the-ground'},outFields:['*'],popupEnabled:false,minScale:BUILDING_LIMITS.drawScale});
      registerLayer('power',layer,true);layers.push(layer);
    }
    sync();
    await Promise.all(layers.map(l=>l.load()));
  }
  return {set,clear,sync,setLabels(value){labels=value;sync();},focusAll(options){const bounds=powerFocusExtent(records.map(r=>r.geometry));if(!bounds)return Promise.resolve(false);return focusGeometry(new Extent(bounds),null,options);},async focus(id){const row=records.find(r=>r.id===id);if(!row)return;return focusGeometry(new Graphic({geometry:{...row.geometry,type:'polygon'}}).geometry,2500);}};
}
