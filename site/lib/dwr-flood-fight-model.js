/** Restrict a publisher layer to a successful complete-county ID query. Never fall back to statewide data. */
export function fresnoDefinition(objectIdField, ids, where = '1=1') {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(objectIdField || '')) throw new Error('Source object-ID field is unavailable');
  if (!Array.isArray(ids) || ids.length > 20000 || ids.some(id => !Number.isSafeInteger(id) || id < 0)) throw new Error('Fresno source scope could not be verified');
  const unique = [...new Set(ids)].sort((a, b) => a - b);
  return unique.length ? `(${where}) AND ${objectIdField} IN (${unique.join(',')})` : '1=0';
}

/** Inventory dates are publisher calendar dates, formatted explicitly in UTC rather than shifted a day locally. */
export function inspectionDate(value) {
  return Number.isFinite(value) ? new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' }).format(value) : 'Unknown';
}

/** Source quantities preserve null versus an explicitly reported zero. */
export function inventoryQuantity(value) {
  return Number.isFinite(value) && value >= 0 ? new Intl.NumberFormat('en-US').format(value) : 'Unknown';
}

/** Reject a service response that escaped the independently verified county ID scope. */
export function assertScopedInventory(features, ids, objectIdField) {
  const expected=new Set(ids),returned=new Set();
  if(!Array.isArray(features))throw new Error('Supply inventory response is missing');
  for(const feature of features){const id=feature.attributes?.[objectIdField];if(!expected.has(id)||returned.has(id))throw new Error('Supply response escaped Fresno scope or contains duplicate IDs');returned.add(id);}
  if(returned.size!==expected.size)throw new Error('Supply inventory is incomplete');
  return features;
}
