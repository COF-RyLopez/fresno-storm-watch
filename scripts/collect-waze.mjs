/** County Waze for Cities partner feed. The feed URL embeds an access key: it comes only from WAZE_FEED_URL and is never logged or written. */
import {createHash} from 'node:crypto';
import {countyGeometry} from '../site/lib/model.js';
import {pointInRings,validPoint} from '../site/lib/power-geometry.js';
import {WAZE_SOURCE,WAZE_NOTE,WAZE_CATEGORIES,WAZE_TRAFFIC_SIZES,WAZE_UNTYPED_CLOSURE_MAX_AGE,wazeCategory,wazeCounts,validateWazeSnapshot} from '../site/lib/waze-model.js';
import {bounded,fresnoCounty,loadPrevious,writeAtomic} from './lib/snapshot-io.mjs';

const OUTPUT=new URL('../site/data/waze-latest.json',import.meta.url);
const PUBLISHED='https://cof-rylopez.github.io/fresno-storm-watch/data/waze-latest.json';
// ponytail: 5,000 events with jam polylines stays well under 25 MB; raise only if a real county feed hits it.
const MAX_BYTES=25_000_000,TIMEOUT_MS=30_000,WAZE_EVENT_LIMIT=5000;

/** @param {string} message @param {string} url @returns {string} Strip the feed URL, any URL-shaped text and long query values (the access key). */
export function redact(message,url=''){
  let text=String(message??'');
  const secrets=[url];try{for(const v of new URL(url).searchParams.values())if(v.length>=6)secrets.push(v,encodeURIComponent(v));}catch{}
  for(const s of secrets.filter(Boolean).sort((a,b)=>b.length-a.length))text=text.split(s).join('[redacted]');
  return text.replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi,'[redacted URL]').slice(0,180);
}

const FEED_TIME=/^(\d{4}-\d\d-\d\d) (\d\d:\d\d:\d\d):(\d{3})$/;
/** Feed window from *Millis, else the documented UTC "yyyy-MM-dd HH:mm:ss:SSS" text. */
function feedTime(d,key){
  if(Number.isFinite(d[key+'Millis']))return new Date(d[key+'Millis']).toISOString();
  const m=typeof d[key]==='string'&&d[key].match(FEED_TIME),t=m?Date.parse(`${m[1]}T${m[2]}.${m[3]}Z`):NaN;
  if(!Number.isFinite(t))throw new Error(`Waze feed ${key} missing or invalid`);
  return new Date(t).toISOString();
}
const optional=(v,type)=>v===undefined||v===null||typeof v===type;

/** Strict CCP JSON shape check; any malformed alert rejects the whole feed so a partial read never looks complete. */
export function validateWazeFeed(d){
  if(!d||typeof d!=='object'||Array.isArray(d))throw new Error('Waze feed is not a JSON object');
  for(const key of ['alerts','jams','irregularities'])if(d[key]!==undefined&&!Array.isArray(d[key]))throw new Error(`Waze feed ${key} is not an array`);
  const alerts=d.alerts||[];
  for(const a of alerts){
    if(typeof a?.uuid!=='string'||!a.uuid||typeof a.type!=='string'||!a.type||!optional(a.subtype,'string'))throw new Error('Waze alert identity or type invalid');
    if(!validPoint([a.location?.x,a.location?.y])||!Number.isFinite(a.pubMillis)||a.pubMillis<=0)throw new Error('Waze alert location or time invalid');
    if(!optional(a.street,'string')||!optional(a.city,'string')||!['reliability','confidence','nThumbsUp'].every(k=>optional(a[k],'number')))throw new Error('Waze alert fields invalid');
  }
  return {alerts,jams:(d.jams||[]).length,irregularities:d.irregularities||[],startTime:feedTime(d,'startTime'),endTime:feedTime(d,'endTime')};
}

const round=v=>Math.round(v*1e4)/1e4,text=v=>v?.trim().slice(0,120)||null,score=v=>Number.isInteger(v)&&v>=0&&v<=10?v:null;
/** Allowlist, county polygon, then minimise: hashed id, rounded point, no description, username or raw uuid. */
export function filterWazeAlerts(alerts,rings,now=Date.now()){
  const kept=[],seen=new Set();let notStormRelevant=0,outsideCounty=0,duplicates=0;
  for(const a of alerts){
    if(seen.has(a.uuid)){duplicates++;continue;}seen.add(a.uuid);
    const subtype=a.subtype||'';
    if(!wazeCategory(a.type,subtype)||a.type==='ROAD_CLOSED'&&(!subtype||subtype==='NO_SUBTYPE')&&now-a.pubMillis>WAZE_UNTYPED_CLOSURE_MAX_AGE){notStormRelevant++;continue;}
    if(!pointInRings([a.location.x,a.location.y],rings)){outsideCounty++;continue;}
    kept.push({id:createHash('sha256').update(a.uuid).digest('hex').slice(0,16),type:a.type,subtype,lon:round(a.location.x),lat:round(a.location.y),street:text(a.street),city:text(a.city),reportedAt:new Date(a.pubMillis).toISOString(),reliability:score(a.reliability),confidence:score(a.confidence),thumbsUp:Number.isInteger(a.nThumbsUp)&&a.nThumbsUp>=0?a.nThumbsUp:null});
  }
  return {kept,notStormRelevant,outsideCounty,duplicates};
}

const SIZES=new Map(WAZE_TRAFFIC_SIZES.map(v=>[v.toUpperCase(),v]));
const num=v=>Number.isFinite(v)&&v>=0?Math.round(v*10)/10:null;
/** Epoch ms as a number or a digit string (the live feed sends strings), else a parseable date text; null otherwise. */
const millis=(v,text)=>{const n=typeof v==='string'&&/^\d{10,14}$/.test(v)?Number(v):v,t=Number.isFinite(n)&&n>0?n:typeof text==='string'?Date.parse(text):NaN;return Number.isFinite(t)&&t>0?new Date(t).toISOString():null;};
/** Unusual traffic inside the county, minimised: hashed id, rounded line of at most 25 points, no driver or node fields.
 * The spec is looser here than for alerts, so a malformed record is skipped (and visible as total minus kept), not fatal. */
export function filterWazeTraffic(items,rings){
  const kept=[],seen=new Set(),drops={};
  for(const t of items){
    const id=t?.id===undefined||t?.id===null?'':String(t.id),pts=Array.isArray(t?.line)?t.line.map(p=>[p?.x,p?.y]).filter(validPoint):[];
    const detectedAt=millis(t?.detectionDateMillis,t?.detectionDate),updatedAt=millis(t?.updateDateMillis,t?.updateDate)||detectedAt;
    const why=!id?'noId':seen.has(id)?'duplicate':!pts.length?'noLine':!detectedAt?'noTime':!pts.some(p=>pointInRings(p,rings))?'outsideCounty':null;
    if(why){drops[why]=(drops[why]||0)+1;continue;}seen.add(id);
    const step=Math.max(1,(pts.length-1)/24),line=[...new Set([...Array(Math.min(25,pts.length)).keys()].map(i=>Math.round(i*step)))].map(i=>pts[Math.min(i,pts.length-1)].map(round));
    kept.push({id:createHash('sha256').update('irregularity:'+id).digest('hex').slice(0,16),size:SIZES.get(String(t.type??'').toUpperCase())??null,lengthM:num(t.length),delaySeconds:num(t.delaySeconds),
      speedKmh:num(t.speed),regularSpeedKmh:num(t.regularSpeed),trend:[-1,0,1].includes(t.trend)?t.trend:null,street:text(typeof t.street==='string'?t.street:null),city:text(typeof t.city==='string'?t.city:null),detectedAt,updatedAt,line});
  }
  return Object.assign(kept,{drops});
}
/** Field names seen on feed irregularities (names only, no values), so a schema mismatch shows in the run log. */
const fieldNames=items=>[...new Set(items.flatMap(t=>t&&typeof t==='object'?Object.keys(t):[]))].filter(k=>/^[A-Za-z_]{1,40}$/.test(k)).sort();

/** @returns {Promise<object>} Validated snapshot; on any failure the previous alerts are kept and the redacted error recorded. */
// Every feed alert's TYPE:SUBTYPE (no location or text), so the owner can tune the storm allowlist from the run log.
const byType=alerts=>{const t={};for(const a of alerts){let k=`${a.type}:${a.subtype||'NO_SUBTYPE'}`;if(!/^[A-Z_]{1,40}:[A-Z_]{1,60}$/.test(k))k='OTHER';t[k]=(t[k]||0)+1;}return t;};
export async function collectWaze({url,county,previous=null,fetchImpl=fetch,now=Date.now()}){
  const at=new Date(now).toISOString(),empty={alerts:0,kept:0,notStormRelevant:0,outsideCounty:0,duplicates:0,jams:0,irregularities:0,irregularitiesKept:0,byCategory:Object.fromEntries(WAZE_CATEGORIES.map(c=>[c,0]))};
  const snapshot={schemaVersion:1,source:WAZE_SOURCE,note:WAZE_NOTE,generatedAt:at,checkedAt:previous?.checkedAt||null,error:null,feed:previous?.feed||{startTime:null,endTime:null},possiblyTruncated:previous?.possiblyTruncated||false,counts:previous?.counts||empty,alerts:previous?.alerts||[],irregularities:previous?.irregularities||[]};
  try{
    const response=await fetchImpl(url,{cache:'no-store',signal:AbortSignal.timeout(TIMEOUT_MS)});
    const feed=validateWazeFeed(JSON.parse(await bounded(response,MAX_BYTES,'Waze feed','Waze feed response too large')));
    const rings=countyGeometry(county.geometry).rings,{kept,...dropped}=filterWazeAlerts(feed.alerts,rings,now),traffic=filterWazeTraffic(feed.irregularities,rings);
    Object.assign(snapshot,{checkedAt:at,feed:{startTime:feed.startTime,endTime:feed.endTime},possiblyTruncated:feed.alerts.length+feed.jams+feed.irregularities.length>=WAZE_EVENT_LIMIT,
      counts:{alerts:feed.alerts.length,kept:kept.length,...dropped,jams:feed.jams,irregularities:feed.irregularities.length,irregularitiesKept:traffic.length,irregularityDrops:traffic.drops,irregularityFields:fieldNames(feed.irregularities),byCategory:wazeCounts(kept),byType:byType(feed.alerts)},alerts:kept,irregularities:traffic});
  }catch(error){snapshot.error=redact(error?.message||'Waze collection unavailable',url);}
  return validateWazeSnapshot(snapshot,now);
}

/** Missing secret = clean skip. WAZE_PUBLISH!=='true' = fetch and validate, log counts only, write nothing. */
export async function run({env=process.env,output=OUTPUT,fetchImpl=fetch,now=Date.now(),log=console.log}={}){
  const url=env.WAZE_FEED_URL?.trim(),publish=env.WAZE_PUBLISH==='true';
  if(!url){log(JSON.stringify({event:'waze-collection',skipped:'WAZE_FEED_URL not set'}));return null;}
  try{
    const previous=publish?await loadPrevious(output,d=>validateWazeSnapshot(d,now),'Previous Waze snapshot unavailable:',{url:PUBLISHED,future:'Published collection time is in the future.',warning:'Published prior Waze snapshot unavailable; using local fallback:'}):null;
    const snapshot=await collectWaze({url,county:await fresnoCounty(),previous,fetchImpl,now});
    if(publish)await writeAtomic(output,JSON.stringify(snapshot,null,2)+'\n');
    log(JSON.stringify({event:'waze-collection',published:publish,checkedAt:snapshot.checkedAt,error:snapshot.error,possiblyTruncated:snapshot.possiblyTruncated,counts:snapshot.counts}));
    return snapshot;
  }catch(error){log(JSON.stringify({event:'waze-collection',published:false,error:redact(error?.message,url)}));return null;}
}
if(import.meta.main)await run();
