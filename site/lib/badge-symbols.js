/** Icon badges for point layers: a glyph that says what the thing is, inside a shape whose colour says its state.
 * Same approach as power-symbols.js (SVG data URIs as picture markers): crisp at any size, one function for map and legend.
 * Shapes: circle = vehicle, rounded square = County site, hexagon = dam. A dark halo plus a white rim keeps every badge
 * readable on the dark, light, imagery and Google 3D basemaps. */
const HALO='#17232b';
const SHAPES=Object.freeze({
  circle:'<circle cx="18" cy="18" r="11.5"/>',
  square:'<rect x="6.5" y="6.5" width="23" height="23" rx="5"/>',
  hexagon:'<path d="M18 5.5 29 12v12l-11 6.5L7 24V12Z"/>',
});
/** Glyphs on a 36-unit canvas centred on (18,18). `ink` is white on dark fills, near-black on light ones. */
const GLYPHS=Object.freeze({
  plow:ink=>`<g fill="${ink}"><path d="M8.6 13.4 11.2 14v9l-2.6.6Z"/><rect x="12" y="14" width="7.2" height="7" rx=".8"/><path d="M19.6 16h2.9l2.3 2.7V21h-5.2Z"/><circle cx="14.6" cy="22.6" r="1.7"/><circle cx="21.6" cy="22.6" r="1.7"/></g>`,
  blower:ink=>`<g fill="none" stroke="${ink}" stroke-width="1.9" stroke-linecap="round"><path d="M18 10.5v15M11.5 14.2l13 7.6M11.5 21.8l13-7.6M16 11.6l2 1.8 2-1.8M16 24.4l2-1.8 2 1.8"/></g>`,
  wrench:ink=>`<path fill="${ink}" d="M22.6 10.2a4.4 4.4 0 0 0-5.5 5.6l-6.8 6.8a1.7 1.7 0 0 0 2.4 2.4l6.8-6.8a4.4 4.4 0 0 0 5.6-5.5l-2.7 2.7-2.4-.6-.6-2.4Z"/>`,
  garage:(ink,fill)=>`<path fill="${ink}" d="M9.5 17.2 18 11l8.5 6.2V26h-17Z"/><rect x="13.5" y="19" width="9" height="7" fill="${fill}"/><path stroke="${ink}" stroke-width="1" d="M13.5 21.3h9M13.5 23.6h9"/>`,
  fuel:(ink,fill)=>`<rect x="10.5" y="10.5" width="9" height="15.5" rx="1.2" fill="${ink}"/><rect x="12.2" y="12.4" width="5.6" height="4.2" fill="${fill}"/><path fill="none" stroke="${ink}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.2h2.3l1.9 2v6.4a1.2 1.2 0 0 0 2.4 0v-7.8l-2-2.2"/>`,
  dam:ink=>`<path fill="${ink}" d="M18.5 11h4l3 15h-10Z"/><path fill="none" stroke="${ink}" stroke-width="1.6" stroke-linecap="round" d="M9 15.5q1.6-1.6 3.2 0t3.2 0M9 20.5q1.6-1.6 3.2 0t3.2 0"/>`,
});
export const BADGE_GLYPHS=Object.freeze(Object.keys(GLYPHS));

/** @param {string} hex #rrggbb @returns {boolean} Light enough that a white glyph would wash out (WCAG relative luminance). */
export function isLight(hex){
  const c=/^#([0-9a-f]{6})$/i.exec(hex||'');if(!c)return false;
  const [r,g,b]=[0,2,4].map(i=>{const v=parseInt(c[1].slice(i,i+2),16)/255;return v<=.03928?v/12.92:((v+.055)/1.055)**2.4;});
  return .2126*r+.7152*g+.0722*b>.4;
}

/** @param {{glyph:string,fill:string,shape?:string,heading?:number|null}} o heading in degrees (0 = north) adds a direction tick.
 * @returns {string} SVG data URI. */
export function badgeUrl({glyph,fill,shape='circle',heading=null}){
  if(!GLYPHS[glyph])throw Error(`Unknown badge glyph ${glyph}`);
  const body=SHAPES[shape]||SHAPES.circle,ink=isLight(fill)?HALO:'#ffffff';
  const arrow=Number.isFinite(heading)?`<g transform="rotate(${Math.round(heading)} 18 18)"><path d="M18 1.2 22 6.8h-8Z" fill="#ffffff" stroke="${HALO}" stroke-width="1.2"/></g>`:'';
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36">${arrow}<g fill="${HALO}" stroke="${HALO}" stroke-width="5">${body}</g><g fill="${fill}" stroke="#ffffff" stroke-width="1.6">${body}</g>${GLYPHS[glyph](ink,fill)}</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** @returns {object} ArcGIS picture-marker for a badge. */
export const badgeSymbol=(o,size=26)=>({type:'picture-marker',url:badgeUrl(o),width:size,height:size});
