import {prepareWatchGeometry,nearbyWatchpoints} from './watch-proximity.js';

export const SUPPLY_CONTEXT_KM=Object.freeze([10,25,50]);
export const ROAD_CONTEXT_METERS=5000;
const MAX_CHECK_AGE=420000,DAY=86400000;
const current=(checked,error,now)=>!error&&Number.isFinite(checked)&&checked<=now+120000&&now-checked<=MAX_CHECK_AGE;

/** Public source records only; require stable location IDs, Fresno attribution and WGS84 point geometry. */
export function normalizeSupplyFeatures(features) {
  const keys=new Set();
  return features.map(feature=>{
    const a=feature.attributes||{},geometry=feature.geometry?.toJSON?.()||feature.geometry,key=String(a.Location_ID||'').trim();
    if(!key||keys.has(key)||String(a.County||'').trim().toLowerCase()!=='fresno')throw new Error('Supply identity or Fresno attribution is incomplete / duplicated');
    prepareWatchGeometry(geometry);
    if(!Number.isFinite(geometry.x)||!Number.isFinite(geometry.y))throw new Error('Supply point geometry unavailable');
    keys.add(key);
    return {key:'dwr-supply:'+key,locationId:key,name:String(a.Location||'Unnamed supply location'),address:[a.Address,a.City].filter(Boolean).join(' · '),
      longitude:geometry.x,latitude:geometry.y,geometry:{...geometry,spatialReference:{wkid:4326}},inspection:Number.isFinite(a.Inspection_Date)?a.Inspection_Date:null,
      inventory:{burlap:a.Burlap_Sandbags__ea_??null,plasticBags:a.Plastic_Sandbags__ea_??null,plasticRolls:a.Plastic__rolls_??null,containers:a.Containers??null},availability:'unverified'};
  });
}

/** Display the calendar age without inventing a DWR readiness standard or converting an old inspection into availability. */
export function inspectionAge(value,now=Date.now()) {
  if(!Number.isFinite(value))return {days:null,label:'Inspection date unknown · verify stock',warning:true};
  const age=Math.floor(now/DAY)-Math.floor(value/DAY);
  return age<0?{days:age,label:'Future inspection date · verify with DWR',warning:true}: {days:age,label:age===0?'Inspected today · availability still unverified':`${age.toLocaleString()} days old · historical inspection · verify stock`,warning:age>0};
}

/** Bounded proximity context, not service areas, allocation, routing or verified access. O(road vertices × watchpoints × supplies). */
export function correlateDwrSupplies({supplies,planning,roads,radiusKm=25,areaId='all'},now=Date.now()) {
  if(!SUPPLY_CONTEXT_KM.includes(radiusKm))throw new Error('Unsupported supply context distance');
  const roadPrepared=[],seen=new Map();let rejected=0,conflicts=0;
  for(const row of roads?.snapshot?.rows||[]){
    if(!row.key){rejected++;continue;}
    if(seen.has(row.key)){if(seen.get(row.key).revision!==row.revision){conflicts++;const index=roadPrepared.findIndex(r=>r.row.key===row.key);if(index>=0)roadPrepared.splice(index,1);}continue;}
    seen.set(row.key,row);
    if(row.active==='no')continue;
    try{roadPrepared.push({row,prepared:prepareWatchGeometry(row.geometry)});}catch{rejected++;}
  }
  const roadCurrent=current(roads?.snapshot?.checked,roads?.error,now),supplyCurrent=current(supplies?.checked,supplies?.error,now);
  const groups=planning?.rows||[],points=planning?.points||[];
  const result=(supplies?.error?[]:supplies?.rows||[]).map(site=>{
    const prepared=prepareWatchGeometry(site.geometry);
    const areas=groups.flatMap(r=>{
      if(areaId!=='all'&&r.area.id!==areaId)return [];
      const watchpoints=points.filter(p=>r.area.rainPoints.includes(p.id)).filter(p=>{
        const match=nearbyWatchpoints(prepared,[p],radiusKm*1000);return match&&match.meters<=radiusKm*1000;
      }),near=nearbyWatchpoints(prepared,watchpoints,radiusKm*1000);
      if(!near||near.meters>radiusKm*1000)return [];
      const rain=r.rainfall;
      return [{id:r.area.id,name:r.area.name,...near,points:watchpoints,review:!!r.review,status:r.status,
        rainfall:{maximum:rain?.usable&&Number.isFinite(rain.maximum)?rain.maximum:null,start:rain?.cycle?.start??null,end:rain?.cycle?.end??null,issue:rain?.cycle?.issue??null}}];
    }).sort((a,b)=>a.meters-b.meters||a.id.localeCompare(b.id));
    const watchpoints=[...new Map(areas.flatMap(a=>a.points).map(p=>[p.id,p])).values()];
    const atSite={id:site.key,name:site.name,longitude:site.longitude,latitude:site.latitude};
    const nearbyRoads=roadPrepared.flatMap(({row,prepared})=>{
      const nearSite=nearbyWatchpoints(prepared,[atSite],ROAD_CONTEXT_METERS),nearArea=nearbyWatchpoints(prepared,watchpoints,ROAD_CONTEXT_METERS);
      const siteMeters=nearSite&&nearSite.meters<=ROAD_CONTEXT_METERS?nearSite.meters:null,areaMeters=nearArea&&nearArea.meters<=ROAD_CONTEXT_METERS?nearArea.meters:null;
      if(siteMeters===null&&areaMeters===null)return [];
      return [{row,siteMeters,areaMeters,pointName:areaMeters!==null?nearArea.pointName:null,meters:Math.min(siteMeters??Infinity,areaMeters??Infinity),
        verification:!roadCurrent||row.active!=='yes'||!!row.issues?.length||Number.isFinite(row.end)&&row.end<=now||!row.sourceTime&&!row.edited}];
    }).sort((a,b)=>a.meters-b.meters||a.row.key.localeCompare(b.row.key));
    return {site,areas,roads:nearbyRoads,inspection:inspectionAge(site.inspection,now)};
  });
  return {rows:areaId==='all'?result:result.filter(r=>r.areas.length),total:result.length,loaded:!!supplies?.loaded,supplyCurrent,supplyError:supplies?.error||null,supplyChecked:supplies?.checked??null,
    planningReady:groups.length>0,areaOptions:groups.map(r=>({id:r.area.id,name:r.area.name})),roadCurrent,roadChecked:roads?.snapshot?.checked??null,roadError:roads?.error||null,roadRejected:rejected,roadConflicts:conflicts,radiusKm,areaId};
}
