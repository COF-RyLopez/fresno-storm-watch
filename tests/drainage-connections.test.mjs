import test from 'node:test';
import assert from 'node:assert/strict';
import {drainageConnections,connectionShown} from '../site/lib/drainage-connections.js';
import {createDrainageDetailMap} from '../site/lib/drainage-nearby-map.js';
import {readDrainageDetail} from '../site/lib/drainage-nearby-data.js';
import {GraphicsLayer,Graphic} from './helpers/arcgis.mjs';
import {FMFCD_DETAIL_LAYERS} from '../site/lib/drainage-nearby-model.js';
const sr={wkid:4326},xy=(x,y=0)=>[-119.8+x*.00001,36.8+y*.00001];
const pump=(p=xy(0))=>({key:'fictional-pump',kind:'pump',category:'existing',geometry:{x:p[0],y:p[1],spatialReference:sr}});
const pipe=(id,points,more={})=>({key:'pipe:'+id,name:'Fictional pipe '+id,id,layerId:6,kind:'pipe',category:'mapped',geometry:{paths:[points],spatialReference:sr},attributes:{},...more});
const point=(id,p,kind='inlet',more={})=>({key:kind+':'+id,name:'Fictional '+kind+' '+id,id,layerId:kind==='inlet'?3:5,kind,category:'mapped',geometry:{x:p[0],y:p[1],spatialReference:sr},attributes:{},...more});
const result=(rows,direction=true)=>({radius:500,layers:[{spec:{id:6,kind:'pipe'},directionDocumented:direction,rows:rows.filter(r=>r.kind==='pipe')},{spec:{id:3,kind:'inlet'},rows:rows.filter(r=>r.kind!=='pipe')}]});
const item=(trace,key)=>trace.items.find(i=>i.row.key===key);

test('directed candidates follow shared mapped vertices; counts are unique source records, not segments',()=>{
  const a=pipe(1,[xy(-2),xy(-1),xy(0)]),b=pipe(2,[xy(0),xy(1)]),inlet=point(1,xy(-2)),outfall=point(2,xy(1),'outfall',{category:'unknown'}),trace=drainageConnections(pump(),result([a,b,inlet,outfall]));
  assert.equal(item(trace,a.key).group,'upstream');assert.equal(item(trace,b.key).group,'downstream');assert.equal(item(trace,inlet.key).group,'upstream');assert.equal(item(trace,outfall.key).group,'downstream');assert.equal(trace.items.length,4);assert.equal(trace.counts.upstream,2);assert.equal(trace.verified,0);assert(trace.items.every(i=>i.verified===false));assert.equal(trace.lines.length,2);
});
test('crossings, nearby coordinates and multipart gaps do not create connections or arbitrary long highlights',()=>{
  const a=pipe(1,[xy(-2),xy(0),xy(2)]),cross=pipe(2,[xy(1,-1),xy(1,1)]),near=pipe(3,[xy(2.2),xy(3)]),multi=pipe(4,[xy(2),xy(4)]);multi.geometry.paths.push([xy(100),xy(101)]);
  const trace=drainageConnections(pump(),result([a,cross,near,multi]));assert(!item(trace,cross.key));assert(!item(trace,near.key));assert(item(trace,multi.key));assert(trace.lines.every(l=>l.geometry.paths.flat().every(p=>p[0]<xy(10)[0])));
  assert.equal(trace.unlinked,2);
});
test('source direction documentation is required and source geometry reversal changes direction without using inverts',()=>{
  const a=pipe(1,[xy(-1),xy(0)],{attributes:{FL_UP:0,FL_DN:999,SLOPE:-9}});
  assert.equal(item(drainageConnections(pump(),result([a],false)),a.key).group,'unknown');assert.equal(item(drainageConnections(pump(),result([a])),a.key).group,'upstream');
  const reversed=structuredClone(a);reversed.geometry.paths[0].reverse();assert.equal(item(drainageConnections(pump(),result([reversed])),a.key).group,'downstream');
});
test('cycles and opposing paths retain ambiguous direction; undirected side branches do not become upstream',()=>{
  const rows=[pipe(1,[xy(0),xy(1)]),pipe(2,[xy(1),xy(1,1),xy(0)]),pipe(3,[xy(-1),xy(0)]),pipe(4,[xy(-1),xy(-1,1)])],trace=drainageConnections(pump(),result(rows));
  assert.equal(item(trace,'pipe:1').group,'ambiguous');assert.equal(item(trace,'pipe:2').group,'ambiguous');assert.equal(item(trace,'pipe:4').group,'unknown');
});
test('basin anchors use complete rings including holes and multipart outlines; proximity or matching names do not link outfalls',()=>{
  const square=(x,y)=>[xy(x,y),xy(x+4,y),xy(x+4,y+4),xy(x,y+4),xy(x,y)];
  const basin={...pump(),kind:'basin',code:'A',geometry:{rings:[square(0,0),square(1,1),square(10,0)],spatialReference:sr}};
  const rows=[pipe(1,[xy(-2,0),xy(0,0)]),pipe(2,[xy(2,2),xy(3,3)]),pipe(3,[xy(11,0),xy(15,0)]),point(4,xy(7,0),'outfall',{attributes:{BASIN:'A'}})];
  const trace=drainageConnections(basin,result(rows));assert(item(trace,'pipe:1'));assert(!item(trace,'pipe:2'));assert(item(trace,'pipe:3'));assert(!item(trace,'outfall:4'));
});
test('pump starts never auto-snap; explicit short-gap review is unverified and bounded to current candidates',()=>{
  const rows=[pipe(1,[xy(3),xy(10)]),pipe(2,[xy(100),xy(101)])],before=drainageConnections(pump(),result(rows));assert.equal(before.seedCount,0);assert.equal(before.items.length,0);assert(before.starts.length>0);
  const reviewed=drainageConnections(pump(),result(rows),{start:before.starts[0].id});assert(reviewed.manual);assert(reviewed.seedDistance>0&&reviewed.seedDistance<25);assert(reviewed.seedLink);assert.equal(reviewed.verified,0);
  assert.match(drainageConnections(pump(),result(rows),{start:'invented'}).error,/changed|outside/);
  assert.equal(drainageConnections(pump(),result(rows)).manual,false,'New reads do not retain an assumed link.');
});
test('proposed pipes cannot bridge a trace, while unknown classification is controlled independently',()=>{
  const rows=[pipe(1,[xy(-1),xy(0)]),pipe(2,[xy(0),xy(1)],{category:'planned'}),pipe(3,[xy(1),xy(2)]),pipe(4,[xy(0),xy(0,1)],{category:'unknown'}),pipe(5,[xy(0,1),xy(0,2)])];
  const trace=drainageConnections(pump(),result(rows));assert(!item(trace,'pipe:2'));assert(!item(trace,'pipe:3'));assert(item(trace,'pipe:4'));assert.equal(trace.plannedExcluded,1);
  const hidden=drainageConnections(pump(),result(rows),{includeUnknown:false});assert(!item(hidden,'pipe:4'));assert(!item(hidden,'pipe:5'));
});
test('malformed geometry, duplicate identities, oversized graphs and pipe failures fail without a partial trace',()=>{
  const a=pipe(1,[xy(0),xy(1)]);assert.match(drainageConnections(pump(),result([a,a])).error,/Duplicate/);
  const broken=structuredClone(a);broken.geometry.spatialReference={wkid:2228};assert.match(drainageConnections(pump(),result([broken])).error,/geometry/);
  const huge=pipe(2,Array.from({length:40001},(_,i)=>xy(i/10000)));const limited=drainageConnections(pump(),result([huge]));assert.match(limited.error,/limit/);assert.equal(limited.lines.length,0);
  const failed=result([a]);failed.layers[0].error='Unavailable';assert.match(drainageConnections(pump(),failed).error,/incomplete/);
  assert.match(drainageConnections({...pump(),category:'proposed'},result([a])).error,/existing/);
  assert.match(drainageConnections({...pump(),geometry:{...a.geometry}},result([a])).error,/geometry/);
  failed.layers[0].error=null;failed.layers[1].error='Unavailable';assert(drainageConnections(pump(),failed).partial);
});
test('view filters retain ambiguous candidates and never treat unknown direction as upstream or downstream',()=>{
  assert(connectionShown('upstream','upstream'));assert(!connectionShown('downstream','upstream'));assert(!connectionShown('unknown','downstream'));assert(connectionShown('ambiguous','upstream'));assert(connectionShown('ambiguous','unresolved'));assert(!connectionShown('upstream','nearby'));
});
test('only live publisher documentation enables direction support',async()=>{
  const spec=FMFCD_DETAIL_LAYERS[0],meta={geometryType:spec.geometry,objectIdField:'OBJECTID',fields:[{name:'OBJECTID'},...spec.fields.map(name=>({name}))],advancedQueryCapabilities:{supportsQueryWithDistance:true}};
  const read=description=>readDrainageDetail(spec,{},async path=>path.endsWith('/query')?{objectIds:[]}:{...meta,description});
  assert((await read('Each pipeline is drawn in the general direction of flow.')).directionDocumented);assert(!(await read('')).directionDocumented);
});
test('connection overlays dim unrelated source graphics, survive 3D switching and clear private state',()=>{
  const layers=[],view={type:'2d',scale:6000},map=createDrainageDetailMap({GraphicsLayer,Graphic,registerLayer:(k,l)=>layers.push(l),setLayerEligibility(){},focusGeometry(){},getView:()=>view});
  const rows=[pipe(1,[xy(-100),xy(0)]),pipe(2,[xy(0),xy(100)])],trace=drainageConnections(pump(),result(rows));map.set(rows,{}, {trace,mode:'upstream'});
  assert.equal(layers[0].opacity,.22);assert.equal(layers.at(-1).graphics.length,1);assert.equal(layers.at(-1).graphics[0].attributes.drainageDetailKey,'pipe:1');
  view.type='3d';map.sync();assert(layers.at(-1).graphics.some(g=>g.geometry.type==='polygon'));assert(layers.at(-1).graphics.every(g=>g.symbol.type!=='cim'));
  map.set(rows,{}, {trace,mode:'nearby'});assert.equal(layers[0].opacity,1);assert.equal(layers.at(-1).graphics.length,0);map.clear();assert(layers.every(l=>l.graphics.length===0));
});
