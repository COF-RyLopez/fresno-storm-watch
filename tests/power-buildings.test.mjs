import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {gunzipSync,gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {buildingPowerTarget,buildingHeight,validateBuildingIndex,planBuildingTiles,selectPowerBuildings,BuildingQueryLimitError} from '../site/lib/power-buildings-model.js';
import {loadPowerBuildings,loadPowerBuildingsAutomatic} from '../site/lib/power-buildings-data.js';
import {createPowerBuildingsMap} from '../site/lib/power-buildings-map.js';
import {createPowerBuildings} from '../site/lib/power-buildings-ui.js';
const box=(x=0,y=0,w=1)=>({rings:[[[x,y],[x,y+w],[x+w,y+w],[x+w,y],[x,y]]],spatialReference:{wkid:4326}});
const building=(id,g=box(.2,.2,.1),height=8,addresses=['100 Example Rd'])=>({id,version:1,geometry:g,height,addresses,sources:['EXERCISE']});
const index=()=>({schemaVersion:1,release:'2026-10-21.0',compression:'gzip',crs:'EPSG:4326',heightUnit:'metres',tiles:[{key:'-2_1',bbox:[0,0,1,1],count:1,bytes:10,decodedBytes:100,sha256:'a'.repeat(64)}]});

test('only current published polygons define a potential building overlap; points and circuit identity do not',()=>{
  assert.equal(buildingPowerTarget({status:'warning',geometries:[box()]}).polygons.length,1);
  for(const status of ['restored','cancelled','unknown'])assert.equal(buildingPowerTarget({status,geometries:[box()]}).polygons.length,0);
  assert.equal(buildingPowerTarget({status:'outage',geometries:[{x:0,y:0,spatialReference:{wkid:4326}}],networkCircuit:{value:'123'}}).polygons.length,0);
});
test('height is positive published metres; missing, zero, strings and impossible values remain unknown',()=>{
  for(const v of [null,0,-1,true,'12',NaN,Infinity,851])assert.equal(buildingHeight(v),null);
  assert.equal(buildingHeight(12.5),12.5);
});
test('full polygon boundaries and holes determine overlap, rather than building centres or bounding boxes',()=>{
  const area=box();area.rings.push(box(.3,.3,.4).rings[0]);
  const rows=[building('edge',box(-.05,.1,.1)),building('hole',box(.4,.4,.1)),building('outside',box(2,2,.1))];
  assert.deepEqual(selectPowerBuildings(rows,[area]).map(r=>r.id),['edge']);
  assert.equal(selectPowerBuildings([building('a')],[box()],box(.8,.8,.1)).length,0);
});
test('duplicate identities and ambiguous CRS fail closed; multiple address associations are retained without picking one',()=>{
  assert.throws(()=>selectPowerBuildings([building('x'),building('x')],[box()]),/duplicated/);
  assert.throws(()=>selectPowerBuildings([building('x',{...box(),spatialReference:{wkid:3857}})],[box()]),/WGS84/);
  const row=selectPowerBuildings([building('x',box(.1,.1,.1),null,['100 A St','102 A St','100 A St'])],[box()])[0];
  assert.deepEqual(row.addresses,['100 A St','102 A St']);assert.equal(row.label,'2 associated addresses');assert.equal(row.height,null);
  assert.equal(selectPowerBuildings([building('x',box(.1,.1,.1),8,[])],[box()])[0].label,'Address not matched');
});
test('chunk bounds preserve footprints crossing cells; oversized queries and unsafe paths cannot silently truncate',()=>{
  assert.equal(planBuildingTiles(validateBuildingIndex(index()),[box(.99,0,.1)]).length,1);
  const big=index();big.tiles[0].decodedBytes=30_000_000;assert.throws(()=>planBuildingTiles(big,[box()]),/too large/);
  for(const change of [d=>d.tiles[0].key='../secret',d=>d.crs='EPSG:3857',d=>d.tiles.push({...d.tiles[0]}),d=>d.tiles[0].sha256='x']){const d=index();change(d);assert.throws(()=>validateBuildingIndex(d));}
});
test('all compressed chunks reconcile with the exact pinned county index and preserve height/address unknowns',async()=>{
  const root=new URL('../site/data/power-buildings/',import.meta.url),d=validateBuildingIndex(JSON.parse(await readFile(new URL('index.json',root))));
  let count=0,heights=0,addresses=0;const ids=new Set();
  for(const tile of d.tiles){const data=await readFile(new URL(`${d.release}/${tile.key}.json.gz`,root));assert.equal(data.length,tile.bytes);assert.equal(createHash('sha256').update(data).digest('hex'),tile.sha256);const text=gunzipSync(data);assert.equal(text.length,tile.decodedBytes);const chunk=JSON.parse(text);assert.equal(chunk.rows.length,tile.count);assert.equal(chunk.release,d.release);for(const r of chunk.rows){assert(!ids.has(r.id));ids.add(r.id);count++;heights+=buildingHeight(r.height)!==null;addresses+=r.addresses.length>0;}}
  assert.equal(count,d.buildings);assert.equal(heights,d.withHeight);assert.equal(addresses,d.withAddress);assert.equal((await readdir(new URL(d.release+'/',root))).length,d.tiles.length);
});
test('partial, changed or cancelled downloads never yield an apparently complete result',async()=>{
  const d=index(),chunk=gzipSync(JSON.stringify({schemaVersion:1,release:d.release,rows:[building('a')]}));d.tiles[0].bytes=chunk.length;d.tiles[0].decodedBytes=gunzipSync(chunk).length;d.tiles[0].sha256=createHash('sha256').update(chunk).digest('hex');
  let cancelled=false;const fetcher=async url=>String(url).endsWith('index.json')?new Response(JSON.stringify(d)):new Response(chunk);
  const value=await loadPowerBuildings([box()],{fetcher});assert.equal(value.rows.length,1);
  assert.equal(await loadPowerBuildings([box()],{fetcher:async url=>{const r=await fetcher(url);cancelled=true;return r;},current:()=>!cancelled}),null);
  await assert.rejects(loadPowerBuildings([box()],{fetcher:async url=>String(url).endsWith('index.json')?new Response(JSON.stringify(d)):new Response('Failed',{status:503})}),/503/);
  await assert.rejects(loadPowerBuildings([box()],{fetcher:async url=>String(url).endsWith('index.json')?new Response(JSON.stringify(d)):new Response(new Uint8Array(chunk.length))}),/differs/);
});
test('3D uses the same positive height field; unknown footprints stay flat and closing releases registered layers',async()=>{
  class Layer{constructor(p){Object.assign(this,p);}load(){return Promise.resolve(this);}destroy(){this.destroyed=true;}}
  class Graphic{constructor(p){Object.assign(this,p);}}
  const registered=[],removed=[],view={type:'2d'};
  const c=createPowerBuildingsMap({FeatureLayer:Layer,Graphic,registerLayer:(k,l)=>registered.push(l),removeLayer:l=>removed.push(l),getView:()=>view,focusGeometry:()=>{}});
  await c.set([building('a'),building('b',box(.3,.3,.1),null,[])]);view.type='3d';c.sync();
  assert.equal(registered[0].minScale,0,'Selected footprints must draw at the fitted area extent, without another zoom action.');
  assert.equal(registered[0].renderer.visualVariables[0].field,'height_m');assert.equal(registered[0].renderer.visualVariables[0].valueUnit,'meters');assert.equal(registered[1].renderer.symbol.type,'simple-fill');assert.equal(registered[1].source[0].attributes.height_m,null);assert.equal(registered[1].source[0].attributes.address_label,'');
  c.clear();assert.equal(removed.length,2);assert(removed.every(l=>l.destroyed));
});

test('automatic loading keeps the complete area when within bounds; only capacity limits narrow to the current viewport',async()=>{
  const expected={rows:[building('a')],scope:'Whole selected utility area'};let reads=0,visible=0;
  assert.equal(await loadPowerBuildingsAutomatic([box()],{read:async()=>{reads++;return expected;},viewport:()=>{throw Error('Should not inspect viewport');}}),expected);assert.equal(reads,1);
  reads=0;const view=box(.1,.1,.2),calls=[];
  const result=await loadPowerBuildingsAutomatic([box()],{viewport:()=>view,onVisible:()=>visible++,read:async(_p,options)=>{reads++;calls.push(options);if(!options.viewport)throw new BuildingQueryLimitError('Too large');return {...expected,scope:'Visible map portion when loaded'};}});
  assert.equal(reads,2);assert.equal(visible,1);assert.equal(calls[1].viewport,view);assert.equal(result.scope,'Visible map portion when loaded');
});
test('automatic source failures and cancelled selections never disguise themselves as smaller-scope successes',async()=>{
  let reads=0,visible=0;
  await assert.rejects(loadPowerBuildingsAutomatic([box()],{viewport:()=>box(),onVisible:()=>visible++,read:async()=>{reads++;throw Error('HTTP 503');}}),/503/);
  assert.equal(reads,1);assert.equal(visible,0);
  await assert.rejects(loadPowerBuildingsAutomatic([box()],{current:()=>false,viewport:()=>box(),onVisible:()=>visible++,read:async()=>{throw new BuildingQueryLimitError('Cancelled large query');}}),/Cancelled/);assert.equal(visible,0);
  await assert.rejects(loadPowerBuildingsAutomatic([box()],{viewport:()=>null,read:async()=>{throw new BuildingQueryLimitError('Too large');}}),/extent is not ready/);
});

test('selecting a power area loads without a button, waits for navigation and does not refetch on unchanged refreshes',async()=>{
  class Element{constructor(tag){this.tag=tag;this.children=[];this.isConnected=true;}append(...nodes){this.children.push(...nodes);}replaceChildren(...nodes){this.children=nodes;}setAttribute(){}addEventListener(){}}
  const before={document:globalThis.document,window:globalThis.window,fetch:globalThis.fetch};
  const d=index();
  // Use one source record outside the utility polygon, so the UI has an empty but complete result.
  const content=gzipSync(JSON.stringify({schemaVersion:1,release:d.release,rows:[building('outside',box(.8,.8,.1))]}));d.tiles[0].count=1;d.tiles[0].bytes=content.length;d.tiles[0].decodedBytes=gunzipSync(content).length;d.tiles[0].sha256=createHash('sha256').update(content).digest('hex');
  let reads=0,applied=0,resolveNavigation;
  try{
    globalThis.document={createElement:tag=>new Element(tag)};globalThis.window={addEventListener(){}};
    globalThis.fetch=async url=>{reads++;return String(url).endsWith('index.json')?new Response(JSON.stringify(d)):new Response(content);};
    const ui=createPowerBuildings(),map={clearPowerBuildings(){},capturePowerBuildingFocus:()=>()=>true,focusPower(){return Promise.resolve();},onPowerBuildingsViewSettled(){return ()=>{};},setPowerBuildingLabels(){},async setPowerBuildings(){applied++;},powerBuildingsViewport:()=>box()};
    ui.setMap(map);const row={key:'event',revision:'r1',status:'warning',geometries:[box(0,0,.5)]},ready=new Promise(resolve=>{resolveNavigation=resolve;});
    ui.select(row,new Element('div'),{ready});ui.select(row,new Element('div'));
    await new Promise(resolve=>setTimeout(resolve,0));assert.equal(reads,0,'An unchanged refresh must not bypass pending navigation.');
    resolveNavigation();for(let i=0;i<30&&!applied;i++)await new Promise(resolve=>setTimeout(resolve,5));
    assert.equal(applied,1);assert.equal(reads,2);
    ui.select(row,new Element('div'));await new Promise(resolve=>setTimeout(resolve,0));assert.equal(reads,2);
    let finish;ui.select({...row,revision:'r2'},new Element('div'),{ready:new Promise(resolve=>{finish=resolve;})});ui.clear();finish();await new Promise(resolve=>setTimeout(resolve,0));assert.equal(reads,2,'Closing a pending selection prevents its automatic request.');
  }finally{for(const [k,v]of Object.entries(before)){if(v===undefined)delete globalThis[k];else globalThis[k]=v;}}
});

test('building fits happen only for deliberate whole-area selections, never refreshes, visible queries or superseded navigation',async()=>{
  class Element{constructor(tag){this.tag=tag;this.children=[];this.isConnected=true;}append(...n){this.children.push(...n);}replaceChildren(...n){this.children=n;}setAttribute(){}addEventListener(){}}
  const before={document:globalThis.document,window:globalThis.window,fetch:globalThis.fetch};
  const wait=async fn=>{for(let i=0;i<100&&!fn();i++)await new Promise(r=>setTimeout(r,5));assert(fn(),'UI operation must finish');};
  try{
    globalThis.document={createElement:tag=>new Element(tag)};globalThis.window={addEventListener(){}};
    for(const scenario of ['selection','manual navigation','closed pane','background revision','visible portion']){
      const d=index(),content=gzipSync(JSON.stringify({schemaVersion:1,release:d.release,rows:[building('a')]}));
      Object.assign(d.tiles[0],{bytes:content.length,decodedBytes:gunzipSync(content).length,sha256:createHash('sha256').update(content).digest('hex')});
      if(scenario==='visible portion')d.tiles=Array.from({length:81},(_,i)=>({...d.tiles[0],key:`${i}_0`,bbox:[i,0,i+.5,.5]}));
      let applied=0,fitted=0,reads=0,allowed=true;
      globalThis.fetch=async url=>{reads++;return String(url).endsWith('index.json')?new Response(JSON.stringify(d)):new Response(content);};
      const ui=createPowerBuildings(),map={clearPowerBuildings(){},capturePowerBuildingFocus:()=>()=>allowed,onPowerBuildingsViewSettled:()=>()=>{},powerBuildingsViewport:()=>box(0,0,.5),setPowerBuildingLabels(){},
        async setPowerBuildings(){applied++;if(scenario==='manual navigation')allowed=false;if(scenario==='closed pane')ui.clear();},
        async focusPowerBuildings(options){assert(options.canNavigate());fitted++;}};
      ui.setMap(map);
      const row={key:'outage',revision:'1',status:'outage',geometries:[scenario==='visible portion'?box(0,0,85):box()]};
      ui.select(row,new Element('div'),{locate:scenario!=='background revision'});
      await wait(()=>applied===1);await new Promise(r=>setTimeout(r,0));
      assert.equal(fitted,scenario==='selection'?1:0,scenario);
      if(scenario==='selection'){
        const count=reads;ui.select(row,new Element('div'),{locate:false});await new Promise(r=>setTimeout(r,0));assert.equal(fitted,1);assert.equal(reads,count);
        ui.select(row,new Element('div'),{locate:true});await wait(()=>fitted===2);assert.equal(reads,count,'Reselecting reuses the complete loaded footprint result.');
        ui.select({...row,revision:'2'},new Element('div'),{locate:false});await wait(()=>applied===2);assert.equal(fitted,2,'New source revisions refresh buildings without moving the operator.');
      }
      ui.clear();
    }
  }finally{for(const[k,v]of Object.entries(before)){if(v===undefined)delete globalThis[k];else globalThis[k]=v;}}
});

test('the building-group map target includes every footprint and retains the navigation guard',async()=>{
  class Layer{constructor(p){Object.assign(this,p);}load(){return Promise.resolve();}destroy(){}}
  class Geometry{constructor(p){Object.assign(this,p);}}
  const targets=[],options={canNavigate:()=>true};
  const map=createPowerBuildingsMap({FeatureLayer:Layer,Graphic:Geometry,Extent:Geometry,registerLayer(){},removeLayer(){},getView:()=>({type:'3d'}),focusGeometry:(...args)=>targets.push(args)});
  assert.equal(await map.focusAll(options),false);
  await map.set([building('near',box(-119.8,36.7,.001)),building('far',box(-119.7,36.8,.001))]);await map.focusAll(options);
  const[extent,scale,guard]=targets[0];assert(extent.xmin<-119.8&&extent.xmax>-119.699&&extent.ymin<36.7&&extent.ymax>36.801);assert.equal(scale,null,'A large group must not be cropped to address scale.');assert.equal(guard,options);
});
