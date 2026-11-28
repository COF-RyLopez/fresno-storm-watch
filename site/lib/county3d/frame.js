/** County 3D frame: Web Mercator metres from a county origin (x east, y up, z south), XYZ tile maths, sun position.
 *  Pure functions, no three.js, so they are testable in Node. Heights are multiplied by k (Mercator metres per ground
 *  metre at the origin) so that vertical and horizontal units agree. */
export const R = 6378137;
const HALF = Math.PI * R;
/** Fresno County plus the upstream Millerton and Pine Flat watersheds (the 3DHP hydrography bounds). */
export const COUNTY_BOUNDS = [-120.92, 35.91, -118.33, 37.74];

export const mercX = lon => (R * lon * Math.PI) / 180;
export const mercY = lat => R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
const lonOf = mx => (mx / R) * (180 / Math.PI);
const latOf = my => (2 * Math.atan(Math.exp(my / R)) - Math.PI / 2) * (180 / Math.PI);

/** A frame centred on bounds [w, s, e, n] (degrees). */
export function createFrame(bounds = COUNTY_BOUNDS) {
  const [w, s, e, n] = bounds;
  const ox = (mercX(w) + mercX(e)) / 2, oy = (mercY(s) + mercY(n)) / 2;
  const k = 1 / Math.cos((latOf(oy) * Math.PI) / 180);
  return {
    bounds, ox, oy, k,
    /** lon, lat -> world [x, z] */
    project: (lon, lat) => [mercX(lon) - ox, -(mercY(lat) - oy)],
    /** world x, z -> [lon, lat] */
    unproject: (x, z) => [lonOf(x + ox), latOf(oy - z)],
    /** XYZ tile -> world rectangle {x0, x1, z0 (north), z1 (south)} */
    tileRect(z, x, y) {
      const size = (2 * HALF) / 2 ** z;
      const mx0 = -HALF + x * size, my1 = HALF - y * size;
      return { x0: mx0 - ox, x1: mx0 + size - ox, z0: -(my1 - oy), z1: -(my1 - size - oy), size };
    }
  };
}

/** XYZ tiles at zoom z that cover bounds [w, s, e, n]. */
export function tilesCovering([w, s, e, n], z) {
  const t = 2 ** z, tx = lon => Math.floor(((lon + 180) / 360) * t);
  const ty = lat => Math.floor(((HALF - mercY(lat)) / (2 * HALF)) * t);
  const out = [];
  for (let y = ty(n); y <= ty(s); y++) for (let x = tx(w); x <= tx(e); x++) out.push([z, x, y]);
  return out;
}

/** Does tile (z, x, y) intersect bounds [w, s, e, n]? */
export function tileTouches([w, s, e, n], z, x, y) {
  const t = 2 ** z, lon0 = (x / t) * 360 - 180, lon1 = ((x + 1) / t) * 360 - 180;
  const lat = yy => latOf(HALF - (yy / t) * 2 * HALF);
  return lon1 >= w && lon0 <= e && lat(y + 1) <= n && lat(y) >= s;
}

/** Terrarium-encoded pixel -> metres. */
export const terrarium = (r, g, b) => r * 256 + g + b / 256 - 32768;

/** Sun direction for a time and place: {elevation, azimuth} in degrees (azimuth clockwise from north). NOAA
 *  low-precision algorithm, good to about a tenth of a degree for this century. */
export function sunPosition(date, lon, lat) {
  const rad = Math.PI / 180, d = date.getTime() / 864e5 - 10957.5; // days since 2000-01-01 12:00 UTC
  const g = (357.529 + 0.98560028 * d) * rad, q = 280.459 + 0.98564736 * d;
  const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * rad, e = (23.439 - 3.6e-7 * d) * rad;
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L)), dec = Math.asin(Math.sin(e) * Math.sin(L));
  const gmst = (18.697374558 + 24.06570982441908 * d) % 24;
  const ha = ((gmst * 15 + lon) * rad - ra), phi = lat * rad;
  const el = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(ha));
  const az = Math.atan2(-Math.sin(ha), Math.tan(dec) * Math.cos(phi) - Math.sin(phi) * Math.cos(ha));
  return { elevation: el / rad, azimuth: ((az / rad) + 360) % 360 };
}

/** Screen-space size (px) of a world length at a distance, for a vertical field of view (deg) and viewport height (px). */
export const screenPixels = (length, distance, fovDeg, viewportPx) =>
  (length * viewportPx) / (2 * Math.max(distance, 1e-6) * Math.tan((fovDeg * Math.PI) / 360));
