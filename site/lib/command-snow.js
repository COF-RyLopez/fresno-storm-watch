import { mercator } from './watch-watershed-data.js';

export const IMS = 'https://mapservices.weather.noaa.gov/raster/rest/services/obs/usnic_ims_snow_ice_1km/ImageServer';
export const HANFORD_WINTER = 'https://www.weather.gov/hnx/winter';
export const SNOW_SITES = [
  { basin: 'MIL', name: 'Upper San Joaquin', coordinates: [-119.30, 37.29], grid: 'HNX/74,121' },
  { basin: 'PNF', name: 'Upper Kings', coordinates: [-118.98, 36.97], grid: 'HNX/82,105' },
];
const hour = 3600000;
const options = signal => ({ signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000), credentials: 'omit', cache: 'no-store' });
async function json(url, signal) {
  const response = await fetch(url, options(signal));
  if (!response.ok) throw Error('Snow source unavailable');
  const body = await response.json();
  if (body.error) throw Error('Snow source rejected the request');
  return body;
}
const lonLat = (x, y) => [x / 6378137 * 180 / Math.PI, Math.atan(Math.sinh(y / 6378137)) * 180 / Math.PI];

export async function loadSnowCover(signal) {
  const query = new URLSearchParams({ where: 'category=1', outFields: 'objectid,idp_filedate', orderByFields: 'idp_filedate DESC', resultRecordCount: '1', returnGeometry: 'false', f: 'json' });
  const record = (await json(`${IMS}/query?${query}`, signal)).features?.[0]?.attributes;
  if (!Number.isSafeInteger(record?.objectid) || !Number.isFinite(record.idp_filedate) ||
      record.idp_filedate > Date.now() + hour || Date.now() - record.idp_filedate > 72 * hour)
    throw Error('Recent snow analysis date unavailable');
  const [xmin, ymin] = mercator(-121, 35.7), [xmax, ymax] = mercator(-117, 38.5);
  const params = new URLSearchParams({
    bbox: [xmin, ymin, xmax, ymax].join(','), bboxSR: '3857', imageSR: '3857',
    size: '500,445', format: 'png32', noData: '0,1,2,3', noDataInterpretation: 'esriNoDataMatchAny',
    interpolation: 'RSP_NearestNeighbor', mosaicRule: JSON.stringify({ mosaicMethod: 'esriMosaicLockRaster', lockRasterIds: [record.objectid] }), f: 'json',
  });
  const image = await json(`${IMS}/exportImage?${params}`, signal);
  const extent = image.extent;
  if (!extent || (extent.spatialReference?.latestWkid ?? extent.spatialReference?.wkid) !== 3857 ||
      ![extent.xmin, extent.ymin, extent.xmax, extent.ymax].every(Number.isFinite))
    throw Error('Snow map georeferencing unavailable');
  // Use the same locked export directly. The returned temporary directory URL can be inaccessible.
  params.set('f', 'image');
  const response = await fetch(`${IMS}/exportImage?${params}`, options(signal));
  if (!response.ok || !response.headers.get('content-type')?.startsWith('image/png')) throw Error('Snow image unavailable');
  const bitmap = await createImageBitmap(await response.blob());
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext('2d');
  try {
    if (!context || bitmap.width !== image.width || bitmap.height !== image.height) throw Error('Snow image dimensions invalid');
    context.drawImage(bitmap, 0, 0);
  } finally { bitmap.close(); }
  // The publisher export masks all classes except snow. Preserve the exact alpha mask.
  context.globalCompositeOperation = 'source-in';
  context.fillStyle = '#eef8ff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  const blob = await new Promise((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(Error('Snow image unavailable')), 'image/png'));
  const {xmin: west, ymin: south, xmax: east, ymax: north} = extent;
  return { blob, fileTime: record.idp_filedate, coordinates: [lonLat(west,north), lonLat(east,north), lonLat(east,south), lonLat(west,south)] };
}

function intervals(series, unit) {
  if (series?.uom !== unit || !Array.isArray(series.values)) return [];
  return series.values.flatMap(({ validTime, value }) => {
    const [iso, duration] = String(validTime).split('/');
    const start = Date.parse(iso);
    const parts = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/.exec(duration);
    const length = parts ? (Number(parts[1] || 0) * 24 + Number(parts[2] || 0) + Number(parts[3] || 0) / 60) * hour : 0;
    return Number.isFinite(start) && length > 0 && Number.isFinite(value) && value >= 0 ? [{ start, end: start + length, value }] : [];
  }).sort((a, b) => a.start - b.start);
}

export function snowWindow(site, start, end) {
  const snow = site.snow.find(row => row.start <= start && row.end >= end &&
    ((row.start === start && row.end === end) || row.value === 0));
  const levels = site.level.filter(row => row.start < end && row.end > start);
  const coveredUntil = levels.reduce((covered, row) => row.start <= covered ? Math.max(covered, row.end) : covered, start);
  const feet = metres => Math.round(metres / 0.3048 / 100) * 100;
  return { inches: snow ? snow.value / 25.4 : null, level: coveredUntil >= end
    ? [feet(Math.min(...levels.map(row => row.value))), feet(Math.max(...levels.map(row => row.value)))] : null };
}

export async function loadSnowForecast(signal) {
  const result = await Promise.allSettled(SNOW_SITES.map(async site => {
    const url = `https://api.weather.gov/gridpoints/${site.grid}`;
    const { properties: p } = await json(url, signal);
    const issued = Date.parse(p?.updateTime);
    if (!Number.isFinite(issued) || issued > Date.now() + hour || Date.now() - issued > 24 * hour)
      throw Error('Recent forecast unavailable');
    return { ...site, url, issued, snow: intervals(p.snowfallAmount, 'wmoUnit:mm'), level: intervals(p.snowLevel, 'wmoUnit:m') };
  }));
  return result.map((entry, i) => entry.status === 'fulfilled' ? entry.value : { ...SNOW_SITES[i], issued: null, snow: [], level: [] });
}
