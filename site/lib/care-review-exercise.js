import {normalizeCare,normalizeZone,careBox} from './care-model.js';
import {normalizeRoad} from './roads.js';
import {powerExercise} from './power-exercise.js';

/** Fictional care records only; no live queries or private writes. */
export function careReviewExercise(kind='overlap',now=Date.now()){
 const point={x:-119.69,y:36.93,spatialReference:{wkid:4326}},checked=kind==='failure'?now-3600000:now;
 const facility=normalizeCare({attributes:{ObjectId2:900001,OBJECTID:900001,County:'FRESNO',Facility_Name:'EXERCISE · Cedar Care (fictional)',Facility_Address:'FICTIONAL address',City:'Fresno',Facility_Type:'EXERCISE care setting',Licensed_Beds:null,CERTIFICATION_STATUS:'FICTIONAL'},geometry:point});
 const zone=normalizeZone({attributes:{OID:900001,Name:'EXERCISE · fictional county zone',EvacuationStatus:kind==='revised'?'Lifted':'Warn'},geometry:careBox(point,1000)});
 const feeds=powerExercise('watch',now).feeds.map(f=>({...f,error:kind==='failure'?'EXERCISE source unavailable':null}));
 const psps=feeds.flatMap(f=>f.rows).find(r=>r.utility==='PG&E');
 const outage={...structuredClone(psps),key:'EXERCISE:care:outage',name:'EXERCISE · reported outage',status:'outage',kind:'pge-outage',feedId:'pge-outages',revision:'EXERCISE-outage-1'};
 const road=normalizeRoad({attributes:{globalid:'EXERCISE-CARE-ROAD',active:'yes',blocknm:'EXERCISE · fictional crossing',lastupdate:now,startdate:now-3600000,enddate:now+3600000},geometry:{paths:[[[point.x-.003,point.y+.002],[point.x+.003,point.y+.002]]],spatialReference:{wkid:4326}}},1,now);
 return {facilities:{rows:[facility],checked,accounting:{returned:1,retained:1,outside:0,rejected:0}},zones:{rows:[zone],checked,accounting:{returned:1,retained:1,outside:0,rejected:0}},power:{rows:kind==='revised'?[]:[psps,outage],feeds,checked,error:kind==='failure'?'EXERCISE failed utility check':null},roads:{snapshot:{rows:[road],checked},error:kind==='failure'?'EXERCISE failed road check':null},errors:kind==='failure'?{facilities:'EXERCISE failed CDPH query',zones:'EXERCISE failed county zone query'}:{}};
}
