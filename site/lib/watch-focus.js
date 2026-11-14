import {validLocation} from './selection-focus.js';
/** Source points only: these symbols describe evidence locations, never a routed reach. */
export function watchFocusPoints(points=[]){
 const labels={PNF:'Pine Flat · pool / release',PFQC1:'PFQC1 · below-dam stage',MIL:'Millerton · pool / release'};
 const unique=new Map();
 for(const p of points.filter(validLocation)){
  const key=`${p.longitude}:${p.latitude}`;
  if(!unique.has(key))unique.set(key,{...p,label:labels[p.id]||p.name||p.id||'Watchpoint'});
 }
 return [...unique.values()];
}
/** Brief, interruptible movement; no motion when the operator requests reduced motion. */
export const watchFocusMotion=reduced=>({animate:!reduced,duration:900,easing:'ease-in-out'});
