/** Settle with `promise`, or reject with Error(message) after `ms`; the timer is always cleared. */
export async function withTimeout(promise,ms,message){
  let timer;
  try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(message)),ms);})]);}
  finally{clearTimeout(timer);}
}
