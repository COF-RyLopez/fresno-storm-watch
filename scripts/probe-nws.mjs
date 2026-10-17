/** Optional read-only publisher contract probe. Never runs automatically in CI. */
import { CONFIG } from '../site/config.js';
import { fetchJson } from '../site/lib/nws.js';
import { normalizeAlerts } from '../site/lib/model.js';
const body = new URLSearchParams({ f:'json', where:'1=1', resultRecordCount:'2', returnGeometry:'true', returnZ:'false', outSR:'4326', outFields:'objectid,cap_id,prod_type,issuance,onset,expiration,wfo,idp_ingestdate,msg_type' });
const data = await fetchJson(CONFIG.nwsLayerUrl + '/query', { method:'POST', body });
const alerts = normalizeAlerts([{ county:'Fresno', features:data.features }]);
// This arbitrary national sample validates structure only. It is NOT a regional alert list.
console.log(JSON.stringify({ check:'National sample schema only, not regional coverage', checkedAt:new Date().toISOString(), returned:data.features.length, normalized:alerts.length, spatialReference:data.spatialReference, fields:data.features.map(f => ({ ...f.attributes })) }, null, 2));
if (alerts.length) {
  const official = await fetchJson(alerts[0].sourceUrl);
  console.log(JSON.stringify({ officialSourceLinkWorks:!!official.properties, product:official.properties?.event }));
}
