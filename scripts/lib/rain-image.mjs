import {PNG} from 'pngjs';
import {RAIN_PRESENTATION,RAIN_BANDS,remapRainPixels} from '../../site/lib/rain-presentation.js';

/** Prepare an immutable display image from the verified publisher palette. */
export async function prepareRainImage(rain){
 if(!rain.blob)return {...rain,presentation:RAIN_PRESENTATION};
 const bytes=Buffer.from(await rain.blob.arrayBuffer());
 if(bytes.length<24||bytes.length>12*1024*1024||bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||bytes.readUInt32BE(16)>4096||bytes.readUInt32BE(20)>4096)throw Error('Invalid rain PNG bounds');
 const image=PNG.sync.read(bytes);remapRainPixels(image.data,rain.legend);
 return {...rain,blob:new Blob([PNG.sync.write(image)],{type:'image/png'}),legend:RAIN_BANDS.map(({value,label,color})=>({value,label,color})),presentation:RAIN_PRESENTATION};
}
