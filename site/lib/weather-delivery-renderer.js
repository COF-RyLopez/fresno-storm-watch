/** Which map the weather delivery lab draws on. The shared three.js county scene (county-scene-map.js) is the default;
 *  ?renderer=maplibre draws the same recorded forecast on the standard Command map, through the same TerrainMap
 *  interface, so both can still be timed. Plan: docs/county-3d-plan.md, phase 5; docs/county-3d-checklist.md. */
export function labRenderer(search=''){
  const params=new URLSearchParams(search),three=params.get('renderer')!=='maplibre';
  if(three)params.set('renderer','maplibre');else params.delete('renderer');
  return {
    three,id:three?'three':'maplibre',
    label:three?'the 3D county map':'the shared Command terrain renderer',
    switchLabel:three?'Use the standard map':'Use the 3D map',
    /** Link to the same lab with the other renderer; a full page load is needed to switch. */
    switchHref:(pathname,hash='')=>`${pathname}${params.size?'?'+params:''}${hash}`,
  };
}
