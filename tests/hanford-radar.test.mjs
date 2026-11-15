import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {hanfordRadarTimeline,loadHanfordTimeline,loadHanfordFrame} from '../site/lib/hanford-radar-data.js';
import {radarEchoCells} from '../site/lib/hanford-radar-cells.js';

const now=Date.parse('2026-11-15T02:14:00Z');
const scan=(sample=[-119.5,36.6,1200,25])=>{
 const body=Buffer.alloc(16);
 sample.forEach((value,index)=>body.writeFloatLE(value,index*4));
 const frame={file:'KHNX20261115_020730_V06.bin',start:'2026-11-15T02:07:30.230Z',end:'2026-11-15T02:12:11Z',
  count:1,bytes:16,sha256:createHash('sha256').update(body).digest('hex'),
  source:'https://unidata-nexrad-level2.s3.amazonaws.com/2026/11/15/KHNX/KHNX20261115_020730_V06'};
 return {body,frame,manifest:{kind:'live-observation',station:'KHNX',checkedAt:'2026-11-15T02:13:00Z',frames:[frame]}};
};

test('Hanford scans use source time and flag an old collector; reject invalid or future scan identity',()=>{
 const {manifest,frame}=scan();
 assert.equal(hanfordRadarTimeline(manifest,now).frames[0].end,Date.parse(frame.end));
 assert.equal(hanfordRadarTimeline(manifest,now+7*60_000).delayed,true);
 assert.throws(()=>hanfordRadarTimeline(manifest,now+121*60_000),/old/);
 assert.throws(()=>hanfordRadarTimeline(manifest,now-15*60_000),/manifest/);
 assert.throws(()=>hanfordRadarTimeline({...manifest,frames:[{...frame,file:'../other.bin'}]},now),/scan/);
 assert.throws(()=>hanfordRadarTimeline({...manifest,frames:[{...frame,source:'https://example.com/scan'}]},now),/identity/);
});

test('replay orders completed scans, reports gaps and keeps at most the most recent 12',()=>{
 const {manifest,frame}=scan();
 const frames=Array.from({length:20},(_,i)=>{
  const start=new Date(Date.parse(frame.start)-i*180_000).toISOString();
  const file='KHNX'+start.slice(0,10).replaceAll('-','')+'_'+start.slice(11,19).replaceAll(':','')+'_V06.bin';
  return {...frame,file,start,end:new Date(Date.parse(start)+120_000).toISOString(),source:frame.source.replace(frame.file.slice(0,-4),file.slice(0,-4))};
 });
 const history=hanfordRadarTimeline({...manifest,frames},now);
 assert.equal(history.frames.length,12);
 assert.deepEqual(history.frames.map(row=>row.file),frames.slice(0,12).reverse().map(row=>row.file));
 assert.equal(history.gaps,false);
 assert.equal(hanfordRadarTimeline({...manifest,frames:[frames[0],frames[10]]},now).gaps,true);
});

test('downloads verified packed altitude and rejects incomplete, altered or out-of-contract samples',async()=>{
 const {manifest,body,frame}=scan();
 const fetchImpl=async(url,options)=>{
  assert.equal(url.origin,'https://frog-demo.ryanlopez.tech');
  assert.equal(options.credentials,'omit');
  return url.pathname.endsWith('/manifest.json')?Response.json(manifest):new Response(body);
 };
 const options={clock:()=>now,fetchImpl};
 const [parsed]=(await loadHanfordTimeline(options)).frames;
 assert.deepEqual([...await loadHanfordFrame(parsed,options)],[-119.5,Math.fround(36.6),1200,25]);
 const read=(doc,bytes)=>async url=>url.pathname.endsWith('/manifest.json')?Response.json(doc):new Response(bytes);
 await assert.rejects(loadHanfordFrame(frame,{...options,fetchImpl:read(manifest,body.subarray(0,15))}),/length/);
 await assert.rejects(loadHanfordFrame(frame,{...options,fetchImpl:read(manifest,Buffer.alloc(16))}),/checksum/);
 const invalid=scan([-119.5,36.6,12001,25]);
 await assert.rejects(loadHanfordFrame(invalid.frame,{...options,fetchImpl:read(invalid.manifest,invalid.body)}),/sample/);
});

test('radar cells preserve sampled altitude bands, use the strongest return and leave gaps empty',()=>{
 const samples=new Float32Array([
  -120.597,36.303,1200,31,
  -120.598,36.302,1700,22,
  -120.598,36.302,3800,46,
  -120.596,36.303,6500,12,
  -120.1,36.8,1200,55
 ]);
 const cells=radarEchoCells(samples);
 assert.deepEqual(cells.map(cell=>[cell.bottom,cell.top,cell.dbz]),[[1000,2000,31],[3000,4000,46],[1000,2000,55]]);
 assert.equal(radarEchoCells(samples,10).length,4);
 assert(cells.every(cell=>cell.east-cell.west<0.05&&cell.north-cell.south<0.04));
});
