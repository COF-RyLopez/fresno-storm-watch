import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {gzipSync} from 'node:zlib';
import {PMTiles} from 'pmtiles';
import {pack} from '../scripts/pack-waterway-archives.mjs';
test('archive repack preserves each original tile, zooms, bounds and deterministic hash',async()=>{
 const root=await mkdtemp(join(tmpdir(),'frog-archive-test-'));
 try{
  await mkdir(join(root,'tiles','0','0'),{recursive:true});
  const bytes=Buffer.from([26,0]);await writeFile(join(root,'tiles','0','0','0.pbf'),gzipSync(bytes));
  const metadata={bounds:[-121,35,-118,38],vector_layers:[]},base=pathToFileURL(root+'/');
  const result=await pack('tiles',metadata,base),again=await pack('tiles',metadata,base);
  assert.equal(result.verified,1);assert.equal(result.tileCount,1);assert.equal(result.sha256,again.sha256);
  const reader=new PMTiles({getKey:()=>root,getBytes:async(o,l)=>({data:Uint8Array.from(result.bytes.subarray(o,o+l)).buffer})});
  assert.deepEqual(Buffer.from((await reader.getZxy(0,0,0)).data),bytes);
  const h=await reader.getHeader();assert.equal(h.minZoom,0);assert.equal(h.maxZoom,0);assert.equal(h.minLon,-121);assert.equal(h.maxLat,38);
 }finally{await rm(root,{recursive:true});}
});
