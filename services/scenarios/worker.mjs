import {readFile,writeFile,mkdir,copyFile,realpath,stat} from 'node:fs/promises';
import {resolve,relative,isAbsolute,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {RunStore,sha256} from './store.mjs';
import {canonical,validateRun,validateResult,validId} from '../../site/lib/scenario-contract.js';
/** Realpath containment: rejects absolute or '..' paths, then any symlink resolving outside root. */
export async function confined(root,file){if(!file||isAbsolute(file)||file.split(/[\\/]/).includes('..'))throw Error('Package path rejected.');const base=await realpath(root),path=await realpath(resolve(base,file)),rel=relative(base,path);if(rel.startsWith('..')||isAbsolute(rel))throw Error('Package escapes root.');return path;}
async function fileHash(path){const hash=createHash('sha256');for await(const chunk of createReadStream(path))hash.update(chunk);return hash.digest('hex');}
/** Execute only an administrator-installed, hash-pinned adapter; user inputs are a JSON file. */
export async function executeAdapter(executor,jobDir,input,{cancelled=()=>false,onHeartbeat=()=>{},timeoutMs=1800000,spawnProcess=spawn}={}){
 if(!Number.isFinite(timeoutMs)||timeoutMs<100||timeoutMs>86400000)throw Error('Invalid runtime cap.');
 if(!isAbsolute(executor.program)||!Array.isArray(executor.args)||executor.args.some(a=>typeof a!=='string'))throw Error('Approved executor configuration required.');
 const inputFile=resolve(jobDir,'input.json');await writeFile(inputFile,canonical(input),{encoding:'utf8',flag:'wx'});
 const args=executor.args.map(a=>a.replaceAll('{jobDir}',jobDir).replaceAll('{input}',inputFile));
 return new Promise((accept,reject)=>{
  const child=spawnProcess(executor.program,args,{cwd:jobDir,shell:false,windowsHide:true,detached:process.platform!=='win32',stdio:'ignore',env:{...process.env,SCENARIO_JOB_DIR:jobDir}});let reason=null,finished=false;
  const stop=why=>{if(reason||finished)return;reason=why;if(child.pid){if(process.platform==='win32'){const killer=spawn('taskkill',['/pid',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});killer.on('error',()=>child.kill());}else{try{process.kill(-child.pid,'SIGKILL');}catch{child.kill('SIGKILL');}}}};
  const interval=setInterval(()=>{try{onHeartbeat();if(cancelled())stop('cancelled');}catch{stop('worker-state-lost');}},250);
  const timeout=setTimeout(()=>stop('runtime-limit'),timeoutMs);
  const clean=()=>{finished=true;clearInterval(interval);clearTimeout(timeout);};
  child.once('error',error=>{clean();reject(error);});child.once('exit',code=>{clean();if(reason)reject(Object.assign(Error(reason),{cancelled:reason==='cancelled'}));else if(code!==0)reject(Error('Model adapter did not finish successfully.'));else accept();});
 });
}
/** Recoverable filesystem outputs + atomic queue claim. Never claim a second active run. */
export async function processOne({store,registry,dataRoot,workerId='single-worker'}){
 const run=store.claim(workerId);if(!run)return null;let lastBeat=0,cancelled=false;
 try{
  const model=registry.models.find(m=>m.id===run.input.modelId&&m.version===run.input.modelVersion),executor=registry.executors?.[run.input.modelId];validateRun(run.input,model);
  if(sha256(model)!==run.templateHash||!executor||!validId(executor.id))throw Error('Model/executor registry changed or is unavailable.');
  if(!Number.isInteger(executor.maxRuntimeMs)||executor.maxRuntimeMs<1000||executor.maxRuntimeMs>86400000)throw Error('Approved runtime cap missing.');
  const packageManifest=JSON.parse(await readFile(await confined(executor.packageRoot,'package-manifest.json'),'utf8'));
  if(sha256(packageManifest)!==model.baseline.packageHash||!Array.isArray(packageManifest.files)||!packageManifest.files.length)throw Error('Approved package manifest mismatch.');
  const root=resolve(dataRoot,run.id);await mkdir(root,{recursive:false});
  for(const entry of packageManifest.files){if(['input.json','result.json','execution-context.json'].includes(entry.file))throw Error('Reserved job files cannot be supplied by the template.');const source=await confined(executor.packageRoot,entry.file);if(await fileHash(source)!==entry.sha256)throw Error('Template package checksum mismatch.');const target=resolve(root,entry.file);await mkdir(dirname(target),{recursive:true});await copyFile(source,target);}
  await writeFile(resolve(root,'execution-context.json'),canonical({runId:run.id,model,inputs:run.input}),{encoding:'utf8',flag:'wx'});
  // Adapter program is an operations-owned absolute executable; its checksum is also pinned.
  if(await fileHash(executor.program)!==executor.programSha256)throw Error('Approved adapter executable changed.');
  await executeAdapter(executor,root,run.input,{timeoutMs:executor.maxRuntimeMs,cancelled:()=>cancelled,onHeartbeat:()=>{if(Date.now()-lastBeat>1000){cancelled=store.heartbeat(run.id,run.attempt);lastBeat=Date.now();}}});
  cancelled=store.heartbeat(run.id,run.attempt);if(cancelled)throw Object.assign(Error('cancelled'),{cancelled:true});
  store.transition(run.id,run.attempt,'preparing');
  const path=await confined(root,'result.json'),result=validateResult(JSON.parse(await readFile(path,'utf8')),run,model);
  for(const artifact of result.artifacts){const file=await confined(root,artifact.file),info=await stat(file);if(info.size!==artifact.bytes||await fileHash(file)!==artifact.sha256)throw Error('Incomplete or changed result artifact.');}
  if(store.heartbeat(run.id,run.attempt))throw Object.assign(Error('cancelled'),{cancelled:true});
  return store.transition(run.id,run.attempt,'complete',{resultDigest:sha256(result),resultPath:path});
 }catch(error){return store.transition(run.id,run.attempt,error.cancelled?'cancelled':'failed',{failureCode:error.cancelled?'cancelled':'execution-or-output-validation-failed'});}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const dataRoot=process.env.SCENARIO_DATA_ROOT,registryPath=process.env.SCENARIO_REGISTRY;if(!dataRoot||!registryPath)throw Error('Private data root and reviewed registry required.');
 const registry=JSON.parse(await readFile(registryPath,'utf8')),store=new RunStore(resolve(dataRoot,'queue.sqlite'));
 // Deliberate operator reconciliation, never automatic restart of a possibly running solver.
 if(process.argv.includes('--reconcile-interrupted')){for(const run of store.list().filter(r=>['running','preparing'].includes(r.status))){if(Date.now()-run.heartbeatAt<120000)throw Error('Worker heartbeat is still current.');store.transition(run.id,run.attempt,'interrupted',{failureCode:'operator-reconciled-after-confirming-solver-stopped'});}store.close();}
 else{const result=await processOne({store,registry,dataRoot});console.info(JSON.stringify({event:'scenario-worker-pass',claimed:!!result,status:result?.status||'idle'}));store.close();}
}
