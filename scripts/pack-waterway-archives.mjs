/** Repack existing public MVT without geometry changes. PMTiles v3; standard reader verifies every tile. */
import {readFile,writeFile,readdir,mkdir} from 'node:fs/promises';
import {gzipSync,gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {PMTiles,zxyToTileId} from 'pmtiles';
import {pathToFileURL} from 'node:url';
const source=new URL('../site/basemaps/frog-waterways-dark/',import.meta.url);
const target=new URL('../site/basemaps/frog-waterways-dark/archives/',import.meta.url);
const sha=b=>createHash('sha256').update(b).digest('hex');
function varint(value){const a=[];do{const byte=value%128;value=Math.floor(value/128);a.push(byte+(value?128:0));}while(value);return a;}
function directory(entries){let previous=0;const parts=[varint(entries.length)];for(const e of entries){parts.push(varint(e.id-previous));previous=e.id;}for(const field of ['run','length','offset'])for(const e of entries)parts.push(varint(e[field]+(field==='offset'?1:0)));return gzipSync(Buffer.from(parts.flat()));}
export async function pack(folder,metadata,base=source){
 const tiles=[];
 for(const z of await readdir(new URL(folder+'/',base)))for(const x of await readdir(new URL(`${folder}/${z}/`,base)))for(const file of await readdir(new URL(`${folder}/${z}/${x}/`,base))){
  if(!/^\d+\.pbf$/.test(file))throw Error('Unexpected tile filename');
  const y=Number(file.slice(0,-4)),raw=await readFile(new URL(`${folder}/${z}/${x}/${file}`,base));
  const plain=raw[0]===31&&raw[1]===139?gunzipSync(raw):raw;
  tiles.push({id:zxyToTileId(+z,+x,y),z:+z,x:+x,y,bytes:gzipSync(plain),hash:sha(plain)});
 }
 tiles.sort((a,b)=>a.id-b.id);if(!tiles.length||new Set(tiles.map(t=>t.id)).size!==tiles.length)throw Error('Empty/duplicate tiles');
 let offset=0;const entries=tiles.map(t=>{const e={id:t.id,run:1,length:t.bytes.length,offset};offset+=e.length;return e;});
 let root=directory(entries),leaves=Buffer.alloc(0);
 if(root.length>16000){let leafOffset=0;const indexes=[],chunks=[];for(let i=0;i<entries.length;i+=1000){const chunk=directory(entries.slice(i,i+1000));indexes.push({id:entries[i].id,run:0,length:chunk.length,offset:leafOffset});chunks.push(chunk);leafOffset+=chunk.length;}leaves=Buffer.concat(chunks);root=directory(indexes);}
 if(root.length+127>16384)throw Error('PMTiles root exceeds initial range');
 const meta=gzipSync(Buffer.from(JSON.stringify(metadata))),header=Buffer.alloc(127);header.write('PMTiles');header[7]=3;
 const numbers=[127,root.length,127+root.length,meta.length,127+root.length+meta.length,leaves.length,127+root.length+meta.length+leaves.length,offset,tiles.length,tiles.length,tiles.length];
 numbers.forEach((n,i)=>header.writeBigUInt64LE(BigInt(n),8+i*8));header[96]=1;header[97]=2;header[98]=2;header[99]=1;header[100]=Math.min(...tiles.map(t=>t.z));header[101]=Math.max(...tiles.map(t=>t.z));
 metadata.bounds.forEach((n,i)=>header.writeInt32LE(Math.round(n*1e7),102+i*4));header[118]=9;header.writeInt32LE(Math.round((metadata.bounds[0]+metadata.bounds[2])*5e6),119);header.writeInt32LE(Math.round((metadata.bounds[1]+metadata.bounds[3])*5e6),123);
 const bytes=Buffer.concat([header,root,meta,leaves,...tiles.map(t=>t.bytes)]);
 const reader=new PMTiles({getKey:()=>folder,getBytes:async(o,l)=>({data:Uint8Array.from(bytes.subarray(o,o+l)).buffer})});
 let compared=0;for(const t of tiles){const out=await reader.getZxy(t.z,t.x,t.y);if(!out||sha(Buffer.from(out.data))!==t.hash)throw Error(`Tile mismatch ${t.z}/${t.x}/${t.y}`);compared++;}
 return {bytes,tileCount:tiles.length,verified:compared,minzoom:header[100],maxzoom:header[101],sha256:sha(bytes)};
}
async function main(){
await mkdir(target,{recursive:true});const records=[];
for(const [name,folder,metaName,manifestName]of [['waterways','tiles-v0.29.0','tilejson.json','manifest.json'],['waterbodies','waterbodies-v0.33.0','waterbodies-tilejson.json','waterbodies-manifest.json']]){
 const meta=JSON.parse(await readFile(new URL(metaName,source),'utf8')),original=JSON.parse(await readFile(new URL(manifestName,source),'utf8'));
 delete meta.tiles;meta.attribution='USGS 3DHP · reference retrieved '+original.retrievedAt;
 const result=await pack(folder,meta);if(original.tileCount&&result.tileCount!==original.tileCount)throw Error('Source tile inventory mismatch');
 await writeFile(new URL(name+'.pmtiles',target),result.bytes);records.push({name,...result,bytes:result.bytes.length,source:original.source,sourceRetrievedAt:original.retrievedAt,sourceFeatures:original.accepted,limits:original.limitations});console.log(name,result.tileCount,result.bytes.length,result.sha256);
}
await writeFile(new URL('manifest.json',target),JSON.stringify({schemaVersion:1,generatedAt:new Date().toISOString(),format:'PMTiles v3 / gzip MVT',crs:'Web Mercator tiles; OGC:CRS84 bounds',conversion:'Byte-preserving tile repack; every tile decoded by standard PMTiles reader and SHA256 compared to source MVT',records},null,2)+'\n');
const style=JSON.parse(await readFile(new URL('root.json',source),'utf8'));
await writeFile(new URL('style.json',target),JSON.stringify(style.layers.filter(l=>['frog','frogWaterbodies'].includes(l.source)&&['line','fill'].includes(l.type)).map(l=>({...l,id:'county-'+l.id,source:l.source==='frog'?'county-waterways':'county-waterbodies'})))+'\n');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main();
