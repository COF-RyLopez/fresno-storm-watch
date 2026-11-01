import test from 'node:test';
import assert from 'node:assert/strict';
import {FMFCD_DETAIL_URL,FMFCD_DETAIL_LAYERS} from '../site/lib/drainage-nearby-model.js';
import {fmfcdRendererOverrides,fmfcdRendererSymbol,fmfcdDetailSymbol,fmfcdSceneArrows,fmfcdInventorySymbol} from '../site/lib/fmfcd-symbology.js';
import {readDrainageDetail} from '../site/lib/drainage-nearby-data.js';
import {GraphicsLayer,Graphic} from './helpers/arcgis.mjs';
import {createDrainageDetailMap} from '../site/lib/drainage-nearby-map.js';
const pipe={layerId:6,kind:'pipe',category:'mapped',attributes:{AS_BUILT:'2020'},key:'fictional',geometry:{paths:[[[-119.8,36.8],[-119.79,36.8]]],spatialReference:{wkid:4326}}};
const renderer={type:'simple',symbol:{type:'CIMSymbolReference',symbol:{type:'CIMLineSymbol',symbolLayers:[{type:'CIMSolidStroke',enable:true,width:1.875,color:[0,77,168,255]}]}}};

test('web-map overrides are extracted only for the fixed FMFCD service, including nested groups',()=>{
  const styles=fmfcdRendererOverrides({operationalLayers:[{layers:[{url:FMFCD_DETAIL_URL+'/6',layerDefinition:{drawingInfo:{renderer}}},{url:'https://other.invalid/6',layerDefinition:{drawingInfo:{renderer}}}]}]});
  assert.deepEqual(Object.keys(styles),['6']);assert.equal(styles[6],renderer);assert.throws(()=>fmfcdRendererOverrides({}));
});
test('a web-map renderer overrides the service renderer without changing data or source dates',async()=>{
  const spec=FMFCD_DETAIL_LAYERS.find(s=>s.id===6),service={type:'simple',symbol:{type:'esriSLS'}},meta={geometryType:spec.geometry,objectIdField:'OBJECTID',fields:[{name:'OBJECTID',type:'esriFieldTypeOID'},...spec.fields.map(name=>({name}))],advancedQueryCapabilities:{supportsQueryWithDistance:true},drawingInfo:{renderer:service},editingInfo:{dataLastEditDate:1000}};
  const call=async()=>meta,read=async override=>readDrainageDetail(spec,{},async(suffix)=>suffix.endsWith('/query')?{objectIds:[]}:call(),override);
  assert.equal((await read(renderer)).renderer,renderer);assert.equal((await read(null)).renderer,service);assert.equal((await read(renderer)).sourceEdited,1000);assert.deepEqual((await read(renderer)).rows,[]);
});
test('native 2D pipe styling preserves source values without mutating shared publisher metadata',()=>{
  const original=structuredClone(renderer),light=fmfcdDetailSymbol(pipe,renderer,{dark:false}),dark=fmfcdDetailSymbol(pipe,renderer,{dark:true});
  assert.deepEqual(light,{type:'cim',data:renderer.symbol});assert.deepEqual(renderer,original);assert.equal(dark.data.symbol.symbolLayers.at(-1).width,3.1);
  const unknown=fmfcdDetailSymbol({...pipe,category:'unknown'},renderer,{dark:false});assert.equal(unknown.data.symbol.symbolLayers[0].effects[0].type,'CIMGeometricEffectDashes');
  assert.deepEqual(fmfcdDetailSymbol({...pipe,layerId:2},null,{scene:true}).color,[230,0,0]);assert.deepEqual(fmfcdDetailSymbol({...pipe,layerId:8},null,{scene:true}).color,[115,178,255]);
  const reference=fmfcdDetailSymbol(pipe,null,{dark:false});assert.equal(reference.data.symbol.symbolLayers[0].markerPlacement.relativeTo,'LineMiddle');
});
test('null outfall subtypes never pick an existing symbol; data-image symbols cannot load arbitrary external URLs',()=>{
  const unique={type:'uniqueValue',field1:'SUBTYPE',uniqueValueInfos:[{value:'1',symbol:{type:'esriPMS',imageData:'AAAA',contentType:'image/png'}}]};
  const row={kind:'outfall',category:'unknown',layerId:5,attributes:{SUBTYPE:null}};
  assert.equal(fmfcdRendererSymbol(unique,row),null);assert.equal(fmfcdDetailSymbol(row,unique).style,'diamond');
  const valid=fmfcdDetailSymbol({...row,category:'mapped',attributes:{SUBTYPE:1}},unique);assert.equal(valid.url,'data:image/png;base64,AAAA');
  const remote=structuredClone(unique);remote.uniqueValueInfos[0].symbol={type:'esriPMS',url:'https://other.invalid/symbol'};assert(!fmfcdDetailSymbol({...row,category:'mapped',attributes:{SUBTYPE:1}},remote).url);
});
test('3D arrows follow each source path vertex order without joining separate parts or inferring hydraulic flow',()=>{
  const forward=fmfcdSceneArrows(pipe.geometry,6000)[0].rings[0];assert(forward[0][0]>forward[1][0]);
  const reverse=fmfcdSceneArrows({paths:[pipe.geometry.paths[0].slice().reverse()]},6000)[0].rings[0];assert(reverse[0][0]<reverse[1][0]);
  const parts=fmfcdSceneArrows({paths:[...pipe.geometry.paths,[[-120,37],[-119.99,37]]]},6000);assert.equal(parts.length,2);
  assert(parts[0].rings[0].every(p=>p[0]>-119.8&&p[0]<-119.79));assert(parts[1].rings[0].every(p=>p[0]>-120&&p[0]<-119.99));
  assert.equal(fmfcdSceneArrows({paths:[[[-119.8,36.8],[-119.8,36.8]]]}).length,0);
});
test('basins use the FMFCD pale-blue palette while proposed assets and pump readiness symbols remain separate',()=>{
  assert.deepEqual(fmfcdInventorySymbol({kind:'basin',category:'existing'}).color,[190,210,255,.32]);
  assert.equal(fmfcdInventorySymbol({kind:'basin',category:'proposed'}).outline.style,'dash');assert.equal(fmfcdInventorySymbol({kind:'pump',category:'existing'}).style,'circle');
  assert.equal(fmfcdInventorySymbol({kind:'catchment'},{dark:false}).outline.color,'#000000');
});
test('view switches replace unsupported CIM lines with terrain-compatible geometry and preserve source selection keys',()=>{
  const layers=[],view={type:'2d',scale:6000},map=createDrainageDetailMap({GraphicsLayer,Graphic,registerLayer:(k,l)=>layers.push(l),setLayerEligibility(){},focusGeometry(){},getView:()=>view});
  map.set([pipe]);assert.equal(layers[0].graphics[0].symbol.type,'cim');view.type='3d';map.sync();
  assert(layers[0].graphics.every(g=>g.symbol.type!=='cim'&&g.attributes.drainageDetailKey===pipe.key));assert(layers[0].graphics.some(g=>g.geometry.type==='polygon'));
  map.clear();assert(layers.every(l=>l.graphics.length===0));
});
