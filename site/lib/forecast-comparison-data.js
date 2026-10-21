import {MODELS,modelSeries,nwsSeries} from './forecast-comparison-model.js';

/** Credential-free fixed publisher endpoints with bounded responses and cancellation. */
async function json(url,fetchImpl,signal,body){
  const response=await fetchImpl(url,{method:body?'POST':'GET',headers:body?{'content-type':'application/json'}:{Accept:'application/json'},...(body?{body:JSON.stringify(body)}:{}),credentials:'omit',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(45000)]):AbortSignal.timeout(45000)});
  if(!response.ok)throw Error(`Source HTTP ${response.status}`);
  const data=await response.json();if(data?.error||data?.status>=400)throw Error('Source returned an error.');return data;
}

/** Independently collect one official NWS grid and two resolved model runs. */
export async function fetchComparison(point,{fetchImpl=fetch,signal,now=Date.now()}={}){
  if(!Number.isFinite(point?.latitude)||!Number.isFinite(point.longitude)||point.latitude<35.5||point.latitude>38||point.longitude< -121.5||point.longitude> -118)throw Error('Comparison point is outside the configured Fresno region.');
  const model=async m=>{
    // Resolve current metadata at runtime; no storage href or dataset version is pinned.
    const meta=await json(`https://stac.dynamical.org/${m.id}/collection.json`,fetchImpl,signal);
    if(meta.id!==m.id||meta.license!=='CC-BY-4.0'||typeof meta.attribution!=='string')throw Error('Model identity, license or attribution needs review.');
    for(const k of ['precipitation_surface','wind_u_10m','wind_v_10m',...(m.gust?['wind_gust_surface']:[])])if(meta['cube:variables']?.[k]?.unit!==(k==='precipitation_surface'?'kg m-2 s-1':'m s-1'))throw Error('Catalog variable units changed.');
    const response=await json('https://api.dynamical.org/v1/forecasts',fetchImpl,signal,{queries:[{dataProductId:m.id,location:{latitude:point.latitude,longitude:point.longitude},variables:['precipitation_surface','wind_u_10m','wind_v_10m',...(m.gust?['wind_gust_surface']:[])],maxLeadTimeHours:m.hours}]});
    if(response.results?.length!==1)throw Error('Expected one point forecast response.');
    return {...modelSeries(response.results[0],m,point,now),attribution:meta.attribution,license:meta.license,catalog:`https://stac.dynamical.org/${m.id}/collection.json`};
  };
  const nws=async()=>{
    const p=(await json(`https://api.weather.gov/points/${point.latitude.toFixed(4)},${point.longitude.toFixed(4)}`,fetchImpl,signal)).properties;
    if(!/^[A-Z]{3}$/.test(p?.gridId)||!Number.isInteger(p.gridX)||!Number.isInteger(p.gridY))throw Error('NWS grid mapping is invalid.');
    const grid={office:p.gridId,x:p.gridX,y:p.gridY};
    return nwsSeries(await json(`https://api.weather.gov/gridpoints/${grid.office}/${grid.x},${grid.y}`,fetchImpl,signal),grid,point,now);
  };
  const sources=[{id:'nws',label:'NWS Hanford grid'},...MODELS];
  const results=await Promise.allSettled([nws(),...MODELS.map(model)]);
  return {point,checked:now,rows:results.map((r,i)=>r.status==='fulfilled'?r.value:{id:sources[i].id,label:sources[i].label,error:String(r.reason.message||r.reason).slice(0,180)})};
}
