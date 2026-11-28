/** County-wide 3D buildings for the county scene: zoom-13 BLD1 tiles (scripts/build-county3d-buildings.mjs) streamed around the
 *  view target when the camera is close, extruded on the terrain with hip roofs on simple houses (lib/flood-three-model.js
 *  hipRoof) and flat roofs elsewhere. Heights are Overture's where known, otherwise one storey (5 m). Reference context:
 *  footprints and heights are not verified against county records. */
import * as THREE from '../../vendor/three-0.187.0/three.module.js';

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
  // compile the building shader up front: its first draw otherwise stalls a frame for ~180 ms
  county.renderer.compileAsync?.(new THREE.Mesh(new THREE.BoxGeometry(), material), camera, scene).catch(() => {});
  const tiles = new Map(); // 'x/y' -> {state, mesh, used}
  let available = null, inflight = 0;
  const manifest = fetch(new URL('manifest.json', base), { cache: 'no-cache' }).then(r => (r.ok ? r.json() : Promise.reject(Error(r.status))))
    .then(m => { available = new Set(m.tiles.map(([x, y]) => `${x}/${y}`)); return m; }).catch(error => { console.warn('County buildings unavailable:', error.message); return null; });

  // Geometry is built in a worker (triangulation and roofs for ~13k buildings took hundreds of ms on the main thread); the
  // worker returns positions relative to each building's ground, and the main thread adds the terrain height per building.
  // Workers ignore the page's import map, so resolve through it here: the worker then loads the same cache-keyed modules.
  const resolve = path => new URL(import.meta.resolve?.(path) ?? path, import.meta.url).href;
  const worker = new Worker(URL.createObjectURL(new Blob([`
    import * as THREE from ${JSON.stringify(resolve('../../vendor/three-0.187.0/three.module.js'))};
    import { hipRoof } from ${JSON.stringify(resolve('../flood-three-model.js'))};
    onmessage = ({ data: { id, buffer, fox, foy, k, defaultHeight } }) => {
      try {
        const view = new DataView(buffer), n = view.getUint32(8, true), nv = view.getUint32(12, true), ox = view.getFloat64(16, true), oy = view.getFloat64(24, true);
        const start = new Uint32Array(buffer, 32, n + 1), xy = new Float32Array(buffer, 32 + 4 * (n + 1), 2 * nv), height = new Float32Array(buffer, 32 + 4 * (n + 1) + 8 * nv, n);
        const pos = [], col = [], owner = [], index = [], centre = new Float32Array(2 * n);
        for (let b = 0; b < n; b++) {
          const ring = [];
          for (let v = start[b]; v < start[b + 1]; v++) ring.push([xy[2 * v] + ox - fox, -(xy[2 * v + 1] + oy - foy)]);
          centre[2 * b] = ring.reduce((s, p) => s + p[0], 0) / ring.length; centre[2 * b + 1] = ring.reduce((s, p) => s + p[1], 0) / ring.length;
          const h = (Number.isFinite(height[b]) ? height[b] : defaultHeight) * k, hash = Math.abs(Math.sin(b * 12.9898 + ox) * 43758.5453) % 1;
          const wall = [0.42 + 0.18 * hash, 0.40 + 0.16 * hash, 0.36 + 0.14 * hash].map(c => c ** 2.2), roof = [0.20 + 0.2 * ((hash * 7) % 1), 0.17 + 0.1 * ((hash * 7) % 1), 0.15].map(c => c ** 2.2);
          const first = pos.length / 3, m = ring.length;
          for (const [x, z] of ring) { pos.push(x, -3 * k, z, x, h, z); col.push(...wall, ...wall); owner.push(b, b); }
          for (let j = 0; j < m; j++) { const a = first + 2 * j, c = first + 2 * ((j + 1) % m); index.push(a, c, a + 1, c, c + 1, a + 1); }
          const hip = hipRoof(ring, { maxArea: 600 * k * k });
          if (hip) { const r0 = pos.length / 3; for (let i = 0; i < hip.length; i += 3) { pos.push(hip[i], h + hip[i + 1], hip[i + 2]); col.push(...roof); owner.push(b); index.push(r0 + i / 3); } }
          else for (const [a, b2, c] of THREE.ShapeUtils.triangulateShape(ring.map(([x, z]) => new THREE.Vector2(x, z)), [])) index.push(first + 2 * a + 1, first + 2 * b2 + 1, first + 2 * c + 1);
        }
        const out = { id, n, position: new Float32Array(pos), color: new Float32Array(col), owner: new Uint32Array(owner), index: new Uint32Array(index), centre };
        postMessage(out, [out.position.buffer, out.color.buffer, out.owner.buffer, out.index.buffer, out.centre.buffer]);
      } catch (error) { postMessage({ id, error: String(error) }); }
    };`], { type: 'text/javascript' })), { type: 'module' });
  const jobs = new Map(); let jobId = 0;
  worker.onmessage = ({ data }) => { const j = jobs.get(data.id); jobs.delete(data.id); data.error ? j.reject(Error(data.error)) : j.resolve(data); };
  const buildInWorker = buffer => new Promise((resolve, reject) => { const id = ++jobId; jobs.set(id, { resolve, reject }); worker.postMessage({ id, buffer, fox: frame.ox, foy: frame.oy, k, defaultHeight: DEFAULT_HEIGHT }, [buffer]); });

  /** Seat each building on the terrain: relative heights from the worker plus the ground under its centre. */
  function seat(t) {
    const { relative, owner, centre, n } = t.parts, base = new Float32Array(n), pos = t.mesh.geometry.attributes.position.array;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let b = 0; b < n; b++) {
      const x = centre[2 * b], z = centre[2 * b + 1], y = (base[b] = county.terrain.groundAt(x, z) ?? 0);
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    for (let v = 0; v < owner.length; v++) pos[3 * v + 1] = relative[v] + base[owner[v]];
    t.mesh.geometry.attributes.position.needsUpdate = true;
    // a sphere from building centres (the tile) padded by the largest footprint and height; computeBoundingSphere scans every vertex
    const pad = t.parts.reach, c = new THREE.Vector3((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    t.mesh.geometry.boundingSphere = new THREE.Sphere(c, Math.hypot(x1 - x0, y1 - y0, z1 - z0) / 2 + pad);
  }
  function meshFrom(parts) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(parts.position, 3));
    g.setAttribute('color', new THREE.BufferAttribute(parts.color, 3));
    g.setIndex(new THREE.BufferAttribute(parts.index, 1));
    const relative = new Float32Array(parts.owner.length), { position: p, owner, centre } = parts;
    let reach = 0;
    for (let v = 0; v < relative.length; v++) {
      relative[v] = p[3 * v + 1];
      reach = Math.max(reach, Math.abs(p[3 * v + 1]), Math.abs(p[3 * v] - centre[2 * owner[v]]), Math.abs(p[3 * v + 2] - centre[2 * owner[v] + 1]));
    }
    return { mesh: new THREE.Mesh(g, material), parts: { relative, owner, centre, n: parts.n, reach: reach * Math.SQRT2 } };
  }

  async function load(key) {
    const t = { state: 'loading', mesh: null, used: performance.now(), built: 0 };
    tiles.set(key, t); inflight++;
    try {
      const response = await fetch(new URL(`${Z}/${key}.bin.gz`, base));
      if (!response.ok) throw Error(response.status);
      const built = meshFrom(await buildInWorker(await inflate(response)));
      Object.assign(t, built); seat(t); t.built = performance.now(); group.add(t.mesh); t.state = 'ready';
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
      if (t.state === 'ready' && t.built && now - t.built > 4000 && !t.reseated) { seat(t); t.reseated = true; } // finer terrain has arrived
      if (now - t.used > 20_000 && t.mesh) { group.remove(t.mesh); t.mesh.geometry.dispose(); tiles.delete(key); }
      else if (t.mesh && now - t.used > 100) t.mesh.visible = false;
    }
  });
  return { group, manifest, dispose() { worker.terminate(); for (const t of tiles.values()) t.mesh?.geometry.dispose(); material.dispose(); scene.remove(group); } };
}
