import http from 'node:http';
import {readFile,stat,realpath} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {resolve,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {RunStore,sha256} from './store.mjs';
import {authorize} from './auth.mjs';
import {runnable} from '../../site/lib/scenario-contract.js';
export function configuration(env=process.env){
 const config={portalUrl:env.SCENARIO_PORTAL||'https://cofgisonline.maps.arcgis.com',orgId:env.SCENARIO_ORG_ID||'',eocGroups:(env.SCENARIO_EOC_GROUPS||'').split(',').filter(Boolean),reviewerGroups:(env.SCENARIO_REVIEW_GROUPS||'').split(',').filter(Boolean),origins:(env.SCENARIO_ORIGINS||'').split(',').filter(Boolean),dataRoot:env.SCENARIO_DATA_ROOT,registry:env.SCENARIO_REGISTRY,host:env.SCENARIO_BIND||'127.0.0.1',port:Number(env.SCENARIO_PORT||8791),maxPending:Number(env.SCENARIO_MAX_PENDING||20),maxRunsPerDay:Number(env.SCENARIO_MAX_RUNS_DAY||100)};
 if(config.portalUrl!=='https://cofgisonline.maps.arcgis.com'||!config.orgId||!config.eocGroups.length||!config.reviewerGroups.length||!config.origins.length||!config.dataRoot||!config.registry)throw Error('County identity, membership groups, origins, private storage and registry must be configured.');
 const publicRoot=fileURLToPath(new URL('../../site/',import.meta.url)),data=relative(publicRoot,resolve(config.dataRoot));if(!isAbsolute(config.dataRoot)||!isAbsolute(config.registry)||(!data.startsWith('..')&&!isAbsolute(data)))throw Error('Private absolute paths outside the public website are required.');
 for(const origin of config.origins){const u=new URL(origin);if(u.protocol!=='https:'||u.origin!==origin)throw Error('Only exact HTTPS application origins are permitted.');}
 if(!Number.isInteger(config.maxPending)||config.maxPending<1||!Number.isInteger(config.maxRunsPerDay)||config.maxRunsPerDay<1)throw Error('Positive queue limits required.');
 if(config.host!=='127.0.0.1'&&env.SCENARIO_TLS_GATEWAY!=='configured')throw Error('A configured TLS gateway is required for a non-loopback bind.');return config;
}
/** Protect every artifact, including range reads; no public output directory. */
export async function artifactPath(root,run,artifact){const dir=await realpath(resolve(root,run.id)),path=await realpath(resolve(dir,artifact.file)),rel=relative(dir,path);if(rel.startsWith('..')||isAbsolute(rel))throw Error('Invalid artifact path.');return path;}
async function body(req){let size=0,parts=[];for await(const part of req){size+=part.length;if(size>64000)throw Object.assign(Error('Request too large.'),{status:413});parts.push(part);}try{return JSON.parse(Buffer.concat(parts).toString('utf8'));}catch{throw Object.assign(Error('JSON request required.'),{status:400});}}
export function createService({config,store,catalog,authenticate=token=>authorize(token,config)}){
 const attempts=new Map();const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));};
 return http.createServer(async(req,res)=>{
  const started=Date.now();res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Vary','Origin');
  const origin=req.headers.origin;if(origin&&!config.origins.includes(origin))return json(res,403,{message:'Application origin denied.'});
  if(origin){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Access-Control-Expose-Headers','Content-Range, Accept-Ranges, ETag');}
  if(req.method==='OPTIONS'){res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');res.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type, Range');res.writeHead(204);return res.end();}
  const url=new URL(req.url,'http://service.invalid');
  if(req.method==='GET'&&url.pathname==='/health')return json(res,200,{status:'up',environment:'exercise',enabledModels:catalog.models.filter(runnable).length});
  let user;try{
   if(url.search)throw Object.assign(Error('Query parameters are not accepted.'),{status:400});
   const auth=/^Bearer (\S+)$/i.exec(req.headers.authorization||'');user=await authenticate(auth?.[1]);
   const rate=attempts.get(user.username)||{at:Date.now(),n:0};if(Date.now()-rate.at>60000){rate.at=Date.now();rate.n=0;}if(++rate.n>120)throw Object.assign(Error('Too many requests. Retry in one minute.'),{status:429});attempts.set(user.username,rate);if(attempts.size>1000)for(const [k,v]of attempts)if(Date.now()-v.at>60000)attempts.delete(k);
   const present=run=>{const {resultPath,...safe}=run;return {...safe,canReview:user.reviewer};};
   if(url.pathname==='/v1/catalog'&&req.method==='GET')return json(res,200,{schemaVersion:1,environment:'exercise',models:catalog.models,readiness:[],serviceReady:true});
   if(url.pathname==='/v1/runs'&&req.method==='GET')return json(res,200,{runs:store.list().map(present)});
   if(url.pathname==='/v1/runs'&&req.method==='POST'){const input=await body(req),model=catalog.models.find(m=>m.id===input.modelId);if(!model)throw Error('Model not found.');return json(res,202,present(store.submit(input,model,user.username)));}
   const match=/^\/v1\/runs\/([A-Za-z0-9_-]{1,100})(?:\/(cancel|review|result|artifacts)(?:\/([A-Za-z0-9_-]{1,100}))?)?$/.exec(url.pathname);if(!match)return json(res,404,{message:'Endpoint not found.'});const run=store.get(match[1]);if(!run)return json(res,404,{message:'Run not found.'});
   if(req.method==='GET'&&!match[2])return json(res,200,present(run));
   if(req.method==='POST'&&match[2]==='cancel')return json(res,200,present(store.cancel(run.id,user.username,user.reviewer)));
   if(req.method==='POST'&&match[2]==='review'){if(!user.reviewer)throw Object.assign(Error('Technical reviewer group required.'),{status:403});return json(res,200,present(store.review(run.id,user.username,await body(req))));}
   if(req.method==='GET'&&['result','artifacts'].includes(match[2])){
    if(run.status!=='complete')throw Error('Verified result is not complete.');const manifest=JSON.parse(await readFile(resolve(config.dataRoot,run.id,'result.json'),'utf8'));if(sha256(manifest)!==run.resultDigest)throw Error('Result changed after its completion receipt.');
    if(match[2]==='result')return json(res,200,manifest);const artifact=manifest.artifacts.find(a=>a.id===match[3]);if(!artifact)return json(res,404,{message:'Artifact not found.'});const path=await artifactPath(config.dataRoot,run,artifact),info=await stat(path);if(info.size!==artifact.bytes)throw Error('Artifact length does not match its receipt.');res.setHeader('Content-Type',artifact.mediaType);res.setHeader('Accept-Ranges','bytes');res.setHeader('ETag',`"${artifact.sha256}"`);
    let start=0,end=info.size-1,status=200;if(req.headers.range){const r=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range);if(!r||Number(r[1])>end||(r[2]&&Number(r[2])<Number(r[1]))){res.setHeader('Content-Range',`bytes */${info.size}`);return res.writeHead(416).end();}start=Number(r[1]);end=r[2]?Math.min(end,Number(r[2])):end;status=206;res.setHeader('Content-Range',`bytes ${start}-${end}/${info.size}`);}res.setHeader('Content-Length',end-start+1);res.writeHead(status);const stream=createReadStream(path,{start,end});stream.on('error',()=>res.destroy());stream.pipe(res);return;
   }
   json(res,405,{message:'Method not allowed.'});
  }catch(error){const status=error.status||400;json(res,status,{message:status>=500?'Scenario service unavailable.':error.message});}
  finally{console.info(JSON.stringify({event:'scenario-request',method:req.method,status:res.statusCode,durationMs:Date.now()-started}));}
 });
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){const config=configuration(),catalog=JSON.parse(await readFile(config.registry,'utf8')),store=new RunStore(resolve(config.dataRoot,'queue.sqlite'),config),server=createService({config,store,catalog});server.requestTimeout=15000;server.listen(config.port,config.host,()=>console.info('Private exercise scenario service started.'));for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>server.close(()=>{store.close();process.exit(0);}));}
