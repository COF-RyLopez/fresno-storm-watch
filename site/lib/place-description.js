/** Plain-language "where is this" for records whose source gives a map location but no location text, e.g.
 *  "in Fresno" or "3.4 mi NW of Kerman". Derived only from the record's own geometry and Census city boundaries; callers
 *  must say it is derived, not supplied by the source. */
const R_MI = 3958.8;
const DIRECTIONS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

/** A representative [lon, lat] for a GeoJSON geometry: the middle vertex of a line, the bbox centre otherwise. */
export function representativePoint(geometry) {
  if (!geometry) return null;
  const { type, coordinates: c } = geometry;
  if (type === 'Point') return c;
  if (type === 'LineString') return c[c.length >> 1];
  if (type === 'MultiLineString') { const longest = c.reduce((a, b) => (b.length > a.length ? b : a), []); return longest[longest.length >> 1] ?? null; }
  const pts = type === 'Polygon' ? c[0] : type === 'MultiPolygon' ? c.flatMap(p => p[0]) : type === 'MultiPoint' ? c : [];
  if (!pts.length) return null;
  const lons = pts.map(p => p[0]), lats = pts.map(p => p[1]);
  return [(Math.min(...lons) + Math.max(...lons)) / 2, (Math.min(...lats) + Math.max(...lats)) / 2];
}

function inside([lon, lat], geometry) {
  const polys = geometry?.type === 'Polygon' ? [geometry.coordinates] : geometry?.type === 'MultiPolygon' ? geometry.coordinates : [];
  return polys.some(rings => {
    let c = false;
    for (const ring of rings) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
  });
}

/** Great-circle miles and an 8-point compass direction from a to b ([lon, lat]). */
export function milesAndDirection(a, b) {
  const rad = Math.PI / 180, [l1, p1] = [a[0] * rad, a[1] * rad], [l2, p2] = [b[0] * rad, b[1] * rad];
  const h = Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin((l2 - l1) / 2) ** 2;
  const miles = 2 * R_MI * Math.asin(Math.sqrt(h));
  const bearing = (Math.atan2(Math.sin(l2 - l1) * Math.cos(p2), Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(l2 - l1)) / rad + 360) % 360;
  return { miles, direction: DIRECTIONS[Math.round(bearing / 45) % 8] };
}

/**
 * @param {object} geometry GeoJSON geometry of the record
 * @param {{features?: object[]} | object[] | null | undefined} cities Census city polygons with properties.name
 * @returns {string | null} "in Fresno", "3.4 mi NW of Kerman", or null when nothing is known
 */
export function describePlace(geometry, cities) {
  const point = representativePoint(geometry), list = Array.isArray(cities) ? cities : cities?.features ?? [];
  if (!point || !list.length) return null;
  const home = list.find(f => inside(point, f.geometry));
  if (home) return `in ${home.properties.name}`;
  let best = null;
  for (const f of list) {
    const centre = representativePoint(f.geometry);
    if (!centre) continue;
    const m = milesAndDirection(centre, point);
    if (!best || m.miles < best.miles) best = { ...m, name: f.properties.name };
  }
  if (!best) return null;
  return `${best.miles < 10 ? best.miles.toFixed(1) : Math.round(best.miles)} mi ${best.direction} of ${best.name}`;
}
