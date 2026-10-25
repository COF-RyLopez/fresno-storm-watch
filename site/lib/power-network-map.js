import {NETWORK_LAYER_KEYS,NETWORK_SCALES,networkSymbol,networkSourceProblem} from './power-network-model.js?v=0.50.0';
/** A focused reference is separate from verified event identity. The grid never supplies a fault or trace. */
export function createNetworkMap({GraphicsLayer,Graphic,Extent,registerLayer,setLayerEligibility,focusGeometry,onSelect}){
  const layers={},focusLayers={};
  for(const [kind,key]of Object.entries(NETWORK_LAYER_KEYS)){
    const layer=new GraphicsLayer({title:kind==='circuit'?'Distribution circuits · local detail':kind==='line'?'Transmission lines · area detail':'Substations · area detail',elevationInfo:{mode:'on-the-ground'},popupEnabled:false,minScale:NETWORK_SCALES[kind]});
    registerLayer(key,layer,false,3);layers[kind]=layer;
    const focused=new GraphicsLayer({title:'Selected utility reference · connection unverified',elevationInfo:{mode:'on-the-ground'},popupEnabled:false});
    registerLayer(key,focused,false);focusLayers[kind]=focused;
  }
  const nearby=new GraphicsLayer({title:'Selected nearby county place · proximity only',elevationInfo:{mode:'on-the-ground'},popupEnabled:false});registerLayer('facilities',nearby,false);
  let snapshot=null,features=new Map(),match=null,referenceKeys=[];
  const dark=()=>document.querySelector?.('#map')?.dataset.basemap!=='light';
  const geometry=f=>({...f.geometry,type:f.geometry.paths?'polyline':f.geometry.rings?'polygon':'point'});
  function drawFocus(){
    const verified=match?.state==='matched'&&match.circuits.length>0&&match.circuits.every(f=>features.get(f.key)?.code===f.code&&!networkSourceProblem(snapshot?.sources.find(s=>s.id===f.sourceId)));
    const keys=verified?match.circuits.map(f=>f.key):referenceKeys;
    const selected=keys.map(key=>features.get(key)).filter(Boolean),active=selected.length>0;
    for(const [kind,layer]of Object.entries(focusLayers)){
      layer.removeAll();const rows=selected.filter(f=>f.kind===kind);
      layer.addMany(rows.map(f=>new Graphic({geometry:geometry(f),attributes:{networkKey:f.key},symbol:networkSymbol(f,{highlight:verified,selected:true,stale:!verified&&!!networkSourceProblem(snapshot?.sources.find(s=>s.id===f.sourceId)),dark:dark()})})));
      setLayerEligibility(layer,rows.length>0);layers[kind].opacity=active ? 0.16 : 1;
    }
    const host=document.querySelector?.('#map');if(host)host.dataset.networkFocus=active?(verified?'verified':'reference'):'none';
  }
  const controller={
    setSnapshot(data,force=false){
      if(data===snapshot&&!force)return;snapshot=data;features=new Map();
      for(const [kind,layer]of Object.entries(layers)){
        layer.removeAll();const rows=(data?.sources||[]).flatMap(s=>s.features.filter(f=>f.kind===kind).map(f=>({f,stale:!!networkSourceProblem(s)})));
        for(const {f}of rows)features.set(f.key,f);
        layer.addMany(rows.map(({f,stale})=>new Graphic({geometry:geometry(f),attributes:{networkKey:f.key},symbol:networkSymbol(f,{stale,dark:dark()})})));setLayerEligibility(layer,rows.length>0);
      }
      drawFocus();
    },
    setReference(keys){match=null;referenceKeys=[...new Set(keys)];controller.clearNearby();drawFocus();},
    setMatch(value){match=value;referenceKeys=[];drawFocus();},
    clearMatch(){match=null;referenceKeys=[];controller.clearNearby();drawFocus();},
    select:key=>{const f=features.get(key);if(f)onSelect(f);},
    focus(keys){
      const selected=keys.map(k=>features.get(k)).filter(Boolean);if(!selected.length)return false;
      const points=selected.flatMap(f=>f.geometry.paths?.flat()||[[f.geometry.x,f.geometry.y]]);
      const bounds=points.reduce((b,[x,y])=>[Math.min(b[0],x),Math.min(b[1],y),Math.max(b[2],x),Math.max(b[3],y)],[Infinity,Infinity,-Infinity,-Infinity]);
      return focusGeometry(new Extent({xmin:bounds[0]-.005,xmax:bounds[2]+.005,ymin:bounds[1]-.005,ymax:bounds[3]+.005,spatialReference:{wkid:4326}}));
    },
    showNearby(shape,category){
      const type=shape.paths?'polyline':shape.rings?'polygon':'point';nearby.removeAll();
      const symbol=type==='point'?{type:'simple-marker',style:category==='pump'?'circle':'diamond',size:18,color:[0,0,0,0],outline:{color:'#ffffff',width:3}}:type==='polygon'?{type:'simple-fill',style:'none',outline:{color:'#ffffff',width:3}}:{type:'simple-line',color:'#ffffff',width:3};
      const graphic=new Graphic({geometry:{...shape,type},symbol});nearby.addMany([graphic]);setLayerEligibility(nearby,true);return focusGeometry(graphic.geometry,type==='point'?14000:null);
    },
    clearNearby(){nearby.removeAll();setLayerEligibility(nearby,false);},layers,focusLayers
  };
  for(const event of ['storm-theme-change','storm-basemap-change'])window.addEventListener(event,()=>controller.setSnapshot(snapshot,true));
  return controller;
}
