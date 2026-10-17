import { environmentalJson, fetchQpfCycle } from './environment-data.js';
import { QPF_URL } from './environment-model.js';
import { qpfPointValue } from './planning-model.js';
const PERIOD=Object.freeze({id:9,hours:72});

/** @param {object[]} points @param {Function} fetchImpl @param {Function} clock @returns {Promise<object>} Three concurrent requests at most; failed points remain unknown. */
export async function fetchPlanningRain(points,fetchImpl=fetch,clock=Date.now){
  if(!points.length||points.length>20||new Set(points.map(p=>p.id)).size!==points.length)throw new Error('Invalid rainfall sample inventory.');
  const cycle=await fetchQpfCycle(PERIOD,fetchImpl,clock()),results={};
  for(let start=0;start<points.length;start+=3){
    await Promise.all(points.slice(start,start+3).map(async point=>{
      try{
        const url=new URL(`${QPF_URL}/9/query`);
        url.search=new URLSearchParams({f:'json',where:'1=1',geometry:JSON.stringify({x:point.longitude,y:point.latitude,spatialReference:{wkid:4326}}),geometryType:'esriGeometryPoint',inSR:'4326',spatialRel:'esriSpatialRelIntersects',outFields:'qpf,units,product,issue_time,start_time,end_time',returnGeometry:'false',resultRecordCount:'2000'});
        results[point.id]={...qpfPointValue(await environmentalJson(url,fetchImpl),cycle,clock()),error:null};
      }catch(error){results[point.id]={value:null,labels:[],error:error.message};}
    }));
  }
  return {cycle,points:results,checked:clock(),error:null};
}
