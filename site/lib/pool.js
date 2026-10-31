/** Run fn over items with at most n in flight; results keep input order. */
export async function pool(items,n,fn){
  const results=new Array(items.length);let cursor=0;
  const worker=async()=>{while(cursor<items.length){const i=cursor++;results[i]=await fn(items[i],i);}};
  await Promise.all(Array.from({length:n},worker));return results;
}
