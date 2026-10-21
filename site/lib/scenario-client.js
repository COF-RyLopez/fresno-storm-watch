import {validateModel,validateRun} from './scenario-contract.js';
/** Memory-only authenticated client. A new session invalidates delayed private responses. */
export function createScenarioClient(config){
 let session=null,generation=0;const url=config.serviceUrl?new URL(config.serviceUrl):null;
 if(url&&(url.protocol!=='https:'||url.username||url.password||url.search||url.hash))throw Error('Scenario service requires a configured HTTPS URL without credentials.');
 async function request(path,{method='GET',body}={}){
  if(!url)throw Error('The protected simulation service is awaiting county cloud setup.');
  if(!session?.getToken)throw Error('Sign in with your authorized county EOC account.');
  const epoch=generation,token=await session.getToken();if(epoch!==generation)throw Error('Session changed.');
  const response=await fetch(new URL(path,url.href.replace(/\/?$/,'/')),{method,headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,cache:'no-store',credentials:'omit',redirect:'error',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(30000)});
  if(epoch!==generation)throw Error('Session ended; private response discarded.');
  if([401,403].includes(response.status)){session=null;generation++;throw Object.assign(Error('Scenario access expired or was denied. Private scenario results cleared; sign in again.'),{status:response.status});}
  if(!response.ok){let message='Scenario service request failed.';try{message=(await response.json()).message||message;}catch{}throw Error(message);}
  return response;
 }
 return {setSession(value){generation++;session=value;},get configured(){return !!url;},async catalog(){const data=await(await request('v1/catalog')).json();data.models.forEach(validateModel);return data;},async list(){return (await(await request('v1/runs')).json()).runs;},async submit(input,model){validateRun(input,model);return (await(await request('v1/runs',{method:'POST',body:input})).json());},async cancel(id){return (await(await request(`v1/runs/${encodeURIComponent(id)}/cancel`,{method:'POST',body:{}})).json());},async review(id,decision){return (await(await request(`v1/runs/${encodeURIComponent(id)}/review`,{method:'POST',body:decision})).json());},async result(id){return (await(await request(`v1/runs/${encodeURIComponent(id)}/result`)).json());},async artifact(id,key){return(await request(`v1/runs/${encodeURIComponent(id)}/artifacts/${encodeURIComponent(key)}`)).blob();}};
}
