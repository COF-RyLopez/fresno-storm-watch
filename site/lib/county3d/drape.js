/** Drape: 2D vector and raster overlays painted on canvases and projected straight down onto the terrain in its shader,
 *  so polygons, lines and weather images sit exactly on the ground at any level of detail. Two levels: a county canvas
 *  (whole base) and a detail canvas around the view target, repainted as the view moves. Overlays add a little emissive
 *  light so they stay readable at night. Painting is debounced and happens off the interaction path. */
import * as THREE from '../../vendor/three-0.187.0/three.module.js';

/**
 * @param {{frame: ReturnType<import('./frame.js').createFrame>, paint: (ctx: CanvasRenderingContext2D, level: object) => void,
 *   countySize?: number, detailSize?: number, glow?: number, margin?: number}} options  margin: degrees of context around the county
 *   paint(ctx, level): level = {project(lon, lat) -> [px, py], pxPerMetre, linePx(screenPx) -> canvas px, rect}
 */
export function createDrape({ frame, paint, countySize = 4096, detailSize = 4096, glow = 0.55, margin = 3 }) {
  const { k } = frame;
  const [w, s, e, n] = frame.bounds.map((v, i) => v + (i < 2 ? -margin : margin)); // regional alerts reach past the county
  const [x0, z0] = frame.project(w, n), [x1, z1] = frame.project(e, s);
  const county = { size: Math.max(x1 - x0, z1 - z0) * 1.02 };
  Object.assign(county, { x0: (x0 + x1) / 2 - county.size / 2, z0: (z0 + z1) / 2 - county.size / 2 });
  const make = px => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = px;
    const tex = new THREE.CanvasTexture(canvas);
    Object.assign(tex, { colorSpace: THREE.SRGBColorSpace, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, anisotropy: 8 });
    return { canvas, ctx: canvas.getContext('2d'), tex, px, rect: { x0: 0, z0: 0, size: 1 } };
  };
  const levels = [make(countySize), make(detailSize)];
  levels[0].rect = county;
  const uniforms = {
    uDrape0: { value: levels[0].tex }, uDrapeRect0: { value: new THREE.Vector4() },
    uDrape1: { value: levels[1].tex }, uDrapeRect1: { value: new THREE.Vector4(0, 0, 1e-6, 1e-6) }, uDrapeGlow: { value: glow }
  };

  /** Patch a terrain material to sample the drape. */
  function decorate(material) {
    material.customProgramCacheKey = () => 'county-drape';
    material.onBeforeCompile = shader => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vDrapeXZ;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvDrapeXZ = (modelMatrix * vec4(transformed, 1.0)).xz;');
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
        varying vec2 vDrapeXZ; uniform sampler2D uDrape0, uDrape1; uniform vec4 uDrapeRect0, uDrapeRect1; uniform float uDrapeGlow;
        vec4 drapeAt(sampler2D t, vec4 r) { vec2 uv = (vDrapeXZ - r.xy) / r.zw; return all(greaterThan(uv, vec2(0.0))) && all(lessThan(uv, vec2(1.0))) ? texture2D(t, uv) : vec4(0.0); }`)
        .replace('#include <map_fragment>', `#include <map_fragment>
        vec2 du = (vDrapeXZ - uDrapeRect1.xy) / uDrapeRect1.zw;
        float inDetail = smoothstep(0.0, 0.04, min(min(du.x, 1.0 - du.x), min(du.y, 1.0 - du.y)));
        vec4 drape = mix(drapeAt(uDrape0, uDrapeRect0), drapeAt(uDrape1, uDrapeRect1), inDetail);
        diffuseColor.rgb = mix(diffuseColor.rgb, drape.rgb, drape.a);`)
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += drape.rgb * drape.a * uDrapeGlow;');
    };
  }

  let view = { x: 0, z: 0, distance: 1e9, worldPerPx: 1 }, pending = 0, dirty = true;
  function draw(level) {
    const { ctx, px, rect } = level, scale = px / rect.size; // canvas px per world unit
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, px, px);
    const project = (lon, lat) => { const [x, z] = frame.project(lon, lat); return [(x - rect.x0) * scale, (z - rect.z0) * scale]; };
    paint(ctx, { project, pxPerMetre: scale * k, linePx: screenPx => Math.max(1, screenPx * view.worldPerPx * scale), rect, canvasPx: px });
    level.tex.needsUpdate = true;
  }
  const sync = () => {
    uniforms.uDrapeRect0.value.set(county.x0, county.z0, county.size, county.size);
    const r = levels[1].rect;
    uniforms.uDrapeRect1.value.set(r.x0, r.z0, r.size, r.size);
  };
  sync();
  function repaint() {
    pending = 0; dirty = false;
    const size = Math.min(Math.max(view.distance * 2.6, 3000 * k), county.size);
    Object.assign(levels[1].rect, { x0: view.x - size / 2, z0: view.z - size / 2, size });
    draw(levels[0]); draw(levels[1]); sync();
  }
  return {
    decorate, uniforms,
    /** Call each frame with the camera target and distance (world units) and world units per screen px. */
    track(x, z, distance, worldPerPx) {
      const r = levels[1].rect, size = Math.min(Math.max(distance * 2.6, 3000 * k), county.size);
      const moved = Math.hypot(x - (r.x0 + r.size / 2), z - (r.z0 + r.size / 2)) > r.size * 0.18, scaled = Math.abs(Math.log(size / r.size)) > 0.45;
      view = { x, z, distance, worldPerPx };
      if ((moved || scaled || dirty) && !pending) pending = setTimeout(repaint, dirty && !moved && !scaled ? 0 : 140);
    },
    /** Data changed: repaint soon. */
    invalidate() { dirty = true; if (!pending) pending = setTimeout(repaint, 0); },
    dispose() { clearTimeout(pending); levels.forEach(l => l.tex.dispose()); }
  };
}
