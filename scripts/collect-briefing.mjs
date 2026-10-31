/** Collect only the public NWS Hanford product. County email is never a collector input. */
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {writeAtomic} from './lib/snapshot-io.mjs';
import {HNX_BRIEFING_PAGE,HNX_BRIEFING_PDF,parseBriefingDate,validateBriefingSnapshot} from '../site/lib/briefing-model.js';
const DATA=new URL('../site/data/',import.meta.url),PUBLISHED='https://cof-rylopez.github.io/fresno-storm-watch/data/';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
/** @param {Response} response @param {number} max @returns {Promise<Buffer>} Bound streamed responses, including missing content lengths. */
async function bounded(response,max){if(!response.ok)throw new Error(`NWS source HTTP ${response.status}`);let size=0;const chunks=[];for await(const chunk of response.body){size+=chunk.length;if(size>max)throw new Error('NWS source exceeds the collection size limit.');chunks.push(chunk);}return Buffer.concat(chunks);}
/** @param {Buffer} bytes @returns {boolean} Reject HTML error pages and truncated PDF payloads. */
const isPdf=bytes=>bytes.length>=100&&bytes.subarray(0,5).toString()==='%PDF-'&&bytes.subarray(-2048).includes(Buffer.from('%%EOF'));
/** @param {object} options @returns {Promise<object>} Keep a failed check separate from the last verified file and publication time. */
export async function collectBriefing({previous=null,previousPdf=null,fetchImpl=fetch,now=Date.now()}={}){
  if(previous){validateBriefingSnapshot(previous);if(previous.document&&(!previousPdf||sha(previousPdf)!==previous.document.sha256))throw new Error('Prior briefing file does not match its metadata.');}
  const checkedAt=new Date(now).toISOString(),base={schemaVersion:1,sourcePage:HNX_BRIEFING_PAGE,sourcePdf:HNX_BRIEFING_PDF,checkedAt,lastSuccessAt:previous?.lastSuccessAt||previous?.document?.collectedAt||null,document:previous?.document||null,error:null};
  const get=(url,headers={})=>fetchImpl(url,{redirect:'error',signal:AbortSignal.timeout(20_000),headers:{'User-Agent':'FresnoCountyStormWatch/0.20 (https://cof-rylopez.github.io/fresno-storm-watch/)',...headers}});
  try{
    const html=(await bounded(await get(HNX_BRIEFING_PAGE),2_000_000)).toString('utf8');
    const label=/Last Update:\s*([^<]+)/i.exec(html)?.[1]?.trim().replace(/\s+/g,' ');if(!label)throw new Error('Hanford page has no recognizable update date.');
    const updated=parseBriefingDate(label);if(updated>now+120_000)throw new Error('Hanford source page update is in the future.');
    if(!html.includes(HNX_BRIEFING_PDF))throw new Error('Hanford page no longer identifies the configured partner PDF.');
    const prior=previous?.document,modifiedAt=Date.parse(prior?.fileModifiedAt),age=now-Date.parse(prior?.collectedAt);
    const conditional=Number.isFinite(modifiedAt)&&modifiedAt<=now+120_000&&age>=0&&age<6*3600_000;
    const response=await get(HNX_BRIEFING_PDF,conditional?{'If-Modified-Since':new Date(modifiedAt).toUTCString()}:{});
    if(response.status===304){if(!conditional||!previousPdf)throw new Error('NWS returned unchanged status without a verified prior file.');base.document={...prior,sourceUpdatedAt:new Date(updated).toISOString(),sourceDateLabel:label};base.lastSuccessAt=checkedAt;return {snapshot:validateBriefingSnapshot(base),pdf:previousPdf};}
    const pdf=await bounded(response,15_000_000);if(!isPdf(pdf))throw new Error('Hanford source did not return a complete PDF.');
    const modified=Date.parse(response.headers.get('last-modified')||'');
    base.document={...(previous?.document?.sha256===sha(pdf)?{previews:previous.document.previews,previewError:previous.document.previewError}:{}),sha256:sha(pdf),bytes:pdf.length,sourceUpdatedAt:new Date(updated).toISOString(),sourceDateLabel:label,collectedAt:checkedAt,fileModifiedAt:Number.isFinite(modified)?new Date(modified).toISOString():null};
    base.lastSuccessAt=checkedAt;
    return {snapshot:validateBriefingSnapshot(base),pdf};
  }catch(error){base.error=String(error.message||'Public briefing collection failed.').slice(0,300);return {snapshot:validateBriefingSnapshot(base),pdf:previousPdf};}
}
/** @returns {Promise<void>} Atomic deploy snapshot; public prior copies protect against a transient outage on a fresh runner. */
async function main(){
  const start=Date.now();let previous=null,previousPdf=null;
  try{previous=validateBriefingSnapshot(JSON.parse(await readFile(new URL('hanford-briefing.json',DATA),'utf8')));if(previous.document){previousPdf=await readFile(new URL('hanford-briefing-current.pdf',DATA));if(sha(previousPdf)!==previous.document.sha256)throw new Error('Local prior file hash mismatch');}}catch(error){console.warn('Local prior briefing unavailable:',error.message);previous=null;previousPdf=null;}
  if(process.argv.includes('--published'))try{const metadata=await fetch(PUBLISHED+'hanford-briefing.json?check='+Date.now(),{signal:AbortSignal.timeout(15_000)});if(!metadata.ok)throw new Error(`HTTP ${metadata.status}`);const prior=validateBriefingSnapshot(await metadata.json());if(prior.document&&(!previous?.document||Date.parse(prior.lastSuccessAt||prior.document.collectedAt)>Date.parse(previous.lastSuccessAt||previous.document.collectedAt))){const pdf=previous?.document?.sha256===prior.document.sha256?previousPdf:await bounded(await fetch(PUBLISHED+'hanford-briefing-current.pdf?v='+prior.document.sha256,{signal:AbortSignal.timeout(20_000)}),15_000_000);if(sha(pdf)!==prior.document.sha256||!isPdf(pdf))throw new Error('Published prior file hash mismatch');previous=prior;previousPdf=pdf;}}catch(error){console.warn('Published prior briefing unavailable; using local fallback:',error.message);}
  const {snapshot,pdf}=await collectBriefing({previous,previousPdf});
  if(pdf)await writeAtomic(new URL('hanford-briefing-current.pdf',DATA),pdf);
  await writeAtomic(new URL('hanford-briefing.json',DATA),JSON.stringify(snapshot,null,2)+'\n');
  console.log(JSON.stringify({event:'hanford-briefing-collection',checkedAt:snapshot.checkedAt,durationMs:Date.now()-start,sourceUpdatedAt:snapshot.document?.sourceUpdatedAt,revision:snapshot.document?.sha256,bytes:snapshot.document?.bytes,error:snapshot.error}));if(snapshot.error)console.warn('Briefing collection failed; retained evidence remains explicitly marked.');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
