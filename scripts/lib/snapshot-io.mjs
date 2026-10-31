/** Shared collector I/O: prior-snapshot fallback, atomic same-directory replace, county boundary. */
import {readFile,writeFile,rename} from 'node:fs/promises';

/** @returns {Promise<object>} Fresno County (GEOID 06019) from the committed boundary file. */
export const fresnoCounty=async()=>JSON.parse(await readFile(new URL('../../site/data/counties.geojson',import.meta.url),'utf8')).features.find(f=>f.properties.GEOID==='06019');

/** @param {URL} output @param {string|Buffer} data @returns {Promise<void>} Write <name>.tmp beside output, then rename over it. */
export async function writeAtomic(output,data){
  const temporary=new URL(output.href.replace(/\.[^./]+$/,'.tmp'));
  await writeFile(temporary,data,'utf8');await rename(temporary,output);
}

/**
 * Validated local prior; with --published and `published`, a newer validated Pages copy replaces it.
 * @param {URL} output @param {(snapshot:object)=>object} validate @param {string} localWarning
 * @param {{url:string,init?:object,future:string,warning:string}} [published] future: error for a future generatedAt.
 * @returns {Promise<object|null>}
 */
export async function loadPrevious(output,validate,localWarning,published){
  let previous=null;
  try{previous=validate(JSON.parse(await readFile(output,'utf8')));}catch(error){if(error.code!=='ENOENT')console.warn(localWarning,error.message);}
  if(published&&process.argv.includes('--published')){
    try{
      const response=await fetch(`${published.url}?check=${Date.now()}`,{signal:AbortSignal.timeout(15_000),...published.init});
      if(!response.ok)throw new Error(`HTTP ${response.status}`);
      const candidate=validate(await response.json()),stamp=Date.parse(candidate.generatedAt);
      if(stamp>Date.now()+120_000)throw new Error(published.future);
      if(!previous||stamp>Date.parse(previous.generatedAt))previous=candidate;
    }catch(error){console.warn(published.warning,error.message);}
  }
  return previous;
}
