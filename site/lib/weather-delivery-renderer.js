/** Which map the weather delivery lab draws on. MapLibre (the standard Command map) stays the default;
 *  ?renderer=three draws the same recorded forecast on the shared three.js county scene (county-scene-map.js),
 *  through the same TerrainMap interface. Plan: docs/county-3d-plan.md, phase 5. */
export function labRenderer(search=''){
  const params=new URLSearchParams(search),three=params.get('renderer')==='three';
  if(three)params.delete('renderer');else params.set('renderer','three');
  return {
    three,id:three?'three':'maplibre',
    label:three?'the 3D county map (preview)':'the shared Command terrain renderer',
    switchLabel:three?'Use the standard map':'Try the 3D map (preview)',
    /** Link to the same lab with the other renderer; a full page load is needed to switch. */
    switchHref:(pathname,hash='')=>`${pathname}${params.size?'?'+params:''}${hash}`,
  };
}
