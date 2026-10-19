import {GOES_URL,GOES_PRODUCTS,satelliteFrames} from './weather-model.js';

/** @param {Function} fetchImpl @param {number} now @returns {Promise<object>} Validate WMS layer names and advertised frame times in the browser. */
export async function fetchSatelliteCatalog(fetchImpl=fetch,now=Date.now()){
  const url=new URL(GOES_URL);url.search=new URLSearchParams({service:'WMS',version:'1.3.0',request:'GetCapabilities'});
  const response=await fetchImpl(url,{signal:AbortSignal.timeout(25_000),credentials:'omit',cache:'no-store'});
  if(!response.ok)throw new Error(`GOES catalog HTTP ${response.status}`);
  const xml=new DOMParser().parseFromString(await response.text(),'application/xml');
  if(xml.querySelector('parsererror')||xml.getElementsByTagNameNS('*','ServiceException').length)throw new Error('GOES capabilities could not be read.');
  const layers=[...xml.getElementsByTagNameNS('*','Layer')],result={};
  for(const product of GOES_PRODUCTS){
    const node=layers.find(n=>[...n.children].some(c=>c.localName==='Name'&&c.textContent.trim()===product.id));
    const dimension=node&&[...node.children].find(c=>c.localName==='Dimension'&&c.getAttribute('name')==='time');
    if(!dimension)throw new Error(`GOES ${product.label} time catalog is missing.`);
    result[product.id]=satelliteFrames(dimension.textContent,now);
  }
  return result;
}
