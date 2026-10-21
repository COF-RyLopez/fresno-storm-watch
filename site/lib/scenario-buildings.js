/** Bounded display derivative only. Full-fidelity records remain in private GeoParquet. */
export function validateScenarioBuildings(data,maxBuildings=5000){
 if(data?.type!=='FeatureCollection'||!Array.isArray(data.features)||data.features.length>maxBuildings)throw Error('Building preview needs a bounded/tiled subset (maximum 5,000 footprints).');
 const ids=new Set();let vertices=0;
 for(const f of data.features){const p=f.properties,g=f.geometry;if(!p?.building_id||ids.has(p.building_id)||!['Polygon','MultiPolygon'].includes(g?.type))throw Error('Building preview identity/geometry invalid.');ids.add(p.building_id);const polygons=g.type==='Polygon'?[g.coordinates]:g.coordinates;if(!polygons.length)throw Error('Empty building polygon.');for(const polygon of polygons)for(const ring of polygon){if(ring.length<4||ring[0][0]!==ring.at(-1)[0]||ring[0][1]!==ring.at(-1)[1])throw Error('Building ring must close.');for(const xy of ring){if(!Number.isFinite(xy[0])||!Number.isFinite(xy[1])||Math.abs(xy[0])>180||Math.abs(xy[1])>90)throw Error('Building preview must use WGS84 longitude/latitude.');if(++vertices>250000)throw Error('Building preview requires vector tiling.');}}
  if(p.display_height_m!==null&&p.display_height_m!==undefined&&(!Number.isFinite(p.display_height_m)||p.display_height_m<=0))throw Error('Building height must be positive meters or unknown.');
  if(p.depth_m!==undefined&&(!Array.isArray(p.depth_m)||p.depth_m.some(d=>d!==null&&(!Number.isFinite(d)||d<0))))throw Error('Modeled building depth samples must be meters or unknown.');
 }
 return data.features;
}
export function buildingFrame(properties,index){const d=properties.depth_m?.[index];return {height:Number.isFinite(properties.display_height_m)?properties.display_height_m:null,depth:Number.isFinite(d)?d:null,status:!Number.isFinite(d)?'Modeled depth unknown':d>0?'Modeled water at sampled building location':'No modeled water at this sample/time'};}
