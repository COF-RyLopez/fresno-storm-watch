import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {findMapEntries} from '../site/lib/map-search-model.js';
const base=new URL('../site/data/search/waterbodies-v0.34.0/',import.meta.url),index=JSON.parse(await readFile(new URL('index.json',base),'utf8')),manifest=JSON.parse(await readFile(new URL('manifest.json',base),'utf8'));
test('named lake coverage, aliases and separate identities are accounted for',()=>{
  assert.equal(index.entries.length,411);assert.equal(new Set(index.entries.map(row=>row.key)).size,411);
  const a=manifest.accounting;assert.equal(a.input,a.otherFeatureType+a.unnamed+a.accepted);assert.equal(a.accepted,417);
  for(const query of ['Millerton','Friant Dam','MIL','Pine Flat Reservoir','PNF','Shaver','Huntington'])assert.equal(findMapEntries(index.entries,query).rows[0].kind,'waterbody');
  assert.equal(findMapEntries(index.entries,'Pine Flat Reservoir').rows[0].name,'Pine Flat Lake');
  const mil=findMapEntries(index.entries,'Millerton').rows[0];assert.equal(mil.stationId,'MIL');
  assert.match(manifest.scope,/complete source outlines/);assert.match(manifest.scope,/Not clipped or simplified/);
  const sameNames=new Map();for(const row of index.entries){const identities=sameNames.get(row.name)??new Set();identities.add(row.identity);sameNames.set(row.name,identities);}
  assert([...sameNames.values()].some(values=>values.size>1),'Distinct same-name lakes should remain separate');
});
test('every named lake has a complete hashed polygon shard with rings and matching whole-feature bounds',async()=>{
  const shapes=new Map();
  for(const [name,hash]of Object.entries(manifest.geometryShardsSha256)){
    const bytes=await readFile(new URL(name,base));assert.equal(createHash('sha256').update(bytes).digest('hex'),hash);
    for(const [key,shape]of Object.entries(JSON.parse(bytes))){assert(!shapes.has(key));shapes.set(key,shape);assert.equal(shape.spatialReference.wkid,4326);assert(shape.rings.length);}
  }
  let holesOrParts=0;
  for(const row of index.entries){
    assert.equal(row.private,undefined);assert.equal(row.kind,'waterbody');assert(!('geometry'in row));
    const shape=shapes.get(row.key);assert(shape);if(shape.rings.length>1)holesOrParts++;
    const bounds=[Infinity,Infinity,-Infinity,-Infinity];
    for(const ring of shape.rings){assert(ring.length>=4);assert.deepEqual(ring[0],ring.at(-1));for(const [x,y]of ring){assert(Number.isFinite(x)&&Number.isFinite(y)&&x>-122&&x<-117&&y>35&&y<39);bounds[0]=Math.min(bounds[0],x);bounds[1]=Math.min(bounds[1],y);bounds[2]=Math.max(bounds[2],x);bounds[3]=Math.max(bounds[3],y);}}
    assert.deepEqual(bounds,row.bounds);
  }
  assert.equal(shapes.size,index.entries.length);assert(holesOrParts>0);
});
