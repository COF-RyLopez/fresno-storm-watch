import {RADAR_EXTENT} from './hanford-radar-data.js';

// Fixed horizontal display bins approximate 4 km at Hanford's latitude.
const LON_STEP=0.045, LAT_STEP=0.036;

/**
 * One footprint per occupied XY bin, using its strongest sampled echo across altitude.
 * Height is that echo's estimated MSL metres, not a cloud top or an altitude band.
 * Equal-strength returns use the lower sample deterministically. O(samples + bins log bins).
 */
export function radarEchoCells(samples,minDbz=20){
 if(!Number.isFinite(minDbz)||minDbz<10||minDbz>80)throw Error('Invalid radar reflectivity threshold');
 if(!samples||!Number.isSafeInteger(samples.length)||samples.length%4)throw Error('Invalid radar footprint samples');
 const [west,south,east,north]=RADAR_EXTENT,cells=new Map();
 const columns=Math.ceil((east-west)/LON_STEP),rows=Math.ceil((north-south)/LAT_STEP);
 for(let i=0;i<samples.length;i+=4){
  const lon=samples[i],lat=samples[i+1],height=samples[i+2],dbz=samples[i+3];
  if(!Number.isFinite(lon)||!Number.isFinite(lat)||!Number.isFinite(height)||!Number.isFinite(dbz)||
   lon<west||lon>east||lat<south||lat>north||height<0||height>12000||dbz<10||dbz>=80)throw Error('Invalid radar footprint sample');
  if(dbz<minDbz)continue;
  const x=Math.min(columns-1,Math.floor((lon-west)/LON_STEP)),y=Math.min(rows-1,Math.floor((lat-south)/LAT_STEP));
  const key=y*columns+x;
  const cell=cells.get(key);
  if(cell){if(dbz>cell.dbz||dbz===cell.dbz&&height<cell.height){cell.dbz=dbz;cell.height=height;}continue;}
  cells.set(key,{west:west+x*LON_STEP,south:south+y*LAT_STEP,
   east:Math.min(east,west+(x+1)*LON_STEP),north:Math.min(north,south+(y+1)*LAT_STEP),
   height,dbz});
 }
 return [...cells.entries()].sort((a,b)=>a[0]-b[0]).map(([,cell])=>cell);
}
