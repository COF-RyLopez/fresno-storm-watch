/** Fixed, read-only county source contract. No feature records or credentials are bundled. */
export const DRAINAGE_URL='https://gisprod10.co.fresno.ca.us/server/rest/services/PublicWorks/FMFCD/MapServer';
export const DRAINAGE_LIMIT=5000;
export const DRAINAGE_MAX_AGE=10*60_000;
export const DRAINAGE_LAYERS=Object.freeze([
  {id:17,kind:'basin',title:'Basins',geometry:'esriGeometryPolygon',fields:['BASIN','SUBTYPE','REV','MODIFIEDDATE']},
  {id:0,kind:'pump',title:'Pumps',geometry:'esriGeometryPoint',fields:['DA','SUBTYPE','MODIFIEDDATE']},
  {id:16,kind:'catchment',title:'Drainage areas',geometry:'esriGeometryPolygon',fields:['DRAINAGE','MODIFIEDDATE']}
]);
export const DRAINAGE_COLORS=Object.freeze({existing:'#65cad1',proposed:'#f2c572',other:'#b3bac3',catchment:'#a7a2c3'});
/** @param {object} config @param {object|null} session @returns {Promise<void>} Match existing EOC viewer access; source permissions still apply independently. */
export async function authorizeDrainage(config,session){
  if(!config.enabled||!config.orgId||session?.portal?.id!==config.orgId)throw Error('County AGOL sign-in is required.');
  let groups;try{groups=await session.portal.user.fetchGroups();}catch{throw Error('Private EOC membership could not be verified. Sign in again before loading drainage layers.');}
  if(config.owner!==session.username&&!groups.some(g=>g.id===config.groups?.viewers))throw Error('The private EOC viewer group is required. Ask the county GIS administrator for access.');
}
/** @param {object} spec @param {object} metadata @returns {string} Reject schema drift before reading private features. */
export function drainageSchema(spec,metadata){
  const oid=metadata.fields?.find(f=>f.type==='esriFieldTypeOID')?.name;
  if(metadata.geometryType!==spec.geometry||!oid||spec.fields.some(name=>!metadata.fields.some(f=>f.name===name)))throw Error('FMFCD layer schema changed; GIS must verify the connection.');
  return oid;
}
/** @param {object} spec @param {object} feature @param {string} oid @returns {object} Source object IDs are session-only selection keys, never persistent asset IDs. */
export function drainageRecord(spec,feature,oid){
  const a=feature.attributes,g=feature.geometry;
  if(!Number.isSafeInteger(a?.[oid])||a[oid]<1||!g)throw Error('FMFCD record identifier or geometry is missing.');
  const coord=p=>Array.isArray(p)&&p.length>=2&&Number.isFinite(p[0])&&Number.isFinite(p[1])&&p[0]>=-125&&p[0]<=-114&&p[1]>=32&&p[1]<=43;
  if(spec.geometry==='esriGeometryPoint'?!coord([g.x,g.y]):!Array.isArray(g.rings)||!g.rings.length||g.rings.some(r=>r.length<4||r.some(p=>!coord(p))||r[0][0]!==r.at(-1)[0]||r[0][1]!==r.at(-1)[1]))throw Error('FMFCD geometry is invalid or outside the expected California coordinate range.');
  const subtype=a.SUBTYPE,category=spec.kind==='catchment'?'catchment':subtype===1?'existing':subtype===0?'proposed':'other';
  const code=String(a.BASIN??a.DA??a.DRAINAGE??'').trim();
  return {key:`fmfcd:${spec.id}:${a[oid]}`,layerId:spec.id,objectId:a[oid],kind:spec.kind,category,subtype,code,
    name:`${spec.kind==='basin'?'Basin':spec.kind==='pump'?'Pump':'Drainage area'} ${code||'· code not supplied'}${spec.kind==='pump'?' · record '+a[oid]:''}`,
    status:category==='existing'?'Existing in source · operation unconfirmed':category==='proposed'?'Proposed / future · not confirmed built':category==='other'?(subtype===2?'Caltrans classification · operation unconfirmed':subtype===3?'Other classification · operation unconfirmed':'Unclassified · verify with FMFCD'):'Master-plan drainage boundary',
    updated:Number.isFinite(a.MODIFIEDDATE)?a.MODIFIEDDATE:null,revision:Number.isFinite(a.REV)?a.REV:null,
    geometry:{...(spec.geometry==='esriGeometryPoint'?{x:g.x,y:g.y}:{rings:g.rings}),spatialReference:{wkid:4326}}};
}
/** @param {object[]} rows @returns {object} Counts are source records; polygon pieces and co-located pumps are not physical-site counts. */
export function drainageCounts(rows){return {basins:rows.filter(r=>r.kind==='basin'&&r.category==='existing').length,pumps:rows.filter(r=>r.kind==='pump'&&r.category==='existing').length,proposed:rows.filter(r=>r.category==='proposed').length,other:rows.filter(r=>r.category==='other').length,catchments:rows.filter(r=>r.kind==='catchment').length};}
