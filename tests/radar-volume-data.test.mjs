import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {loadRadarVolumeTimeline,loadRadarVolumeFrame} from '../site/lib/radar-volume-data.js';

const now=Date.parse('2026-11-15T08:10:00Z');
const hash=body=>createHash('sha256').update(body).digest('hex');
function fixture(){
 const bytes=Buffer.alloc(4096);for(let i=0;i<1024;i++)bytes.writeFloatLE(-999,i*4);
 bytes.writeFloatLE(32,0);bytes.writeFloatLE(51.5,4092);
 const packed=gzipSync(bytes);
 const source={file:'KHNX20261115_080000_V06.bin',sha256:'a'.repeat(64),start:now-600000,end:now-300000,
  source:'https://unidata-nexrad-level2.s3.amazonaws.com/2026/11/15/KHNX/KHNX20261115_080000_V06'};
 const radius=6378137,merc=lat=>radius*Math.log(Math.tan(Math.PI/4+lat*Math.PI/360));
 const bounds=[Math.fround(-120.6)*Math.PI/180*radius,merc(Math.fround(36.3)),Math.fround(-118.5)*Math.PI/180*radius,merc(Math.fround(37.7))];
 const meta={zarr_format:3,node_type:'array',shape:[24,48,64],data_type:'float32',dimension_names:['height','y','x'],
  chunk_grid:{name:'regular',configuration:{chunk_shape:[4,16,16]}},chunk_key_encoding:{name:'default',configuration:{separator:'/'}},fill_value:-999,
  codecs:[{name:'bytes',configuration:{endian:'little'}},{name:'gzip',configuration:{level:6}}],
  attributes:{dimensions:['height','y','x'],bounds3857:bounds,heightRange:[0,12000],crs:'EPSG:3857',units:'dBZ',heightReference:'estimated MSL metres',
   sourceFrame:source,sourceCount:3,occupiedVoxels:2,chunks:[{key:'c/2/1/3',bytes:packed.length,sha256:hash(packed)}]}};
 const body=Buffer.from(JSON.stringify(meta));
 const record={...source,url:`${source.file.slice(0,-4)}-${source.sha256.slice(0,12)}.zarr/`,metadataSha256:hash(body),bytes:packed.length,sourceCount:3,occupiedVoxels:2};
 const doc={version:1,kind:'sampled-radar-volume',station:'KHNX',generatedAt:now,checkedAt:now,frames:[record],errors:[]};
 const calls=[];
 const fetchImpl=async url=>{calls.push(String(url));return new Response(String(url).endsWith('manifest.json')?JSON.stringify(doc):String(url).endsWith('zarr.json')?body:packed);};
 return {doc,record,meta,body,packed,calls,fetchImpl};
}

test('volume timeline retains the exact source scan identity and observation times',async()=>{
 const f=fixture(),result=await loadRadarVolumeTimeline({fetchImpl:f.fetchImpl,clock:()=>now});
 assert.equal(result.frames.length,1);assert.equal(result.frames[0].count,3);
 assert.equal(result.frames[0].bytes,48);assert.equal(result.frames[0].end,now-300000);
 assert.equal(result.frames[0].volumeRecord.url,f.record.url);
 f.doc.frames[0].url='../private/';
 await assert.rejects(loadRadarVolumeTimeline({fetchImpl:f.fetchImpl,clock:()=>now}),/volume/);
});

test('sparse Zarr chunks place heights and northward rows correctly, with all unobserved cells unknown',async()=>{
 const f=fixture();
 const cube=await loadRadarVolumeFrame(f.record,{fetchImpl:f.fetchImpl,clock:()=>now});
 assert.deepEqual(cube.shape,[24,48,64]);assert.equal(cube.values.length,24*48*64);
 assert.equal(cube.values[(8*48+16)*64+48],32);
 assert.equal(cube.values[(11*48+31)*64+63],51.5);
 assert.equal(cube.values.filter(v=>v!==-999).length,2);
 assert.equal(cube.values[0],-999);assert.equal(f.calls.length,2,'Only metadata and the occupied chunk are fetched.');
});

test('corrupt metadata or a missing listed chunk must fail instead of implying clear sky',async()=>{
 const f=fixture();
 await assert.rejects(loadRadarVolumeFrame({...f.record,metadataSha256:'b'.repeat(64)},{fetchImpl:f.fetchImpl,clock:()=>now}),/checksum/);
 await assert.rejects(loadRadarVolumeFrame(f.record,{clock:()=>now,fetchImpl:async url=>String(url).endsWith('zarr.json')?new Response(f.body):new Response('',{status:404})}),/HTTP 404/);
 const corrupt=Buffer.from(f.packed);corrupt[20]^=1;
 await assert.rejects(loadRadarVolumeFrame(f.record,{clock:()=>now,fetchImpl:async url=>new Response(String(url).endsWith('zarr.json')?f.body:corrupt)}),/checksum/);
});

test('expired, conflicting and oversized metadata are rejected before allocation',async()=>{
 const f=fixture();
 await assert.rejects(loadRadarVolumeFrame(f.record,{fetchImpl:f.fetchImpl,clock:()=>now+3*3600000}),/old|expired/);
 for(const mutation of [m=>m.shape=[999999,48,64],m=>m.attributes.sourceFrame.sha256='b'.repeat(64),m=>m.attributes.bounds3857[0]=0,m=>m.attributes.chunks.push(m.attributes.chunks[0])]){
  const m=structuredClone(f.meta);mutation(m);const body=Buffer.from(JSON.stringify(m));
  await assert.rejects(loadRadarVolumeFrame({...f.record,metadataSha256:hash(body)},{clock:()=>now,fetchImpl:async()=>new Response(body)}),/metadata|source|chunk|bounds/);
 }
});
