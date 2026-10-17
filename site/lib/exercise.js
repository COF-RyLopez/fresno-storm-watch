/** Fictional records. Used only when the user explicitly opens ?exercise=1. */
export function exerciseBatches(scenario, clock) {
  const iso = offset => new Date(clock + offset).toISOString();
  const polygon = (x, y, width) => ({ rings: [[[x,y],[x,y+0.28],[x+width,y+0.28],[x+width,y],[x,y]]], spatialReference: { wkid: 4326 } });
  const record = (id, type, geometry, revision = false) => ({ attributes: {
    objectid: id, cap_id: `urn:oid:EXERCISE-${id}`, prod_type: `[EXERCISE] ${type}`,
    issuance: iso(revision ? -60_000 : -1_800_000), onset: iso(-600_000),
    expiration: iso(scenario === 'expired' ? -1 : 7_200_000), wfo: 'EXERCISE', idp_ingestdate: clock - 30_000, msg_type: 'NEW'
  }, geometry });
  if (scenario === 'failure') throw new Error('Exercise: simulated NWS connection failure.');
  if (scenario === 'empty') return [{ county: 'Fresno', features: [] }];
  const watch = record(1, 'Flood Watch', polygon(-120.16, 36.82, 0.38), scenario === 'revision');
  const advisory = record(2, 'Wind Advisory', polygon(-119.74, 36.42, 0.40));
  const features = [watch, advisory];
  if (scenario === 'warning') features.push(record(3, 'Flash Flood Warning', polygon(-119.9, 36.72, 0.20)));
  if (scenario === 'duplicate') features.push(structuredClone(watch));
  return [{ county: 'Fresno', features }, { county: 'Madera', features: [structuredClone(watch)] }];
}
