import {DRAINAGE_URL} from './drainage-model.js';

export const PUMP_READINESS_SCOPE='fmfcd-pump-readiness-exercise';
export const PUMP_READINESS_TEST_SCOPE='fmfcd-pump-readiness-acceptance';
export const BACKUP_OPTIONS=['Unknown','Available','Unavailable'];
export const CONNECTION_OPTIONS=['Unknown','Confirmed compatible / tested','Needs verification'];
export const FUEL_OPTIONS=['Unknown','Confirmed available','Refuel needed','Not fuel powered'];
const text=(value,label)=>{if(typeof value!=='string'||!value.trim()||value.length>1500)throw Error(`${label} is required (up to 1,500 characters).`);};
const one=(value,options,label)=>{if(!options.includes(value))throw Error(`${label} is not recognized.`);};

/** A retrieval association, NOT a permanent FMFCD asset identifier. Any change requires owner rematching. */
export function pumpBinding(record){
  const g=record?.geometry;
  if(record?.kind!=='pump'||record.category!=='existing'||(g?.spatialReference?.latestWkid||g?.spatialReference?.wkid)!==4326||!Number.isFinite(g.x)||!Number.isFinite(g.y))throw Error('Select an existing mapped FMFCD pump with verified WGS84 coordinates.');
  return {source:DRAINAGE_URL+'/0',selectionKey:record.key,code:String(record.code||''),x:g.x,y:g.y,wkid:4326};
}
export const validBinding=b=>b?.source===DRAINAGE_URL+'/0'&&typeof b.selectionKey==='string'&&!!b.selectionKey&&typeof b.code==='string'&&b.wkid===4326&&Number.isFinite(b.x)&&Number.isFinite(b.y)&&b.x>=-125&&b.x<=-114&&b.y>=32&&b.y<=43;
export const bindingKey=b=>JSON.stringify([b?.source,b?.selectionKey,b?.code,b?.x,b?.y,b?.wkid]);

export function validatePumpReadiness(p,now=Date.now()){
  if(p.kind!=='pump-readiness'||p.schema!==1)throw Error('Pump readiness schema is not supported.');
  const b=p.binding;
  if(!validBinding(b))throw Error('Pump source association is invalid.');
  if(p.identityConfirmed!==true)throw Error('Confirm the selected pump location and identity before saving.');
  text(p.pumpLabel,'Pump identification');text(p.owner,'Responsible contact / team');text(p.contact,'Contact method');text(p.evidence,'Confirmation notes / source');
  one(p.backup,BACKUP_OPTIONS,'Backup power');one(p.connection,CONNECTION_OPTIONS,'Backup connection');one(p.fuel,FUEL_OPTIONS,'Fuel');
  if(p.backup!=='Available'&&p.connection!=='Unknown')throw Error('Only an available backup can have a confirmed connection.');
  if(p.runtimeHours!==null&&(!Number.isFinite(p.runtimeHours)||p.runtimeHours<0||p.runtimeHours>100000))throw Error('Runtime must be blank (unknown) or a nonnegative number of hours.');
  if(p.runtimeHours!==null)text(p.runtimeBasis,'Runtime estimate basis');
  if(p.fuel==='Refuel needed'&&p.runtimeHours>0&&!p.runtimeBasis)throw Error('Describe the remaining runtime and refueling assumption.');
  if(!Number.isFinite(p.observed)||p.observed<=0||p.observed>now+60000)throw Error('Confirmation time must be a valid past or current time.');
  if(!Number.isFinite(p.validUntil)||p.validUntil<=p.observed)throw Error('Next readiness review must follow the confirmation time.');
  return p;
}
