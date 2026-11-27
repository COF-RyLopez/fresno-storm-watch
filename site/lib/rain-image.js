import {RAIN_PRESENTATION,RAIN_BANDS,remapRainPixels} from './rain-presentation.js';

/** Browser-only fallback; preparation already applies the same palette off the UI thread. */
export async function presentRainImage(rain){
 if(!rain.blob)return {...rain,presentation:RAIN_PRESENTATION};
 const image=await createImageBitmap(rain.blob);
 try{
  if(image.width>4096||image.height>4096)throw Error('Rain image exceeds display bounds');
  const canvas=typeof OffscreenCanvas==='function'?new OffscreenCanvas(image.width,image.height):document.createElement('canvas');
  canvas.width=image.width;canvas.height=image.height;
  const ctx=canvas.getContext('2d',{willReadFrequently:true});
  ctx.drawImage(image,0,0);
  const pixels=ctx.getImageData(0,0,image.width,image.height);remapRainPixels(pixels.data,rain.legend);ctx.putImageData(pixels,0,0);
  const blob=canvas.convertToBlob?await canvas.convertToBlob({type:'image/png'}):await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('Rain display conversion failed')),'image/png'));
  return {...rain,blob,legend:RAIN_BANDS.map(({value,label,color})=>({value,label,color})),presentation:RAIN_PRESENTATION};
 }finally{image.close();}
}
