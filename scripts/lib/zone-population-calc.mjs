import clipping from 'polygon-clipping';
import geodesic from 'geographiclib-geodesic';
import {arcgisToGeoJSON} from '@terraformer/arcgis';
import {summarizeZoneAcs} from '../../site/lib/zone-acs-model.js';

const MAX_SEGMENT_DEGREES=.0005,TOLERANCE=1e-6;

/** The county feed also contains a neighboring county context polygon. */
export function selectFresnoZones(rows){
  const included=[],excluded=[];
  for(const row of rows){
    if(row.name==='San Benito County')excluded.push({key:row.key,name:row.name,reason:'Neighboring-county context polygon; not a Fresno County evacuation zone.'});
    else if(/^[A-Z]\d+[A-Z0-9]*(?: (?:North|south)(?: of Elwood)?)?$/.test(row.name))included.push(row);
    else throw Error('Unclassified county zone name requires scope review: '+row.name);
  }
  return {included,excluded};
}

/** Ellipsoidal square metres; densify straight geographic segments consistently. */
export function polygonArea(multi){
  let total=0;
  for(const polygon of multi){let value=0;
    for(let r=0;r<polygon.length;r++){
      const ring=polygon[r],calculator=geodesic.Geodesic.WGS84.Polygon(false);
      for(let i=0;i<ring.length-1;i++){
        const a=ring[i],b=ring[i+1],steps=Math.max(1,Math.ceil(Math.max(Math.abs(b[0]-a[0]),Math.abs(b[1]-a[1]))/MAX_SEGMENT_DEGREES));
        for(let j=0;j<steps;j++)calculator.AddPoint(a[1]+(b[1]-a[1])*j/steps,a[0]+(b[0]-a[0])*j/steps);
      }
      const area=Math.abs(calculator.Compute(false,true).area);if(!Number.isFinite(area))throw Error('Nonfinite ellipsoidal area.');value+=(r?-1:1)*area;
    }
    if(value<-.01)throw Error('Polygon holes exceed exterior area.');total+=Math.max(0,value);
  }
  return total;
}

const bounds=multi=>{const b=[Infinity,Infinity,-Infinity,-Infinity];for(const p of multi)for(const r of p)for(const [x,y]of r){b[0]=Math.min(b[0],x);b[1]=Math.min(b[1],y);b[2]=Math.max(b[2],x);b[3]=Math.max(b[3],y);}return b;};
const boxesMeet=(a,b)=>a[0]<=b[2]&&a[2]>=b[0]&&a[1]<=b[3]&&a[3]>=b[1];
export const overlap=(a,b)=>boxesMeet(a.box,b.box)?clipping.intersection(a.shape,b.shape):[];
// Relative topology check only; these angular values are never used as ground area.
const topologyArea=multi=>multi.reduce((sum,p)=>sum+p.reduce((v,ring,index)=>{const [ox,oy]=ring[0];let a=0;for(let i=0;i<ring.length-1;i++)a+=(ring[i][0]-ox)*(ring[i+1][1]-oy)-(ring[i+1][0]-ox)*(ring[i][1]-oy);return v+(index?-1:1)*Math.abs(a/2);},0),0);

/** Preserve multipart/hole meaning. Reject material topology repairs instead of guessing. */
export function prepareGeometry(geometry,id){
  if(geometry.spatialReference?.wkid!==4326)throw Error(id+': unexpected CRS.');
  const geojson=arcgisToGeoJSON(geometry),original=geojson.type==='Polygon'?[geojson.coordinates]:geojson.type==='MultiPolygon'?geojson.coordinates:null;
  if(!original?.length)throw Error(id+': polygon missing.');
  for(const p of original)for(const ring of p){
    if(ring.length<4||ring[0][0]!==ring.at(-1)[0]||ring[0][1]!==ring.at(-1)[1])throw Error(id+': unclosed or empty ring.');
    if(ring.some(([x,y])=>!Number.isFinite(x)||!Number.isFinite(y)||x< -125||x> -114||y<32||y>43))throw Error(id+': unexpected California coordinates.');
  }
  const rawArea=topologyArea(original),shape=clipping.union(original),normalizedArea=topologyArea(shape),area=polygonArea(shape);
  if(!area||Math.abs(normalizedArea-rawArea)>Math.max(1e-16,rawArea*1e-7))throw Error(id+': topology changes its area; review source geometry.');
  return {shape,area,box:bounds(shape),geojson:{type:'MultiPolygon',coordinates:shape}};
}

/** Cache block-to-tract intersections once. Bounding boxes bound the small county scan. */
export function preparePopulation(tracts,blocks,onProgress=()=>{}){
  const blockShapes=blocks.map(b=>({...b,...prepareGeometry(b.geometry,b.id)})),prepared=[];
  if(new Set(blockShapes.map(b=>b.id)).size!==blocks.length)throw Error('Duplicate population blocks.');
  for(const source of tracts){
    const tract={...source,...prepareGeometry(source.geometry,source.id),parts:[],denominator:0,missing:0};
    for(const other of prepared)if(boxesMeet(tract.box,other.box)&&polygonArea(overlap(tract,other))>Math.min(tract.area,other.area)*TOLERANCE)throw Error('Census tract coverage overlaps.');
    for(const block of blockShapes){
      if(!boxesMeet(tract.box,block.box))continue;
      const shape=overlap(tract,block),area=polygonArea(shape);if(!area)continue;
      if(area>block.area*(1+TOLERANCE))throw Error('Block intersection exceeds source area.');
      const part={id:block.id,shape,box:bounds(shape),population:block.population,blockArea:block.area};tract.parts.push(part);
      if(block.population===null)tract.missing++;else tract.denominator+=block.population*Math.min(1,area/block.area);
    }
    prepared.push(tract);onProgress({tracts:prepared.length,parts:tract.parts.length});
  }
  return prepared;
}

/** Same allocation contract as selected-zone planning; no whole-tract summing shortcut. */
export function calculatePreparedZone(zone,tracts){
  const target=prepareGeometry(zone.geometry,zone.key),rows=[];
  for(const tract of tracts){
    if(!boxesMeet(target.box,tract.box))continue;
    const clippedArea=polygonArea(overlap(tract,target));if(!clippedArea)continue;
    if(clippedArea>tract.area*(1+TOLERANCE))throw Error('Zone-to-tract area exceeds source.');
    const measure=tract.measures[0],row={id:tract.id,name:tract.name,population:measure.estimate,moe:measure.moe,weight:null,method:'2020 block population pattern',baselineTotal:tract.denominator,baselineWithin:null,blocks:tract.parts.length,reason:null};
    if(clippedArea/tract.area>=1-1e-9){row.weight=1;row.method='Whole tract';}
    else if(tract.missing)row.reason='Missing 2020 block population prevents allocation.';
    else{
      let numerator=0;
      for(const part of tract.parts){if(!boxesMeet(part.box,target.box))continue;const area=polygonArea(overlap(part,target));if(area>part.blockArea*(1+TOLERANCE))throw Error('Zone block share exceeds source.');numerator+=part.population*Math.min(1,area/part.blockArea);}
      row.baselineWithin=numerator;
      if(tract.denominator<=0||numerator<=0)row.reason='No populated 2020 pattern in this partial overlap; newer development is unknown.';
      else if(numerator>tract.denominator*(1+TOLERANCE))throw Error('Zone population weight exceeds tract denominator.');
      else row.weight=Math.min(1,numerator/tract.denominator);
    }
    rows.push(row);
  }
  return {...summarizeZoneAcs(rows),geojson:target.geojson};
}
