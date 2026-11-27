/** Fixed amount classes, not hazard/action thresholds. Shared by export and map key. */
export const RAIN_PRESENTATION='frog-rain-1';
export const RAIN_BANDS=Object.freeze([
 {value:.01,label:'0.01–<0.1',rgba:[79,116,141,65]},
 {value:.1,label:'0.1–<0.25',rgba:[85,135,171,90]},
 {value:.25,label:'0.25–<0.5',rgba:[99,143,194,120]},
 {value:.5,label:'0.5–<1',rgba:[125,133,202,145]},
 {value:1,label:'1–<2',rgba:[158,126,206,170]},
 {value:2,label:'2+',rgba:[208,155,225,200]},
].map(b=>Object.freeze({...b,rgba:Object.freeze(b.rgba),color:`rgb(${b.rgba.slice(0,3).join(',')})`})));

export function rainBand(value){
 if(typeof value!=='number'||!Number.isFinite(value)||value<.01)return null;
 return RAIN_BANDS.findLast(b=>value>=b.value);
}
/** Recolor display pixels only; never infer numerical rainfall from an arbitrary image. */
export function remapRainPixels(pixels,sourceLegend){
 const entries=sourceLegend.map(entry=>{
  const rgb=entry.color?.match(/^rgb\((\d+),(\d+),(\d+)\)$/),band=rainBand(entry.value);
  if(!rgb||!band)throw Error('Invalid publisher rain legend');
  return {rgb:rgb.slice(1).map(Number),band};
 });
 const memo=new Map();
 for(let i=0;i<pixels.length;i+=4){
  if(!pixels[i+3])continue;
  const key=(pixels[i]<<16)|(pixels[i+1]<<8)|pixels[i+2];
  if(!memo.has(key)){
   let best=null,distance=24**2;
   for(const e of entries){const d=e.rgb.reduce((s,v,j)=>s+(v-pixels[i+j])**2,0);if(d<distance){distance=d;best=e.band;}}
   memo.set(key,best);
  }
  const band=memo.get(key);
  if(!band){pixels[i+3]=0;continue;}
  pixels[i]=band.rgba[0];pixels[i+1]=band.rgba[1];pixels[i+2]=band.rgba[2];
  pixels[i+3]=Math.round(pixels[i+3]*band.rgba[3]/255);
 }
 return pixels;
}
