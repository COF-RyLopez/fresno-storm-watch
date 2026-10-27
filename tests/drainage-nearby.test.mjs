import test from 'node:test';
import assert from 'node:assert/strict';
import {FMFCD_DETAIL_URL,FMFCD_DETAIL_LAYERS,FMFCD_DETAIL_LIMIT,drainageDetailScope,drainageDetailExtent,drainageDetailCategory,drainageDetailRecord} from '../site/lib/drainage-nearby-model.js';
import {readDrainageDetail,openDrainageDetail} from '../site/lib/drainage-nearby-data.js';
import {createDrainageDetailMap} from '../site/lib/drainage-nearby-map.js';
import {createDrainageNearby} from '../site/lib/drainage-nearby-ui.js';
import {unchangedDrainageSelection} from '../site/lib/drainage-model.js';
import {FMFCD_WEBMAP_DATA} from '../site/lib/fmfcd-symbology.js';
const spec=FMFCD_DETAIL_LAYERS[0],inlet=FMFCD_DETAIL_LAYERS[1],outfall=FMFCD_DETAIL_LAYERS[2];
const point={x:-119.77,y:36.81,spatialReference:{wkid:4326}};
const selected={key:'fictional-pump',kind:'pump',category:'existing',geometry:point};
const polygon={rings:[[[-119.77,36.81],[-119.76,36.81],[-119.76,36.82],[-119.77,36.81]]],spatialReference:{wkid:4326}};
const meta=s=>({geometryType:s.geometry,objectIdField:'OBJECTID',fields:[{name:'OBJECTID',type:'esriFieldTypeOID'},...s.fields.map(name=>({name}))],advancedQueryCapabilities:{supportsQueryWithDistance:true},editingInfo:{dataLastEditDate:1000}});
const feature=(s=spec,id=1,attributes={})=>({attributes:{OBJECTID:id,AS_BUILT:'2020',...attributes},geometry:s.kind==='pipe'?{paths:[[[-119.77,36.81],[-119.769,36.811]]]}:{x:-119.77,y:36.81}});
const call=(s=spec,overrides={})=>async(suffix,p)=>!suffix.endsWith('/query')?overrides.meta||meta(s):p.returnIdsOnly?overrides.inventory||{objectIds:[1]}:p.returnCountOnly?overrides.count||{count:0}:overrides.batch||{spatialReference:{wkid:4326},features:[feature(s)]};
const config={enabled:true,orgId:'county',owner:'builder',groups:{viewers:'eoc'}};
const session=()=>({username:'operator',portal:{id:'county',user:{fetchGroups:async()=>[{id:'eoc'}]}},getToken:async()=>'synthetic-never-forward'});

test('unchanged inventory refreshes retain the selection; missing, moved or reclassified parents invalidate it',()=>{
  const rows=[{...selected,category:'existing'}];assert(unchangedDrainageSelection(selected.key,rows,structuredClone(rows)));
  for(const after of [[],[{...rows[0],category:'proposed'}],[{...rows[0],geometry:{...point,x:-119.9}}]])assert(!unchangedDrainageSelection(selected.key,rows,after));
  assert(!unchangedDrainageSelection(null,rows,rows));
});

test('proximity scope preserves complete polygon rings and fixed metre units; malformed locations fail',()=>{
  const r=drainageDetailScope({...selected,kind:'basin',geometry:polygon},500);
  assert.deepEqual(JSON.parse(r.geometry),polygon);assert.equal(r.geometryType,'esriGeometryPolygon');assert.equal(r.distance,500);assert.equal(r.units,'esriSRUnit_Meter');
  for(const bad of [{...selected,geometry:{...point,spatialReference:{wkid:2228}}},{...selected,kind:'basin'}, {...selected,kind:'road'}])assert.throws(()=>drainageDetailScope(bad,500));
  assert.throws(()=>drainageDetailScope(selected,5000));
  const extent=drainageDetailExtent({...selected,kind:'basin',geometry:polygon},500);
  assert(extent.xmin<-119.775&&extent.xmax>-119.755&&extent.ymin<36.806&&extent.ymax>36.824);
});
test('future and design records stay separate; null outfall subtype and invalid as-built dates remain unknown',()=>{
  assert.equal(drainageDetailCategory(outfall,{SUBTYPE:null}),'unknown');assert.equal(drainageDetailCategory(outfall,{SUBTYPE:'1'}),'unknown');assert.equal(drainageDetailCategory(outfall,{SUBTYPE:1}),'mapped');
  for(const code of [0,2])assert.equal(drainageDetailCategory(outfall,{SUBTYPE:code}),'planned');
  for(const AS_BUILT of [null,'','205','2961'])assert.equal(drainageDetailCategory(spec,{AS_BUILT}),'unknown');
  assert.equal(drainageDetailCategory(spec,{AS_BUILT:'2027'},2026),'planned');assert.equal(drainageDetailCategory(spec,{AS_BUILT:'2026'},2026),'mapped');
  assert.equal(drainageDetailCategory({...spec,planned:true},{AS_BUILT:'2020'}),'planned');assert.equal(drainageDetailCategory(spec,{AS_BUILT:'2020',CONTRACT:'FUTURE'}),'planned');
});
test('source ID inventories and every batch reconcile, using only the fixed whitelisted fields',async()=>{
  const calls=[],read=await readDrainageDetail(spec,drainageDetailScope(selected,500),async(s,p)=>{calls.push({s,p});return call()(s,p);});
  assert.equal(read.rows.length,1);assert.equal(read.sourceEdited,1000);assert.equal(read.rows[0].key,'fmfcd-detail:6:1');assert.equal(read.rows[0].geometry.spatialReference.wkid,4326);
  assert.equal(calls[1].p.returnIdsOnly,true);assert.equal(calls[1].p.distance,500);assert.equal(calls[2].p.outSR,4326);assert(!calls[2].p.outFields.includes('*'));
  for(const overrides of [{inventory:{objectIds:[1,1]}},{inventory:{objectIds:[1],exceededTransferLimit:true}},{inventory:{objectIds:Array.from({length:FMFCD_DETAIL_LIMIT+1},(_,i)=>i)}},{batch:{spatialReference:{wkid:2228},features:[feature()]}},{batch:{spatialReference:{wkid:4326},features:[]}},{batch:{spatialReference:{wkid:4326},features:[feature(spec,2)]}},{meta:{...meta(spec),advancedQueryCapabilities:{}}}])await assert.rejects(readDrainageDetail(spec,drainageDetailScope(selected,500),call(spec,overrides)));
  assert.deepEqual((await readDrainageDetail(spec,{},call(spec,{inventory:{objectIds:null}}))).rows,[]);
  await assert.rejects(readDrainageDetail(spec,{},call(spec,{inventory:{objectIds:null},count:{count:1}})));
  assert.throws(()=>drainageDetailRecord(spec,{...feature(),geometry:{paths:[[[NaN,0],[1,1]]]}},'OBJECTID'));
});
test('private authorization gates reads; county credentials never reach FMFCD; planned layers are opt-in',async()=>{
  const calls=[],fetcher=async(url,options)=>{calls.push({url,options});if(url===FMFCD_WEBMAP_DATA)return new Response(JSON.stringify({operationalLayers:[]}));const s=FMFCD_DETAIL_LAYERS.find(s=>s.id===Number(url.match(/FeatureServer\/(\d+)/)[1])),p=Object.fromEntries(options.body);
    return new Response(JSON.stringify(!url.endsWith('/query')?meta(s):p.returnIdsOnly?{objectIds:[]}:{count:0}));};
  await assert.rejects(openDrainageDetail(config,null,{fetcher}));assert.equal(calls.length,0);
  const s=session(),adapter=await openDrainageDetail(config,s,{fetcher});const result=await adapter.read(selected);assert.equal(result.layers.length,3);
  assert.equal(result.styleError,null);assert(calls.every(c=>(c.url.startsWith(FMFCD_DETAIL_URL)||c.url===FMFCD_WEBMAP_DATA)&&c.options.method==='POST'&&c.options.credentials==='omit'&&c.options.cache==='no-store'&&!String(c.options.body).includes('synthetic')&&!String(c.options.body).includes('token')));
  assert(calls.every(c=>!c.url.match(/FeatureServer\/(1|2|7|8)(?:\/|$)/)));
  assert.equal((await adapter.read(selected,{planned:true})).layers.length,7);
  s.portal.user.fetchGroups=async()=>[];await assert.rejects(adapter.read(selected));adapter.close();
});
test('one failed source is explicitly unassessed, while closing or expiry rejects late records',async()=>{
  const s=session(),source=await openDrainageDetail(config,s,{fetcher:async(url,options)=>{
    const id=Number(url.match(/FeatureServer\/(\d+)/)[1]);if(id===3)return new Response('Unavailable',{status:503});
    const spec=FMFCD_DETAIL_LAYERS.find(s=>s.id===id);return new Response(JSON.stringify(url.endsWith('/query')?{objectIds:[]}:meta(spec)));
  }});
  const result=await source.read(selected);assert.equal(result.layers.filter(l=>l.error).length,1);assert.equal(result.layers[1].spec.id,3);assert.match(result.layers[1].error,/503/);source.close();await assert.rejects(source.read(selected));
  const releases=[];let signal,started;const ready=new Promise(r=>{started=r;});
  const late=await openDrainageDetail(config,session(),{fetcher:async(_url,options)=>{signal=options.signal;started();return new Promise(r=>{releases.push(r);});}});
  const pending=late.read(selected);await ready;late.close();assert(signal.aborted);for(const release of releases)release(new Response('{}'));assert.equal(await pending,null);
});
test('map symbols distinguish pipes, inlets, outfalls and classification; clearing removes all graphics',()=>{
  class Layer{constructor(p){Object.assign(this,p);this.graphics=[];}removeAll(){this.graphics=[];}add(g){this.graphics.push(g);}}
  class Graphic{constructor(p){Object.assign(this,p);}}
  const layers=[],map=createDrainageDetailMap({GraphicsLayer:Layer,Graphic,registerLayer:(key,l)=>layers.push({key,l}),setLayerEligibility(){},focusGeometry(){}});
  map.set([drainageDetailRecord(spec,feature(),'OBJECTID'),drainageDetailRecord(outfall,feature(outfall,2,{SUBTYPE:null}),'OBJECTID'),drainageDetailRecord(inlet,feature(inlet,3,{AS_BUILT:'2027'}),'OBJECTID')]);
  assert.equal(layers[0].l.graphics[0].symbol.type,'cim');assert.equal(layers[1].l.graphics[0].symbol.style,'diamond');assert.equal(layers[2].l.graphics[0].symbol.style,'square');
  map.clear();assert(layers.every(({l})=>l.graphics.length===0));
});

test('a credential expiring after public reads cannot return evidence to the private workspace',async()=>{
  const s=session();let checks=0;
  s.getToken=async()=>{if(++checks===3)throw Error('County sign-in expired.');return 'synthetic';};
  const source=await openDrainageDetail(config,s,{fetcher:async(url)=>{const spec=FMFCD_DETAIL_LAYERS.find(s=>s.id===Number(url.match(/FeatureServer\/(\d+)/)[1]));return new Response(JSON.stringify(url.endsWith('/query')?{objectIds:[]}:meta(spec)));}});
  await assert.rejects(source.read(selected),/expired/);source.close();
});

test('private UI clears DOM and map on sign-out; rapid selection discards old responses and plans start hidden',async()=>{
  class Element{
    constructor(tag){this.tag=tag;this.children=[];this.isConnected=true;this.dataset={};this.events={};this.style={};}
    append(...n){this.children.push(...n);}prepend(...n){this.children.unshift(...n);}replaceChildren(...n){this.children=n;}setAttribute(){}addEventListener(n,f){this.events[n]=f;}contains(n){return this===n||this.children.some(c=>c instanceof Element&&c.contains(n));}
  }
  const before={document:globalThis.document,window:globalThis.window,setInterval:globalThis.setInterval};
  const flush=()=>new Promise(r=>setTimeout(r,0));
  try{
    globalThis.document={createElement:tag=>new Element(tag),hidden:false};globalThis.window={addEventListener(){}};globalThis.setInterval=()=>0;
    let finish,reads=0;const displayed=[],prefs=[],traceOptions=[];
    const ui=createDrainageNearby({timeZone:'America/Los_Angeles',open:async()=>({close(){},read:async(_r,options)=>{reads++;assert.equal(options.planned,false);if(reads===1)return new Promise(r=>{finish=r;});return {layers:[{spec,rows:[drainageDetailRecord(spec,feature(),'OBJECTID')],sourceEdited:1000,checked:2000}],checked:2000};}})});
    ui.setSession(session());ui.setMap({clearDrainageNearby(){displayed.push([]);},setDrainageNearby:(r,_styles,options)=>{displayed.push(r);traceOptions.push(options);},setLayerPreference:(key,value)=>prefs.push({key,value})});
    const a=new Element('parent'),b=new Element('parent');ui.renderInto(a,selected);await flush();ui.renderInto(b,{...selected,key:'new'});await flush();
    assert.equal(displayed.at(-1).length,1);assert.equal(traceOptions.at(-1).trace.items.length,1);finish({layers:[],checked:1});await flush();assert.equal(displayed.at(-1).length,1);
    assert(prefs.filter(p=>p.key==='drainageNetworkPlanned').every(p=>p.value===false));
    ui.clearIfWithin(a);assert(b.children[0].children.length>0,'Closing an old evidence pane cannot clear a new one.');
    ui.setSession(null);assert.equal(b.children[0].children.length,0);assert.equal(displayed.at(-1).length,0);
  }finally{for(const[k,v]of Object.entries(before))globalThis[k]=v;}
});
