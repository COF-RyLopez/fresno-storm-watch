import {POWER_COLORS} from './power-model.js';
import {ZONE_COLORS} from './care-model.js';

/** Small selection-scoped public reference overlays; comparisons are never persisted. */
export async function createCareMap(controller,loadSdk){
 const [GraphicsLayer,Graphic]=await(await loadSdk()).import(['@arcgis/core/layers/GraphicsLayer.js','@arcgis/core/Graphic.js']);
 const sites=new GraphicsLayer({title:'CDPH resident-care locations',elevationInfo:{mode:'relative-to-ground'},popupEnabled:false});
 const context=new GraphicsLayer({title:'Resident-care source comparison · unverified associations',elevationInfo:{mode:'on-the-ground'},popupEnabled:false});
 const support=new GraphicsLayer({title:'Selected resident-care utility areas and nearby roads · planning reference',elevationInfo:{mode:'on-the-ground'},popupEnabled:false});
 const zonesLayer=new GraphicsLayer({title:'Fresno County published evacuation status · issue times unavailable',elevationInfo:{mode:'on-the-ground'},popupEnabled:false});
 controller.registerLayer('care',sites);controller.registerLayer('care',context);controller.registerLayer('evacuations',zonesLayer);controller.registerLayer('care',support);
 let buildings=[],places=[],selected=null,zones=[],showLifted=false,siteRows=[],reviewKeys=new Set(),showAll=false,review=null;
 const add=(layer,geometry,symbol,attributes={})=>layer.add(new Graphic({geometry:{...geometry,type:geometry.rings?'polygon':geometry.paths?'polyline':'point'},symbol,attributes}));
 function draw(){context.removeAll();support.removeAll();for(const m of review?.powerReviews||[])if(m.returned)for(const g of m.row.geometries.filter(g=>g.rings))add(support,g,{type:'simple-fill',color:[0,0,0,0],outline:{color:POWER_COLORS[m.row.status],width:2,style:m.eligible?'solid':'dash'}});for(const r of review?.roads||[])if(r.record.geometry){const g=r.record.geometry,color=r.verification?'#e7b65e':'#fa929c',line={color,width:3,style:r.verification?'dash':'solid'},symbol=g.paths?{type:'simple-line',...line}:g.rings?{type:'simple-fill',color:[0,0,0,0],outline:line}:{type:'simple-marker',style:'diamond',size:12,color:[0,0,0,0],outline:{color,width:2.5}};add(support,{...g,spatialReference:{wkid:4326}},symbol);}const scene=controller.getViewMode()==='3d';
  for(const b of buildings){const associated=b.associated,shade=associated?'#72d5c8':'#839698';add(context,b.geometry,scene&&b.height!==null?{type:'polygon-3d',symbolLayers:[{type:'extrude',size:b.height,material:{color:associated?'#62b9ad':'#526466'},edges:{type:'solid',color:shade,size:.7}}]}:{type:'simple-fill',color:associated?[114,213,200,.3]:[114,213,200,.05],outline:{color:shade,width:associated?2:.6,style:b.height===null?'dash':'solid'}});}
  for(const p of places)add(context,{x:p.x,y:p.y,spatialReference:{wkid:4326}},{type:'simple-marker',style:'circle',size:p.candidate?10:7,color:[0,0,0,0],outline:{color:p.candidate?'#e9a4e4':'#aeb6bd',width:2}});
  if(selected)add(context,selected.geometry,{type:'simple-marker',style:'square',size:18,color:[0,0,0,0],outline:{color:'#ffffff',width:2}});
 }
 function drawZones(){zonesLayer.removeAll();for(const z of zones.filter(z=>showLifted||z.status!=='Lifted'))add(zonesLayer,z.geometry,{type:'simple-fill',color:z.status==='Order'?[181,53,53,.12]:z.status==='Warn'?[255,255,0,.08]:z.status==='Lifted'?[101,168,67,.05]:[180,189,198,.05],outline:{color:ZONE_COLORS[z.status]||ZONE_COLORS.unknown,width:1.4,style:z.status==='unknown'?'dash':'solid'}});}
 controller.onViewChanged(draw);
 function drawSites(){sites.removeAll();for(const r of siteRows.filter(r=>showAll||reviewKeys.has(r.key)))add(sites,r.geometry,{type:'simple-marker',style:'square',size:10,color:'#72d5c8',outline:{color:reviewKeys.has(r.key)?'#e7b65e':'#202427',width:reviewKeys.has(r.key)?2.5:1.5}},{careKey:r.key});}
 return {setSites(rows,reviews=[]){siteRows=rows;reviewKeys=new Set(reviews.filter(r=>r.review).map(r=>r.key));drawSites();},setAll(value){showAll=!!value;drawSites();},setReview(value){review=value;draw();},
  setZones(rows,lifted=false){zones=rows;showLifted=lifted;drawZones();},
  setSelection(site,nextBuildings=[],nextPlaces=[]){selected=site;buildings=nextBuildings;places=nextPlaces;draw();},
  clearSelection(){controller.clearSearchSelection();support.removeAll();review=null;selected=null;buildings=[];places=[];context.removeAll();},
  clear(){sites.removeAll();zones=[];zonesLayer.removeAll();this.clearSelection();},
  async focus(geometry,{scale=5500}={}){if(geometry.rings)await controller.focusSearchSelection(geometry);else await controller.focusReferenceGeometry(geometry,scale);}
 };
}
