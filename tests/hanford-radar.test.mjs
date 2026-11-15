import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {hanfordRadarTimeline,loadHanfordTimeline,loadHanfordFrame,RADAR_EXTENT} from '../site/lib/hanford-radar-data.js';
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

test('radar footprints use the strongest sampled return across altitude and leave gaps empty',()=>{
 const samples=new Float32Array([
  -120.597,36.303,1200,31,
  -120.598,36.302,1700,22,
  -120.598,36.302,3800,46,
  -120.596,36.303,6500,12,
  -120.1,36.8,1200,55
 ]);
 const cells=radarEchoCells(samples);
 assert.deepEqual(cells.map(cell=>[cell.height,cell.dbz]),[[3800,46],[1200,55]]);
 assert.equal(radarEchoCells(samples,10).length,2,'A weaker return at another altitude does not create an extra footprint.');
 assert(cells.every(cell=>cell.east-cell.west<0.05&&cell.north-cell.south<0.04));
});

test('equal-strength echoes choose the lower actual sample deterministically, without altitude quantization',()=>{
 const samples=[[-120.597,36.303,3789,46],[-120.598,36.302,1655,46],[-120.596,36.303,1000,31]];
 const forward=radarEchoCells(new Float32Array(samples.flat()));
 const reverse=radarEchoCells(new Float32Array(samples.toReversed().flat()));
 assert.deepEqual(forward,reverse);assert.equal(forward[0].height,1655);assert.equal(forward[0].dbz,46);
});

test('weak-return filtering changes only occupied horizontal support and never expands an edge bin',()=>{
 const [west,south,east,north]=RADAR_EXTENT;
 const samples=new Float32Array([west,south,1200,19,east,north,2912,35]);
 const normal=radarEchoCells(samples,20),weak=radarEchoCells(samples,10);
 assert.equal(normal.length,1);assert.equal(weak.length,2);assert.equal(normal[0].height,2912);
 for(const cell of weak){assert(cell.west>=west&&cell.east<=east&&cell.south>=south&&cell.north<=north);assert(cell.west<cell.east&&cell.south<cell.north);}
 assert.deepEqual(radarEchoCells(samples,40),[]);assert.deepEqual(radarEchoCells(new Float32Array()),[]);
});

test('invalid footprint samples and thresholds cannot create NaN geometry',()=>{
 for(const sample of [[-119.5,36.6,NaN,25],[-119.5,36.6,-1,25],[-119.5,36.6,12001,25],[-125,36.6,1200,25],[-119.5,36.6,1200,80]])
  assert.throws(()=>radarEchoCells(new Float32Array(sample)),/sample/);
 assert.throws(()=>radarEchoCells(new Float32Array([1,2,3])),/sample/);
 assert.throws(()=>radarEchoCells(new Float32Array(),NaN),/threshold/);
});
