import {pointInRings, powerGeometry, powerScope, bounds} from './power-geometry.js';
import {POWER_FEEDS, POWER_STATES, powerHealth, powerRowIssues} from './power-model.js';

export const FACILITY_MAX_AGE = 10 * 60_000;
export const FACILITY_LIMIT = 5000;
export const FACILITY_COLORS = {outage:'#ef89ba',watch:'#edbd62',verify:'#b4bdc6',unmatched:'#93bfc5'};
const present = value => value !== null && value !== undefined && String(value).trim() !== '';

/** @param {string} value @returns {string} County service URLs only; credentials and query strings are never accepted. */
export function facilityService(value,allowRoot=false) {
  const url = new URL(value);
  const path=allowRoot&&!/\/\d+$/.test(url.pathname)?`${url.pathname}/0`:url.pathname;
  const agol = /^services\d*\.arcgis\.com$/.test(url.hostname) && /^\/ibgDyuD2DLBge82s\/arcgis\/rest\/services\/[^/]+\/(FeatureServer|MapServer)\/\d+$/i.test(path);
  const enterprise = ['gisportal.co.fresno.ca.us','gisprod10.co.fresno.ca.us'].includes(url.hostname) && /^\/[^/]+\/rest\/services\/.+\/(FeatureServer|MapServer)\/\d+$/i.test(path);
  if (url.protocol !== 'https:' || url.port || url.username || url.password || url.search || url.hash || (!agol && !enterprise)) throw new Error('Use a county HTTPS feature-layer URL ending in FeatureServer/number or MapServer/number, without a token or query string.');
  return url.href;
}

/** @param {object} metadata @param {object} mapping @returns {string[]} Validate fields against the publisher schema. */
export function facilityFields(metadata, mapping) {
  if (!['esriGeometryPoint','esriGeometryPolygon'].includes(metadata.geometryType)) throw new Error('This pilot requires a point or building-footprint polygon layer.');
  const fields = new Map((metadata.fields || []).map(f => [f.name, f]));
  for (const name of ['id','name']) if (!mapping[name] || !fields.has(mapping[name])) throw new Error('Choose a stable site ID and a site name field.');
  if (fields.get(mapping.id).type === 'esriFieldTypeOID') throw new Error('Use a GlobalID or maintained site ID; ObjectID is not a stable site identity.');
  for (const field of Object.values(mapping).filter(Boolean)) if (!fields.has(field)) throw new Error('A mapped field is not in the layer schema.');
  return [...new Set([metadata.objectIdField, ...Object.values(mapping)].filter(Boolean))];
}

/** @param {object} feature @param {object} source @param {object} metadata @returns {object} Normalize a point or footprint without interpreting unconfirmed backup-power codes. */
export function normalizeFacility(feature, source, metadata) {
  const a = feature.attributes || {}, m = source.fields;
  if (!present(a[m.id])) throw new Error('Missing stable site ID');
  const g = powerGeometry(feature.geometry);
  const display = key => {
    const field = metadata.fields.find(f => f.name === m[key]), raw = a[m[key]];
    if (!present(raw)) return null;
    if (field?.type === 'esriFieldTypeDate') return Number.isFinite(Number(raw)) ? Number(raw) : null;
    const domain = field?.domain?.codedValues?.find(c => String(c.code) === String(raw));
    return String(domain?.name ?? raw).slice(0,500);
  };
  const stable = String(a[m.id]).trim();
  const global = metadata.fields.find(f => f.name === m.id)?.type === 'esriFieldTypeGlobalID';
  return {key:global ? `global:${stable.toLowerCase()}` : `${source.url}|${stable}`,id:stable,name:display('name') || `Site ${stable}`,
    kind:source.kind,sourceId:source.url,sourceTitle:source.title,geometry:g,owner:display('owner'),backup:display('backup'),
    runtime:display('runtime'),load:display('load'),updated:display('updated'),reference:display('reference'),status:display('status'),assetType:display('assetType'),fetched:source.lastSuccess};
}

/** @param {object[]} sites @param {object[]} rows @param {object[]} feeds @param {Map} previous @param {number} now @returns {object}
 * Point/polygon intersections with envelope rejection before ring tests. No distance buffers, circuit inference or safety score.
 * Work is bounded by the 5,000-record connection limit; polygon bounds avoid most vertex scans.
 */
export function assessFacilities(sites, rows, feeds, previous = new Map(), now = Date.now()) {
  const footprints = rows.map(row => ({row,polygons:row.geometries.filter(g=>g.rings).map(g=>({rings:g.rings,
    box:bounds(g.rings.flat())}))}));
  const feedGaps = POWER_FEEDS.map(f=>powerHealth(feeds.find(d=>d.id===f.id),now)).filter(Boolean);
  const unique = new Map();
  for (const site of sites) {
    if (unique.has(site.key)) { unique.get(site.key).duplicate = true; continue; }
    unique.set(site.key,{...site});
  }
  const result = [...unique.values()].map(site => {
    const {x,y} = site.geometry,siteArea=site.geometry.rings?powerScope(site.geometry):null;
    const matches = footprints.filter(f=>f.polygons.some(p=>siteArea?siteArea.intersects({rings:p.rings}):x>=p.box[0]&&x<=p.box[2]&&y>=p.box[1]&&y<=p.box[3]&&pointInRings([x,y],p.rings)))
      .map(f=>({...f.row,health:powerHealth(feeds.find(d=>d.id===f.row.feedId),now),issues:powerRowIssues(f.row,now)}));
    const active = matches.filter(r=>!['restored','cancelled'].includes(r.status));
    const uncertain = !!site.sourceError || site.duplicate || !site.fetched || now-site.fetched>FACILITY_MAX_AGE || site.fetched>now+60_000 || active.some(r=>r.health||r.issues.some(note=>/passed|ended|24 hours|future|differ|conflict|Unrecognized/i.test(note))||r.status==='unknown');
    const old = previous.get(site.key);
    const followup = !active.length && !!(old?.active?.length || old?.followup);
    const tone = uncertain && active.length ? 'verify' : active.some(r=>['psps','outage'].includes(r.status)) ? 'outage' : active.length ? 'watch' : followup||matches.length ? 'verify' : 'unmatched';
    const label = tone==='outage'?'Possible outage impact':tone==='watch'?'PSPS planning review':tone==='verify'?'Site power needs verification':feedGaps.length||uncertain?'Match incomplete':'No published area match';
    const notes = [];
    if (site.sourceError) notes.push('Site source check failed; last retrieved location retained.');
    if (!site.fetched||now-site.fetched>FACILITY_MAX_AGE||site.fetched>now+60_000) notes.push('Site retrieval overdue or unverified.');
    if (site.duplicate) notes.push('Repeated GlobalID across connected layers; reconcile the site registry. Counted once.');
    if (followup) notes.push('A previous overlap changed or is no longer returned. Confirm site power before closing the follow-up.');
    if (feedGaps.length) notes.push(`${feedGaps.length} utility feed checks unavailable or overdue; absence of an overlap is inconclusive.`);
    return {site,matches,active,followup,tone,label,notes,review:active.length>0||followup||matches.length>0,
      next:site.kind==='Generator / fuel asset'?'Contact the asset owner; verify purpose, condition, fuel availability and the facility served. This inventory record does not confirm backup power at a nearby facility.':site.backup?'Contact the owner; verify backup operation, critical load, fuel/runtime and resource needs.':'Contact the owner; establish backup-power availability, critical load, fuel/runtime and resource needs.'};
  }).sort((a,b)=>['outage','watch','verify','unmatched'].indexOf(a.tone)-['outage','watch','verify','unmatched'].indexOf(b.tone)||a.site.name.localeCompare(b.site.name));
  return {sites:result,feedGaps:feedGaps.length,pointOnly:rows.filter(r=>!['restored','cancelled'].includes(r.status)&&!r.geometries.some(g=>g.rings)).length,
    review:result.filter(r=>r.review).length,overlap:result.filter(r=>r.active.length).length,unknownBackup:result.filter(r=>r.review&&r.site.kind!=='Generator / fuel asset'&&!r.site.backup).length};
}

/** @returns {object[]} Fictional site points for the isolated power exercise only. */
export function facilityExercise(now=Date.now()) {
  return [
    ['F1','EXERCISE · county facility','County facility',-119.70,36.92,null],
    ['P1','EXERCISE · pump station','Pump station',-119.69,36.94,'Generator listed — readiness unverified'],
    ['S1','EXERCISE · shelter candidate','Shelter',-119.50,37.08,null],
    ['F2','EXERCISE · unmatched facility','County facility',-119.90,36.75,null]
  ].map(([id,name,kind,x,y,backup])=>({key:`exercise:${id}`,id,name,kind,geometry:{x,y,spatialReference:{wkid:4326}},owner:'EXERCISE facilities team',backup,
    sourceId:'exercise',sourceTitle:'Fictional sites — no county asset data',fetched:now,updated:now-3600000,runtime:null,load:null}));
}
