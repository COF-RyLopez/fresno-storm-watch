/** Shared ArcGIS stand-ins: constructor properties are kept and graphics are recorded. */
export class GraphicsLayer{constructor(p){Object.assign(this,p);this.graphics=[];}removeAll(){this.graphics=[];}add(g){this.graphics.push(g);}addMany(list){this.graphics.push(...list);}}
export class Graphic{constructor(p){Object.assign(this,p);}}
