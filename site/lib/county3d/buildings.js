/** County-wide 3D buildings for the county scene: zoom-13 BLD1 tiles (scripts/build-county3d-buildings.mjs) streamed around the
 *  view target when the camera is close, extruded on the terrain with hip roofs on simple houses (lib/flood-three-model.js
 *  hipRoof) and flat roofs elsewhere. Heights are Overture's where known, otherwise one storey (5 m). Reference context:
 *  footprints and heights are not verified against county records. */
import * as THREE from '../../vendor/three-0.187.0/three.module.js';
import { hipRoof } from '../flood-three-model.js';

const Z = 13, R = 6378137, HALF = Math.PI * R, DEFAULT_HEIGHT = 5, SHOW_WITHIN = 14_000; // ground metres camera-to-target

/** BLD1 tile (gunzipped) -> {n, nv, origin, start, xy, height}. */
export function parseBuildings(buffer) {
  const view = new DataView(buffer);
  if (String.fromCharCode(...new Uint8Array(buffer, 0, 4)) !== 'BLD1' || view.getUint32(4, true) !== 1) throw Error('Not a BLD1 v1 tile');
  const n = view.getUint32(8, true), nv = view.getUint32(12, true);
  const start = new Uint32Array(buffer, 32, n + 1), xy = new Float32Array(buffer, 32 + 4 * (n + 1), 2 * nv), height = new Float32Array(buffer, 32 + 4 * (n + 1) + 8 * nv, n);
  return { n, nv, origin: [view.getFloat64(16, true), view.getFloat64(24, true)], start, xy, height };
}

async function inflate(response) {
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return bytes.buffer; // already decoded by Content-Encoding
  return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
}

/**
 * @param {{county: ReturnType<typeof import('./core.js').createCountyScene>, baseUrl: string|URL}} options
 */
export function createBuildings({ county, baseUrl }) {
  const { scene, camera, controls, frame } = county, k = frame.k, base = new URL(baseUrl, location.href);
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0, flatShading: true });
  const group = new THREE.Group(); scene.add(group);
  const tiles = new Map(); // 'x/y' -> {state, mesh, used}
  let available = null, inflight = 0;
  const manifest = fetch(new URL('manifest.json', base), { cache: 'no-cache' }).then(r => (r.ok ? r.json() : Promise.reject(Error(r.status))))
    .then(m => { available = new Set(m.tiles.map(([x, y]) => `${x}/${y}`)); return m; }).catch(error => { console.warn('County buildings unavailable:', error.message); return null; });

  function build(data) {
    const pos = [], col = [], index = [];
    const [ox, oy] = data.origin;
    const wall = new THREE.Color(), roofColor = new THREE.Color();
    for (let b = 0; b < data.n; b++) {
      const s = data.start[b], e = data.start[b + 1], ring = [];
      for (let v = s; v < e; v++) { const [x, z] = [data.xy[2 * v] + ox - frame.ox, -(data.xy[2 * v + 1] + oy - frame.oy)]; ring.push([x, z]); }
      let lo = Infinity;
      for (const [x, z] of ring) lo = Math.min(lo, county.terrain.groundAt(x, z) ?? 0);
      const h = (Number.isFinite(data.height[b]) ? data.height[b] : DEFAULT_HEIGHT) * k, top = lo + h;
      const hash = Math.abs(Math.sin(b * 12.9898 + ox) * 43758.5453) % 1;
      wall.setRGB(0.42 + 0.18 * hash, 0.40 + 0.16 * hash, 0.36 + 0.14 * hash, THREE.SRGBColorSpace);
      roofColor.setRGB(0.20 + 0.2 * ((hash * 7) % 1), 0.17 + 0.1 * ((hash * 7) % 1), 0.15, THREE.SRGBColorSpace);
      const first = pos.length / 3;
      for (const [x, z] of ring) { pos.push(x, lo - 1 * k, z, x, top, z); col.push(wall.r, wall.g, wall.b, wall.r, wall.g, wall.b); }
      const m = ring.length;
      for (let j = 0; j < m; j++) { const a = first + 2 * j, c = first + 2 * ((j + 1) % m); index.push(a, c, a + 1, c, c + 1, a + 1); }
      const roof = hipRoof(ring, { maxArea: 600 * k * k });
      if (roof) {
        const r0 = pos.length / 3;
        for (let i = 0; i < roof.length; i += 3) { pos.push(roof[i], top + roof[i + 1], roof[i + 2]); col.push(roofColor.r, roofColor.g, roofColor.b); index.push(r0 + i / 3); }
      } else {
        for (const [a, b2, c] of THREE.ShapeUtils.triangulateShape(ring.map(([x, z]) => new THREE.Vector2(x, z)), [])) index.push(first + 2 * a + 1, first + 2 * b2 + 1, first + 2 * c + 1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(index); g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, material);
    mesh.castShadow = mesh.receiveShadow = false;
    return mesh;
  }

  async function load(key) {
    const t = { state: 'loading', mesh: null, used: performance.now(), built: 0 };
    tiles.set(key, t); inflight++;
    try {
      const response = await fetch(new URL(`${Z}/${key}.bin.gz`, base));
      if (!response.ok) throw Error(response.status);
      t.data = parseBuildings(await inflate(response));
      t.mesh = build(t.data); t.built = performance.now(); group.add(t.mesh); t.state = 'ready';
    } catch (error) { t.state = 'failed'; console.warn('Building tile', key, error.message); }
    finally { inflight--; }
  }

  county.onFrame(now => {
    const d = camera.position.distanceTo(controls.target) / k;
    group.visible = d < SHOW_WITHIN;
    if (!available || !group.visible) return;
    // tiles within about 1.4 view distances of the target (ground metres), nearest first
    const radius = Math.max(1500, d * 1.4) * k, size = (2 * HALF) / 2 ** Z;
    const cx = controls.target.x + frame.ox, cy = -controls.target.z + frame.oy;
    const x0 = Math.floor((cx - radius + HALF) / size), x1 = Math.floor((cx + radius + HALF) / size);
    const y0 = Math.floor((HALF - (cy + radius)) / size), y1 = Math.floor((HALF - (cy - radius)) / size);
    const wanted = [];
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const key = `${x}/${y}`;
      if (!available.has(key)) continue;
      const t = tiles.get(key);
      if (t) { t.used = now; if (t.mesh) t.mesh.visible = true; }
      else wanted.push([Math.hypot(-HALF + (x + 0.5) * size - cx, HALF - (y + 0.5) * size - cy), key]);
    }
    wanted.sort((a, b) => a[0] - b[0]);
    for (const [, key] of wanted) { if (inflight >= 4) break; load(key); }
    // re-seat once on finer terrain, and drop tiles unused for a while
    for (const [key, t] of tiles) {
      if (t.state === 'ready' && t.built && now - t.built > 4000 && !t.reseated) { group.remove(t.mesh); t.mesh.geometry.dispose(); t.mesh = build(t.data); group.add(t.mesh); t.reseated = true; }
      if (now - t.used > 20_000 && t.mesh) { group.remove(t.mesh); t.mesh.geometry.dispose(); tiles.delete(key); }
      else if (t.mesh && now - t.used > 100) t.mesh.visible = false;
    }
  });
  return { group, manifest, dispose() { for (const t of tiles.values()) t.mesh?.geometry.dispose(); material.dispose(); scene.remove(group); } };
}
