import {RADAR_EXTENT} from './hanford-radar-data.js';

// Fixed display bins approximate 4 km at Hanford's latitude, with 1 km MSL bands.
const LON_STEP=0.045, LAT_STEP=0.036, HEIGHT_STEP=1000;

/** Only occupied bins are drawn. A maximum represents sampled echo strength, not density. */
export function radarEchoCells(samples,minDbz=20){
 const [west,south,east,north]=RADAR_EXTENT,cells=new Map();
 for(let i=0;i<samples.length;i+=4){
  const dbz=samples[i+3];
  if(dbz<minDbz)continue;
  const x=Math.floor((samples[i]-west)/LON_STEP),y=Math.floor((samples[i+1]-south)/LAT_STEP);
  const z=Math.min(11,Math.floor(samples[i+2]/HEIGHT_STEP));
  const key=`${x}/${y}/${z}`;
  const cell=cells.get(key);
  if(cell){cell.dbz=Math.max(cell.dbz,dbz);continue;}
  cells.set(key,{west:west+x*LON_STEP,south:south+y*LAT_STEP,
   east:Math.min(east,west+(x+1)*LON_STEP),north:Math.min(north,south+(y+1)*LAT_STEP),
   bottom:z*HEIGHT_STEP,top:(z+1)*HEIGHT_STEP,dbz});
 }
 return [...cells.values()];
}
