import test from 'node:test';
import assert from 'node:assert/strict';
import {CARE_SOURCES,normalizeCare,normalizeZone,comparePlaces,compareBuildings,zonesAt,distanceMetres,careBox} from '../site/lib/care-model.js';
import {readCareCollection,readCarePlaces} from '../site/lib/care-data.js';
import {createCareMap} from '../site/lib/care-map.js';
import {GraphicsLayer,Graphic} from './helpers/arcgis.mjs';
import {readFile} from 'node:fs/promises';

const point={x:-119.75,y:36.75,spatialReference:{wkid:4326}};
const facility={attributes:{ObjectId2:12,OBJECTID:500,County:'FRESNO',Facility_Name:'Fictional Cedar Care Center',Facility_Address:'10 North Pine Avenue',City:'Fresno',Facility_Type:'SNF',Licensed_Beds:null,CERTIFICATION_STATUS:'Active'},geometry:point};
const county={geometry:{type:'Polygon',coordinates:careBox(point,10000).rings}};

test('CDPH capacity, identifiers, bad coordinates and county eligibility stay explicit',()=>{
 const f=normalizeCare(facility);assert.equal(f.beds,null);assert.equal(f.key,'cdph:12');assert.equal(f.sourceId,500);
 assert.equal(normalizeCare({...facility,attributes:{...facility.attributes,Licensed_Beds:0}}).beds,0);
 assert.throws(()=>normalizeCare({...facility,geometry:{...point,spatialReference:{wkid:3857}}}));
 assert.throws(()=>normalizeCare({...facility,attributes:{...facility.attributes,County:'OTHER'}}));
 assert.throws(()=>normalizeCare({...facility,attributes:{...facility.attributes,ObjectId2:null}}));
});
test('Places candidates use explainable name/address agreement without verified identity',()=>{
 const f=normalizeCare(facility),rows=[
  {id:'near',name:'Other business',x:point.x,y:point.y,addresses:[]},
  {id:'address',name:'Different brand',x:point.x+.001,y:point.y,addresses:[{freeform:'10 N Pine Ave',locality:'Fresno'}],status:'permanently_closed'},
  {id:'name',name:'Fictional Cedar Care Center',x:point.x+.002,y:point.y,addresses:[]},
  {id:'city',name:'Unrelated',x:point.x,y:point.y,addresses:[{freeform:'10 N Pine Ave',locality:'Other city'}]},
  {id:'far',name:f.name,x:point.x+.1,y:point.y,addresses:[]}
 ];const result=comparePlaces(f,rows);assert.equal(result[0].id,'address');assert(result[0].addressMatch);assert.equal(result[0].status,'permanently_closed');assert(result.find(p=>p.id==='name').exactName);assert(!result.find(p=>p.id==='near').candidate);assert(!result.find(p=>p.id==='city').addressMatch);assert(!result.some(p=>p.id==='far'));assert(result.every(p=>p.verified===false));
 assert(Math.abs(distanceMetres(point,{x:point.x,y:point.y+.001})-111.195)<.1);
});
test('building containment preserves holes, overlapping footprints, and separate campus records',()=>{
 const f=normalizeCare(facility),outer=careBox(point,100),hole=careBox(point,20).rings[0];
 const rows=[{id:'a',geometry:outer},{id:'b',geometry:outer},{id:'hole',geometry:{...outer,rings:[...outer.rings,hole]}},{id:'near',geometry:careBox({x:point.x+.003,y:point.y},50)}];
 const result=compareBuildings(f,[],rows);assert.equal(result.filter(r=>r.direct).length,2);assert(!result[2].direct);assert(!result[3].associated);assert(result.every(r=>r.verified===false));
 const p={id:'place',candidate:true,x:point.x+.003,y:point.y};assert.deepEqual(compareBuildings(f,[p],rows)[3].placeIds,['place']);
});
test('county source status retains lifted/unknown and multiple containing zones',()=>{
 const zones=['Order','Warn','Lifted','Unexpected'].map((s,i)=>normalizeZone({attributes:{OID:i,Name:`Zone ${i}`,EvacuationStatus:s},geometry:careBox(point,100)}));
 assert.equal(zonesAt(point,zones).length,4);assert.equal(zones[2].status,'Lifted');assert.equal(zones[3].status,'unknown');assert.equal(zones[3].rawStatus,'Unexpected');
});
function mockSource({incomplete=false,changed=false,wkid=4326,rejected=false}={}){
 let inventories=0;return async url=>{const u=new URL(url);let data;
  if(!u.pathname.endsWith('/query'))data={fields:['ObjectId2','OBJECTID','County','Facility_Name','Facility_Address','City','Facility_Type','Licensed_Beds','CERTIFICATION_STATUS'].map(name=>({name})),geometryType:'esriGeometryPoint',objectIdField:'ObjectId2',editingInfo:{dataLastEditDate:100}};
  else if(u.searchParams.get('returnIdsOnly'))data={objectIds:++inventories>1&&changed?[13]:[12]};
  else data={spatialReference:{wkid},features:incomplete?[]:[rejected?{...facility,geometry:null}:facility]};
  return {ok:true,json:async()=>data};
 };
}
test('live inventory reconciles batches and reports rejected records without zero-safety inference',async()=>{
 const result=await readCareCollection('facilities',{county,fetcher:mockSource()});assert.equal(result.rows.length,1);assert.deepEqual(result.accounting,{returned:1,outside:0,rejected:0,retained:1});assert.equal(result.edited,100);
 const rejected=await readCareCollection('facilities',{county,fetcher:mockSource({rejected:true})});assert.equal(rejected.accounting.rejected,1);assert.equal(rejected.rows.length,0);
 for(const options of [{incomplete:true},{changed:true},{wkid:3857}])await assert.rejects(readCareCollection('facilities',{county,fetcher:mockSource(options)}));
 await assert.rejects(readCareCollection('arbitrary',{county,fetcher:mockSource()}));
});
test('published Places reference is pinned, complete, unique and contains no private matching output',async()=>{
 const fetcher=async url=>{const u=new URL(url),file=new URL('../site/data/care-places/'+u.pathname.split('/').at(-1),import.meta.url),b=await readFile(file);return {ok:true,json:async()=>JSON.parse(b),arrayBuffer:async()=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)};};
 const result=await readCarePlaces({fetcher});assert(result.rows.length>0);assert.equal(result.rows.length,result.index.count);assert(!result.rows.some(r=>r.facility||r.countyFootprints));
});
test('care comparison layers clear selection outlines and synchronize 3D independently',async()=>{
 const layers=[],callbacks=[],focus=[];let mode='2d',clears=0;
 const map=await createCareMap({registerLayer:(key,layer)=>layers.push({key,layer}),onViewChanged:f=>callbacks.push(f),getViewMode:()=>mode,clearSearchSelection:()=>clears++,focusSearchSelection:async g=>focus.push(['outline',g]),focusReferenceGeometry:async g=>focus.push(['point',g])},async()=>({import:async()=>[GraphicsLayer,Graphic]}));
 await map.focus(point);await map.focus(careBox(point));assert.deepEqual(focus.map(f=>f[0]),['point','outline']);assert(!focus[0][1].rings);
 map.setSelection(normalizeCare(facility),[{geometry:careBox(point),height:12,associated:true}],[]);const context=layers[1].layer;assert.equal(context.graphics[0].symbol.type,'simple-fill');mode='3d';callbacks[0]();assert.equal(context.graphics[0].symbol.type,'polygon-3d');
 assert(context.graphics.length>0);map.clear();assert.equal(clears,1);assert(layers.every(r=>r.layer.graphics.length===0));
});
