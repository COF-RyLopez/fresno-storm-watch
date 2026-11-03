/** Read-only report references. Validation never moves, snaps or merges a location. */
export function reportedFeatures(collection){
  if(collection?.type!=='FeatureCollection'||!Array.isArray(collection.features)||!collection.features.length)throw new Error('Reported locations are missing.');
  const ids=new Set();
  const coordinate=p=>Array.isArray(p)&&p.length>=2&&Number.isFinite(p[0])&&Number.isFinite(p[1])&&Math.abs(p[0])<=180&&Math.abs(p[1])<=90;
  for(const f of collection.features){
    const p=f.properties,g=f.geometry;
    if(f.type!=='Feature'||!p)throw new Error('Invalid reported location.');
    for(const key of ['id','name','section','source','reported_text','position_status','position_basis','confirmation'])if(typeof p[key]!=='string'||!p[key].trim())throw new Error(`Missing ${key} in reported locations.`);
    if(ids.has(p.id))throw new Error(`Duplicate reported location: ${p.id}`);ids.add(p.id);
    if('photo_links' in p)throw new Error('Private photo links must not be included in the shared map.');
    if(typeof p.has_reported_coordinate!=='boolean')throw new Error(`Missing coordinate classification: ${p.id}`);
    const valid=g?.type==='Point'?coordinate(g.coordinates):g?.type==='MultiPoint'?Array.isArray(g.coordinates)&&g.coordinates.length>0&&g.coordinates.every(coordinate):g?.type==='MultiLineString'?Array.isArray(g.coordinates)&&g.coordinates.length>0&&g.coordinates.every(line=>Array.isArray(line)&&line.length>=2&&line.every(coordinate)):false;
    if(!valid)throw new Error(`Invalid coordinate geometry: ${p.id}`);
  }
  return collection.features;
}

/** Each feature is one report, including features with alternative point candidates. */
export function filterReports(features,{source='all',section='all',query=''}={}){
  const q=query.trim().toLowerCase();
  return features.filter(({properties:p})=>(!['d1','oes'].includes(source)||(source==='d1')===p.id.startsWith('D1-'))&&(section==='all'||p.section===section)&&(!q||[p.id,p.name,p.reported_text,p.nearest_county_road_context].join(' ').toLowerCase().includes(q)));
}
