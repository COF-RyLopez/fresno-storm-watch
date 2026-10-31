/** Shared browser/service contracts. Operational data never belongs in the public catalog. */
export const canonical=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
export const validId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(value);
const requireValue=(ok,message)=>{if(!ok)throw Error(message);};
/** Fail closed: only model-owner-approved, baseline-tested templates may compute. */
export function runnable(model){return !!(model?.kind==='hydraulic-template'&&model.enabled===true&&model.review?.status==='approved'&&model.review?.reviewer&&model.baseline?.passed===true&&/^[a-f0-9]{64}$/.test(model.baseline.packageHash||'')&&model.solver?.version&&model.coverage?.geometry&&model.spatialReference?.horizontal&&model.spatialReference?.vertical&&model.spatialReference?.verticalUnits&&Array.isArray(model.parameters)&&model.parameters.length>0);}
export const modelFitsArea=(model,areaId)=>areaId==='model-domain'||!!model?.coverage?.watchAreas?.includes(areaId);
export function validateModel(model){
 requireValue(validId(model?.id)&&typeof model.version==='string'&&model.version.length>0&&model.version.length<=80&&model.label,'Invalid model identity.');
 const names=new Set();for(const p of model.parameters||[]){requireValue(validId(p.id)&&!names.has(p.id)&&p.label&&p.units&&p.description,'Invalid model parameter.');names.add(p.id);requireValue([p.min,p.max,p.baseline].every(Number.isFinite)&&p.min<=p.baseline&&p.baseline<=p.max,'Parameter baseline/range invalid.');requireValue(['inflow','release','stage','timing','rainfall'].includes(p.kind),'Unsupported parameter kind.');if(p.kind==='rainfall')requireValue(model.capabilities?.rainfallRunoff===true,'Rainfall requires a reviewed rainfall/runoff linkage.');}
 return model;
}
/** Freeze a bounded request; no paths, scripts, arbitrary geometry or live-source URLs are accepted. */
export function validateRun(input,model){
 validateModel(model);requireValue(runnable(model),'This model is not enabled for custom runs.');
 requireValue(input&&typeof input==='object'&&!Array.isArray(input),'Scenario request required.');
 requireValue(Object.keys(input).every(k=>['requestId','modelId','modelVersion','areaId','parameters','title','sourceSnapshots'].includes(k)),'Unexpected request field.');
 requireValue(validId(input.areaId)&&modelFitsArea(model,input.areaId),'The selected area is outside this template’s reviewed watch-area coverage. Choose its model domain or request coverage.');
 requireValue(validId(input.requestId)&&input.modelId===model.id&&input.modelVersion===model.version,'Request/model version mismatch.');
 requireValue(typeof input.title==='string'&&input.title.trim().length>0&&input.title.length<=160,'Use a scenario name of 1–160 characters.');
 const values=input.parameters;requireValue(values&&typeof values==='object'&&!Array.isArray(values),'Parameter values required.');
 requireValue(Object.keys(values).length===model.parameters.length&&Object.keys(values).every(k=>model.parameters.some(p=>p.id===k)),'Only the template’s approved inputs are accepted.');
 for(const p of model.parameters)requireValue(Number.isFinite(values[p.id])&&values[p.id]>=p.min&&values[p.id]<=p.max,`${p.label}: enter ${p.min}–${p.max} ${p.units}.`);
 // Source snapshots are identifiers of already frozen service-side data, never caller-supplied observations.
 requireValue(Array.isArray(input.sourceSnapshots)&&input.sourceSnapshots.length===0,'Source snapshot selection is not enabled for this first adapter.');
 return structuredClone(input);
}
/** Numeric outputs and map previews have different roles; previews cannot be used as depth measurements. */
export function validateResult(result,run,model){
 requireValue(result?.schemaVersion===1&&result.runId===run.id&&result.modelId===model.id&&result.modelVersion===model.version,'Result identity mismatch.');
 requireValue(result.environment==='exercise'&&result.hypothetical===true,'Scenario classification missing.');
 requireValue(canonical(result.inputs)===canonical(run.input),'Result did not preserve frozen inputs.');
 requireValue(result.validation?.passed===true&&Array.isArray(result.validation.checks)&&result.validation.checks.length>0,'Output checks did not pass.');
 requireValue(canonical(result.spatialReference)===canonical(model.spatialReference),'Output reference/units mismatch.');
 requireValue(result.solver?.version===model.solver.version&&result.packageHash===model.baseline.packageHash,'Solver/package mismatch.');
 requireValue(Array.isArray(result.frames)&&result.frames.length>=2&&result.frames.every((f,i)=>Number.isFinite(f.hour)&&f.hour>=0&&(!i||f.hour>result.frames[i-1].hour)),'Model frame times must increase.');
 requireValue(Array.isArray(result.artifacts)&&result.artifacts.length>0,'Result artifacts missing.');
 const ids=new Set();for(const a of result.artifacts){requireValue(validId(a.id)&&!ids.has(a.id)&&typeof a.file==='string'&&/^[A-Za-z0-9_./-]+$/.test(a.file)&&!a.file.split('/').includes('..')&&!a.file.startsWith('/')&&/^[a-f0-9]{64}$/.test(a.sha256)&&Number.isSafeInteger(a.bytes)&&a.bytes>0,'Invalid result artifact.');ids.add(a.id);requireValue(['image/png','image/webp','image/tiff','application/json','application/vnd.apache.parquet','application/octet-stream'].includes(a.mediaType),'Unsupported artifact type.');}
 for(const f of result.frames)requireValue(ids.has(f.preview)&&ids.has(f.depth),'Frame must reference a preview and numeric depth asset.');
 requireValue(result.baseline?.packageHash===model.baseline.packageHash&&Array.isArray(result.baseline.frames)&&result.baseline.frames.length===result.frames.length&&result.baseline.frames.every((f,i)=>f.hour===result.frames[i].hour&&ids.has(f.preview)&&ids.has(f.depth)),'A frozen baseline with the same time steps and numeric depth artifacts is required.');
 for(const key of [result.exposurePreview,result.baseline.exposurePreview].filter(Boolean))requireValue(ids.has(key)&&result.artifacts.find(a=>a.id===key).mediaType==='application/json','Exposure preview must reference a verified JSON artifact.');
 requireValue(result.previewExtent&&Number.isFinite(result.previewExtent.wkid)&&['xmin','ymin','xmax','ymax'].every(k=>Number.isFinite(result.previewExtent[k]))&&result.previewExtent.xmin<result.previewExtent.xmax&&result.previewExtent.ymin<result.previewExtent.ymax,'Preview extent missing.');
 return result;
}
