/** Time the complete data-readiness contract, including the shared identity check. */
export async function measureWeatherReady(load,verify,now=()=>performance.now()){
  const start=now(),value=await load();
  if(!await verify(value))throw Error('Weather evidence identity mismatch');
  return {value,milliseconds:now()-start};
}
