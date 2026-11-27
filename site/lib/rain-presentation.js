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
export function rainRenderer(levels){
 return {type:'uniqueValue',field1:'qpf',defaultSymbol:{type:'esriSFS',style:'esriSFSSolid',color:[0,0,0,0],outline:null},
  uniqueValueInfos:levels.map(value=>{const band=rainBand(value);if(!band)throw Error('Invalid rainfall amount');
   return {value:String(value),label:band.label,symbol:{type:'esriSFS',style:'esriSFSSolid',color:[...band.rgba],outline:null}};})};
}
