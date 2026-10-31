import {powerGeometry,bounds as pointBounds} from './power-geometry.js';

const METRES_PER_DEGREE=111320;
const MINIMUM_SPAN_METRES=180;
const FIT_PADDING=1.2;

/** Fit every WGS84 outline with proportional breathing room, without a kilometre-wide fixed margin.
 * A small minimum span avoids diving into a single roof. This is a display extent, not a hazard buffer.
 */
export function powerFocusExtent(geometries){
  if(!geometries.length)return null;
  const shapes=geometries.map(powerGeometry),polygons=shapes.filter(g=>g.rings);
  const points=(polygons.length?polygons:shapes).flatMap(g=>g.rings?g.rings.flat():[[g.x,g.y]]);
  const bounds=pointBounds(points);
  const x=(bounds[0]+bounds[2])/2,y=(bounds[1]+bounds[3])/2;
  const halfWidth=Math.max(bounds[2]-bounds[0],MINIMUM_SPAN_METRES/(METRES_PER_DEGREE*Math.max(.01,Math.cos(y*Math.PI/180))))*FIT_PADDING/2;
  const halfHeight=Math.max(bounds[3]-bounds[1],MINIMUM_SPAN_METRES/METRES_PER_DEGREE)*FIT_PADDING/2;
  return {xmin:x-halfWidth,ymin:y-halfHeight,xmax:x+halfWidth,ymax:y+halfHeight,spatialReference:{wkid:4326}};
}
