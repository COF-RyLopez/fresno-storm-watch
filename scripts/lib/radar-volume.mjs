import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {RADAR_EXTENT} from '../../site/lib/hanford-radar-data.js';

export const VOLUME_SHAPE=Object.freeze([24,48,64]);
export const VOLUME_CHUNK_SHAPE=Object.freeze([4,16,16]);
export const VOLUME_HEIGHT_RANGE=Object.freeze([0,12000]);
export const VOLUME_FILL=-999;
export const MAX_SOURCE_SAMPLES=150000;
export const SOURCE_ROOT='https://frog-demo.ryanlopez.tech/live/khnx-v1/';
const EARTH_RADIUS=6378137,DEGREE=Math.PI/180,STRIDE=16;
const SCAN_NAME=/^KHNX(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})_V06\.bin$/;
export const SHA256=/^[a-f0-9]{64}$/;

/** SHA-256 of exact encoded bytes. @param {Uint8Array} bytes @returns {string} */
export const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');

/** Project geographic degrees to EPSG:3857 metres. @returns {[number,number]} */
export function project3857(longitude,latitude){
 if(!Number.isFinite(longitude)||!Number.isFinite(latitude)||Math.abs(longitude)>180||Math.abs(latitude)>=85.0511287798066)
  throw Error('Invalid coordinate for EPSG:3857');
 return [EARTH_RADIUS*longitude*DEGREE,latitude===0?0:EARTH_RADIUS*Math.log(Math.tan(Math.PI/4+latitude*DEGREE/2))];
}

const [west,south,east,north]=RADAR_EXTENT;
export const VOLUME_BOUNDS=Object.freeze([...project3857(west,south),...project3857(east,north)]);

/** Validate a derivative identity without imposing wall-clock freshness. @returns {object} */
export function validateSourceFrame(frame){
 const match=typeof frame?.file==='string'&&SCAN_NAME.exec(frame.file);
 const timestamp=value=>typeof value==='number'?value:typeof value==='string'?Date.parse(value):NaN;
 const start=timestamp(frame?.start),end=timestamp(frame?.end);
 if(!match||!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||Math.abs(start)>8.64e15||Math.abs(end)>8.64e15||
  end<start||end-start>30*60000)throw Error('Invalid source scan identity or time');
 if(!Number.isInteger(frame.count)||frame.count<0||frame.count>MAX_SOURCE_SAMPLES||frame.bytes!==frame.count*STRIDE)
  throw Error('Invalid source count or byte length');
 if(typeof frame.sha256!=='string'||!SHA256.test(frame.sha256))throw Error('Invalid source checksum');
 const [,year,month,day,hour,minute,second]=match;
 if(new Date(start).toISOString().slice(0,19)!==`${year}-${month}-${day}T${hour}:${minute}:${second}`||
  frame.source!==`https://unidata-nexrad-level2.s3.amazonaws.com/${year}/${month}/${day}/KHNX/${frame.file.slice(0,-4)}`)
  throw Error('Unexpected source identity');
 return {...frame,start,end};
}

/** Content-addressed directory uses the derivative checksum, not the raw archive checksum. @returns {string} */
export function volumeDirectory(frame){
 const valid=validateSourceFrame(frame);
 return `${valid.file.slice(0,-4)}-${valid.sha256.slice(0,12)}.zarr`;
}

/**
 * Bin retained derivative samples without interpolation. O(samples + voxels).
 * Values outside the source contract reject the whole frame; none are silently clipped.
 * @param {Float32Array} samples Packed longitude, latitude, estimated MSL metres, dBZ.
 * @returns {{values:Float32Array,sourceCount:number,occupiedVoxels:number,collapsedSamples:number,maximumDbz:number|null}}
 */
export function gridRadarSamples(samples){
 if(!(samples instanceof Float32Array)||samples.length%4||samples.length/4>MAX_SOURCE_SAMPLES)
  throw Error('Invalid packed radar samples');
 const [nz,ny,nx]=VOLUME_SHAPE,[xmin,ymin,xmax,ymax]=VOLUME_BOUNDS;
 const values=new Float32Array(nz*ny*nx).fill(VOLUME_FILL);
 let occupiedVoxels=0,maximumDbz=null;
 for(let i=0;i<samples.length;i+=4){
  const lon=samples[i],lat=samples[i+1],height=samples[i+2],dbz=samples[i+3];
  if(![lon,lat,height,dbz].every(Number.isFinite)||lon<west||lon>east||lat<south||lat>north||
   height<0||height>12000||dbz<10||dbz>=80)throw Error(`Invalid radar sample at index ${i/4}`);
  const [px,py]=project3857(lon,lat);
  // The outermost upper edge belongs to the final voxel; internal edges belong to the next voxel.
  const x=Math.min(nx-1,Math.floor((px-xmin)/(xmax-xmin)*nx));
  const y=Math.min(ny-1,Math.floor((py-ymin)/(ymax-ymin)*ny));
  const z=Math.min(nz-1,Math.floor(height/12000*nz));
  const index=(z*ny+y)*nx+x;
  if(values[index]===VOLUME_FILL)occupiedVoxels++;
  values[index]=Math.max(values[index],dbz);
  maximumDbz=maximumDbz===null?dbz:Math.max(maximumDbz,dbz);
 }
 const sourceCount=samples.length/4;
 return {values,sourceCount,occupiedVoxels,collapsedSamples:sourceCount-occupiedVoxels,maximumDbz};
}

/** Preserve only validated optional upstream diagnostics. @returns {object} */
function sourceDerivative(frame){
 const result={url:`${SOURCE_ROOT}${frame.file}`,format:'little-endian float32 longitude, latitude, estimated MSL metres, dBZ'};
 if(frame.sourceSha256!==undefined){
  if(typeof frame.sourceSha256!=='string'||!SHA256.test(frame.sourceSha256))throw Error('Invalid upstream source checksum');
  result.upstreamSourceSha256=frame.sourceSha256;
 }
 if(frame.parserHasGaps!==undefined){
  if(typeof frame.parserHasGaps!=='boolean')throw Error('Invalid source parser-gap flag');
  result.parserHasGaps=frame.parserHasGaps;
 }
 if(frame.accounting!==undefined){
  const keys=['retained','missingAtSampledGates','belowOrOutsideDisplayScale'];
  if(!keys.every(key=>Number.isSafeInteger(frame.accounting?.[key])&&frame.accounting[key]>=0)||frame.accounting.retained!==frame.count)
   throw Error('Invalid upstream source accounting');
  result.upstreamAccounting=Object.fromEntries(keys.map(key=>[key,frame.accounting[key]]));
 }
 return result;
}

/** Encode nonempty chunks in C order, x fastest, float32 little endian then gzip. @returns {Array<object>} */
export function encodeVolumeChunks(values){
 const [nz,ny,nx]=VOLUME_SHAPE,[cz,cy,cx]=VOLUME_CHUNK_SHAPE;
 if(!(values instanceof Float32Array)||values.length!==nz*ny*nx)throw Error('Invalid volume shape');
 const chunks=[];
 for(let z=0;z<nz;z+=cz)for(let y=0;y<ny;y+=cy)for(let x=0;x<nx;x+=cx){
  const raw=Buffer.alloc(cz*cy*cx*4);
  let occupied=0,offset=0;
  for(let dz=0;dz<cz;dz++)for(let dy=0;dy<cy;dy++)for(let dx=0;dx<cx;dx++){
   const value=values[((z+dz)*ny+y+dy)*nx+x+dx];
   if(value!==VOLUME_FILL){
    if(!Number.isFinite(value)||value<10||value>=80)throw Error('Invalid volume reflectivity');
    occupied++;
   }
   raw.writeFloatLE(value,offset);offset+=4;
  }
  if(occupied){
   const data=gzipSync(raw,{level:6});
   chunks.push({key:`c/${z/cz}/${y/cy}/${x/cx}`,data,bytes:data.length,sha256:sha256(data)});
  }
 }
 return chunks;
}

/** Build standard Zarr-v3 root-array metadata and deterministic encoded chunks. @returns {object} */
export function buildRadarVolume(record,samples){
 const frame=validateSourceFrame(record);
 if(samples?.length!==frame.count*4)throw Error('Source sample count does not match frame');
 const grid=gridRadarSamples(samples),chunks=encodeVolumeChunks(grid.values);
 const {file,sha256:sourceSha256,start,end,source}=frame;
 const metadata={
  zarr_format:3,node_type:'array',shape:[...VOLUME_SHAPE],data_type:'float32',
  chunk_grid:{name:'regular',configuration:{chunk_shape:[...VOLUME_CHUNK_SHAPE]}},
  chunk_key_encoding:{name:'default',configuration:{separator:'/'}},
  fill_value:VOLUME_FILL,codecs:[{name:'bytes',configuration:{endian:'little'}},{name:'gzip',configuration:{level:6}}],
  dimension_names:['height','y','x'],attributes:{
   kind:'sampled-radar-volume',station:'KHNX',dimensions:['height','y','x'],crs:'EPSG:3857',
   bounds3857:[...VOLUME_BOUNDS],heightRange:[...VOLUME_HEIGHT_RANGE],units:'dBZ',
   heightReference:'estimated MSL metres',horizontalUnits:'metres',
   axisDirections:{height:'up',y:'north',x:'east'},coordinateLocation:'voxel centres; bounds describe outer voxel edges',
   sourceFrame:{file,sha256:sourceSha256,start,end,source},sourceDerivative:sourceDerivative(frame),
   processing:{version:1,aggregation:'maximum retained sampled dBZ per voxel',
    sampling:'Upstream derivative decimates to 2-degree azimuth and 2-km range; retains only 10 <= dBZ < 80.',
    interpolation:'none',verticalFill:'none',
    limitations:'This is a regional cube of retained derivative samples, not a full raw radar sweep. Maximum aggregation discards within-voxel sample variation. Altitude is estimated beam height, not a measured cloud surface.',
    missing:'-999 and omitted chunks mean no retained samples. Unknown coverage, parser gaps and filtered values cannot establish measured absence of precipitation.',
    sourceCoordinates:'EPSG:4326 longitude/latitude degrees; estimated MSL metres',
    projection:'EPSG:3857 spherical Mercator, radius 6378137 metres; horizontal display coordinates are not ground-distance measurements',
    specification:'https://zarr-specs.readthedocs.io/en/latest/v3/core/',specificationCheckedOn:'2026-11-14'},
   sourceCount:grid.sourceCount,occupiedVoxels:grid.occupiedVoxels,collapsedSamples:grid.collapsedSamples,maximumDbz:grid.maximumDbz,
   chunks:chunks.map(({key,bytes,sha256})=>({key,bytes,sha256}))
  }
 };
 const metadataBytes=Buffer.from(JSON.stringify(metadata,null,2)+'\n','utf8');
 return {directory:volumeDirectory(frame),metadata,metadataBytes,metadataSha256:sha256(metadataBytes),chunks,
  bytes:chunks.reduce((sum,chunk)=>sum+chunk.bytes,0)};
}
