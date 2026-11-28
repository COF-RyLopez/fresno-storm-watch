/** County scene core: renderer, sky and sun at the real sun position, controls, streamed terrain, frame loop with an
 *  honest smoothness readout and adaptive resolution. Layers add themselves to `scene` and register per-frame hooks. */
import * as THREE from '../../vendor/three-0.187.0/three.module.js';
import { OrbitControls } from '../../vendor/three-0.187.0/addons/OrbitControls.js';
import { Sky } from '../../vendor/three-0.187.0/addons/Sky.js';
import { COUNTY_BOUNDS, createFrame, sunPosition } from './frame.js';
import { createTerrain } from './terrain.js';

/**
 * @param {{container: HTMLElement, bounds?: number[], time?: Date, terrain?: object, onPerf?: (p: object) => void,
 *   maxPixelRatio?: number}} options
 */
export function createCountyScene({ container, bounds = COUNTY_BOUNDS, time = new Date(), terrain: terrainOptions = {}, onPerf = () => {}, maxPixelRatio = 2 }) {
  const frame = createFrame(bounds), { k } = frame;
  const [lonC, latC] = [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2];
  // Reversed depth where supported keeps early-z; logarithmic depth is only the fallback (it disables early-z).
  const renderer = new THREE.WebGLRenderer({ antialias: true, reversedDepthBuffer: true, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
  const maxRatio = Math.min(devicePixelRatio, maxPixelRatio);
  let ratio = maxRatio;
  renderer.setPixelRatio(ratio);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.55;
  renderer.domElement.style.cssText = 'width:100%;height:100%;display:block;touch-action:none';
  container.append(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 5, 2.5e6);

  // ---------- sky, sun, light ----------
  const sky = new Sky(), skyScene = new THREE.Scene().add(sky);
  sky.scale.setScalar(1e4);
  Object.assign(sky.material.uniforms.turbidity, { value: 3 });
  Object.assign(sky.material.uniforms.rayleigh, { value: 1.2 });
  if (sky.material.uniforms.cloudCoverage) sky.material.uniforms.cloudCoverage.value = 0.3;
  const cube = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType });
  const cubeCamera = new THREE.CubeCamera(1, 2e4, cube);
  const pmrem = new THREE.PMREMGenerator(renderer);
  let envRT = null;
  const sun = new THREE.DirectionalLight(0xfff1dc, 2.2), hemi = new THREE.HemisphereLight(0xcfe4ff, 0x6b5a40, 0.5);
  scene.add(sun, sun.target, hemi);
  scene.fog = new THREE.FogExp2(0xb4c3ce, 1 / (700_000 * k)); // light aerial perspective: the county view spans ~250 km
  const sunDir = new THREE.Vector3();
  let clock = time;
  /** Set the scene clock: moves the sun and sky (night is dark), returns {elevation, azimuth}. */
  function setTime(date) {
    clock = date;
    const { elevation, azimuth } = sunPosition(date, lonC, latC), e = THREE.MathUtils.degToRad(elevation), a = THREE.MathUtils.degToRad(azimuth);
    sunDir.set(Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e));
    sky.material.uniforms.sunPosition.value.copy(sunDir);
    sun.position.copy(sunDir).multiplyScalar(100_000 * k); // a directional light only uses position - target
    cubeCamera.update(renderer, skyScene);
    scene.background = cube.texture;
    envRT?.dispose();
    envRT = pmrem.fromScene(skyScene, 0.02);
    scene.environment = envRT.texture;
    const day = THREE.MathUtils.smoothstep(elevation, -4, 8);
    sun.intensity = 2.2 * THREE.MathUtils.smoothstep(elevation, 0, 10);
    sun.color.setHSL(0.09, 0.6, 0.5 + 0.4 * THREE.MathUtils.smoothstep(elevation, 2, 25));
    hemi.intensity = 0.06 + 0.44 * day;
    scene.environmentIntensity = 0.12 + 0.48 * day;
    scene.fog.color.setRGB(0.04 + 0.66 * day, 0.05 + 0.71 * day, 0.07 + 0.74 * day);
    return { elevation, azimuth };
  }

  // ---------- controls: drag pans, right-drag rotates, wheel zooms toward the cursor ----------
  const controls = new OrbitControls(camera, renderer.domElement);
  Object.assign(controls, { enableDamping: true, dampingFactor: 0.08, screenSpacePanning: false, maxPolarAngle: THREE.MathUtils.degToRad(84),
    minDistance: 40 * k, maxDistance: 600_000 * k, zoomToCursor: true });
  controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
  controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };
  controls.listenToKeyEvents(window);
  controls.keyPanSpeed = 60;

  const terrain = createTerrain({ frame, renderer, ...terrainOptions });
  scene.add(terrain.group);
  const groundAt = (x, z) => terrain.groundAt(x, z) ?? 0;

  /** Look at lon/lat from `distance` ground metres, `tilt` degrees from straight down, `heading` degrees clockwise from north. */
  function view(lon, lat, distance, tilt = 55, heading = 0) {
    const [x, z] = frame.project(lon, lat);
    controls.target.set(x, groundAt(x, z), z);
    const p = THREE.MathUtils.degToRad(tilt), h = THREE.MathUtils.degToRad(heading);
    // the camera sits opposite the heading: looking north means standing south of the target
    camera.position.set(x - Math.sin(h) * Math.sin(p) * distance * k, controls.target.y + Math.cos(p) * distance * k, z + Math.cos(h) * Math.sin(p) * distance * k);
    controls.update();
  }

  // ---------- frame loop ----------
  const hooks = new Set();
  const times = [];
  let last = performance.now(), perfAt = last, frames = 0, worst = 0;
  function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    if (!w || !h) return false;
    if (renderer.domElement.width !== Math.round(w * renderer.getPixelRatio()) || renderer.domElement.height !== Math.round(h * renderer.getPixelRatio())) {
      renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
    }
    return true;
  }
  renderer.setAnimationLoop(now => {
    if (!resize()) return;
    const dt = now - last; last = now;
    controls.update();
    // keep the pivot on the ground and the camera above it
    const tg = terrain.groundAt(controls.target.x, controls.target.z);
    if (tg !== null) controls.target.y += (tg - controls.target.y) * 0.2;
    const cg = terrain.groundAt(camera.position.x, camera.position.z);
    if (cg !== null && camera.position.y < cg + 25 * k) camera.position.y = cg + 25 * k;
    for (const hook of hooks) hook(now, dt);
    terrain.update(camera, container.clientHeight);
    renderer.render(scene, camera);
    frames++; worst = Math.max(worst, dt); times.push(dt);
    if (times.length > 90) times.shift();
    if (now - perfAt >= 1000) {
      const fps = (frames * 1000) / (now - perfAt), med = [...times].sort((a, b) => a - b)[times.length >> 1];
      // adaptive resolution: trade pixels for smoothness before dropping anything from the picture
      if (med > 24 && ratio > 1) ratio = Math.max(1, ratio - 0.25);
      else if (med < 14 && ratio < maxRatio) ratio = Math.min(maxRatio, ratio + 0.25);
      if (ratio !== renderer.getPixelRatio()) renderer.setPixelRatio(ratio);
      const info = renderer.info.render;
      onPerf({ fps, worst, pixelRatio: ratio, calls: info.calls, triangles: info.triangles, terrain: terrain.stats() });
      perfAt = now; frames = 0; worst = 0;
    }
  });

  setTime(time);
  view((bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2, 230_000, 40);

  return {
    THREE, frame, renderer, scene, camera, controls, terrain, groundAt, setTime, view, sun, sunDir,
    get time() { return clock; },
    /** Register a per-frame hook (now ms, dt ms); returns an unsubscribe function. */
    onFrame(fn) { hooks.add(fn); return () => hooks.delete(fn); },
    destroy() { renderer.setAnimationLoop(null); terrain.dispose(); controls.dispose(); envRT?.dispose(); cube.dispose(); pmrem.dispose(); renderer.dispose(); renderer.domElement.remove(); }
  };
}
