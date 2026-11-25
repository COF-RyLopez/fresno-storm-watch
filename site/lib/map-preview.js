/** Short visual preview only. Full dated observations remain in the inspector. */
export const previewText=text=>String(text).split('\n').filter(Boolean).slice(0,4).join('\n');

/** Place a screen-space preview inside a map and away from its visible controls. */
export function previewPosition(point,size,viewport,obstacles=[]){
 const margin=8,gap=14,width=Math.max(0,Math.min(size.width,viewport.width-2*margin)),height=Math.max(0,Math.min(size.height,viewport.height-2*margin));
 const clamp=(n,max)=>Math.max(margin,Math.min(n,max));
 const candidates=[
  [point.x+gap,point.y+gap],[point.x-width-gap,point.y+gap],
  [point.x+gap,point.y-height-gap],[point.x-width-gap,point.y-height-gap],
  [margin,viewport.height-height-margin],[viewport.width-width-margin,viewport.height-height-margin],
  [margin,margin],
 ].map(([x,y])=>({left:clamp(x,viewport.width-width-margin),top:clamp(y,viewport.height-height-margin),width,height}));
 const overlap=box=>obstacles.reduce((sum,o)=>sum+Math.max(0,Math.min(box.left+width,o.right)-Math.max(box.left,o.left))*Math.max(0,Math.min(box.top+height,o.bottom)-Math.max(box.top,o.top)),0);
 return candidates.reduce((best,box)=>overlap(box)<overlap(best)?box:best);
}

export function createMapPreview(map){
 const container=map.getContainer(),element=document.createElement('div');
 element.className='watch-map-preview';element.hidden=true;element.setAttribute('role','tooltip');container.append(element);
 return {
  show(text,point){
   const bounds=container.getBoundingClientRect();
   element.style.maxWidth=Math.max(0,Math.min(280,bounds.width-16))+'px';
   element.style.maxHeight=Math.max(0,Math.min(130,bounds.height-16))+'px';
   element.textContent=previewText(text);element.hidden=false;
   const obstacles=[...container.parentElement.querySelectorAll('.map-tools,.map-caption,.maplibregl-control-container .maplibregl-ctrl')]
     .map(node=>node.getBoundingClientRect()).filter(r=>r.width&&r.height)
     .map(r=>({left:r.left-bounds.left-6,top:r.top-bounds.top-6,right:r.right-bounds.left+6,bottom:r.bottom-bounds.top+6}));
   const box=previewPosition(point,{width:element.offsetWidth,height:element.offsetHeight},bounds,obstacles);
   element.style.left=box.left+'px';element.style.top=box.top+'px';
  },
  remove(){element.hidden=true;},
  destroy(){element.remove();},
 };
}
