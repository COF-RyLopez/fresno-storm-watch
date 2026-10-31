import {fetchComparison} from './forecast-comparison-data.js';
import {pool} from './pool.js';
import {uniqueComparisonPoints,validateComparisonSnapshot,REVIEW_MAX_AGE} from './forecast-review-model.js';

/** Two bounded workers; each public sample is queried once despite shared areas. */
export async function collectComparisonSnapshot(areas,{fetchPoint=fetchComparison,now=Date.now(),signal}={}){
  const points=uniqueComparisonPoints(areas),results=await pool(points,2,point=>{if(signal?.aborted)throw signal.reason;return fetchPoint(point,{now,signal});});
  return validateComparisonSnapshot({schemaVersion:1,generatedAt:new Date(now).toISOString(),points:results},points);
}

/** Scheduled public copy first; stale/missing copies fall back to bounded live checks. */
export async function currentComparisonSnapshot(areas,{fetchImpl=fetch,now=Date.now(),signal,force=false}={}){
  const points=uniqueComparisonPoints(areas);
  if(!force){
    try{
      const r=await fetchImpl(new URL('../data/comparison-latest.json',import.meta.url),{credentials:'omit',cache:'no-store',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000)});
      if(!r.ok)throw Error('Scheduled comparison unavailable.');
      const s=validateComparisonSnapshot(await r.json(),points),age=now-Date.parse(s.generatedAt);
      if(age>=-120000&&age<=REVIEW_MAX_AGE)return s;
    }catch(error){if(signal?.aborted)throw error;/* Explicit direct fallback; no stale copy is relabeled. */}
  }
  return collectComparisonSnapshot(areas,{now,signal,fetchPoint:(point,options)=>fetchComparison(point,{...options,fetchImpl})});
}
