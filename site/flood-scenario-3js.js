// three.js flood scenario playback: the scenarios and playback of the 2D page, drawn as a lit scene for realism. Terrain from
// Terrarium elevation tiles draped with Esri World Imagery; a water surface raised to ground + modeled depth (decoded from
// the depth PNGs); Overture footprints as one mesh whose impact colours come from the clock in the shader; evacuation cars
// as instanced vehicles on the terrain. World frame: x east, y up, z south, Web Mercator metres from the scenario extent
// centre; elevations are scaled by the Mercator factor k so heights and distances share units.
import * as THREE from './vendor/three-0.187.0/three.module.js';
import { OrbitControls } from './vendor/three-0.187.0/addons/OrbitControls.js';
import { Sky } from './vendor/three-0.187.0/addons/Sky.js';
import { positionsAt } from './lib/evacuation-traffic.js';
import { blend, rowsToObjects, summarize } from './lib/flood-scenario-model.js';
import { CLASSES, createPlayer, fieldInfos, pickScenario, showScenario, showStatus, trafficCounts, trafficLoader } from './lib/flood-scenario-page.js';
import { DEPTH_STEPS_PER_FT, hipRoof, parseFootprints, sampleGrid, terrarium, tileRange } from './lib/flood-three-model.js';

const ROOT = './data/flood-scenarios/';
const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const FT = 0.3048;
const loading = $('loading');
const step = text => { loading.textContent = text; };

const { id, entry, DATA } = await pickScenario(ROOT);
$('link-2d').href = `./flood-scenario.html?scenario=${encodeURIComponent(id)}`;
step('Loading scenario and buildings…');
const gunzip = r => new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
const [scenario, buildingsJson, footprintsBuf] = await Promise.all([
  fetch(DATA + 'scenario.json').then(r => r.json()),
  fetch(DATA + 'buildings.json').then(r => r.json()),
  fetch(DATA + 'footprints-3js.bin').then(r => (r.ok ? gunzip(r) : null))
]);
const { frames, hours, extent, start } = showScenario(scenario, class { constructor(o) { Object.assign(this, o); } });
const props = rowsToObjects(buildingsJson);
const byFd = new Map(props.map(p => [p.fd_id, p]));
const W = extent.xmax - extent.xmin, H = extent.ymax - extent.ymin;
const ox = (extent.xmin + extent.xmax) / 2, oy = (extent.ymin + extent.ymax) / 2;
const k = 1 / Math.cos(2 * Math.atan(Math.exp(oy / 6378137)) - Math.PI / 2); // Mercator metres per ground metre here
const toWorld = (mx, my) => [mx - ox, -(my - oy)];

// ---------- tiles: elevation and imagery, composited at native resolution over a Web Mercator box ----------
const IMAGERY = (z, x, y) => `https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
async function mosaic(z, url, crop, box = extent) {
  const r = tileRange(box, z), cols = r.x1 - r.x0 + 1, rows = r.y1 - r.y0 + 1, size = (r.span.xmax - r.span.xmin) / cols;
  const canvas = new OffscreenCanvas(cols * 256, rows * 256), ctx = canvas.getContext('2d', { willReadFrequently: !crop });
  const jobs = [];
  for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) {
    jobs.push(fetch(url(z, x, y), { mode: 'cors' }).then(res => (res.ok ? res.blob() : Promise.reject(new Error(res.status))))
      .then(createImageBitmap).then(img => ctx.drawImage(img, (x - r.x0) * 256, (y - r.y0) * 256)).catch(e => console.warn('Tile', z, x, y, e.message)));
  }
  await Promise.all(jobs);
  const px = m => (m / size) * 256; // metres -> mosaic pixels
  return { canvas, ctx, sx: px(box.xmin - r.span.xmin), sy: px(r.span.ymax - box.ymax), sw: px(box.xmax - box.xmin), sh: px(box.ymax - box.ymin) };
}
step('Loading terrain and imagery…');
const IMAGERY_Z = Number(params.get('imagery')) || 13;
const [dem, img] = await Promise.all([
  mosaic(12, (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`),
  mosaic(IMAGERY_Z, IMAGERY, true)
]);
const demPx = dem.ctx.getImageData(0, 0, dem.canvas.width, dem.canvas.height).data;
const demW = dem.canvas.width, demH = dem.canvas.height, elev = new Float32Array(demW * demH);
for (let i = 0; i < elev.length; i++) elev[i] = terrarium(demPx[4 * i], demPx[4 * i + 1], demPx[4 * i + 2]);
/** Ground height (world units) at world x, z. */
const groundAt = (x, z) => k * sampleGrid(elev, demW, demH, dem.sx + ((x + W / 2) / W) * dem.sw - 0.5, dem.sy + ((z + H / 2) / H) * dem.sh - 0.5);

// ---------- renderer, sky, light ----------
const container = $('view');
const renderer = new THREE.WebGLRenderer({ antialias: true, reversedDepthBuffer: true, logarithmicDepthBuffer: true, powerPreference: 'high-performance' }) // log depth only where reversed depth is unsupported: it disables early-z;
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.55;
renderer.shadowMap.enabled = params.get('shadows') !== '0';
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.shadowMap.autoUpdate = false; // the sun and buildings are static: redraw the shadow map only when its window moves
container.append(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, 1, 2, 4e5);
let skyCube = null;
const sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - 32), THREE.MathUtils.degToRad(215));
{
  const sky = new Sky();
  sky.scale.setScalar(1e4);
  sky.material.uniforms.turbidity.value = 3;
  sky.material.uniforms.rayleigh.value = 1.2;
  sky.material.uniforms.sunPosition.value.copy(sunDir);
  sky.material.uniforms.cloudCoverage.value = 0.35;
  const skyScene = new THREE.Scene().add(sky);
  const cube = new THREE.WebGLCubeRenderTarget(512, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
  new THREE.CubeCamera(1, 2e4, cube).update(renderer, skyScene);
  scene.background = skyCube = cube.texture; // also what the water reflects (mipmapped: rippled water blurs it)
  scene.environment = new THREE.PMREMGenerator(renderer).fromScene(skyScene, 0.02).texture;
  scene.environmentIntensity = 0.6;
}
scene.fog = new THREE.FogExp2(0xb4c3ce, 1 / (70_000 * k));
const sun = new THREE.DirectionalLight(0xfff1dc, 2.2);
sun.castShadow = renderer.shadowMap.enabled;
sun.shadow.mapSize.set(4096, 4096);
const SHADOW_HALF = 2500 * k; // shadow window around the view target, ~1.2 m texels
Object.assign(sun.shadow.camera, { left: -SHADOW_HALF, right: SHADOW_HALF, top: SHADOW_HALF, bottom: -SHADOW_HALF, near: 10, far: 20_000 * k });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 1.5 * k;
scene.add(sun, sun.target, new THREE.HemisphereLight(0xcfe4ff, 0x6b5a40, 0.5));

// ---------- terrain ----------
const GX = Number(params.get('grid')) || 900, GZ = Math.round((GX * H) / W);
const grid = new THREE.PlaneGeometry(W, H, GX, GZ).rotateX(-Math.PI / 2); // north (+y) becomes -z
{
  const pos = grid.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setY(i, groundAt(pos.getX(i), pos.getZ(i)));
  grid.computeVertexNormals();
  grid.computeBoundingSphere();
}
const imagery = new THREE.CanvasTexture(new OffscreenCanvas(Math.min(8192, Math.round(img.sw)), Math.min(8192, Math.round(img.sh))));
imagery.image.getContext('2d').drawImage(img.canvas, img.sx, img.sy, img.sw, img.sh, 0, 0, imagery.image.width, imagery.image.height);
imagery.colorSpace = THREE.SRGBColorSpace;
imagery.anisotropy = renderer.capabilities.getMaxAnisotropy();
const terrain = new THREE.Mesh(grid, new THREE.MeshStandardMaterial({ map: imagery, roughness: 0.95, metalness: 0 }));
terrain.receiveShadow = true;
scene.add(terrain);
// Sharper imagery near the view target: zoom-16 tiles (~2.4 m) over a square that follows the camera, blended over the base drape.
const DETAIL_Z = Number(params.get('detail')) || 16, DETAIL_HALF = 2400 * k;
const detail = { tex: { value: new THREE.Texture() }, rect: { value: new THREE.Vector4(0, 0, 1e-6, 1e-6) }, at: new THREE.Vector3(Infinity, 0, 0), busy: false };
terrain.material.onBeforeCompile = shader => {
  Object.assign(shader.uniforms, { uDetail: detail.tex, uDetailRect: detail.rect, ...depthU, uWetR: { value: new THREE.Vector2(WET_BAND * k / W, WET_BAND * k / H) } });
  shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vXZ; varying vec2 vDUv;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvXZ = position.xz; vDUv = vec2(uv.x, 1.0 - uv.y);');
  shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
      varying vec2 vXZ; varying vec2 vDUv; uniform sampler2D uDetail, uD0, uD1; uniform vec4 uDetailRect; uniform vec2 uWetR; uniform float uW;
      float depthAt(vec2 uv) { return mix(texture2D(uD0, uv).r, texture2D(uD1, uv).r, uW) * ${DEPTH_SCALE}; }`)
    .replace('#include <map_fragment>', `#include <map_fragment>
      vec2 du = (vXZ - uDetailRect.xy) / uDetailRect.zw;
      float inside = smoothstep(0.0, 0.08, min(min(du.x, 1.0 - du.x), min(du.y, 1.0 - du.y)));
      if (inside > 0.0) diffuseColor.rgb = mix(diffuseColor.rgb, texture2D(uDetail, vec2(du.x, 1.0 - du.y)).rgb, inside);
      // wet soil: darker under the water and in a band just beyond its edge (8 taps at two radii)
      float wet = step(0.04, depthAt(vDUv));
      for (int j = 0; j < 8; j++) {
        vec2 o = vec2(cos(float(j) * 0.7854), sin(float(j) * 0.7854)) * uWetR;
        wet = max(wet, max(step(0.04, depthAt(vDUv + 0.4 * o)) * 0.85, step(0.04, depthAt(vDUv + o)) * 0.45));
      }
      diffuseColor.rgb *= mix(1.0, 0.55, wet);`);
};
async function loadDetail() {
  const c = controls.target;
  if (detail.busy || detail.at.distanceTo(c) < DETAIL_HALF * 0.4) return;
  detail.busy = true;
  const at = c.clone(), [mx, my] = [at.x + ox, -at.z + oy];
  const box = { xmin: mx - DETAIL_HALF, xmax: mx + DETAIL_HALF, ymin: my - DETAIL_HALF, ymax: my + DETAIL_HALF };
  try {
    const m = await mosaic(DETAIL_Z, IMAGERY, true, box), size = Math.min(4096, Math.round(m.sw));
    const tex = new THREE.CanvasTexture(new OffscreenCanvas(size, size));
    tex.image.getContext('2d').drawImage(m.canvas, m.sx, m.sy, m.sw, m.sh, 0, 0, size, size);
    Object.assign(tex, { colorSpace: THREE.SRGBColorSpace, anisotropy: renderer.capabilities.getMaxAnisotropy() });
    detail.tex.value.dispose();
    detail.tex.value = tex;
    detail.rect.value.set(at.x - DETAIL_HALF, at.z - DETAIL_HALF, 2 * DETAIL_HALF, 2 * DETAIL_HALF);
    detail.at.copy(at);
  } finally { detail.busy = false; }
}

// ---------- water ----------
// Depth frames are fetched and decoded in a worker: ~45 ms per frame on the main thread stalled playback once per frame.
// A blob module worker imports the import-mapped (cache-keyed) model URL, so it updates with the page.
const depthWorker = new Worker(URL.createObjectURL(new Blob([`
  import { decodeDepth, legendDepth } from ${JSON.stringify(import.meta.resolve('./lib/flood-three-model.js'))};
  const toFt = legendDepth(${JSON.stringify(scenario.legend)});
  onmessage = async ({ data: { i, url } }) => {
    try {
      const bmp = await createImageBitmap(await (await fetch(url)).blob());
      const ctx = new OffscreenCanvas(bmp.width, bmp.height).getContext('2d', { willReadFrequently: true });
      ctx.drawImage(bmp, 0, 0);
      const depth = decodeDepth(ctx.getImageData(0, 0, bmp.width, bmp.height).data, toFt);
      postMessage({ i, depth, size: [bmp.width, bmp.height] }, [depth.buffer]);
    } catch (error) { postMessage({ i, error: String(error) }); }
  };`], { type: 'text/javascript' })), { type: 'module' });
const pending = new Map(); // frame index -> { resolve, reject }
depthWorker.onmessage = ({ data: { i, depth, size, error } }) => {
  const p = pending.get(i);
  pending.delete(i);
  if (error) { frameCache.delete(i); p?.reject(new Error(error)); } else { frameSize = size; p?.resolve(depth); }
};
const frameCache = new Map(); // frame index -> Promise<Uint8Array>; last 8 frames kept
let frameSize = null;
function frameDepth(i) {
  if (!frameCache.has(i)) {
    frameCache.set(i, new Promise((resolve, reject) => { pending.set(i, { resolve, reject }); depthWorker.postMessage({ i, url: new URL(DATA + frames[i].image, location.href).href }); }));
    if (frameCache.size > 8) frameCache.delete(frameCache.keys().next().value);
  }
  return frameCache.get(i);
}
const depthTexture = (data = new Uint8Array(1), w = 1, h = 1) => { // WebGL storage does not resize: a new size needs a new texture
  const t = new THREE.DataTexture(data, w, h, THREE.RedFormat, THREE.UnsignedByteType);
  Object.assign(t, { magFilter: THREE.LinearFilter, minFilter: THREE.LinearFilter, unpackAlignment: 1, needsUpdate: true });
  return t;
};
const pool = [depthTexture(), depthTexture()]; // two GPU textures, refilled in place
const slots = [...pool];
const slotFrame = [-1, -1];
const DEPTH_SCALE = (255 / DEPTH_STEPS_PER_FT).toFixed(4); // R8 texel -> ft
const WET_BAND = 14; // m of darkened, wet ground beyond the water's edge
const depthU = { uD0: { value: slots[0] }, uD1: { value: slots[1] }, uW: { value: 0 } }; // shared by the water and the terrain
// Ground elevation (m) at the water mesh's vertices, one texel each: with linear filtering a lookup through SURFACE_GLSL's
// meshUv() reproduces the mesh's own ground, so the flow slope and the wall water lines match the drawn water surface.
const groundTex = (() => {
  const gw = GX + 1, gh = GZ + 1, data = new Float32Array(gw * gh);
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) data[j * gw + i] = groundAt(-W / 2 + (i / GX) * W, -H / 2 + (j / GZ) * H) / k;
  const t = new THREE.DataTexture(data, gw, gh, THREE.RedFormat, THREE.FloatType);
  const filter = renderer.extensions.has('OES_texture_float_linear') ? THREE.LinearFilter : THREE.NearestFilter;
  return Object.assign(t, { magFilter: filter, minFilter: filter, needsUpdate: true });
})();
// GLSL: the water mesh's surface height (m) at a depth-frame uv, as drawn: ground + depth taken at the mesh vertices and
// interpolated between them (the vertex shader lifts the mesh by depth sampled per vertex), plus its 0.12 m lift.
const SURFACE_GLSL = `
  uniform sampler2D uGround; const vec2 GRID = vec2(${GX}.0, ${GZ}.0);
  vec2 meshUv(vec2 uv) { return (uv * GRID + 0.5) / (GRID + 1.0); }
  float depthFt(vec2 uv) { return mix(texture2D(uD0, uv).r, texture2D(uD1, uv).r, uW) * ${DEPTH_SCALE}; }
  // PlaneGeometry splits each cell (corners a = (0,0), b = (0,1), c = (1,1), d = (1,0)) into triangles abd and bcd
  float meshLerp(float a, float b, float c, float d, vec2 f) {
    return f.x + f.y <= 1.0 ? a + f.x * (d - a) + f.y * (b - a) : c + (1.0 - f.x) * (b - c) + (1.0 - f.y) * (d - c);
  }
  float nodeHeight(vec2 n) { return texture2D(uGround, (n + 0.5) / (GRID + 1.0)).r + depthFt(n / GRID) * ${FT}; }
  float meshDepthFt(vec2 uv) { // depth as the mesh carries it: per vertex, interpolated (buildings often sit in dry raster cells)
    vec2 g = uv * GRID, n = floor(g);
    return meshLerp(depthFt(n / GRID), depthFt((n + vec2(0.0, 1.0)) / GRID), depthFt((n + 1.0) / GRID), depthFt((n + vec2(1.0, 0.0)) / GRID), g - n);
  }
  float surfaceM(vec2 uv) { // the drawn water surface, m
    vec2 g = uv * GRID, n = floor(g);
    return meshLerp(nodeHeight(n), nodeHeight(n + vec2(0.0, 1.0)), nodeHeight(n + 1.0), nodeHeight(n + vec2(1.0, 0.0)), g - n) + 0.12;
  }`;
const FLOW_STEP = 40; // m between slope samples (and three times that for a smoother second estimate)
function waveNormals(N = 256) { // tileable ripple normal map: a sum of waves with integer frequencies
  const h = new Float32Array(N * N), waves = [];
  for (let s = 1; s <= 28; s++) { const a = Math.random() * 2 * Math.PI, f = 2 + Math.random() * 14; waves.push([Math.round(Math.cos(a) * f), Math.round(Math.sin(a) * f), 1 / f, Math.random() * 6.3]); }
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) h[y * N + x] = waves.reduce((s, [fx, fy, a, p]) => s + a * Math.sin((2 * Math.PI * (fx * x + fy * y)) / N + p), 0);
  const out = new Uint8Array(4 * N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const dx = h[y * N + ((x + 1) % N)] - h[y * N + ((x + N - 1) % N)], dy = h[((y + 1) % N) * N + x] - h[((y + N - 1) % N) * N + x];
    const n = new THREE.Vector3(-dx * 3, -dy * 3, 1).normalize();
    out.set([(n.x * 0.5 + 0.5) * 255, (n.y * 0.5 + 0.5) * 255, (n.z * 0.5 + 0.5) * 255, 255], 4 * (y * N + x));
  }
  const t = new THREE.DataTexture(out, N, N);
  Object.assign(t, { wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping, magFilter: THREE.LinearFilter, minFilter: THREE.LinearMipmapLinearFilter, generateMipmaps: true, needsUpdate: true });
  return t;
}
const ramp = (() => { // the legend as a 256 x 1 texture, for the 'depth colours' water option
  const c = new OffscreenCanvas(256, 1), ctx = c.getContext('2d'), top = scenario.legend.at(-1).ft, g = ctx.createLinearGradient(0, 0, 256, 0);
  for (const s of scenario.legend) g.addColorStop(s.ft / top, `rgb(${s.rgba.slice(0, 3)})`);
  ctx.fillStyle = g; ctx.fillRect(0, 0, 256, 1);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
})();
const water = new THREE.Mesh(grid, new THREE.ShaderMaterial({
  transparent: true, fog: true, lights: false,
  uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
    uD0: { value: slots[0] }, uD1: { value: slots[1] }, uW: { value: 0 }, uK: { value: k }, uTime: { value: 0 }, uNormals: { value: waveNormals() },
    uSun: { value: sunDir }, uRamp: { value: ramp }, uRampTop: { value: scenario.legend.at(-1).ft }, uDepthColours: { value: 0 }
  }]),
  vertexShader: /* glsl */`
    #include <common>
    #include <fog_pars_vertex>
    #include <logdepthbuf_pars_vertex>
    uniform sampler2D uD0, uD1; uniform float uW, uK;
    varying vec2 vUv; varying vec3 vWorld; varying float vLift;
    void main() {
      vUv = vec2(uv.x, 1.0 - uv.y);
      float d = mix(texture2D(uD0, vUv).r, texture2D(uD1, vUv).r, uW) * ${DEPTH_SCALE};
      vLift = d;
      vec3 p = position + vec3(0.0, (d * ${FT} + 0.12) * uK, 0.0);
      vWorld = (modelMatrix * vec4(p, 1.0)).xyz;
      vec4 mvPosition = viewMatrix * vec4(vWorld, 1.0);
      gl_Position = projectionMatrix * mvPosition;
      #include <logdepthbuf_vertex>
      #include <fog_vertex>
    }`,
  fragmentShader: /* glsl */`
    #include <common>
    #include <fog_pars_fragment>
    #include <logdepthbuf_pars_fragment>
    uniform sampler2D uD0, uD1, uNormals, uRamp; uniform samplerCube uSky; uniform float uW, uTime, uK, uRampTop, uDepthColours; uniform vec3 uSun; uniform vec2 uFlowStep;
    varying vec2 vUv; varying vec3 vWorld; varying float vLift;
    vec3 ripple(vec2 p, float s, vec2 v) { return texture2D(uNormals, p * s + v * uTime).rgb * 2.0 - 1.0; }
    vec3 chop(vec2 q) { return (texture2D(uNormals, q / 23.0).rgb * 2.0 - 1.0) + (texture2D(uNormals, q / 7.0 + 0.31).rgb * 2.0 - 1.0) * 0.6; }
    ${SURFACE_GLSL}
    float eta(vec2 uv) { return texture2D(uGround, meshUv(uv)).r + depthFt(uv) * ${FT}; } // water surface, m
    vec2 slope(vec2 s) { return vec2(eta(vUv + vec2(s.x, 0.0)) - eta(vUv - vec2(s.x, 0.0)), eta(vUv + vec2(0.0, s.y)) - eta(vUv - vec2(0.0, s.y))); }
    void main() {
      #include <logdepthbuf_fragment>
      float d0 = texture2D(uD0, vUv).r * ${DEPTH_SCALE}, d1 = texture2D(uD1, vUv).r * ${DEPTH_SCALE};
      float d = mix(d0, d1, uW); // ft, at the PNG's resolution
      if (d < 0.04) discard;
      vec2 p = vWorld.xz / uK;
      // Flow: down the water-surface slope (x east, z south; averaged over two baselines to smooth the 30 m terrain), at a
      // Manning speed for rough urban flow (n = 0.06), capped. Ripples and foam ride it in real time, whatever the playback rate.
      vec2 g = slope(uFlowStep) / ${2 * 40}.0 * 0.5 + slope(uFlowStep * 3.0) / ${6 * 40}.0 * 0.5;
      float S = length(g), dm = d * ${FT};
      float speed = min(sqrt(S) * pow(dm, 0.667) / 0.06, 3.0);
      vec2 dir = S > 1e-6 ? -g / S : vec2(1.0, 0.0), flow = dir * speed;
      // two-phase flow map: each layer drifts for P seconds and resets while its weight is zero
      const float P = 4.0;
      float ph0 = fract(uTime / P), ph1 = fract(uTime / P + 0.5), w0 = 1.0 - abs(2.0 * ph0 - 1.0);
      vec2 o0 = flow * ph0 * P, o1 = flow * ph1 * P + vec2(5.3, 11.7);
      vec3 nf = chop(p - o0) * w0 + chop(p - o1) * (1.0 - w0);
      vec3 n3 = ripple(p, 1.0 / 180.0, vec2(0.002, -0.001)); // slow wind swell, independent of the current
      float far = smoothstep(300.0, 2500.0, distance(cameraPosition, vWorld) / uK); // calm the fine ripples with distance: they shimmer
      vec3 N = normalize(vec3(nf.x * (1.0 - far) + n3.x * 0.8, 5.0 + 6.0 * far, nf.y * (1.0 - far) + n3.y * 0.8));
      vec3 V = normalize(cameraPosition - vWorld);
      float fres = 0.02 + 0.98 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
      vec3 R = reflect(-V, N);
      R.y = abs(R.y); // ripples can tip a reflection below the horizon; the water reflects sky, not ground
      vec3 sky = textureLod(uSky, R, 3.5).rgb * 0.8; // the scene's own sky, blurred by the chop; a muddy, debris-strewn surface reflects less than clear water
      float deep = 1.0 - exp(-d / 5.0);
      vec3 body = mix(vec3(0.42, 0.35, 0.24), vec3(0.15, 0.13, 0.09), deep); // light scattered back by silty floodwater
      body = mix(body, texture2D(uRamp, vec2(clamp(d / uRampTop, 0.0, 1.0), 0.5)).rgb, uDepthColours);
      body *= 0.6 + 0.4 * max(dot(N, uSun), 0.0);
      // Silt absorbs light with depth (Beer-Lambert): the ground shows through the first foot and is gone by about two feet.
      float T = mix(exp(-d / 0.45), 1.0 - mix(0.55, 0.94, smoothstep(0.04, 1.5, d)), uDepthColours);
      float F = fres * (1.0 - 0.6 * uDepthColours);
      vec3 glint = vec3(1.0, 0.93, 0.8) * pow(max(dot(R, uSun), 0.0), 420.0) * 6.0 * (1.0 - uDepthColours);
      // Patchy foam only where the water is rising fast (the advancing front) and in a thin line at the very edge.
      float rising = smoothstep(0.08, 0.8, abs(d1 - d0)) * (1.0 - smoothstep(0.0, 3.0, d));
      // Foam: streaks stretched along the current and carried by it; more of it where the flow is fast.
      mat2 toFlow = mat2(dir.x, -dir.y, dir.y, dir.x); // world xz -> (along, across)
      vec2 st = vec2(1.0 / 70.0, 1.0 / 13.0);
      float patches = texture2D(uNormals, toFlow * (p - o0) * st).r * w0 + texture2D(uNormals, toFlow * (p - o1) * st).r * (1.0 - w0);
      patches = patches * 0.7 + texture2D(uNormals, p / 41.0).g * 0.3;
      float churn = smoothstep(0.7, 2.4, speed);
      float foam = smoothstep(0.6, 0.76, patches) * clamp(rising + churn * 0.8 + (1.0 - smoothstep(0.04, 0.2, d)) * 0.5, 0.0, 1.0) * (1.0 - uDepthColours);
      // out = ground * T(1-F) + body (1-T)(1-F) + sky F, written as a colour over the ground with alpha a
      float a = 1.0 - T * (1.0 - F);
      vec3 col = (body * (1.0 - T) * (1.0 - F) + sky * F + glint) / max(a, 1e-3);
      col = mix(col, vec3(0.8, 0.76, 0.68), foam * 0.7);
      gl_FragColor = vec4(col, max(a, foam * 0.7));
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      #include <fog_fragment>
    }`
}));
Object.assign(water.material.uniforms, depthU, { uSky: { value: skyCube }, uGround: { value: groundTex }, uFlowStep: { value: new THREE.Vector2((FLOW_STEP * k) / W, (FLOW_STEP * k) / H) } });
water.renderOrder = 1;
water.frustumCulled = false;
scene.add(water);
let wantFrames = '';
async function showFrames(i0, i1) {
  const key = `${i0},${i1}`;
  if (key === wantFrames) return;
  wantFrames = key;
  const [a, b] = await Promise.all([frameDepth(i0), frameDepth(i1)]).catch(e => { console.warn('Depth frame:', e.message); return []; });
  if (!a) { if (wantFrames === key) wantFrames = ''; return; } // the next render retries
  if (wantFrames !== key) return;
  // Reuse a texture that already holds a wanted frame (stepping forward, the old i1 becomes i0) and refill the other in
  // place: a same-size update is one texSubImage2D, where a new texture also reallocated GPU storage (~100 ms per frame step).
  const held = new Map(slotFrame.map((f, s) => [f, slots[s]]));
  const next = [held.get(i0), held.get(i1)];
  const spare = pool.filter(t => !next.includes(t));
  [[0, a, i0], [1, b, i1]].forEach(([s, data, i]) => {
    if (next[s]) return;
    if (s === 1 && i1 === i0) { next[1] = next[0]; return; }
    let t = spare.pop();
    if (t.image.width === frameSize[0] && t.image.height === frameSize[1]) { t.image.data = data; t.needsUpdate = true; } else { t.dispose(); pool[pool.indexOf(t)] = t = depthTexture(data, ...frameSize); }
    next[s] = t;
  });
  [slots[0], slots[1]] = next;
  [slotFrame[0], slotFrame[1]] = [i0, i1];
  water.material.uniforms.uD0.value = slots[0];
  water.material.uniforms.uD1.value = slots[1];
  frameDepth(Math.min(i1 + 1, frames.length - 1)); // prefetch
}

// ---------- buildings ----------
const timeU = { value: 0 }, impactU = { value: 1 };
let buildings = null, fp = null;
if (footprintsBuf) {
  step('Building footprints…');
  fp = parseFootprints(footprintsBuf);
  const [fx, fy] = [fp.origin[0] - ox, -(fp.origin[1] - oy)]; // the binary's origin is the extent centre: both 0
  const nv = fp.nv, pos = new Float32Array(nv * 2 * 3), bld = new Float32Array(nv * 2), index = [], roofPos = [], roofBld = [];
  for (let b = 0; b < fp.n; b++) {
    const s = fp.start[b], e = fp.start[b + 1], m = e - s;
    let lo = Infinity, hi = -Infinity;
    for (let v = s; v < e; v++) { const g = groundAt(fp.xy[2 * v] + fx, -fp.xy[2 * v + 1] + fy); lo = Math.min(lo, g); hi = Math.max(hi, g); }
    const height = (Number.isFinite(fp.attr[5 * b + 4]) ? fp.attr[5 * b + 4] : 12) * FT * k;
    const contour = [];
    for (let v = s; v < e; v++) {
      const x = fp.xy[2 * v] + fx, z = -fp.xy[2 * v + 1] + fy;
      pos.set([x, lo - 0.6 * k, z], 6 * v); pos.set([x, hi + height, z], 6 * v + 3);
      bld[2 * v] = b; bld[2 * v + 1] = b;
      contour.push(new THREE.Vector2(x, z));
    }
    for (let j = 0; j < m; j++) { // walls; winding gives outward faces for either ring orientation once culling is off
      const a0 = 2 * (s + j), b0 = 2 * (s + ((j + 1) % m));
      index.push(a0, b0, a0 + 1, b0, b0 + 1, a0 + 1);
    }
    const roof = hipRoof(contour.map(v => [v.x, v.y]), { maxArea: 600 * k * k }); // houses: a hip roof; others stay flat
    if (roof) for (let i = 0; i < roof.length; i += 3) { roofPos.push(roof[i], hi + height + roof[i + 1], roof[i + 2]); roofBld.push(b); }
    else for (const [a, b2, c] of THREE.ShapeUtils.triangulateShape(contour, [])) index.push(2 * (s + a) + 1, 2 * (s + b2) + 1, 2 * (s + c) + 1);
  }
  for (let i = 0; i < roofBld.length; i++) index.push(nv * 2 + i);
  const geom = new THREE.BufferGeometry();
  const join = (a, b) => { const out = new Float32Array(a.length + b.length); out.set(a); out.set(b, a.length); return out; };
  geom.setAttribute('position', new THREE.BufferAttribute(join(pos, roofPos), 3));
  geom.setAttribute('aBld', new THREE.BufferAttribute(join(bld, roofBld), 1));
  geom.userData.roofs = roofBld.length / 18;
  geom.setIndex(nv * 2 + roofBld.length > 65535 ? new THREE.Uint32BufferAttribute(index, 1) : new THREE.Uint16BufferAttribute(index, 1));
  geom.computeBoundingSphere();
  // per-building class hours (arrive_hr, t_in0, t_in2, t_in6; never = 1e6) in a float texture read by the vertex shader
  const TW = 2048, TH = Math.ceil(fp.n / TW), hoursTex = new Float32Array(TW * TH * 4).fill(1e6);
  for (let b = 0; b < fp.n; b++) for (let j = 0; j < 4; j++) { const v = fp.attr[5 * b + j]; if (Number.isFinite(v)) hoursTex[4 * b + j] = v; }
  const classTex = new THREE.DataTexture(hoursTex, TW, TH, THREE.RGBAFormat, THREE.FloatType);
  classTex.needsUpdate = true;
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.82, metalness: 0, flatShading: true, side: THREE.DoubleSide });
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, { uHours: { value: classTex }, uTime: timeU, uImpact: impactU, ...depthU, uGround: { value: groundTex }, uExt: { value: new THREE.Vector2(W, H) }, uK: { value: k } });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float aBld; uniform highp sampler2D uHours; uniform float uTime; varying float vCls; varying float vHash; varying vec3 vW;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        int bi = int(aBld + 0.5); vec4 hr = texelFetch(uHours, ivec2(bi % ${TW}, bi / ${TW}), 0);
        vCls = uTime < hr.x ? 0.0 : uTime < hr.y ? 1.0 : uTime < hr.z ? 2.0 : uTime < hr.w ? 3.0 : 4.0;
        vHash = fract(sin(aBld * 12.9898) * 43758.5453); vW = (modelMatrix * vec4(position, 1.0)).xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uImpact; varying float vCls; varying float vHash; varying vec3 vW;
        uniform sampler2D uD0, uD1; uniform float uW, uK; uniform vec2 uExt;
        ${SURFACE_GLSL}
        const vec3 CLS[5] = vec3[5](${CLASSES.map(([, , hex]) => { const c = new THREE.Color(hex); return `vec3(${c.r.toFixed(3)}, ${c.g.toFixed(3)}, ${c.b.toFixed(3)})`; }).join(', ')});`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        bool roof = abs(normalize(cross(dFdx(vW), dFdy(vW))).y) > 0.7;
        vec3 wall = mix(vec3(0.33, 0.29, 0.24), vec3(0.47, 0.45, 0.41), vHash); // stucco and siding (linear)
        vec3 top = mix(vec3(0.09, 0.09, 0.09), vec3(0.26, 0.15, 0.10), fract(vHash * 7.0)); // composition and tile roofs
        vec3 natural = roof ? top : wall;
        int ci = int(vCls + 0.5);
        diffuseColor.rgb = mix(natural, CLS[ci], vCls > 0.5 ? uImpact * (roof ? 0.9 : 0.75) : 0.0);
        // Water line: walls darken below the water surface and in a band above it where water wicks and splashes, with a
        // mud line at the level. Depth never recedes in these scenarios, so the current level is the high-water mark.
        vec2 duv = vW.xz / uExt + 0.5;
        float mdf = roof ? 0.0 : meshDepthFt(duv);
        if (mdf > 0.04) {
          float above = vW.y / uK - surfaceM(duv); // m above the drawn water surface
          float soaked = 1.0 - smoothstep(0.25, 0.75, above); // wet and silt-stained, wicking up the wall (strong: sunlit walls sit
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.16, 0.13, 0.09), soaked); // near the tone-map shoulder)
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.07, 0.055, 0.035), (1.0 - smoothstep(0.02, 0.09, abs(above - 0.04))) * 0.9); // mud line
        }`);
  };
  buildings = new THREE.Mesh(geom, material);
  buildings.castShadow = buildings.receiveShadow = true;
  scene.add(buildings);
}

// ---------- evacuation cars ----------
let traffic = null;
const carGeom = new THREE.BoxGeometry(1.8, 1.45, 4.5).translate(0, 0.72, 0);
const carMat = new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.4, emissive: 0xffffff, emissiveIntensity: 0.0 });
let cars = null, exits = null, carPos = null, carPrev = null;
const on = [], onPrev = [];
const AMBER = new THREE.Color(0xffb547), RED = new THREE.Color(0xff5d73);
function useTraffic(next) {
  traffic = next;
  if (cars) scene.remove(cars, exits);
  const n = traffic.trips.start.length;
  cars = new THREE.InstancedMesh(carGeom, carMat, n);
  cars.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  cars.frustumCulled = false;
  carPos = new Float64Array(2 * n); carPrev = new Float64Array(2 * n);
  exits = new THREE.InstancedMesh(new THREE.CylinderGeometry(6, 6, 30, 16).translate(0, 15, 0),
    new THREE.MeshStandardMaterial({ color: 0x7ef0c4, emissive: 0x7ef0c4, emissiveIntensity: 0.8, transparent: true, opacity: 0.8 }), traffic.exits.length);
  const m = new THREE.Matrix4();
  traffic.exits.forEach(([ex, ey], i) => { const [x, z] = toWorld(ex + traffic.origin[0], ey + traffic.origin[1]); exits.setMatrixAt(i, m.makeTranslation(x, groundAt(x, z), z).scale(new THREE.Vector3(k, k, k))); });
  scene.add(cars, exits);
  drawCars();
}
const mtx = new THREE.Matrix4(), quat = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), scl = new THREE.Vector3(), at3 = new THREE.Vector3();
function drawCars() {
  if (!cars) return;
  const show = $('traffic-show').checked;
  cars.visible = exits.visible = show;
  if (!show) return;
  const seconds = t * 3600, [tx, ty] = traffic.origin;
  positionsAt(traffic.trips, seconds, carPos, on);
  positionsAt(traffic.trips, seconds - 20, carPrev, onPrev);
  const had = new Set(onPrev);
  // cars are drawn larger when the camera is far, so a street of traffic stays visible from the opening view
  const s = k * Math.max(1, camera.position.distanceTo(controls.target) / (900 * k));
  scl.set(s, s, s);
  let c = 0;
  for (const i of on) {
    const [x, z] = toWorld(carPos[2 * i] + tx, carPos[2 * i + 1] + ty);
    let heading = 0;
    if (had.has(i)) { const [px, pz] = toWorld(carPrev[2 * i] + tx, carPrev[2 * i + 1] + ty); if ((x - px) ** 2 + (z - pz) ** 2 > 0.01) heading = Math.atan2(x - px, z - pz); }
    quat.setFromAxisAngle(up, heading);
    cars.setMatrixAt(c, mtx.compose(at3.set(x, groundAt(x, z), z), quat, scl));
    cars.setColorAt(c, traffic.status[i] === 1 ? RED : AMBER);
    c++;
  }
  cars.count = c;
  cars.instanceMatrix.needsUpdate = true;
  if (cars.instanceColor) cars.instanceColor.needsUpdate = true;
  trafficCounts(traffic, t);
}
if (entry.evacuation) {
  const load = trafficLoader(id, 'Same evac-engine run as the 2D page: one car per household of night-time residents on OpenStreetMap roads, '
    + 'Greenshields speed-density with spillback and rerouting around roads deeper than 0.5 ft. Departure delays are a placeholder, not a calibrated warning curve. '
    + 'Cars are drawn larger than life when the camera is far away.', useTraffic, drawCars);
  load('base');
}

// ---------- camera and controls ----------
const controls = new OrbitControls(camera, renderer.domElement);
Object.assign(controls, { enableDamping: true, dampingFactor: 0.08, screenSpacePanning: false, maxPolarAngle: THREE.MathUtils.degToRad(86),
  minDistance: 25 * k, maxDistance: 120_000 * k, zoomToCursor: true });
controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };
controls.listenToKeyEvents(window);
controls.keyPanSpeed = 40;
{ // open tilted over the first neighbourhoods with water above the first floor, as the 3D page does
  const wet = props.filter(p => p.depth_max - p.found_ht > 2 && p.arrive_hr <= 6);
  const pick = wet.length ? wet : props;
  const R = 6378137, merc = p => [(R * p.lon * Math.PI) / 180, R * Math.log(Math.tan(Math.PI / 4 + (p.lat * Math.PI) / 360))];
  const [cx, cy] = pick.reduce(([a, b], p) => { const [x, y] = merc(p); return [a + x / pick.length, b + y / pick.length]; }, [0, 0]);
  const [x, z] = pick.length ? toWorld(cx, cy) : [0, 0];
  controls.target.set(x, groundAt(x, z), z);
  camera.position.copy(controls.target).add(new THREE.Vector3().setFromSphericalCoords(4200 * k, THREE.MathUtils.degToRad(58), THREE.MathUtils.degToRad(200)));
  controls.update();
}
setInterval(loadDetail, 1000); // pans by mouse, touch and keys alike
loadDetail();
let shadowAt = new THREE.Vector3(Infinity, 0, 0);
function placeSun() { // move the shadow window with the view target; redraw the map only after a real move
  if (!sun.castShadow || shadowAt.distanceTo(controls.target) < SHADOW_HALF * 0.25) return;
  shadowAt.copy(controls.target);
  sun.target.position.copy(controls.target);
  sun.position.copy(controls.target).addScaledVector(sunDir, 9000 * k);
  sun.target.updateMatrixWorld();
  renderer.shadowMap.needsUpdate = true;
}

// ---------- clock ----------
let t = start, summaryAt = 0;
function render(next) {
  t = Math.min(Math.max(next, hours[0]), hours.at(-1));
  const { i0, i1, w } = blend(t, hours);
  showFrames(i0, i1);
  water.material.uniforms.uW.value = slotFrame[0] === i0 && slotFrame[1] === i1 ? w : water.material.uniforms.uW.value;
  timeU.value = t;
  const s = !player.playing || performance.now() - summaryAt > 200 ? (summaryAt = performance.now(), summarize(props, t, hours)) : null;
  showStatus(t, frames[i0].wet_acres * (1 - w) + frames[i1].wet_acres * w, s);
  drawCars();
}
const player = createPlayer(hours, () => t, render);

// ---------- display options, building inspection ----------
$('impact').addEventListener('calciteSwitchChange', e => { impactU.value = e.target.checked ? 1 : 0; });
$('depth-colours').addEventListener('calciteSwitchChange', e => { water.material.uniforms.uDepthColours.value = e.target.checked ? 1 : 0; });
const raycaster = new THREE.Raycaster();
const popupFields = fieldInfos(scenario.arrival_labels).filter(f => f.fieldName !== 'arrive2_hr');
let downAt = null;
renderer.domElement.addEventListener('pointerdown', e => { downAt = [e.clientX, e.clientY]; });
renderer.domElement.addEventListener('pointerup', e => {
  if (!buildings || !downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 4) return; // a drag, not a click
  const r = renderer.domElement.getBoundingClientRect();
  raycaster.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
  const hit = raycaster.intersectObject(buildings)[0];
  if (!hit) { $('pick').hidden = true; return; }
  const b = buildings.geometry.attributes.aBld.getX(hit.face.a), p = byFd.get(fp.fd[b]) ?? {};
  const fmtv = (v, f) => (typeof v === 'number' ? v.toLocaleString('en-US', { maximumFractionDigits: f.format?.places ?? 2 }) : v);
  $('pick-title').textContent = p.occtype ? `${p.occtype} · NSI ${p.fd_id}` : 'Building';
  $('pick-rows').innerHTML = popupFields.filter(f => p[f.fieldName] != null).map(f => `<tr><th>${f.label}</th><td>${fmtv(p[f.fieldName], f)}</td></tr>`).join('')
    + `<tr><th>Drawn height (ft)</th><td>${Math.round(fp.attr[5 * b + 4]) || 12}</td></tr>`;
  $('pick').hidden = false;
});

// ---------- frame loop and smoothness readout ----------
const perf = (window.perf3js = { frames: [] });
let fpsT = performance.now(), fpsN = 0, worst = 0, prevT = fpsT;
function resize() {
  const { clientWidth: w, clientHeight: h } = container;
  if (renderer.domElement.width !== Math.round(w * renderer.getPixelRatio()) || renderer.domElement.height !== Math.round(h * renderer.getPixelRatio())) {
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  }
}
renderer.domElement.style.cssText = 'width:100%;height:100%;display:block;touch-action:none';
renderer.setAnimationLoop(now => {
  resize();
  controls.update();
  placeSun();
  water.material.uniforms.uTime.value = now / 1000;
  if (cars?.visible && !player.playing) drawCars(); // car size follows the camera distance
  renderer.render(scene, camera);
  const dt = now - prevT; prevT = now; fpsN += 1; worst = Math.max(worst, dt);
  if (now - fpsT >= 1000) {
    const fps = (fpsN * 1000) / (now - fpsT), info = renderer.info.render;
    perf.frames.push({ at: Math.round(now), fps: Number(fps.toFixed(1)), worst: Math.round(worst), playing: player.playing });
    $('perf').textContent = `${fps.toFixed(0)} fps, worst frame ${Math.round(worst)} ms · ${info.calls} draw calls, ${(info.triangles / 1e6).toFixed(2)} M triangles`
      + (performance.memory ? ` · JS heap ${Math.round(performance.memory.usedJSHeapSize / 2 ** 20)} MB` : '');
    fpsT = now; fpsN = 0; worst = 0;
  }
});
window.scene3js = { renderer, scene, camera, controls, render, player, groundAt, detail }; // for checks from DevTools
render(start);
loading.hidden = true;
