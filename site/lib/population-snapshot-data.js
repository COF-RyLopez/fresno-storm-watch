import {loadSdk} from './map.js?v=0.73.1';
import {calculateAcsZonePopulation} from './zone-acs-data.js?v=0.74.0-population';
import {readPopulationBlocks,calculateZonePopulation} from './population-data.js?v=0.74.0-population';
import {freezePopulationEvidence} from './population-snapshot-model.js?v=0.74.0-population';

let geometryTools=null;
export async function populationGeometryTools(){
  if(!geometryTools)geometryTools=(async()=>{const sdk=await loadSdk(),[Polygon,intersection,area]=await sdk.import(['@arcgis/core/geometry/Polygon.js','@arcgis/core/geometry/operators/intersectionOperator.js','@arcgis/core/geometry/operators/geodeticAreaOperator.js']);if(!area.isLoaded())await area.load();return {Polygon,intersection,area};})().catch(error=>{geometryTools=null;throw error;});
  return geometryTools;
}

/** Independent public reads; private message/contact fields are never passed to publishers. */
export async function capturePopulationEvidence(row,zone,{signal,current=()=>true,operators=null,readNewer=calculateAcsZonePopulation,readBlocks=readPopulationBlocks,calculateBaseline=calculateZonePopulation}={}){
  const check=()=>{if(signal?.aborted||!current())throw new DOMException('Selection changed','AbortError');};check();
  let tools;try{tools=operators||await populationGeometryTools();}catch(error){check();return freezePopulationEvidence({zone,errors:['acs','baseline'].map(source=>({source,detail:'Geometry tools unavailable; no population estimate was calculated.'}))});}check();
  const results=await Promise.allSettled([
    readNewer(row,{...tools,signal,current}),
    (async()=>{const collection=await readBlocks(row.geometry,{signal});check();const result=await calculateBaseline(row,collection,{...tools,current});return {result,collection};})()
  ]);check();
  const errors=results.flatMap((r,i)=>r.status==='rejected'?[{source:i?'baseline':'acs',detail:r.reason?.message||'Public source or geometry check failed.'}]:[]);
  return freezePopulationEvidence({zone,newer:results[0].status==='fulfilled'?results[0].value:null,baseline:results[1].status==='fulfilled'?results[1].value.result:null,baselineMeta:results[1].status==='fulfilled'?results[1].value.collection:null,errors});
}
