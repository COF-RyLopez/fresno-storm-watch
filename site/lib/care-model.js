import {pointInRings,powerGeometry} from './power-geometry.js';
import {EVAC_SERVICE,EVAC_MAP} from './roads.js';

export const CARE_SOURCES=Object.freeze({
  facilities:'https://services2.arcgis.com/wi1yEacfYjH5viqb/arcgis/rest/services/CDPH_R_D_Facilities/FeatureServer/0',
  zones:EVAC_SERVICE,
  facilityItem:'https://www.arcgis.com/home/item.html?id=0efaf1dc942f430f887c11cae008918c',
  zoneItem:EVAC_MAP
});
export const ZONE_STATUS=Object.freeze({Order:'Evacuation Order',Warn:'Evacuation Warning',Lifted:'Evacuation Order(s) Lifted'});
export const ZONE_COLORS=Object.freeze({Order:'#b53535',Warn:'#ffff00',Lifted:'#65a843',unknown:'#b4bdc6'});
export const normalizeText=v=>String(v??'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');
const abbreviations={street:'st',avenue:'ave',road:'rd',drive:'dr',boulevard:'blvd',lane:'ln',court:'ct',highway:'hwy',north:'n',south:'s',east:'e',west:'w'};
export const normalizedAddress=v=>normalizeText(v).split(' ').map(s=>abbreviations[s]||s).join(' ');
export const distanceMetres=(a,b)=>{const rad=Math.PI/180,p=a.y*rad,q=b.y*rad,s=Math.sin((q-p)/2)**2+Math.cos(p)*Math.cos(q)*Math.sin((b.x-a.x)*rad/2)**2;return 6371008.8*2*Math.asin(Math.min(1,Math.sqrt(s)));};
export function careBox(point,metres=250){const dy=metres/111195,dx=dy/Math.cos(point.y*Math.PI/180);return {rings:[[[point.x-dx,point.y-dy],[point.x-dx,point.y+dy],[point.x+dx,point.y+dy],[point.x+dx,point.y-dy],[point.x-dx,point.y-dy]]],spatialReference:{wkid:4326}};}
export function normalizeCare(feature){
 const a=feature.attributes||{},g=powerGeometry(feature.geometry);
 if(g.rings||!Number.isInteger(a.ObjectId2)||normalizeText(a.County)!=='fresno'||!String(a.Facility_Name||'').trim())throw Error('Invalid CDPH record identifier, name, county or point.');
 return {key:`cdph:${a.ObjectId2}`,oid:a.ObjectId2,sourceId:a.OBJECTID??null,name:a.Facility_Name,address:a.Facility_Address||'',city:a.City||'',kind:a.Facility_Type||'Not supplied',beds:Number.isInteger(a.Licensed_Beds)&&a.Licensed_Beds>=0?a.Licensed_Beds:null,status:a.CERTIFICATION_STATUS||'Not supplied',geometry:g};
}
export function normalizeZone(feature){const a=feature.attributes||{},geometry=powerGeometry(feature.geometry);if(!geometry.rings||!Number.isInteger(a.OID))throw Error('Invalid evacuation record.');return {key:`county-zone:${a.OID}`,oid:a.OID,name:a.Name||'Unnamed county zone',status:Object.hasOwn(ZONE_STATUS,a.EvacuationStatus)?a.EvacuationStatus:'unknown',rawStatus:a.EvacuationStatus??null,geometry};}
export function zonesAt(point,zones){return zones.filter(z=>pointInRings([point.x,point.y],z.geometry.rings));}
export function comparePlaces(facility,places,{radius=500}={}){
 const name=normalizeText(facility.name),tokens=new Set(name.split(' ').filter(t=>t.length>2)),address=normalizedAddress(facility.address),city=normalizeText(facility.city);
 const rows=[];
 for(const p of places){const metres=distanceMetres(facility.geometry,p);if(metres>radius)continue;const n=normalizeText(p.name),other=new Set(n.split(' ').filter(t=>t.length>2));const shared=[...tokens].filter(t=>other.has(t));const exactName=!!name&&name===n,nameSimilar=exactName||shared.length>=2&&shared.length/new Set([...tokens,...other]).size>=.5;
  const addressMatch=!!address&&!!city&&(p.addresses||[]).some(a=>normalizeText(a.locality)===city&&normalizedAddress(a.freeform)===address);
  rows.push({...p,metres,exactName,nameSimilar,addressMatch,candidate:addressMatch||nameSimilar,verified:false});
 }
 return rows.sort((a,b)=>Number(b.addressMatch)-Number(a.addressMatch)||Number(b.exactName)-Number(a.exactName)||Number(b.nameSimilar)-Number(a.nameSimilar)||a.metres-b.metres||a.id.localeCompare(b.id));
}
/** No nearest-building join: multiple footprints and campus buildings remain separate. */
export function compareBuildings(facility,places,buildings){return buildings.map(b=>{const direct=pointInRings([facility.geometry.x,facility.geometry.y],b.geometry.rings),placeIds=places.filter(p=>p.candidate&&pointInRings([p.x,p.y],b.geometry.rings)).map(p=>p.id);return {...b,direct,placeIds,associated:direct||placeIds.length>0,verified:false};});}
