import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {latestHanfordScan,loadHanfordRadar} from '../site/lib/hanford-radar-data.js';

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
 assert.equal(latestHanfordScan(manifest,now).frame.end,Date.parse(frame.end));
 assert.equal(latestHanfordScan(manifest,now+7*60_000).delayed,true);
 assert.throws(()=>latestHanfordScan(manifest,now+121*60_000),/old/);
 assert.throws(()=>latestHanfordScan(manifest,now-15*60_000),/manifest/);
 assert.throws(()=>latestHanfordScan({...manifest,frames:[{...frame,file:'../other.bin'}]},now),/scan/);
 assert.throws(()=>latestHanfordScan({...manifest,frames:[{...frame,source:'https://example.com/scan'}]},now),/identity/);
});

test('downloads verified packed altitude once and detects incomplete, altered or out-of-contract samples',async()=>{
 const {manifest,body}=scan(),downloads=[];
 const fetchImpl=async(url,options)=>{
  assert.equal(url.origin,'https://frog-demo.ryanlopez.tech');
  assert.equal(options.credentials,'omit');
  downloads.push(url.pathname);
  return url.pathname.endsWith('/manifest.json')?Response.json(manifest):new Response(body);
 };
 const options={clock:()=>now,fetchImpl};
 const first=await loadHanfordRadar(options);
 assert.deepEqual([...first.samples],[-119.5,Math.fround(36.6),1200,25]);
 assert.equal((await loadHanfordRadar({...options,previous:first})).samples,first.samples);
 assert.equal(downloads.filter(path=>path.endsWith('.bin')).length,1);
 const read=(doc,bytes)=>async url=>url.pathname.endsWith('/manifest.json')?Response.json(doc):new Response(bytes);
 await assert.rejects(loadHanfordRadar({...options,fetchImpl:read(manifest,body.subarray(0,15))}),/length/);
 await assert.rejects(loadHanfordRadar({...options,fetchImpl:read(manifest,Buffer.alloc(16))}),/checksum/);
 const invalid=scan([-119.5,36.6,12001,25]);
 await assert.rejects(loadHanfordRadar({...options,fetchImpl:read(invalid.manifest,invalid.body)}),/sample/);
});
