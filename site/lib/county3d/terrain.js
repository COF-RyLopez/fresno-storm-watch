/** Streamed quadtree terrain for the county scene (plan stage A): each node is one XYZ tile with a 32 x 32 grid of
 *  Terrarium heights and a 512 px Esri World Imagery texture (its four children at zoom + 1). Nodes split by
 *  screen-space texel size, draw their parent until all four children are ready (no holes), hide cracks with skirts,
 *  and are decoded off the main thread. Swapping DEM/IMAGERY templates is how the pre-rendered stage B base plugs in. */
import * as THREE from '../../vendor/three-0.187.0/three.module.js';
import { screenPixels, tileTouches, tilesCovering } from './frame.js';

export const DEM = (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
export const IMAGERY = (z, x, y) => `https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
const N = 32, ROOT_Z = 6, DEM_MAX_Z = 14, TEX = 512;
// Coarse context around the county (about 5 degrees each way) so wide views never show the edge of the base.
const CONTEXT_DEGREES = 5;

// Fetch and decode in workers: PNG decode and getImageData on the main thread stall the frame loop.
const WORKER = `
const terrarium = (r, g, b) => r * 256 + g + b / 256 - 32768;
const get = url => fetch(url, { mode: 'cors' }).then(r => r.ok ? r.blob() : Promise.reject(new Error(r.status))).then(createImageBitmap);
onmessage = async ({ data: { id, kind, urls } }) => {
  try {
    if (kind === 'dem') {
      const bmp = await get(urls[0]), c = new OffscreenCanvas(256, 256).getContext('2d', { willReadFrequently: true });
      c.drawImage(bmp, 0, 0);
      const px = c.getImageData(0, 0, 256, 256).data, h = new Float32Array(65536);
      for (let i = 0; i < 65536; i++) h[i] = terrarium(px[4 * i], px[4 * i + 1], px[4 * i + 2]);
      postMessage({ id, h }, [h.buffer]);
    } else {
      const canvas = new OffscreenCanvas(${TEX}, ${TEX}), c = canvas.getContext('2d');
      c.fillStyle = '#4a4f47'; c.fillRect(0, 0, ${TEX}, ${TEX});
      const half = ${TEX / 2};
      const got = await Promise.all(urls.map((u, i) => get(u).then(b => { c.drawImage(b, (i % 2) * half, (i >> 1) * half, half, half); return 1; }, () => 0)));
      const bitmap = canvas.transferToImageBitmap();
      postMessage({ id, bitmap, missing: got.filter(v => !v).length }, [bitmap]);
    }
  } catch (error) { postMessage({ id, error: String(error) }); }
};`;

/** Shared index and uv buffers: an (N+1)^2 grid plus a skirt ring, (N+3)^2 vertices. */
function gridBuffers() {
  const S = N + 3, uv = new Float32Array(S * S * 2), index = [];
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
    const u = Math.min(Math.max(i - 1, 0), N) / N, v = Math.min(Math.max(j - 1, 0), N) / N;
    uv.set([u, v], 2 * (j * S + i));
  }
  for (let j = 0; j < S - 1; j++) for (let i = 0; i < S - 1; i++) {
    const a = j * S + i, b = a + S;
    index.push(a, b, a + 1, a + 1, b, b + 1);
  }
  return { uv: new THREE.BufferAttribute(uv, 2), index: new THREE.Uint16BufferAttribute(index, 1) };
}

/**
 * @param {{frame: ReturnType<import('./frame.js').createFrame>, renderer: THREE.WebGLRenderer, dem?: Function, imagery?: Function,
 *   maxZoom?: number, outsideMaxZoom?: number, detail?: number, maxNodes?: number, decorate?: (m: THREE.MeshStandardMaterial) => void}} options
 */
export function createTerrain({ frame, renderer, dem = DEM, imagery = IMAGERY, maxZoom = 16, outsideMaxZoom = 10, detail = 1.25, maxNodes = 700, decorate = () => {} }) {
  const { k } = frame, group = new THREE.Group(), shared = gridBuffers();
  const anisotropy = renderer.capabilities.getMaxAnisotropy();
  const workers = [0, 1, 2].map(() => new Worker(URL.createObjectURL(new Blob([WORKER], { type: 'text/javascript' }))));
  const jobs = new Map();
  let jobId = 0, turn = 0;
  workers.forEach(w => { w.onmessage = ({ data }) => { const j = jobs.get(data.id); jobs.delete(data.id); data.error ? j.reject(new Error(data.error)) : j.resolve(data); }; });
  const run = (kind, urls) => new Promise((resolve, reject) => {
    const id = ++jobId; jobs.set(id, { resolve, reject });
    workers[turn++ % workers.length].postMessage({ id, kind, urls });
  });
  const demCache = new Map(); // 'z/x/y' -> Promise<Float32Array>, least recently used first
  function demTile(z, x, y) {
    const key = `${z}/${x}/${y}`;
    let p = demCache.get(key);
    if (p) { demCache.delete(key); demCache.set(key, p); return p; }
    p = run('dem', [dem(z, x, y)]).then(d => d.h, () => new Float32Array(65536)); // unreachable elevation reads as sea level
    demCache.set(key, p);
    if (demCache.size > 300) demCache.delete(demCache.keys().next().value);
    return p;
  }

  class Node {
    constructor(z, x, y, parent) {
      Object.assign(this, { z, x, y, parent, children: null, state: 'empty', mesh: null, used: 0, heights: null, minY: 0, maxY: 4000 * k });
      this.rect = frame.tileRect(z, x, y);
      this.inside = tileTouches(frame.bounds, z, x, y);
    }
    get maxZ() { return this.inside ? maxZoom : outsideMaxZoom; }
  }
  const [bw, bs, be, bn] = frame.bounds, context = [bw - CONTEXT_DEGREES, bs - CONTEXT_DEGREES, be + CONTEXT_DEGREES, bn + CONTEXT_DEGREES];
  const roots = tilesCovering(context, ROOT_Z).map(([z, x, y]) => new Node(z, x, y, null));
  const loaded = new Set();
  let inflight = 0, frameNo = 0;

  async function load(node) {
    node.state = 'loading'; inflight++;
    try {
      const { z, x, y, rect } = node, zd = Math.min(z, DEM_MAX_Z), scale = 2 ** (z - zd);
      const dx = Math.floor(x / scale), dy = Math.floor(y / scale), ox = x - dx * scale, oy = y - dy * scale;
      const zi = z + 1, kids = [[2 * x, 2 * y], [2 * x + 1, 2 * y], [2 * x, 2 * y + 1], [2 * x + 1, 2 * y + 1]];
      const [h, img] = await Promise.all([demTile(zd, dx, dy), run('img', kids.map(([cx, cy]) => imagery(zi, cx, cy)))]);
      // heights at the (N+1)^2 vertices, bilinear in the (possibly ancestor) DEM tile
      const S = N + 1, grid = new Float32Array(S * S);
      for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
        const px = Math.min(Math.max(((ox + i / N) / scale) * 256 - 0.5, 0), 255), py = Math.min(Math.max(((oy + j / N) / scale) * 256 - 0.5, 0), 255);
        const x0 = Math.floor(px), y0 = Math.floor(py), x1 = Math.min(x0 + 1, 255), y1 = Math.min(y0 + 1, 255), fx = px - x0, fy = py - y0;
        const top = h[y0 * 256 + x0] * (1 - fx) + h[y0 * 256 + x1] * fx, bottom = h[y1 * 256 + x0] * (1 - fx) + h[y1 * 256 + x1] * fx;
        grid[j * S + i] = Math.max(top * (1 - fy) + bottom * fy, -100) * k;
      }
      if (node.state !== 'loading') { img.bitmap.close(); return; } // disposed while loading
      const T = N + 3, pos = new Float32Array(T * T * 3), nor = new Float32Array(T * T * 3), step = rect.size / N;
      const cx = (rect.x0 + rect.x1) / 2, cz = (rect.z0 + rect.z1) / 2, skirt = Math.max(rect.size / N, 30 * k);
      const H = (i, j) => grid[Math.min(Math.max(j, 0), N) * S + Math.min(Math.max(i, 0), N)];
      let minY = Infinity, maxY = -Infinity;
      for (let j = 0; j < T; j++) for (let i = 0; i < T; i++) {
        const gi = Math.min(Math.max(i - 1, 0), N), gj = Math.min(Math.max(j - 1, 0), N), edge = i === 0 || j === 0 || i === T - 1 || j === T - 1;
        const y = H(gi, gj), o = 3 * (j * T + i);
        pos[o] = rect.x0 + gi * step - cx; pos[o + 1] = edge ? y - skirt : y; pos[o + 2] = rect.z0 + gj * step - cz;
        const nx = -(H(gi + 1, gj) - H(gi - 1, gj)) / (2 * step), nz = -(H(gi, gj + 1) - H(gi, gj - 1)) / (2 * step), l = Math.hypot(nx, 1, nz);
        nor[o] = nx / l; nor[o + 1] = 1 / l; nor[o + 2] = nz / l;
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      }
      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geom.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      geom.setAttribute('uv', shared.uv);
      geom.setIndex(shared.index);
      geom.computeBoundingSphere();
      const map = new THREE.Texture(img.bitmap);
      Object.assign(map, { colorSpace: THREE.SRGBColorSpace, flipY: false, anisotropy, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, needsUpdate: true });
      const material = new THREE.MeshStandardMaterial({ map, roughness: 0.95, metalness: 0 });
      decorate(material);
      const mesh = new THREE.Mesh(geom, material);
      mesh.position.set(cx, 0, cz);
      mesh.visible = false;
      mesh.receiveShadow = true;
      mesh.userData.node = node;
      group.add(mesh);
      Object.assign(node, { mesh, heights: grid, minY, maxY, state: 'ready', missingImagery: img.missing });
      loaded.add(node);
    } catch (error) {
      console.warn('Terrain tile', node.z, node.x, node.y, error.message);
      node.state = 'failed';
    } finally { inflight--; }
  }

  function unload(node) {
    if (node.mesh) { group.remove(node.mesh); node.mesh.geometry.dispose(); node.mesh.material.map.dispose(); node.mesh.material.dispose(); }
    Object.assign(node, { mesh: null, heights: null, state: 'empty' });
    loaded.delete(node);
  }

  const camPos = new THREE.Vector3();
  /** Choose and show the nodes for this camera; queue loads. Call once per frame before rendering. */
  function update(camera, viewportPx) {
    frameNo++;
    camPos.copy(camera.position);
    for (const n of loaded) n.mesh.visible = false;
    const wanted = [];
    const distanceTo = n => {
      const { x0, x1, z0, z1 } = n.rect;
      const dx = Math.max(x0 - camPos.x, 0, camPos.x - x1), dz = Math.max(z0 - camPos.z, 0, camPos.z - z1);
      const dy = Math.max(n.minY - camPos.y, 0, camPos.y - n.maxY);
      return Math.hypot(dx, dy, dz);
    };
    const wantsSplit = (n, d) => n.z < n.maxZ && screenPixels(n.rect.size / 512, d, camera.fov, viewportPx) > detail;
    function visit(n) {
      n.used = frameNo;
      const d = distanceTo(n);
      if (n.state !== 'ready') { if (n.state === 'empty') wanted.push([d, n]); return; }
      if (wantsSplit(n, d)) {
        n.children ??= [0, 1, 2, 3].map(q => new Node(n.z + 1, 2 * n.x + (q & 1), 2 * n.y + (q >> 1), n));
        if (n.children.every(c => c.state === 'ready' || c.state === 'failed') && n.children.some(c => c.state === 'ready')) {
          for (const c of n.children) c.state === 'ready' ? visit(c) : (c.used = frameNo);
          if (n.children.some(c => c.state === 'failed')) n.mesh.visible = true; // keep the parent under a failed child
          return;
        }
        for (const c of n.children) { c.used = frameNo; if (c.state === 'empty') wanted.push([distanceTo(c), c]); }
      }
      n.mesh.visible = true;
    }
    roots.forEach(visit);
    wanted.sort((a, b) => a[0] - b[0] || a[1].z - b[1].z);
    for (const [, n] of wanted) { if (inflight >= 12) break; load(n); }
    if (loaded.size > maxNodes) {
      const stale = [...loaded].filter(n => n.parent && n.used < frameNo - 30).sort((a, b) => a.used - b.used);
      for (const n of stale.slice(0, loaded.size - maxNodes)) unload(n);
    }
  }

  /** Ground height (world units) at world x, z from the finest loaded tile, or null outside the base. */
  function groundAt(x, z) {
    let n = roots.find(r => x >= r.rect.x0 && x < r.rect.x1 && z >= r.rect.z0 && z < r.rect.z1);
    let best = null;
    while (n) {
      if (n.state === 'ready') best = n;
      const c = n.children?.find(c => x >= c.rect.x0 && x < c.rect.x1 && z >= c.rect.z0 && z < c.rect.z1);
      if (!c || c.state !== 'ready') break;
      n = c;
    }
    if (!best) return null;
    const { rect, heights } = best, S = N + 1;
    const u = Math.min(Math.max(((x - rect.x0) / rect.size) * N, 0), N), v = Math.min(Math.max(((z - rect.z0) / rect.size) * N, 0), N);
    const i0 = Math.min(Math.floor(u), N - 1), j0 = Math.min(Math.floor(v), N - 1), fx = u - i0, fy = v - j0;
    const at = (i, j) => heights[j * S + i];
    return (at(i0, j0) * (1 - fx) + at(i0 + 1, j0) * fx) * (1 - fy) + (at(i0, j0 + 1) * (1 - fx) + at(i0 + 1, j0 + 1) * fx) * fy;
  }

  return {
    group, update, groundAt,
    /** true when nothing is loading and nothing visible is waiting on a split */
    get idle() { return inflight === 0; },
    stats: () => ({ loaded: loaded.size, inflight, visible: [...loaded].filter(n => n.mesh.visible).length, maxZ: Math.max(0, ...[...loaded].filter(n => n.mesh.visible).map(n => n.z)) }),
    dispose() { for (const n of [...loaded]) unload(n); workers.forEach(w => w.terminate()); }
  };
}
