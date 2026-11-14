/** Optional display initialization: one in-flight attempt; failures may be retried. */
export function lazyDisplay(create){
  let pending=null;
  return ()=>pending??=Promise.resolve().then(create).catch(error=>{pending=null;throw error;});
}
