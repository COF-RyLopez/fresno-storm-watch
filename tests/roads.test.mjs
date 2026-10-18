import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchRoads,roadJson,roadHealth,roadFailureReason,RoadFeedError,ROAD_QUERY_SERVICE,ROAD_SERVICE} from '../site/lib/roads.js';

const reply=data=>({ok:true,json:async()=>data});
function fixture({ids=[1,2],mutate=data=>data}={}){
  return async(url,options)=>{
    const u=new URL(url),layer=Number(u.pathname.split('/').at(-2));
    assert(url.startsWith(`${ROAD_QUERY_SERVICE}/`));
    assert.equal(u.pathname.split('/').at(-1),'query');
    assert.equal(options.credentials,'omit');
    assert.equal(options.cache,'no-store');
    assert(!u.searchParams.has('token'));
    if(u.searchParams.has('returnIdsOnly'))return reply({objectIds:ids,objectIdFieldName:'objectid'});
    if(u.searchParams.has('returnCountOnly'))return reply({count:0});
    assert.equal(u.searchParams.get('outSR'),'4326');
    assert(!/contact|permitid|lasteditor|created_user|last_edited_user/.test(u.searchParams.get('outFields')));
    const features=u.searchParams.get('objectIds').split(',').map(Number).map(id=>({attributes:{objectid:id,globalid:`{layer-${layer}-${id}}`,blocknm:`Road ${id}`,active:'Yes'},geometry:layer===0?{x:-119.8,y:36.7}:{paths:[[[-119.8,36.7],[-119.7,36.8]]]}}));
    return reply(mutate({features,spatialReference:{wkid:4326}},u));
  };
}
test('all three road layers query the county public route without user credentials',async()=>{
  const before=Date.now(),result=await fetchRoads(fixture());
  assert.equal(result.rows.length,6);
  assert.deepEqual([...new Set(result.rows.map(r=>r.layer))].sort(),[0,1,2]);
  assert.equal(result.source,ROAD_SERVICE);
  assert.equal(result.queryService,ROAD_QUERY_SERVICE);
  assert(result.checked>=before);
});
test('road batches reconcile every requested ID, including more than one batch',async()=>{
  const ids=Array.from({length:201},(_,i)=>i+1),requests=[];
  const fetcher=fixture({ids});
  const result=await fetchRoads((url,options)=>{if(new URL(url).searchParams.has('objectIds'))requests.push(url);return fetcher(url,options);});
  assert.equal(result.rows.length,603);assert.equal(requests.length,6);
});
test('an empty road inventory must remain empty without implying roads reopened',async()=>{
  for(const ids of [[],null]){
    const result=await fetchRoads(fixture({ids}));assert.deepEqual(result.rows,[]);
    assert.match(roadHealth(result,null),/does not confirm roads are open/);
  }
});
test('malformed or incomplete inventories cannot replace the last successful snapshot',async()=>{
  for(const ids of [[1,1],['1'],[-1],undefined]){
    await assert.rejects(fetchRoads(async()=>reply({objectIds:ids,objectIdFieldName:'objectid'})),/inventory/);
  }
  await assert.rejects(fetchRoads(async url=>reply(new URL(url).searchParams.has('returnIdsOnly')?{objectIds:null,objectIdFieldName:'objectid'}:{count:1})),/could not be verified/);
});
test('duplicate, substituted, truncated or misprojected results fail the complete fetch',async()=>{
  for(const mutate of [
    d=>({...d,features:[d.features[0],d.features[0]]}),
    d=>({...d,features:[d.features[0],{...d.features[1],attributes:{...d.features[1].attributes,objectid:999}}]}),
    d=>({...d,exceededTransferLimit:true}),
    d=>({...d,spatialReference:{wkid:3857}})
  ])await assert.rejects(fetchRoads(fixture({mutate})),error=>error instanceof RoadFeedError&&['inventory','geometry'].includes(error.code));
});
test('transient road connection and HTTP failures retry once, then recover',async()=>{
  for(const failure of [()=>{throw new TypeError('Failed to fetch');},()=>({ok:false,status:503})]){
    let calls=0;const data=await roadJson('https://example.test/query',async()=>++calls===1?failure():reply({count:1}),{retryDelayMs:0});
    assert.equal(calls,2);assert.equal(data.count,1);
  }
});
test('permanent denials and malformed responses do not retry or become empty data',async()=>{
  for(const response of [{ok:false,status:403},reply({error:{code:403}}),{ok:true,json:async()=>{throw new SyntaxError('Bad JSON');}}]){
    let calls=0;await assert.rejects(roadJson('https://example.test/query',async()=>{calls++;return response;},{retryDelayMs:0}));assert.equal(calls,1);
  }
});
test('retry exhaustion remains a visible failure with safe, bounded diagnostics',async()=>{
  let calls=0;const error=await roadJson('https://example.test/query',async()=>{calls++;throw new DOMException('Timed out','TimeoutError');},{retryDelayMs:0}).catch(e=>e);
  assert.equal(calls,2);assert.equal(error.code,'timeout');
  assert.match(roadHealth(null,error),/no road status loaded.*timed out/);
  assert.match(roadHealth({rows:[{}],checked:1},error),/retained records are not a current status check/);
  assert.equal(roadFailureReason(new Error('sensitive response text')),'The county update could not be verified.');
});
