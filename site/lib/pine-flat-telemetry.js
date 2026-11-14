import {sourceTime,realNumber} from './environment-model.js';
const HOUR=3600000;
export const HADS_SITES=Object.freeze({
 PFTC1:{nesdis:'CE94E43C',pe:'HP',name:'Pine Flat pool · NWS HADS',latitude:36.823889,longitude:-119.336111},
 PFQC1:{nesdis:'CE94F74A',pe:'HG',name:'Kings River below Pine Flat Dam',latitude:36.830556,longitude:-119.336111}
});
export const hadsUrl=id=>`https://hads.ncep.noaa.gov/nexhads2/servlet/DecodedData?sinceday=-48&nwslis=${id}&hsa=nil&state=nil&of=1`;
/** Fixed HADS English-unit PE contracts, decoded UTC timestamps. Never execute publisher HTML. */
export function parseHads(text,id,now=Date.now()){
 const site=HADS_SITES[id];if(!site)throw Error('Unknown HADS identity');
 const points=new Map();
 for(const line of text.trim().split(/\r?\n/)){
  const cells=line.split('|').map(s=>s.trim());if(cells.length!==7)throw Error('HADS format changed');
  const [nesdis,nwsli,pe,date,raw,flag]=cells;
  if(nesdis!==site.nesdis||nwsli!==id)throw Error('HADS identity changed');
  if(pe!==site.pe)continue;
  const time=sourceTime(date);if(time===null)throw Error('HADS timestamp changed');
  if(time>now+120000)throw Error('HADS timestamp is in the future');
  if(time<now-49*HOUR)continue;
  const point={time,value:flag?null:realNumber(raw),flag};
  const previous=points.get(time);
  if(previous&&JSON.stringify(previous)!==JSON.stringify(point))points.set(time,{time,value:null,flag:'CONFLICT'});
  else if(!previous)points.set(time,point);
 }
 if(!points.size)throw Error('Expected HADS variable missing');
 return {id,pe:site.pe,units:'ft',source:hadsUrl(id),points:[...points.values()].sort((a,b)=>a.time-b.time)};
}
/** Normalize only stage; no discharge, thresholds, routing or forecast is manufactured. */
export function telemetryGauge(block){
 if(block?.id!=='PFQC1'||block.pe!=='HG'||block.units!=='ft'||!Array.isArray(block.points))return null;
 const site=HADS_SITES.PFQC1;
 return {id:'PFQC1',name:site.name,longitude:site.longitude,latitude:site.latitude,basin:'Kings',county:'Fresno',sourceUrl:hadsUrl('PFQC1'),
  observed:{name:'stage',units:'ft',points:block.points.filter(p=>Number.isFinite(p.time)).map(p=>({...p,value:p.flag?null:p.value}))},
  forecast:{name:'stage',units:'ft',points:[],issued:null},categories:{},stageUnits:'ft',flowUnits:'',inService:!block.error&&Number.isFinite(Date.parse(block.lastSuccess))&&Number.isFinite(block.points.at(-1)?.value)&&!block.points.at(-1)?.flag,
  fetched:Date.parse(block.lastSuccess),datum:'Gauge datum not supplied; stage is not flood depth.',
  note:'Provisional USACE telemetry distributed by NWS HADS. Near-dam stage only; no downstream travel time or forecast.'};
}
/** Separate hourly pool series, eligible only with recent simultaneous CDEC agreement (0.02 ft). */
export function poolBackup(block,cdec,now,maxAgeMs){
 const checked=Date.parse(block?.lastSuccess);
 if(block?.id!=='PFTC1'||block.pe!=='HP'||block.units!=='ft'||block.error||!Number.isFinite(checked)||checked>now+120000||now-checked>maxAgeMs||!Number.isFinite(block.points?.at(-1)?.value)||block.points.at(-1).flag)return null;
 const samples=(block.points||[]).filter(p=>Number.isFinite(p.time)&&p.time%HOUR===0&&p.time<=now&&p.time>=now-48*HOUR).map(p=>({...p,units:'FEET',reportDate:new Date(p.time-8*HOUR).toISOString().slice(0,10)}));
 const overlap=samples.filter(p=>Number.isFinite(p.value)&&!p.flag).map(p=>({p,c:(cdec?.samples||[]).find(c=>c.time===p.time&&Number.isFinite(c.value)&&!c.flag)})).filter(x=>x.c);
 if(!overlap.length||overlap.some(x=>Math.abs(x.p.value-x.c.value)>.020001))return null;
 const lastValid=samples.filter(p=>Number.isFinite(p.value)&&!p.flag).at(-1);
 if(!lastValid||now-lastValid.time>3*HOUR)return null;
 return {sensor:6,duration:'H',units:'FEET',samples,latest:samples.at(-1),lastValid,source:hadsUrl('PFTC1'),publisher:'NWS HADS · provisional pool backup',lastSuccess:block.lastSuccess};
}
