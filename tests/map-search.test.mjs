import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {findMapEntries,searchText,geometryShardUrl,facilitySearchEntries,roadSearchEntries,gaugeSearchEntries,pointGeometry} from '../site/lib/map-search-model.js';
import {createMapSearch} from '../site/lib/map-search-ui.js';
import {FakeElement} from './helpers/dom.mjs';
const base=new URL('../site/data/search/v0.31.0/',import.meta.url),index=JSON.parse(await readFile(new URL('index.json',base),'utf8'));

test('named streams and streets match abbreviations, aliases and accents; exact names rank first',()=>{
  assert.equal(searchText('É Shaw Ave.'),'east shaw avenue');
  assert.equal(searchText('Café Road'),'cafe road');
  assert.equal(findMapEntries(index.entries,'Kings River').rows[0].name,'Kings River');
  assert(findMapEntries(index.entries,'Shaw Avenue','street').rows.some(r=>r.name==='E SHAW AVE'));
  assert.equal(findMapEntries(index.entries,'Fresno Canal','waterway').rows[0].name,'Fresno Canal');
  assert.equal(findMapEntries(index.entries,'x').total,0);
  assert(findMapEntries(index.entries,'river','waterway',2).total>2);
});

test('source IDs remain distinct across records; duplicate representations do not inflate results',()=>{
  const a={key:'a',name:'Main',kind:'asset'},b={...a,key:'b'};
  assert.equal(findMapEntries([a,a,b],'main').total,2);
  assert.equal(findMapEntries([a,b],'main','waterway').total,0);
  assert.throws(()=>geometryShardUrl({shard:'../../private.json'},base));
});

test('loaded assets preserve authorized geometry and IDs without an external lookup; history is searchable',()=>{
  const point={x:-119.8,y:36.8,spatialReference:{wkid:4326}};
  const [asset]=facilitySearchEntries({sites:[{site:{key:'global:1',id:'pump-9',name:'Exercise Pump',kind:'Pump',geometry:point,sourceTitle:'EXERCISE'}}]});
  assert.equal(asset.private,true);assert.equal(asset.geometry,point);assert.equal(findMapEntries([asset],'pump-9').total,1);
  const [road]=roadSearchEntries({snapshot:{rows:[{key:'closed:1',name:'Shaw',status:'Inactive — verify',geometry:point}]},error:'failed'});
  assert.match(road.detail,/Inactive.*Feed update failed/);assert.equal(findMapEntries([road],'shaw').total,1);
  assert.equal(pointGeometry({longitude:NaN,latitude:36}),null);
  const [gauge]=gaugeSearchEntries({stations:[{id:'SJMC1',name:'Mendota',longitude:-120.3,latitude:36.8}],entries:new Map()});
  assert.equal(findMapEntries([gauge],'sjmc1').total,1);
});

test('every public search geometry is accounted for, bounded and in the declared CRS',async()=>{
  const manifest=JSON.parse(await readFile(new URL('manifest.json',base),'utf8')),keys=new Set();
  assert.equal(index.entries.length,manifest.namedGroups);assert.equal(new Set(index.entries.map(r=>r.key)).size,index.entries.length);
  for(const [file,hash]of Object.entries(manifest.geometryShardsSha256)){
    const bytes=await readFile(new URL(file,base));assert.equal(createHash('sha256').update(bytes).digest('hex'),hash);
    for(const [key,g]of Object.entries(JSON.parse(bytes))){assert(!keys.has(key));keys.add(key);assert.equal(g.spatialReference.wkid,4326);assert(g.paths.length);
      for(const path of g.paths){assert(path.length>=2);for(const [x,y]of path)assert(Number.isFinite(x)&&Number.isFinite(y)&&x>-121&&x<-118&&y>35&&y<38);}}
  }
  for(const row of index.entries){assert(keys.has(row.key));assert.equal(row.private,undefined);assert(!('geometry'in row));assert(/^[a-f0-9]{2}\.json$/.test(row.shard));}
  assert.equal(keys.size,index.entries.length);
  for(const counts of Object.values(manifest.accounting))assert.equal(counts.input,counts.accepted+counts.unnamed+counts.rejected);
  assert.equal(manifest.accounting.street.rejected,0);assert.equal(manifest.accounting.waterway.rejected,0);
  assert.equal(index.entries.filter(r=>r.kind==='waterway').length,496);
  assert.equal((await readdir(base)).filter(f=>/^[a-f0-9]{2}\.json$/.test(f)).length,256);
});

/** Exercise the actual controller's asynchronous invalidation with no private persistence. */
function setup(fetchImpl,nearby=null){
  class Node extends FakeElement{constructor(id){super();this.id=id;this.value='';}}
  const nodes=new Map(),ids=['map-search-quick','map-search-submit','map-search-nearby','map-search-nearby-status','map-search-nearby-list','map-search-nearby-detail','map-search-radius','map-search-history','map-search-evidence','map-search-input','map-search-scope','map-search-results','map-search-status','map-search-selection','map-search-clear','search-selection-note','search-selection-label','map-search-coverage','map-search-open','search-clear-highlight'];
  ids.forEach(id=>nodes.set(id,new Node(id)));nodes.get('map-search-scope').value='all';nodes.get('map-search-evidence').setAttribute('open','');
  globalThis.document={getElementById:id=>nodes.get(id),createElement:tag=>new Node(tag)};globalThis.customElements={whenDefined:()=>Promise.resolve()};
  const controller=createMapSearch({fetchImpl}),calls=[];controller.setMap({clearSearchSelection:()=>calls.push('clear'),setSearchContext:rows=>calls.push({context:rows}),findNearbySearch:nearby,focusSearchContext:async()=>true,focusSearchSelection:async g=>{calls.push(g);return true;}});
  const search=text=>{nodes.get('map-search-input').value=text;nodes.get('map-search-input').dispatchEvent(Object.assign(new Event('keydown'),{key:'Enter'}));};
  return {nodes,controller,calls,search,flush:()=>new Promise(r=>setImmediate(r))};
}

test('sign-out/unloaded assets clear results, selected details and highlight without sending asset text to a server',async()=>{
  const h=setup(async()=>{throw new Error('No fetch expected for local asset search');});
  h.controller.setFacilities({sites:[{site:{key:'a',id:'fake9',name:'EXERCISE pump',kind:'Pump',geometry:{x:-119.8,y:36.8,spatialReference:{wkid:4326}},sourceTitle:'EXERCISE'}}]});
  h.search('fake9');assert.equal(h.nodes.get('map-search-results').children.length,1);
  h.nodes.get('map-search-results').children[0].dispatchEvent(new Event('click'));await h.flush();assert(h.nodes.get('map-search-selection').children.length);
  h.controller.setFacilities({sites:[]});assert.equal(h.nodes.get('map-search-selection').children.length,0);assert.equal(h.nodes.get('map-search-results').children.length,0);assert(h.calls.some(call=>call==='clear'));
  assert.equal(h.nodes.get('search-selection-label').textContent,'');
});

test('Enter activates a search result and produces map navigation, beyond merely selecting its list row',async()=>{
  const h=setup(async()=>{throw new Error('Local fixture only');});
  h.controller.setFacilities({sites:[{site:{key:'p1',id:'P1',name:'EXERCISE pump',kind:'Pump',geometry:{x:-119.8,y:36.8,spatialReference:{wkid:4326}}}}]});
  h.search('P1');h.nodes.get('map-search-results').children[0].dispatchEvent(Object.assign(new Event('keydown'),{key:'Enter'}));await h.flush();
  assert(h.calls.some(call=>call?.spatialReference?.wkid===4326));
});

test('clearing while public geometry is pending prevents late selection or navigation',async()=>{
  let resolveGeometry;const row={key:'street:123',name:'Shaw',kind:'street',shard:'00.json'};
  const h=setup(async url=>url.pathname.endsWith('index.json')?{ok:true,json:async()=>({countyGeoid:'06019',entries:[row],sources:{}})}:new Promise(resolve=>{resolveGeometry=resolve;}));
  h.nodes.get('map-search-open').dispatchEvent(new Event('click'));await h.flush();h.search('shaw');h.nodes.get('map-search-results').children[0].dispatchEvent(new Event('click'));await h.flush();
  h.nodes.get('map-search-clear').dispatchEvent(new Event('click'));resolveGeometry({ok:true,json:async()=>({'street:123':{paths:[[[-120,36],[-119,37]]],spatialReference:{wkid:4326}}})});await h.flush();
  assert(h.calls.every(call=>call==='clear'||call.context?.length===0));assert.equal(h.nodes.get('map-search-selection').children.length,0);
});


test('visible quick search opens evidence with its query; nearby private references disappear when unloaded',async()=>{
  const shape={paths:[[[-119.8,36.8],[-119.7,36.8]]],spatialReference:{wkid:4326}},row={key:'street:near',name:'EXERCISE ROAD',kind:'street',shard:'00.json'};
  const h=setup(async url=>({ok:true,json:async()=>url.pathname.endsWith('index.json')?{countyGeoid:'06019',entries:[row]}:{[row.key]:shape}}),async(_shape,entries,options)=>{
    return Object.fromEntries(['gauge','road-record','asset'].map(kind=>[kind,{rows:entries.filter(row=>row.kind===kind).map(row=>({...row,distanceMeters:100})),total:entries.filter(row=>row.kind===kind).length,available:entries.filter(row=>row.kind===kind).length,unknown:0,historyExcluded:0}]));
  });
  h.controller.setFacilities({sites:[{site:{key:'private',name:'EXERCISE private pump',geometry:{x:-119.8,y:36.8,spatialReference:{wkid:4326}}}}]});
  h.nodes.get('map-search-quick').value='EXERCISE ROAD';h.nodes.get('map-search-submit').dispatchEvent(new Event('click'));await h.flush();
  assert.equal(h.nodes.get('map-search-input').value,'EXERCISE ROAD');
  h.nodes.get('map-search-results').children[0].dispatchEvent(new Event('click'));await h.flush();
  assert.equal(h.nodes.get('map-search-nearby').hidden,false);assert(h.calls.some(call=>call.context?.[0]?.key==='private'));
  const lastBefore=h.calls.length;h.controller.setFacilities({sites:[]});await h.flush();
  assert(h.calls.slice(lastBefore).filter(call=>call.context).every(call=>!call.context.some(row=>row.private)));
  assert.equal(h.nodes.get('map-search-nearby-detail').children.length,0);
  h.nodes.get('map-search-clear').dispatchEvent(new Event('click'));assert.equal(h.nodes.get('map-search-nearby').hidden,true);
});


test('a delayed vicinity calculation cannot restore private references after sign-out',async()=>{
  const row={key:'street:a',name:'Exercise road',kind:'street',shard:'00.json'},shape={paths:[[[-119.8,36.8],[-119.7,36.8]]],spatialReference:{wkid:4326}};
  let finishFirst,queries=0;const empty=Object.fromEntries(['gauge','road-record','asset'].map(kind=>[kind,{rows:[],total:0,available:0,unknown:0,historyExcluded:0}]));
  const h=setup(async url=>({ok:true,json:async()=>url.pathname.endsWith('index.json')?{countyGeoid:'06019',entries:[row]}:{[row.key]:shape}}),async()=>++queries===1?new Promise(resolve=>finishFirst=resolve):empty);
  h.controller.setFacilities({sites:[{site:{key:'private',name:'Private fixture',geometry:{x:-119.8,y:36.8,spatialReference:{wkid:4326}}}}]});
  h.nodes.get('map-search-quick').value='Exercise road';h.nodes.get('map-search-submit').dispatchEvent(new Event('click'));await h.flush();h.nodes.get('map-search-results').children[0].dispatchEvent(new Event('click'));await h.flush();
  assert(finishFirst);h.controller.setFacilities({sites:[]});await h.flush();const mark=h.calls.length;
  finishFirst({...empty,asset:{...empty.asset,rows:[{key:'private',private:true,name:'Private fixture'}],total:1}});await h.flush();
  assert(h.calls.slice(mark).every(call=>!call.context?.some(row=>row.private)));assert.equal(h.nodes.get('map-search-nearby-detail').children.length,0);
});


test('lake outlines and reservoir reporting-point selections use full polygon geometry and nearby context',async()=>{
  const row={key:'waterbody:mil',name:'Millerton Lake',kind:'waterbody',stationId:'MIL',shard:'00.json'},shape={rings:[[[-119.8,36.8],[-119.8,36.9],[-119.7,36.9],[-119.7,36.8],[-119.8,36.8]]],spatialReference:{wkid:4326}};
  let queriedShape;
  const h=setup(async url=>({ok:true,json:async()=>url.pathname.endsWith('index.json')?{countyGeoid:'06019',entries:url.pathname.includes('waterbodies-v')?[row]:[]}:{[row.key]:shape}}),async(g)=>{queriedShape=g;return Object.fromEntries(['gauge','road-record','asset'].map(kind=>[kind,{rows:[],total:0,available:0,unknown:0,historyExcluded:0}]));});
  h.controller.setReservoirs({selection:{stations:[{id:'MIL',name:'Millerton / Friant Dam',longitude:-119.705,latitude:37}]}});
  h.nodes.get('map-search-open').dispatchEvent(new Event('click'));await h.flush();h.search('Millerton');
  h.nodes.get('map-search-results').children.find(item=>item.label==='Millerton / Friant Dam').dispatchEvent(new Event('click'));await h.flush();
  assert.equal(h.nodes.get('map-search-nearby').hidden,false);assert.equal(queriedShape,shape);assert(h.calls.some(call=>call?.rings===shape.rings));
  assert.match(h.nodes.get('search-selection-label').textContent,/Millerton Lake/);
  assert(h.nodes.get('map-search-selection').children.some(item=>item.textContent==='Fit full lake outline'));
});

test('lake-index failure keeps available street results and displays its separate coverage gap',async()=>{
  const row={key:'street:a',kind:'street',name:'Shaw',shard:'00.json'};
  const h=setup(async url=>url.pathname.includes('waterbodies-v')?{ok:false,status:503}:{ok:true,json:async()=>({countyGeoid:'06019',entries:[row]})});
  h.nodes.get('map-search-open').dispatchEvent(new Event('click'));await h.flush();h.search('Shaw');
  assert.equal(h.nodes.get('map-search-results').children.length,1);assert.match(h.nodes.get('map-search-coverage').textContent,/Lake outline index unavailable/);
});
