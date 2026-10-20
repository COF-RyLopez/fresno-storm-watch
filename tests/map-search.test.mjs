import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {findMapEntries,searchText,geometryShardUrl,facilitySearchEntries,roadSearchEntries,gaugeSearchEntries,pointGeometry} from '../site/lib/map-search-model.js';
import {createMapSearch} from '../site/lib/map-search-ui.js';
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
function setup(fetchImpl){
  class Node extends EventTarget{constructor(id){super();this.id=id;this.children=[];this.attrs={};this.value='';}append(...n){this.children.push(...n);}replaceChildren(...n){this.children=n;}setAttribute(k,v){this.attrs[k]=v;}hasAttribute(k){return k in this.attrs;}setFocus(){return Promise.resolve();}}
  const nodes=new Map(),ids=['map-search-evidence','map-search-input','map-search-scope','map-search-results','map-search-status','map-search-selection','map-search-clear','search-selection-note','search-selection-label','map-search-coverage','map-search-open','search-clear-highlight'];
  ids.forEach(id=>nodes.set(id,new Node(id)));nodes.get('map-search-scope').value='all';nodes.get('map-search-evidence').setAttribute('open','');
  globalThis.document={getElementById:id=>nodes.get(id),createElement:tag=>new Node(tag)};globalThis.customElements={whenDefined:()=>Promise.resolve()};
  const controller=createMapSearch({fetchImpl}),calls=[];controller.setMap({clearSearchSelection:()=>calls.push('clear'),focusSearchSelection:async g=>{calls.push(g);return true;}});
  const search=text=>{nodes.get('map-search-input').value=text;nodes.get('map-search-input').dispatchEvent(Object.assign(new Event('keydown'),{key:'Enter'}));};
  return {nodes,controller,calls,search,flush:()=>new Promise(r=>setImmediate(r))};
}

test('sign-out/unloaded assets clear results, selected details and highlight without sending asset text to a server',async()=>{
  const h=setup(async()=>{throw new Error('No fetch expected for local asset search');});
  h.controller.setFacilities({sites:[{site:{key:'a',id:'fake9',name:'EXERCISE pump',kind:'Pump',geometry:{x:-119.8,y:36.8,spatialReference:{wkid:4326}},sourceTitle:'EXERCISE'}}]});
  h.search('fake9');assert.equal(h.nodes.get('map-search-results').children.length,1);
  h.nodes.get('map-search-results').children[0].dispatchEvent(new Event('click'));await h.flush();assert(h.nodes.get('map-search-selection').children.length);
  h.controller.setFacilities({sites:[]});assert.equal(h.nodes.get('map-search-selection').children.length,0);assert.equal(h.nodes.get('map-search-results').children.length,0);assert.equal(h.calls.at(-1),'clear');
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
  assert(h.calls.every(call=>call==='clear'));assert.equal(h.nodes.get('map-search-selection').children.length,0);
});
