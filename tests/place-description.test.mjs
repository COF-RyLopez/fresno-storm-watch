import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describePlace, milesAndDirection, representativePoint } from '../site/lib/place-description.js';
import { roadConcerns } from '../site/lib/command-data.js';

const context = JSON.parse(await readFile(new URL('../site/data/command-context.json', import.meta.url), 'utf8'));
const cities = context.cities;

test('representative point: middle vertex of a line, bbox centre of a polygon', () => {
  assert.deepEqual(representativePoint({ type: 'LineString', coordinates: [[0, 0], [1, 1], [2, 2]] }), [1, 1]);
  assert.deepEqual(representativePoint({ type: 'Polygon', coordinates: [[[0, 0], [4, 0], [4, 2], [0, 2], [0, 0]]] }), [2, 1]);
  assert.equal(representativePoint(null), null);
});

test('miles and compass direction', () => {
  const { miles, direction } = milesAndDirection([-119.79, 36.74], [-119.79, 36.84]);
  assert.ok(Math.abs(miles - 6.9) < 0.1, String(miles));
  assert.equal(direction, 'N');
  assert.equal(milesAndDirection([-119.79, 36.74], [-119.9, 36.65]).direction, 'SW');
});

test('describePlace: inside a city, or distance and direction from the nearest one', () => {
  assert.equal(describePlace({ type: 'Point', coordinates: [-119.7871, 36.7378] }, cities), 'in Fresno'); // downtown Fresno
  const rural = describePlace({ type: 'LineString', coordinates: [[-120.10, 36.66], [-120.11, 36.66]] }, cities);
  assert.match(rural, /^\d+(\.\d)? mi (N|NE|E|SE|S|SW|W|NW) of [A-Z][a-z]+/);
  assert.equal(describePlace({ type: 'Point', coordinates: [-119.8, 36.7] }, []), null);
});

test('unnamed county road records are named by derived place and say the location is derived', () => {
  const row = {
    key: 'county-road:2:{x}', id: '{x}', layer: 2, kind: 'Detour', name: 'Unnamed county record', location: 'Location not supplied',
    comment: '', reason: '', alternateRoute: '', status: 'Active', issues: [], revision: 'r1',
    geometry: { paths: [[[-120.10, 36.66], [-120.11, 36.66]]] }
  };
  const [c] = roadConcerns({ rows: [row] }, null, Date.now(), cities);
  assert.match(c.name, /^Detour · \d/);
  assert.equal(c.features[0].properties.name, c.name);
  assert.ok(c.details.some(d => /^Mapped .* \(from the record's map line; the county record has no location text\)$/.test(d)), c.details.join(' | '));
  const [plain] = roadConcerns({ rows: [row] }, null, Date.now(), null);
  assert.equal(plain.name, 'Unnamed county record', 'without city boundaries nothing is invented');
  const [named] = roadConcerns({ rows: [{ ...row, name: 'BETHEL', location: 'Bethel at Manning' }] }, null, Date.now(), cities);
  assert.equal(named.name, 'BETHEL');
});
