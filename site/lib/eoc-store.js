import {loadSdk} from './map.js?v=0.74.0-infra-weather';
import {COLLECTIONS,emptyRecords,validateEvent,validatePayload,canonical} from './eoc-model.js?v=0.73.1';
export const GROUP_FOR={incidents:'recorders',periods:'coordinators',reports:'reporters',verifications:'reviewers',coordination:'coordinators',checklists:'coordinators',staging:'reviewers',briefings:'coordinators',approvals:'approvers',references:'coordinators',reviews:'reporters'};
const idPattern=/^[a-zA-Z0-9_-]{1,80}$/;
function safeService(url){if(!/^https:\/\/services\d*\.arcgis\.com\/[A-Za-z0-9]+\/arcgis\/rest\/services\/[^?#]+\/FeatureServer\/\d+$/.test(url))throw new Error('Private storage must use configured AGOL hosted table views.');return url;}
/** Some empty ArcGIS tables return null IDs; require an independent zero count. */
export async function privateObjectIds(result,verifyEmpty){
  if(!result||result.error||result.exceededTransferLimit)throw new Error('Private record inventory failed or was truncated.');
  let ids=result.objectIds;
  if(ids===null){const count=await verifyEmpty();if(!count||count.error||count.exceededTransferLimit||count.count!==0)throw new Error('Empty private record inventory could not be verified.');ids=[];}
  if(!Array.isArray(ids)||ids.some(id=>!Number.isSafeInteger(id)||id<1)||new Set(ids).size!==ids.length)throw new Error('Incomplete private record inventory.');
  return ids;
}
function decode(feature,collection,layer){
  const a=feature.attributes,track=layer.editFieldsInfo||layer.sourceJSON?.editFieldsInfo||{},author=a[track.creatorField],created=a[track.creationDateField];
  if(!author||!Number.isFinite(created))throw new Error('Editor-tracked author/time missing; private dataset is not ready.');
  const record={id:a.event_id,entity:a.entity_id,incident:a.incident_id,collection,supersedes:JSON.parse(a.supersedes),payload:JSON.parse(a.payload),author,created};
  for(const k of ['id','entity','incident'])if(!idPattern.test(record[k]))throw new Error('Private record identifier invalid.');
  validatePayload(collection,record.payload);return record;
}
export async function createPrivateStore(config,session){
  if(!config.enabled||config.environment!=='exercise')throw new Error('Private exercise storage is not enabled.');
  if(!config.orgId||session.portal.id!==config.orgId)throw new Error('Sign in with an approved county organization account.');
  const groups=await session.portal.user.fetchGroups(),ids=new Set(groups.map(g=>g.id)),owner=config.owner===session.username;
  if(!owner&&!ids.has(config.groups.viewers))throw new Error('The operational viewer group is required.');
  const [FeatureLayer,request]=await (await loadSdk()).import(['@arcgis/core/layers/FeatureLayer.js','@arcgis/core/request.js']);
  const read={},write={},allowed=new Set();let alive=true;
  for(const name of COLLECTIONS){const settings=config.collections[name];if(!settings?.read||!settings?.write)throw new Error(`Storage for ${name} is not configured.`);read[name]=new FeatureLayer({url:safeService(settings.read),outFields:['*']});if(owner||ids.has(config.groups[GROUP_FOR[name]]))allowed.add(name);}
  const ensure=()=>{if(!alive)throw new Error('Session ended; private records were cleared.');};
  async function query(name,where){
    ensure();const layer=read[name];let stage='table metadata';
    try{
    await layer.load();stage='record query';
    // Private record queries use authenticated POST, avoiding URL payloads and reusable GET cache entries.
    const query=async params=>{const result=await request(`${safeService(config.collections[name].read)}/query`,{method:'post',responseType:'json',cacheBust:true,query:{f:'json',...params}});ensure();if(result.data.error)throw new Error('Private query was denied or failed.');return result.data;};
    const inventory=await query({where,returnIdsOnly:true});stage='record inventory';
    const objectIds=await privateObjectIds(inventory,()=>query({where,returnCountOnly:true}));ensure();const records=[];
    stage='record batch';
    for(let i=0;i<objectIds.length;i+=200){const result=await query({objectIds:objectIds.slice(i,i+200).join(','),outFields:'*',returnGeometry:false});ensure();if(!Array.isArray(result.features)||result.exceededTransferLimit||result.features.length!==Math.min(200,objectIds.length-i))throw new Error('Private query was truncated or records changed; refresh required.');records.push(...result.features.map(f=>decode(f,name,layer)));}
    return records;
    }catch(error){throw Object.assign(new Error('Private query failed.',{cause:error}),{privateDiagnostic:`${name}: ${stage}`});}
  }
  return {
    allowed,username:session.username,
    close(){alive=false;for(const layer of [...Object.values(read),...Object.values(write)])layer.destroy();},
    async incidents(){return query('incidents','1=1');},
    async loadCollection(name,incident){if(!COLLECTIONS.includes(name)||!idPattern.test(incident))throw new Error('Invalid private collection or scope.');return query(name,`incident_id = '${incident}'`);},
    async load(incident){if(!idPattern.test(incident))throw new Error('Invalid incident identifier');const pairs=await Promise.all(COLLECTIONS.map(async name=>[name,await query(name,`incident_id = '${incident}'`)]));ensure();return Object.fromEntries(pairs);},
    async append(event,records){
      ensure();if(!allowed.has(event.collection))throw new Error('Your account is not assigned to this editing group.');validateEvent(event,records);const name=event.collection;
      if(!write[name]){const layer=new FeatureLayer({url:safeService(config.collections[name].write)});await layer.load();ensure();if(!layer.capabilities?.operations?.supportsAdd)throw new Error('The server does not permit adding records to this view.');write[name]=layer;}
      const attributes={event_id:event.id,entity_id:event.entity,incident_id:event.incident,supersedes:JSON.stringify(event.supersedes),payload:JSON.stringify(event.payload)};
      // The same event ID is retained across uncertain retries; a unique server index enforces idempotence.
      try{const result=await write[name].applyEdits({addFeatures:[{attributes}]},{rollbackOnFailureEnabled:true});ensure();if(result.addFeatureResults?.length!==1||result.addFeatureResults[0].error)throw new Error('The server did not confirm the append.');}
      catch(error){ensure();const found=await query(name,`event_id = '${event.id}'`);if(found.length===1&&canonical(found[0].payload)===canonical(event.payload)&&found[0].entity===event.entity)return found[0];throw error;}
      const saved=await query(name,`event_id = '${event.id}'`);if(saved.length!==1)throw new Error('Write receipt could not be reconciled. Retry with the same event ID.');return saved[0];
    }
  };
}
/** Fictional rehearsal in memory only; no remote writes or persistent browser storage. */
export function createExerciseStore(seed=emptyRecords()){
  let data=structuredClone(seed),alive=true;
  return {allowed:new Set(COLLECTIONS),username:'EXERCISE operator',close(){data=emptyRecords();alive=false;},async incidents(){return structuredClone(data.incidents);},async loadCollection(name,incident){if(!alive)throw new Error('Exercise closed');if(!COLLECTIONS.includes(name)||!idPattern.test(incident))throw new Error('Invalid private collection or scope.');return structuredClone(data[name].filter(r=>r.incident===incident));},async load(incident){if(!alive)throw new Error('Exercise closed');return Object.fromEntries(COLLECTIONS.map(k=>[k,structuredClone(data[k].filter(r=>r.incident===incident))]));},async append(event,records){if(!alive)throw new Error('Exercise closed');const same=data[event.collection].find(r=>r.id===event.id);if(same){if(canonical(same.payload)!==canonical(event.payload))throw new Error('Duplicate event ID has different content');return structuredClone(same);}validateEvent(event,records);const saved={...structuredClone(event),created:Date.now(),author:'EXERCISE operator'};data[event.collection].push(saved);return structuredClone(saved);}};
}
