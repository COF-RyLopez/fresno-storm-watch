import test from 'node:test';
import assert from 'node:assert/strict';
import { COUNTY_BOUNDS, createFrame, screenPixels, sunPosition, terrarium, tilesCovering, tileTouches } from '../site/lib/county3d/frame.js';

test('frame: project and unproject round-trip; north is -z, east is +x; k matches the latitude', () => {
  const f = createFrame();
  const [x, z] = f.project(-119.7871, 36.7378);
  assert.deepEqual(f.unproject(x, z).map(v => +v.toFixed(9)), [-119.7871, 36.7378]);
  const [xe] = f.project(-119.0, 36.7378), [, zn] = f.project(-119.7871, 37.5);
  assert.ok(xe > x && zn < z);
  const latC = f.unproject(0, 0)[1];
  assert.ok(Math.abs(f.k - 1 / Math.cos((latC * Math.PI) / 180)) < 1e-12);
});

test('frame: XYZ tile rectangles tile the plane exactly and children split their parent', () => {
  const f = createFrame(), p = f.tileRect(10, 176, 397), kids = [[352, 794], [353, 794], [352, 795], [353, 795]].map(([x, y]) => f.tileRect(11, x, y));
  assert.ok(Math.abs(kids[0].x0 - p.x0) < 1e-6 && Math.abs(kids[1].x1 - p.x1) < 1e-6 && Math.abs(kids[0].z0 - p.z0) < 1e-6 && Math.abs(kids[3].z1 - p.z1) < 1e-6);
  assert.ok(Math.abs(kids[0].x1 - kids[1].x0) < 1e-6 && Math.abs(kids[0].z1 - kids[2].z0) < 1e-6);
  assert.ok(p.z1 > p.z0, 'z grows southward');
});

test('frame: county root tiles cover the bounds and touch tests agree', () => {
  const roots = tilesCovering(COUNTY_BOUNDS, 8);
  assert.ok(roots.length >= 2 && roots.length <= 6, `${roots.length} roots`);
  for (const [z, x, y] of roots) assert.ok(tileTouches(COUNTY_BOUNDS, z, x, y));
  const f = createFrame(), [w, s, e, n] = COUNTY_BOUNDS, corners = [[w, s], [e, n], [w, n], [e, s]].map(([lon, lat]) => f.project(lon, lat));
  for (const [cx, cz] of corners) assert.ok(roots.some(([z, x, y]) => { const r = f.tileRect(z, x, y); return cx >= r.x0 && cx <= r.x1 && cz >= r.z0 && cz <= r.z1; }));
  assert.equal(tileTouches(COUNTY_BOUNDS, 8, 0, 0), false);
});

test('terrarium decoding and screen-space size', () => {
  assert.equal(terrarium(128, 0, 0), 0);
  assert.equal(terrarium(128, 100, 128), 100.5);
  assert.ok(Math.abs(screenPixels(1, 1000, 90, 1000) - 0.5) < 1e-12);
});

test('sun position at Fresno: solstice solar noon elevations and an evening sun in the west', () => {
  const summer = sunPosition(new Date('2026-06-21T19:58:00Z'), -119.79, 36.74);
  assert.ok(Math.abs(summer.elevation - 76.7) < 1, `summer ${summer.elevation}`);
  assert.ok(Math.abs(summer.azimuth - 180) < 5, `summer azimuth ${summer.azimuth}`);
  const winter = sunPosition(new Date('2026-12-21T19:57:00Z'), -119.79, 36.74);
  assert.ok(Math.abs(winter.elevation - 29.8) < 1, `winter ${winter.elevation}`);
  const evening = sunPosition(new Date('2026-06-21T03:00:00Z'), -119.79, 36.74); // 8 pm PDT
  assert.ok(evening.elevation > -5 && evening.elevation < 15 && evening.azimuth > 270 && evening.azimuth < 310, JSON.stringify(evening));
  assert.ok(sunPosition(new Date('2026-12-21T10:00:00Z'), -119.79, 36.74).elevation < -30, 'night');
});
