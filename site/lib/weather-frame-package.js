import {QPF_URL} from './environment-model.js';
import {createWeatherFrameCache} from './weather-frame-cache.js';
import {rainRasterGeometry} from './watch-watershed-data.js';

const HOUR=3600000, MAX_IMAGE_BYTES=12*1024*1024;
const fail=message=>{throw Error('Weather replay '+message);};
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const freeze=value=>{if(value&&typeof value==='object'){for(const v of Object.values(value))freeze(v);Object.freeze(value);}return value;};

/** Keep point identities independent of their shared parent river-concern ID. */
export function weatherReferenceFeatures(features){
  const result=new Map();
  for(const f of features){
    if(f.private||f.properties?.private)fail('private reference is not publishable');
    if(!['gauge','reservoir'].includes(f.properties?.kind))continue;
    const p=f.geometry?.coordinates,id=f.id||f.properties.gaugeId;
    if(!id||f.geometry?.type!=='Point'||!Array.isArray(p)||p.length!==2||!p.every(finite)||Math.abs(p[0])>180||Math.abs(p[1])>90)fail('reference point is invalid');
    result.set(id,structuredClone(f));
  }
  return [...result.values()];
}

/** Validate a recorded display product; never infer zero rainfall from absent data. */
function validateFrames(p,kind){
  if(p?.schemaVersion!==1||p.kind!==kind||p.publisher!=='NOAA WPC'||p.source!==QPF_URL||
    p.rasterCrs!=='EPSG:3857'||p.coordinateCrs!=='EPSG:4326'||!finite(p.clock)||Date.parse(p.capturedAt)!==p.clock||
    !Array.isArray(p.bounds)||p.bounds.length!==4||!p.bounds.every(finite)||
    p.bounds[0]>=p.bounds[2]||p.bounds[1]>=p.bounds[3]||p.bounds[0]<-180||p.bounds[2]>180||p.bounds[1]<-85||p.bounds[3]>85||
    !Array.isArray(p.frames)||!p.frames.length||p.frames.length>16)fail('manifest is invalid');
  const ids=new Set();
  for(const f of p.frames){
    const c=f?.cycle;
    if(!/^qpf-\d+$/.test(f?.id)||ids.has(f.id)||![c?.issue,c?.start,c?.end].every(finite)||c.units!=='in'||
      ![6,72].includes(c.hours)||c.end-c.start!==c.hours*HOUR||c.issue>=c.end||c.issue>p.clock+300000||
      p.clock-c.issue>24*HOUR||c.end<=p.clock||typeof c.product!=='string')fail('frame times or units are invalid');
    ids.add(f.id);
    if(c.hours===6){
      const w=f.window;
      if(!w||!Number.isInteger(w.layer)||w.layer<13||w.layer>25||f.id!==`qpf-${w.layer}`||
        ['issue','start','end'].some(key=>w[key]!==c[key])||c.product!=='6-hour QPF')fail('frame window does not match its source');
    }else if(f.window!==null||f.id!=='qpf-9')fail('overview is invalid');
    const xy=f.coordinates;
    if(!Array.isArray(xy)||xy.length!==4||xy.some(v=>!Array.isArray(v)||v.length!==2||!v.every(finite)||Math.abs(v[0])>180||Math.abs(v[1])>85)||
      xy[0][0]!==xy[3][0]||xy[1][0]!==xy[2][0]||xy[0][1]!==xy[1][1]||xy[2][1]!==xy[3][1]||
      xy[0][0]>=xy[1][0]||xy[0][1]<=xy[3][1])fail('frame extent is invalid');
    if(!Array.isArray(f.legend)||f.legend.some(b=>!finite(b.value)||b.value<0.01||
      !/^rgb\((?:\d{1,3},){2}\d{1,3}\)$/.test(b.color)||b.color.match(/\d+/g).some(n=>Number(n)>255)))fail('legend is invalid');
    if(f.image===null){if(f.legend.length)fail('missing image cannot represent mapped contours');}
    else if(!f.image||!/^images\/[a-f0-9]{64}\.png$/.test(f.image.file)||!/^([a-f0-9]{64})$/.test(f.image.sha256)||
      f.image.file!==`images/${f.image.sha256}.png`||!Number.isInteger(f.image.bytes)||f.image.bytes<24||f.image.bytes>MAX_IMAGE_BYTES||
      !Number.isInteger(f.image.width)||!Number.isInteger(f.image.height)||f.image.width<1||f.image.height<1||
      f.image.width>4096||f.image.height>4096||!f.legend.length)fail('image reference is invalid');
  }
  return p;
}

export const validateWeatherReplay=p=>validateFrames(p,'recorded-wpc-display-replay');
export function validateCurrentWeather(p){
  validateFrames(p,'prepared-wpc-display');
  const expected=rainRasterGeometry(p.bounds).coordinates;
  if(p.frames.some(f=>f.coordinates.some((v,i)=>v.some((n,j)=>Math.abs(n-expected[i][j])>1e-8))))fail('image coverage does not match the prepared extent');
  return p;
}

/** Fingerprint only the rendered evidence, independent of capture/transport timings. */
export async function frameFingerprint(frame){
  const text=JSON.stringify([frame.cycle,frame.coordinates,frame.legend,frame.image?.sha256??null]);
  const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));
  return [...new Uint8Array(hash)].map(v=>v.toString(16).padStart(2,'0')).join('');
}

/** Selected frames first, at most three image promises, no persistent/private cache. */
export function createPreparedWeather(manifest,baseUrl,{fetchImpl=fetch}={}){
  const validate=manifest?.kind==='prepared-wpc-display'?validateCurrentWeather:validateWeatherReplay;
  const p=freeze(structuredClone(validate(manifest))),cache=createWeatherFrameCache(3);
  let closed=false;
  return {
    manifest:p,
    async load(id){
      if(closed)throw Error('Weather replay is closed');
      const f=p.frames.find(frame=>frame.id===id);
      if(!f)throw Error('Unknown weather replay frame');
      return cache.get(id,async signal=>{
        let blob=null;
        if(f.image){
          const r=await fetchImpl(new URL(f.image.file,baseUrl),{signal,credentials:'omit',cache:'no-store'});
          if(!r.ok||!r.headers.get('content-type')?.startsWith('image/png'))fail('image is unavailable');
          const length=Number(r.headers.get('content-length'));
          if(length&&length!==f.image.bytes)fail('image size changed');
          const reader=r.body.getReader(),chunks=[];let total=0;
          try{for(;;){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>f.image.bytes)fail('image size changed');chunks.push(value);signal.throwIfAborted();}}
          catch(error){await reader.cancel().catch(()=>{});throw error;}
          blob=new Blob(chunks,{type:'image/png'});signal.throwIfAborted();
          if(blob.size!==f.image.bytes)fail('image size changed');
          const data=await blob.arrayBuffer(),bytes=new Uint8Array(data),view=new DataView(data);
          if(bytes[0]!==137||bytes[1]!==80||bytes[2]!==78||bytes[3]!==71||view.getUint32(16)!==f.image.width||view.getUint32(20)!==f.image.height)fail('PNG dimensions changed');
          const digest=await crypto.subtle.digest('SHA-256',data);
          if([...new Uint8Array(digest)].map(n=>n.toString(16).padStart(2,'0')).join('')!==f.image.sha256)fail('image integrity failed');
          signal.throwIfAborted();
        }
        return Object.freeze({cycle:f.cycle,coordinates:f.coordinates,legend:f.legend,blob});
      });
    },
    destroy(){closed=true;cache.clear();},
  };
}
