import { GUST_STOPS, MPH, hrrrAt, validateHrrrFrame, validateHrrrManifest } from './hrrr-model.js';
import { mercator } from './watch-watershed-data.js';

const root = new URL('../data/hrrr/', import.meta.url);
export const gustLegend = GUST_STOPS.map(([mph, color], i) => ({
  label: i === GUST_STOPS.length - 1 ? `${mph}+` : `${mph}–<${GUST_STOPS[i + 1][0]}`,
  color,
}));
const palette = GUST_STOPS.map(([, color]) => color.match(/\w{2}/g).map(value => parseInt(value, 16)));

async function read(file, signal) {
  const response = await fetch(new URL(file, root), {
    signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]), credentials: 'omit', cache: 'no-store',
  });
  if (!response.ok) throw Error('HRRR forecast source unavailable');
  return response.json();
}

export async function loadGustForecast(signal) {
  const now = Date.now();
  const manifest = validateHrrrManifest(await read('latest.json', signal), now);
  const windows = manifest.frames.map(entry => ({start: Date.parse(entry.valid), end: Date.parse(entry.valid), entry}))
    .filter(window => window.start >= now && hrrrAt(manifest, window.start, now).frame);
  if (!windows.length) throw Error('No current regional HRRR gust forecast');
  return {manifest, windows};
}

export async function loadGustImage(manifest, entry, signal) {
  const {frame} = hrrrAt(manifest, Date.parse(entry.valid));
  if (!frame || Date.parse(entry.valid) < Date.now()) throw Error('Forecast step is no longer current');
  const values = validateHrrrFrame(await read(entry.file, signal), manifest, entry).gust;
  if (!values.some(value => value !== null)) throw Error('No gust values returned for this forecast step');
  const {x0, y0, dx, dy, width, height} = manifest.grid;
  const west = x0 - dx / 2, east = west + width * dx;
  const north = y0 - dy / 2, south = north + height * dy;
  const top = mercator(0, north)[1], bottom = mercator(0, south)[1];
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw Error('Gust image rendering unavailable');
  const image = context.createImageData(width, height);
  for (let y = 0; y < height; y++) {
    // The source rows are equally spaced in latitude. The displayed image is Web Mercator.
    const lat = Math.atan(Math.sinh((top + (bottom - top) * (y + .5) / height) / 6378137)) * 180 / Math.PI;
    const row = Math.min(height - 1, Math.max(0, Math.round((lat - y0) / dy)));
    for (let x = 0; x < width; x++) {
      const value = values[row * width + x];
      if (value === null) continue;
      const band = GUST_STOPS.findLastIndex(([mph]) => value * MPH >= mph);
      image.data.set([...palette[band], 255], 4 * (y * width + x));
    }
  }
  context.putImageData(image, 0, 0);
  const blob = await new Promise((resolve, reject) => canvas.toBlob(
    value => value ? resolve(value) : reject(Error('Gust image unavailable')), 'image/png'));
  return {blob, coordinates: [[west,north],[east,north],[east,south],[west,south]]};
}
