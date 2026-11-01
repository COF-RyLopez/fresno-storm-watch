/** USGS Water Services instantaneous values (WaterML-JSON). Public, read-only, no credentials. */
export const USGS_IV_URL='https://waterservices.usgs.gov/nwis/iv/';
const HOUR=3_600_000,CODES={'00065':'stage','00060':'flow'};

/** @param {object} json NWIS IV response @returns {Map<string,object>} site -> {name,stage:[{time,value}],flow:[...]} */
export function parseUsgsIv(json){
  const series=json?.value?.timeSeries;
  if(!Array.isArray(series))throw new Error('USGS response has no timeSeries.');
  const sites=new Map();
  for(const ts of series){
    const site=ts?.sourceInfo?.siteCode?.[0]?.value,kind=CODES[ts?.variable?.variableCode?.[0]?.value];
    if(!/^\d{8,15}$/.test(site||'')||!kind)continue;
    const missing=Number(ts.variable.noDataValue);
    const points=(ts.values||[]).flatMap(v=>v.value||[]).map(p=>({time:Date.parse(p.dateTime),value:Number(p.value)}))
      .filter(p=>Number.isFinite(p.time)&&Number.isFinite(p.value)&&p.value!==missing).sort((a,b)=>a.time-b.time);
    const row=sites.get(site)||{site,name:ts.sourceInfo.siteName||site,stage:[],flow:[]};
    row[kind]=points;sites.set(site,row);
  }
  return sites;
}

/** @param {object} row parsed site @param {number} now @returns {object} Latest stage/flow and rise over ~3 h (prior sample 2.5-4 h before latest, as river-model). */
export function usgsReading(row,now=Date.now()){
  const stage=row.stage.filter(p=>p.time<=now+5*60_000).at(-1)??null,flow=row.flow.filter(p=>p.time<=now+5*60_000).at(-1)??null;
  const prior=stage?row.stage.filter(p=>p.time<=stage.time-2.5*HOUR&&p.time>=stage.time-4*HOUR).at(-1):null;
  const hours=prior?(stage.time-prior.time)/HOUR:null;
  return {site:row.site,name:row.name,stage,flow,rise:prior?{delta:stage.value-prior.value,hours,rate:(stage.value-prior.value)/hours,start:prior.time}:null};
}

/** @param {string[]} sites @returns {Promise<Map>} site -> reading */
export async function fetchUsgs(sites,{fetcher=fetch,now=Date.now}={}){
  const url=`${USGS_IV_URL}?${new URLSearchParams({format:'json',sites:sites.join(','),parameterCd:'00065,00060',period:'PT6H',siteStatus:'all'})}`;
  const response=await fetcher(url,{credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(25_000)});
  if(!response.ok)throw new Error(`USGS HTTP ${response.status}`);
  const parsed=parseUsgsIv(await response.json()),t=now();
  return new Map([...parsed].map(([site,row])=>[site,usgsReading(row,t)]));
}
