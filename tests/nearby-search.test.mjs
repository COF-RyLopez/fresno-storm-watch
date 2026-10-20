import test from 'node:test';
import assert from 'node:assert/strict';
import {nearbyEntries,searchGeometry,envelopesNear,METERS_PER_MILE} from '../site/lib/nearby-search.js';
const sr={wkid:4326},line={paths:[[[-119.8,36.8],[-119.7,36.8]],[[-119.6,36.9],[-119.5,36.9]]],spatialReference:sr};
const point=(x=-119.8,y=36.8)=>({x,y,spatialReference:sr});

test('geometry contract rejects absent CRS, short lines and nonfinite positions; preserves disconnected paths and polygon holes',()=>{
  assert.equal(searchGeometry({...point(),spatialReference:null}),null);
  assert.equal(searchGeometry(point(NaN)),null);
  assert.equal(searchGeometry({paths:[[[-119,36]]],spatialReference:sr}),null);
  assert.equal(searchGeometry(line).shape.paths.length,2);
  const rings=[[[-120,36],[-119,36],[-119,37],[-120,36]],[[-119.8,36.2],[-119.7,36.2],[-119.7,36.3],[-119.8,36.2]]];
  assert.deepEqual(searchGeometry({rings,spatialReference:sr}).shape.rings,rings);
});

test('query passes full geometry to geodetic engine, uses exact cutoff, deduplicates IDs and accounts for unknowns/history',async()=>{
  const rows=[{key:'near',kind:'gauge',geometry:point()},{key:'near',kind:'gauge',geometry:point()},{key:'edge',kind:'gauge',geometry:point()},{key:'beyond',kind:'gauge',geometry:point()},{key:'unknown',kind:'asset',geometry:null},{key:'engine-empty',kind:'asset',geometry:point()},{key:'inactive',kind:'road-record',history:true,geometry:point()},{key:'unrelated',kind:'reservoir',geometry:point()}];
  let calls=0;const values=[0,2*METERS_PER_MILE,2*METERS_PER_MILE+.001,NaN];
  const result=await nearbyEntries(line,rows,{distance:(a,b)=>{assert.equal(a.paths.length,2);assert.equal(b.type,'point');return values[calls++];}});
  assert.equal(calls,4);assert.equal(result.gauge.total,2);assert.equal(result.gauge.available,3);assert.equal(result.asset.unknown,2);assert.equal(result['road-record'].historyExcluded,1);
  const withHistory=await nearbyEntries(line,rows,{history:true,distance:()=>0});assert.equal(withHistory['road-record'].total,1);
});

test('bounding envelopes only reject far records; diagonal-box false positives still require measured distance',async()=>{
  assert(envelopesNear([-120,36,-119,37],[-119.5,36.4,-119.5,36.4],3218));
  assert(!envelopesNear([-120,36,-119,37],[-115,33,-115,33],3218));
  const result=await nearbyEntries(line,[{key:'bbox',kind:'gauge',geometry:point()}],{distance:()=>20_000});assert.equal(result.gauge.total,0);
});

test('source refresh / sign-out cancellation discards pending answers and per-feature failures remain unknown',async()=>{
  let valid=true;const rows=[{key:'a',kind:'asset',geometry:point()}];
  assert.equal(await nearbyEntries(line,rows,{current:()=>valid,distance:()=>{valid=false;return 0;}}),null);
  const result=await nearbyEntries(line,rows,{distance:()=>{throw new Error('bad geometry');}});assert.equal(result.asset.unknown,1);assert.equal(result.asset.total,0);
  await assert.rejects(nearbyEntries(line,[],{miles:10,distance:()=>0}),/Unsupported/);
});

test('list caps do not reduce total counts; ties sort by stable ID, yielding lets navigation cancel work',async()=>{
  const rows=Array.from({length:50},(_,i)=>({key:String(i).padStart(2,'0'),kind:'asset',geometry:point()})).reverse();let yields=0;
  const result=await nearbyEntries(line,rows,{distance:()=>0,yieldTask:async()=>{yields++;}});assert.equal(result.asset.total,50);assert.equal(result.asset.rows.length,20);assert.equal(result.asset.rows[0].key,'00');assert.equal(yields,3);
});
