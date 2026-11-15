import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {mkdtemp,readFile,writeFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {RADAR_EXTENT} from '../site/lib/hanford-radar-data.js';
import {gridRadarSamples,buildRadarVolume,volumeDirectory,project3857,validateSourceFrame} from '../scripts/lib/radar-volume.mjs';
import {collectRadarVolume} from '../scripts/collect-radar-volume.mjs';

const now=Date.parse('2026-11-14T20:10:00Z');
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
function fixture(rows=[[-119.5,36.6,1200,25]],start='2026-11-14T20:00:00Z'){
 const body=Buffer.alloc(rows.length*16);
 rows.flat().forEach((value,index)=>body.writeFloatLE(value,index*4));
 const file=`KHNX${start.slice(0,10).replaceAll('-','')}_${start.slice(11,19).replaceAll(':','')}_V06.bin`;
 const frame={file,start:Date.parse(start),end:Date.parse(start)+120000,count:rows.length,bytes:body.length,sha256:digest(body),
  source:`https://unidata-nexrad-level2.s3.amazonaws.com/${start.slice(0,4)}/${start.slice(5,7)}/${start.slice(8,10)}/KHNX/${file.slice(0,-4)}`};
 return {body,frame,samples:new Float32Array(rows.flat()),manifest:{kind:'live-observation',station:'KHNX',checkedAt:new Date(now).toISOString(),frames:[frame],errors:[]}};
}
const fetchFixture=sample=>async url=>url.pathname.endsWith('/manifest.json')?Response.json(sample.manifest):new Response(sample.body);
const offset=(z,y,x)=>(z*48+y)*64+x;

test('projects longitude and latitude to metre coordinates without swapping axes',()=>{
 assert.deepEqual(project3857(0,0),[0,0]);
 const [x,y]=project3857(-120,37);
 assert(Math.abs(x-(-13358338.895192828))<1e-6);
 assert(Math.abs(y-4439106.787250583)<1e-6);
});

test('inclusive domain edges occupy the first and last voxel with northward y and upward MSL height',()=>{
 const [west,south,east,north]=RADAR_EXTENT;
 const grid=gridRadarSamples(new Float32Array([west,south,0,10,east,north,12000,79.5,west,north,500,25]));
 assert.equal(grid.values[offset(0,0,0)],10);
 assert.equal(grid.values[offset(23,47,63)],79.5);
 assert.equal(grid.values[offset(1,47,0)],25);
 assert.equal(grid.sourceCount,3);
 assert.equal(grid.occupiedVoxels,3);
 assert.equal(grid.collapsedSamples,0);
 assert.equal(grid.values.filter(value=>value!==-999).length,3);
 assert.equal(grid.values[offset(0,47,0)],-999,'No vertical fill below the sample');
});

test('retains each unique bin maximum deterministically and reconciles collapsed samples',()=>{
 const samples=[[-119.5,36.6,1200,25],[-119.5,36.6,1499,65.5],[-119.5,36.6,1300,15],[-119.5,36.6,1500,40]];
 const grid=gridRadarSamples(new Float32Array(samples.flat()));
 assert.deepEqual([...grid.values.filter(value=>value!==-999)],[65.5,40]);
 assert.equal(grid.sourceCount,4);assert.equal(grid.occupiedVoxels,2);assert.equal(grid.collapsedSamples,2);
 assert.equal(grid.maximumDbz,65.5);
 assert.deepEqual(grid,gridRadarSamples(new Float32Array(samples.toReversed().flat())));
});

test('empty input remains entirely unknown rather than clear air or zero reflectivity',()=>{
 const grid=gridRadarSamples(new Float32Array());
 assert.equal(grid.values.length,73728);
 assert(grid.values.every(value=>value===-999));
 assert.equal(grid.sourceCount,0);assert.equal(grid.occupiedVoxels,0);assert.equal(grid.maximumDbz,null);
 const volume=buildRadarVolume(fixture([]).frame,new Float32Array());
 assert.deepEqual(volume.metadata.attributes.chunks,[]);
 assert.equal(volume.bytes,0);
});

test('rejects nonfinite, malformed, filtered-out or out-of-bounds source samples instead of silently losing them',()=>{
 const [west,south,east,north]=RADAR_EXTENT;
 for(const row of [[west-0.001,south,0,20],[east+0.001,north,0,20],[west,south-0.001,0,20],[east,north+0.001,0,20],
  [west,south,-1,20],[west,south,12001,20],[west,south,0,0],[west,south,0,80],[west,south,NaN,20],[Infinity,south,0,20]])
  assert.throws(()=>gridRadarSamples(new Float32Array(row)),/sample/);
 assert.throws(()=>gridRadarSamples(new Float32Array([1,2,3])),/sample/);
 assert.throws(()=>buildRadarVolume(fixture().frame,new Float32Array()),/count/);
});

test('writes standard Zarr v3 metadata with gzip little-endian chunks and immutable full provenance',()=>{
 const [west,south,east,north]=RADAR_EXTENT;
 const f=fixture([[west,south,0,25.5],[east,north,12000,77]]);
 const volume=buildRadarVolume(f.frame,f.samples),m=volume.metadata;
 assert.equal(m.zarr_format,3);assert.equal(m.node_type,'array');assert.equal(m.data_type,'float32');
 assert.deepEqual(m.shape,[24,48,64]);assert.deepEqual(m.chunk_grid,{name:'regular',configuration:{chunk_shape:[4,16,16]}});
 assert.deepEqual(m.chunk_key_encoding,{name:'default',configuration:{separator:'/'}});
 assert.deepEqual(m.codecs,[{name:'bytes',configuration:{endian:'little'}},{name:'gzip',configuration:{level:6}}]);
 assert.equal(m.fill_value,-999);assert.deepEqual(m.dimension_names,['height','y','x']);
 assert.deepEqual(m.attributes.dimensions,['height','y','x']);assert.equal(m.attributes.crs,'EPSG:3857');
 assert.deepEqual(m.attributes.heightRange,[0,12000]);assert.equal(m.attributes.units,'dBZ');
 assert.match(m.attributes.heightReference,/estimated.*MSL/);
 assert.match(m.attributes.processing.sampling,/2.degree.*2.km/);
 assert.equal(m.attributes.processing.interpolation,'none');
 assert.equal(m.attributes.processing.verticalFill,'none');
 assert.deepEqual(m.attributes.sourceFrame,{file:f.frame.file,sha256:f.frame.sha256,start:f.frame.start,end:f.frame.end,source:f.frame.source});
 assert.deepEqual(volume.chunks.map(c=>c.key),['c/0/0/0','c/5/2/3']);
 let total=0;
 for(const c of volume.chunks){
  const info=m.attributes.chunks.find(item=>item.key===c.key),raw=gunzipSync(c.data);
  assert.equal(info.bytes,c.data.length);assert.equal(info.sha256,digest(c.data));
  assert.equal(raw.length,4096);total+=c.data.length;
  if(c.key==='c/0/0/0'){assert.equal(raw.readFloatLE(0),25.5);assert.equal(raw.readFloatLE(4),-999);}
  else assert.equal(raw.readFloatLE(4092),77);
 }
 assert.equal(volume.bytes,total);
 assert.equal(volume.metadataSha256,digest(volume.metadataBytes));
 assert.deepEqual(buildRadarVolume(f.frame,f.samples),volume,'Rebuilds are byte-for-byte deterministic');
});

test('rejects unsafe or inconsistent source identities, checksums, counts, and timestamps',()=>{
 const {frame}=fixture();
 assert.match(volumeDirectory(frame),/^KHNX20261114_200000_V06-[a-f0-9]{12}\.zarr$/);
 assert.notEqual(volumeDirectory(frame),volumeDirectory({...frame,sha256:'a'.repeat(64)}));
 for(const patch of [{file:'../escape.bin'},{file:'KHNX20261314_200000_V06.bin'},{sha256:'ABC'},
  {source:'https://example.com/anything'},{count:1.5},{bytes:15},{count:-1},{start:NaN},{start:frame.start+1000},
  {end:frame.start-1},{end:frame.start+1800001},{start:'bad'}])
  assert.throws(()=>validateSourceFrame({...frame,...patch}),/source|scan|time|count|identity|checksum/i);
});

test('collector commits complete frames before the manifest and reuses only verified local bytes',async t=>{
 const outDir=await mkdtemp(path.join(tmpdir(),'radar-volume-test-'));
 t.after(()=>rm(outDir,{recursive:true,force:true}));
 const f=fixture(),options={outDir,clock:()=>now,fetchImpl:fetchFixture(f),log:()=>{}};
 const first=await collectRadarVolume(options),record=first.frames[0];
 assert.equal(first.kind,'sampled-radar-volume');assert.equal(first.station,'KHNX');assert.equal(first.version,1);
 assert.equal(first.frames.length,1);assert.deepEqual(first.errors,[]);
 assert.equal(record.file,f.frame.file);assert.equal(record.sha256,f.frame.sha256);
 assert.equal(record.sourceCount,1);assert.equal(record.occupiedVoxels,1);
 const metadataPath=path.join(outDir,record.url,'zarr.json'),metadataBytes=await readFile(metadataPath);
 assert.equal(digest(metadataBytes),record.metadataSha256);
 const m=JSON.parse(metadataBytes),chunkPath=path.join(outDir,record.url,m.attributes.chunks[0].key);
 const before=(await stat(metadataPath)).mtimeMs;
 const second=await collectRadarVolume({...options,fetchImpl:async url=>{
  if(url.pathname.endsWith('/manifest.json'))return Response.json(f.manifest);
  throw Error('Verified local frame should not be fetched again');
 }});
 assert.deepEqual(second.frames,first.frames);assert.deepEqual(second.errors,[]);
 assert.equal((await stat(metadataPath)).mtimeMs,before);
 await writeFile(chunkPath,Buffer.from('corrupt gzip'));
 const repaired=await collectRadarVolume(options);
 assert.deepEqual(repaired.errors,[]);assert.equal(digest(await readFile(chunkPath)),m.attributes.chunks[0].sha256);
 assert.deepEqual(JSON.parse(await readFile(path.join(outDir,'manifest.json'),'utf8')),repaired);
});

test('a failed or altered source never publishes a partial frame and keeps errors visible',async t=>{
 const outDir=await mkdtemp(path.join(tmpdir(),'radar-volume-test-'));
 t.after(()=>rm(outDir,{recursive:true,force:true}));
 const f=fixture();
 const manifest=await collectRadarVolume({outDir,clock:()=>now,log:()=>{},fetchImpl:async url=>
  url.pathname.endsWith('/manifest.json')?Response.json(f.manifest):new Response(Buffer.alloc(16))});
 assert.deepEqual(manifest.frames,[]);assert.equal(manifest.errors.length,1);
 assert.match(manifest.errors[0].message,/checksum/);
 await assert.rejects(readFile(path.join(outDir,volumeDirectory(f.frame),'zarr.json')),/ENOENT/);
});

test('a timeline outage retains checksum-verified recent local frames but reports delayed publication',async t=>{
 const outDir=await mkdtemp(path.join(tmpdir(),'radar-volume-test-'));
 t.after(()=>rm(outDir,{recursive:true,force:true}));
 const f=fixture(),base={outDir,clock:()=>now,log:()=>{}};
 const first=await collectRadarVolume({...base,fetchImpl:fetchFixture(f)});
 const second=await collectRadarVolume({...base,fetchImpl:async()=>{throw Error('network offline');}});
 assert.deepEqual(second.frames,first.frames);assert.equal(second.errors.length,1);
 assert.match(second.errors[0].message,/network offline/);
 const old=await collectRadarVolume({...base,clock:()=>now+121*60000,fetchImpl:async()=>{throw Error('network offline');}});
 assert.deepEqual(old.frames,[],'Stale local cubes must expire');
});

test('changed scan timing cannot rewrite an existing immutable source directory',async t=>{
 const outDir=await mkdtemp(path.join(tmpdir(),'radar-volume-test-'));
 t.after(()=>rm(outDir,{recursive:true,force:true}));
 const f=fixture(),options={outDir,clock:()=>now,fetchImpl:fetchFixture(f),log:()=>{}};
 const first=await collectRadarVolume(options),record=first.frames[0];
 const filename=path.join(outDir,record.url,'zarr.json'),before=await readFile(filename);
 f.manifest.frames[0]={...f.frame,end:f.frame.end+1000};
 const changed=await collectRadarVolume(options);
 assert.equal(changed.errors.length,1);
 assert.match(changed.errors[0].message,/immutable.*identity/i);
 assert.deepEqual(await readFile(filename),before);
});

test('newest twelve source frames are retained in time order despite an unordered larger timeline',async t=>{
 const outDir=await mkdtemp(path.join(tmpdir(),'radar-volume-test-'));
 t.after(()=>rm(outDir,{recursive:true,force:true}));
 const f=fixture();
 f.manifest.frames=Array.from({length:13},(_,index)=>fixture(undefined,new Date(now-(13-index)*4*60000).toISOString()).frame).reverse();
 const manifest=await collectRadarVolume({outDir,clock:()=>now,fetchImpl:fetchFixture(f),log:()=>{}});
 assert.equal(manifest.frames.length,12);assert.deepEqual(manifest.errors,[]);
 assert.equal(manifest.frames[0].file,'KHNX20261114_192200_V06.bin');
 assert.equal(manifest.frames.at(-1).file,'KHNX20261114_200600_V06.bin');
 assert(manifest.frames.every((frame,index)=>!index||frame.end>manifest.frames[index-1].end));
});

test('tampered local inventory cannot escape the immutable directory even with a matching metadata hash',async t=>{
 const outDir=await mkdtemp(path.join(tmpdir(),'radar-volume-test-'));
 t.after(()=>rm(outDir,{recursive:true,force:true}));
 const f=fixture(),base={outDir,clock:()=>now,log:()=>{}};
 const manifest=await collectRadarVolume({...base,fetchImpl:fetchFixture(f)}),record=manifest.frames[0];
 const metadataPath=path.join(outDir,record.url,'zarr.json'),metadata=JSON.parse(await readFile(metadataPath,'utf8'));
 metadata.attributes.chunks[0].key='../../escape';
 const bytes=Buffer.from(JSON.stringify(metadata));record.metadataSha256=digest(bytes);
 await writeFile(metadataPath,bytes);await writeFile(path.join(outDir,'manifest.json'),JSON.stringify(manifest),'utf8');
 const result=await collectRadarVolume({...base,fetchImpl:async()=>{throw Error('offline');}});
 assert.deepEqual(result.frames,[]);assert.equal(result.errors.length,1);
});
