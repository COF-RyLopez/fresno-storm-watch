import {briefingState,HNX_BRIEFING_PAGE,HNX_BRIEFING_PDF,isoDay as day} from './briefing-model.js';
import {pacificDate} from './briefing-context-model.js';

/** @param {object} value @returns {object} Summaries cite an exact document, page and calendar window; no inferred county hazard geometry. */
export function validateBriefingImpacts(value){
  if(value?.schemaVersion!==1||!Array.isArray(value.documents)||!Array.isArray(value.impacts)||value.documents.length>10||value.impacts.length>30)throw new Error('Invalid Fresno briefing summary register.');
  const docs=new Map(),ids=new Set(),text=v=>typeof v==='string'&&v.length>0&&v.length<=1200;
  for(const d of value.documents){
    if(!text(d.id)||docs.has(d.id)||d.kind!=='latest'||!text(d.label)||!day(d.date)||!/^[a-f0-9]{64}$/.test(d.sha256)||!Number.isInteger(d.pages)||d.pages<1||d.pages>40||d.sourcePage!==HNX_BRIEFING_PAGE||d.sourcePdf!==HNX_BRIEFING_PDF)throw new Error('Invalid briefing summary document identity.');
    docs.set(d.id,d);
  }
  for(const i of value.impacts){
    const d=docs.get(i.document);
    if(!d||!text(i.id)||ids.has(i.id)||!Number.isInteger(i.page)||i.page<1||i.page>d.pages||!day(i.firstDate)||!day(i.lastDate)||i.firstDate>i.lastDate||['area','overview','geography','impact','timing','confidence','probability','planning','limitation'].some(k=>!text(i[k])))throw new Error('Invalid Fresno briefing impact or source citation.');
    ids.add(i.id);
  }
  return value;
}
/** @param {object|null} register @param {object|null} snapshot @param {number} now @returns {object} Never carry a reviewed summary forward to a different public PDF. */
export function briefingImpacts(register,snapshot,now=Date.now()){
  if(!register)return {rows:[],unreviewed:false,missing:true};
  const today=pacificDate(now);
  const current=snapshot?.document?.sha256,health=briefingState(snapshot,now),docs=new Map(register.documents.map(d=>[d.id,d]));
  const rows=register.impacts.flatMap(i=>{
    const document=docs.get(i.document);
    if(document.sha256!==current)return [];
    const period=today>i.lastDate?'past':today<i.firstDate?'upcoming':'within';
    const status=period==='past'?'Past forecast period':health.tone==='gap'?health.label:period==='upcoming'?'Upcoming forecast period':'Within stated forecast dates';
    return [{...i,document,period,status,qualification:health.tone==='gap'?health.reason:null}];
  });
  return {rows,unreviewed:!!current&&!register.documents.some(d=>d.sha256===current),missing:!current};
}
