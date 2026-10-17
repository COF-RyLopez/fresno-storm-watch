/** Public source check. Reads metadata/headers/playlists only; never records video or images. */
import {readFile,writeFile} from 'node:fs/promises';
import {CAMERA_FEED,normalizeCameras} from '../site/lib/camera-model.js';
const selection=JSON.parse(await readFile(new URL('../site/data/camera-watchlist.json',import.meta.url),'utf8'));
const response=await fetch(CAMERA_FEED,{signal:AbortSignal.timeout(20_000)});
if(!response.ok)throw new Error(`Camera catalog HTTP ${response.status}`);
const payload=await response.json(),cameras=normalizeCameras(payload,selection.cameras),results=[];
/** @param {string|null} url @param {boolean} video @returns {Promise<object>} */
async function probe(url,video=false){
  if(!url)return {available:false,reason:'No supported source URL'};
  try{const r=await fetch(url,{method:video?'GET':'HEAD',signal:AbortSignal.timeout(12_000),cache:'no-store'});
    const body=video?await r.text():null;
    return {status:r.status,available:r.ok&&(!video||body.startsWith('#EXTM3U')),lastModified:r.headers.get('last-modified'),cors:r.headers.get('access-control-allow-origin'),kind:video?'HLS playlist (playback not proven)':'Image headers (capture time unverified)'};
  }catch(error){return {available:false,reason:error.message};}
}
let next=0;
await Promise.all(Array.from({length:2},async()=>{while(next<cameras.length){const c=cameras[next++];results.push({id:c.id,name:c.name,county:c.county,longitude:c.longitude,latitude:c.latitude,error:c.error,inService:c.inService,image:await probe(c.imageUrl),video:await probe(c.videoUrl,true)});}}));
const report={checked:new Date().toISOString(),catalog:CAMERA_FEED,accounting:{input:payload.data.length,selected:cameras.length,excluded:payload.data.length-cameras.length},cameras:results.sort((a,b)=>a.id.localeCompare(b.id))};
if(process.argv[2])await writeFile(process.argv[2],JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
