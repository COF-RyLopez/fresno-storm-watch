/** Display-only label thinning. No source lines, names or network topology are edited. */
const finitePoint=p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y);
const normalize=name=>typeof name==='string'?name.trim().replace(/\s+/g,' '):'';

/** Clip a screen segment to the viewport; return its original line parameters. */
function clip(a,b,box){
  let start=0,end=1;const dx=b.x-a.x,dy=b.y-a.y;
  for(const [p,q]of [[-dx,a.x-box.left],[dx,box.right-a.x],[-dy,a.y-box.top],[dy,box.bottom-a.y]]){
    if(p===0){if(q<0)return null;continue;}
    const r=q/p;if(p<0)start=Math.max(start,r);else end=Math.min(end,r);if(start>end)return null;
  }
  return [start,end];
}

/** One label per normalized publisher name, anchored on a visible source segment.
 * Screen-space spacing is presentation only, never a ground-distance buffer.
 * O(vertices + candidates log candidates); collision checks are bounded to 40 labels.
 */
export function waterwayLabelCandidates(features,{width,height,project,maxLabels=40,blocked=[]}){
  if(!(width>80&&height>60))return [];
  const box={left:20,right:width-20,top:20,bottom:height-20},names=new Map();
  let samples=0;const maxSegments=2400,perFeature=Math.max(1,Math.min(32,Math.floor(maxSegments/Math.max(1,features.length))));
  for(const feature of features){
    if(samples>=maxSegments)break;
    const name=normalize(feature.attributes?.gnisidlabel),key=name.toLocaleLowerCase('en-US');
    if(!name||!feature.geometry?.paths)continue;
    let featureSamples=0;
    for(const path of feature.geometry.paths){
      // Sample original adjacent segments, never connect across skipped vertices.
      const stride=Math.max(1,Math.ceil((path.length-1)/perFeature));
      for(let i=1;i<path.length&&samples<maxSegments&&featureSamples<perFeature;i+=stride){
        samples++;featureSamples++;
        const a=path[i-1],b=path[i];if(![a?.[0],a?.[1],b?.[0],b?.[1]].every(Number.isFinite))continue;
        const screenA=project(a,feature.geometry.spatialReference),screenB=project(b,feature.geometry.spatialReference);
        if(!finitePoint(screenA)||!finitePoint(screenB))continue;
        const clipped=clip(screenA,screenB,box);if(!clipped)continue;
        const [start,end]=clipped,length=Math.hypot(screenB.x-screenA.x,screenB.y-screenA.y)*(end-start);
        if(length<=0)continue;
        const t=(start+end)/2,coordinate=[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t],screen=project(coordinate,feature.geometry.spatialReference);
        if(!finitePoint(screen)||screen.x<box.left||screen.x>box.right||screen.y<box.top||screen.y>box.bottom)continue;
        const score=length-Math.hypot(screen.x-width/2,screen.y-height/2)*.08;
        const candidate={name,key,coordinate,spatialReference:feature.geometry.spatialReference,screen,score,
          sourceId:String(feature.attributes.id3dhp??''),type:Number(feature.attributes.featuretype)};
        const choices=names.get(key)||[];choices.push(candidate);choices.sort((a,b)=>b.score-a.score||a.sourceId.localeCompare(b.sourceId));const spaced=[];for(const choice of choices){if(spaced.every(other=>Math.hypot(other.screen.x-choice.screen.x,other.screen.y-choice.screen.y)>45))spaced.push(choice);if(spaced.length===8)break;}names.set(key,spaced);
      }
    }
  }
  const ordered=[...names.values()].sort((a,b)=>(a[0].type===1?0:1)-(b[0].type===1?0:1)||b[0].score-a[0].score||a[0].key.localeCompare(b[0].key));
  const chosen=[];
  for(const alternatives of ordered){
    for(const row of alternatives){
    // Conservative text bounds include the halo and breathing room; keep names off the edges.
    const half=Math.max(40,row.name.length*3.8),rect={left:row.screen.x-half,right:row.screen.x+half,top:row.screen.y-21,bottom:row.screen.y+11};
    if(rect.left<4||rect.right>width-4)continue;
    if(blocked.some(other=>rect.left<other.right+8&&rect.right>other.left-8&&rect.top<other.bottom+8&&rect.bottom>other.top-8))continue;
    if(chosen.some(other=>rect.left<other.rect.right+16&&rect.right>other.rect.left-16&&rect.top<other.rect.bottom+14&&rect.bottom>other.rect.top-14))continue;
    chosen.push({...row,rect});break;
    }
    if(chosen.length>=maxLabels)break;
  }
  return chosen;
}

/** Cancel superseded local LayerView queries before they can repaint another view. */
export function latestWaterwayLabels({read,draw,clear,onError}){
  let revision=0,abort=null;
  function cancel(){revision++;abort?.abort();abort=null;}
  async function refresh(context){
    cancel();const current=revision,controller=new AbortController();abort=controller;
    try{const rows=await read(context,controller.signal);if(current===revision)draw(rows,context);}
    catch(error){if(current===revision&&error.name!=='AbortError'){clear();onError(error);}}
    finally{if(current===revision)abort=null;}
  }
  return {refresh,cancel};
}

/** Reuse county-filtered, already loaded hydrography in both MapView and SceneView. */
export async function installWaterwayLabels({map,sdk,reactiveUtils,getView,enabled,minScale,onError,onCount=()=>{}}){
  const [GraphicsLayer,Graphic,Point]=await sdk.import(['@arcgis/core/layers/GraphicsLayer.js','@arcgis/core/Graphic.js','@arcgis/core/geometry/Point.js']);
  const layer=new GraphicsLayer({id:'fresno-waterway-names',title:'USGS waterway names · spaced once per view',
    elevationInfo:{mode:'relative-to-ground',offset:2},popupEnabled:false,listMode:'hide',minScale,visible:false});
  map.add(layer);const views=new WeakMap();let timer;
  const query=latestWaterwayLabels({read:async({view,source},signal)=>{
    // Default query preserves the full county polygon filter; screen clipping handles the viewport.
    return (await source.queryFeatures(undefined,{signal})).features;
  },draw:(features,{view})=>{
    if(view!==getView()||!enabled()||view.scale>minScale)return;
    const blocked=[];for(const other of map.layers){if(other===layer||!other.visible||!other.graphics)continue;for(const graphic of other.graphics){if(graphic.geometry?.type!=='point')continue;const screen=view.toScreen(graphic.geometry);if(finitePoint(screen)&&screen.x>0&&screen.x<view.width&&screen.y>0&&screen.y<view.height)blocked.push({left:screen.x-14,right:screen.x+14,top:screen.y-14,bottom:screen.y+14});}}
    const labels=waterwayLabelCandidates(features,{width:view.width,height:view.height,blocked,
      project:(coordinate,spatialReference)=>view.toScreen(new Point({x:coordinate[0],y:coordinate[1],spatialReference}))});
    layer.removeAll();layer.addMany(labels.map(row=>new Graphic({geometry:new Point({x:row.coordinate[0],y:row.coordinate[1],spatialReference:row.spatialReference}),
      symbol:{type:'text',text:row.name,color:'#b5e3ff',haloColor:'#17252e',haloSize:1.5,yoffset:3,horizontalAlignment:'center',verticalAlignment:'middle',font:{family:'Arial',size:10}},popupEnabled:false})));
    layer.visible=true;onCount(labels.length);onError(null);
  },clear:()=>{layer.removeAll();},onError:error=>{console.warn('Waterway label query:',error.message);onError(error);}});
  function sync(){
    clearTimeout(timer);query.cancel();const view=getView(),source=views.get(view);
    layer.visible=enabled()&&view.scale<=minScale;
    if(!layer.visible){layer.removeAll();return;}
    if(!source||!view.stationary)return;
    timer=setTimeout(()=>void query.refresh({view,source}),120);
  }
  return {sync,changeView(){query.cancel();layer.removeAll();sync();},bind(view,source){
    views.set(view,source);
    view.addHandles(reactiveUtils.watch(()=>[view.stationary,view.width,view.height,view.scale,source.updating],()=>{if(view===getView())sync();}));sync();
  }};
}
