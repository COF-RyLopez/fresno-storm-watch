import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {cloudTopFrameAt,validateCloudTopManifest,loadCloudTopFrame} from '../site/lib/cloud-top-height-data.js';

const now=Date.parse('2026-11-15T05:26:00Z');
const minute=60000;
const origin='https://noaa-goes18.s3.amazonaws.com/ABI-L2-ACHA2KMC/2026/319/05/';
function scene(){
 const body=new Float32Array([-119.5,36.7,5500,-119.4,36.7,6000,-119.5,36.8,5750]);
 const first={file:'goes18-20263190508.bin',start:new Date(now-18*minute).toISOString(),end:new Date(now-16*minute).toISOString(),
  resolutionKm:2,count:3,sha256:createHash('sha256').update(Buffer.from(body.buffer)).digest('hex'),source:origin+'OR_ABI-L2-ACHA2KMC-M6_G18_s20263190508000_e20263190510000_c20263190513000.nc'};
 const second={...first,file:'goes18-20263190518.bin',start:new Date(now-8*minute).toISOString(),end:new Date(now-6*minute).toISOString(),
  source:origin+'OR_ABI-L2-ACHA2KMC-M6_G18_s20263190518000_e20263190520000_c20263190523000.nc'};
 return {body,first,second,doc:{schemaVersion:1,product:'ABI-L2-ACHA2KMC',satellite:'GOES-18',generatedAt:new Date(now).toISOString(),frames:[second,first]}};
}

test('a cloud top frame is selected by observation end at or before the radar scan',()=>{
 const {doc,first,second}=scene(),frames=validateCloudTopManifest(doc,now);
 assert.equal(cloudTopFrameAt(frames,now,now).file,second.file);
 assert.equal(cloudTopFrameAt(frames,now-9*minute,now).file,first.file);
 assert.equal(cloudTopFrameAt(frames,now-17*minute,now),null);
 assert.equal(cloudTopFrameAt(frames,now+minute,now),null);
 assert.throws(()=>validateCloudTopManifest({...doc,frames:[{...first,file:'../frame.bin'}]},now),/frame/);
 assert.throws(()=>validateCloudTopManifest({...doc,frames:[{...first,source:'https://example.com/frame.nc'}]},now),/frame/);
});

test('mesh tiles retain altitude in metres and reject corrupt bytes',async()=>{
 const {doc,body}=scene(),frame=validateCloudTopManifest(doc,now)[0];
 const read=buffer=>async()=>new Response(buffer);
 const mesh=await loadCloudTopFrame(frame,{fetchImpl:read(body)});
 assert.deepEqual([...mesh.vertices],Array.from(body));
 assert.equal(mesh.min,5500);assert.equal(mesh.max,6000);
 await assert.rejects(loadCloudTopFrame(frame,{fetchImpl:read(new Uint8Array(36))}),/checksum/);
 await assert.rejects(loadCloudTopFrame(frame,{fetchImpl:read(new Uint8Array(35))}),/length/);
});
