import {damOperator,scenariosFor} from './water-operators.js';

/** Planning questions: what the data raises before a storm, and which agency can answer it. Labels in display order. */
export const QUESTION_KINDS=Object.freeze({sandbags:'Flood zones & sandbags',dams:'Dams',levees:'Levees',power:'Critical-facility power',equipment:'Snow equipment',gauges:'River gauge thresholds'});
/** Map layers a question's Map button turns on, so the thing asked about is drawn. */
export const QUESTION_LAYERS=Object.freeze({sandbags:['fema','countySandbags'],dams:['dams','damInundation'],levees:['levees'],power:['facilities'],equipment:['snowFleet'],gauges:['gauges']});
export const COUNTY='Fresno County';

/** @param {object} data site/data/planning/questions.json @returns {object} The same data, or throws on a shape the panel cannot show. */
export function validateQuestions(data){
  if(data?.schemaVersion!==1||!Array.isArray(data.places)||!Array.isArray(data.questions)||!data.exposure||typeof data.exposure!=='object')throw Error('Planning questions file has an unexpected shape.');
  const ids=new Set();
  for(const q of data.questions){
    if(typeof q?.id!=='string'||!QUESTION_KINDS[q.kind]||typeof q.title!=='string'||typeof q.place!=='string'||typeof q.owner!=='string')throw Error('A planning question is missing its id, topic, title, place or owner.');
    if(ids.has(q.id))throw Error(`Duplicate planning question ${q.id}.`);ids.add(q.id);
    if(!Number.isFinite(q.lon)||!Number.isFinite(q.lat)||q.lon<-121||q.lon>-118||q.lat<35.8||q.lat>37.6)throw Error(`Planning question ${q.id} is placed outside Fresno County.`);
  }
  return data;
}

/** Live questions from the river watch areas: gauges with no NWS stage to act on, and areas with no gauge at all.
 * A gauge whose data failed is a source problem (Source health), not a missing threshold, so it is skipped.
 * @param {object[]} rows planning-model evaluateAreas rows @returns {object[]} */
export function gaugeQuestions(rows){
  const byGauge=new Map(),out=[];
  for(const row of rows||[]){
    const area=row.area;
    if(!row.gauges?.length){out.push({id:`gauges:none:${area.id}`,kind:'gauges',place:COUNTY,title:`How will we know water is rising at ${area.name}?`,
      detail:'No river gauge is connected to this watch area. Decide which gauge, camera or field check stands in for it, and who reports it.',owner:'County OES · NWS Hanford',source:'River watch areas',lon:null,lat:null});continue;}
    for(const g of row.gauges){
      if(!g.gauge||g.assessment?.thresholdKnown)continue;
      const prior=byGauge.get(g.id);if(prior){prior.areas.push(area.name);continue;}
      byGauge.set(g.id,{gauge:g.gauge,id:g.id,areas:[area.name]});
    }
  }
  for(const {gauge,id,areas}of byGauge.values())out.push({id:`gauges:threshold:${id}`,kind:'gauges',place:COUNTY,
    title:`What level at ${gauge.name} should start action?`,
    detail:`NWS publishes no action or flood stage for this gauge, so the app cannot flag a threshold. Watch area${areas.length>1?'s':''}: ${areas.join(', ')}. Agree on a local action level and what happens at it.`,
    owner:'NWS Hanford · County OES',source:'NWS water prediction service gauges',lon:gauge.longitude,lat:gauge.latitude});
  return out;
}

/** Live questions from the snow fleet feed: every unit in the shop, so repairs can be ordered before snow (plows first).
 * @param {object|null} fleet validated snow-fleet snapshot @returns {object[]} */
export function fleetQuestions(fleet){
  const v=fleet?.vehicles||[],shop=v.filter(x=>x.status==='in-shop');if(!shop.length)return [];
  const ready=`${v.length-shop.length} of ${v.length} reporting snow units are available`;
  return shop.map(x=>({id:`equipment:shop:${x.id}`,kind:'equipment',place:COUNTY,title:`When will ${x.id} be back from the shop?`,
    detail:`${x.type==='snow-blower'?'Snow blower':x.type==='plow-truck'?'Plow truck':'Snow equipment'} in the shop for repair (${x.statusBasis||'fleet feed'})${x.expectedBack?`; expected back ${x.expectedBack.slice(0,10)}`:'; no return date in the feed'}. ${ready}. Decide whether this repair goes ahead of other shop work before snow.`,
    owner:'County Fleet Services',source:fleet.sample?'Snow fleet feed (sample export)':'Snow fleet feed (Samsara + OpenGov EAM)',lon:x.lon,lat:x.lat}));
}

/** Dams name their operator with the same rules as the dam popup; a dam with no listed operator keeps the build's owner text. */
export function questionOwner(q){
  if(q.kind==='dams'&&q.nidAttributes){const o=damOperator(q.nidAttributes);if(o.operator!=='Not listed')return o.operator;}
  return q.owner;
}

/** @returns {object[]} Prepared failure scenarios for a dam question (empty for every other topic). */
export const questionScenarios=(q,scenarios)=>q.kind==='dams'?scenariosFor(q.dam,scenarios):[];

/** @param {object[]} questions @param {string} place @param {string} kind 'all' or a QUESTION_KINDS key @returns {object[]} County-wide shows every place; sandbag gaps first, by parcels. */
export function questionsFor(questions,place,kind='all'){
  const order=Object.keys(QUESTION_KINDS);
  return questions.filter(q=>(place===COUNTY||q.place===place)&&(kind==='all'||q.kind===kind))
    .sort((a,b)=>order.indexOf(a.kind)-order.indexOf(b.kind)||(b.parcels||0)-(a.parcels||0));// topic order, then most flood-zone parcels first
}

/** Briefing / follow-up evidence. kind + id make the stable key mission-followup-model uses to attach follow-ups. */
export function questionEvidence(q,now=Date.now()){
  const owner=questionOwner(q);
  return {kind:'planning-question',id:q.id,name:q.title,classification:'Planning question · unanswered',capturedAt:now,topic:QUESTION_KINDS[q.kind],place:q.place,
    question:q.detail,answerFrom:owner,source:q.source,location:Number.isFinite(q.lon)?{longitude:q.lon,latitude:q.lat}:null,nextReview:`${q.detail} Answer from: ${owner}.`};
}

const cell=v=>{const s=String(v??'');return /[",\n]/.test(s)?`"${s.replaceAll('"','""')}"`:s;};
/** @returns {string} CSV for sharing outside the app (spreadsheets, email). Status comes from saved follow-ups when they were loaded. */
export function questionsCsv(questions,statusOf=()=>''){
  const head=['Topic','Place','Question','Why it is asked','Answer from','Source','Status','Longitude','Latitude','ID'];
  return [head,...questions.map(q=>[QUESTION_KINDS[q.kind],q.place,q.title,q.detail,questionOwner(q),q.source,statusOf(q),q.lon,q.lat,q.id])].map(r=>r.map(cell).join(',')).join('\r\n')+'\r\n';
}
