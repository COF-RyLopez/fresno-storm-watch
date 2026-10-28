// Minimal Zarr v3 reader for stores written by stormwatch-flood: regular chunk grid, default "/" chunk keys,
// codecs [optional "transpose", "bytes" (little-endian), optional "gzip"]. gzip is decoded by the browser
// (DecompressionStream), so no library. A missing chunk is all fill_value, as the Zarr spec says.
// ponytail: only what stormwatch-flood writes; anything else throws rather than misreads.

const TYPES = { uint16: Uint16Array, uint8: Uint8Array, int16: Int16Array, float32: Float32Array, float64: Float64Array };

/**
 * Open an array. Returns { meta, shape, chunkShape, order, chunk(indices) -> Promise<TypedArray | null> }.
 * A chunk comes back in stored order: element at chunk-relative indices idx is at offset(idx) (see below);
 * null means the chunk is absent, i.e. every element is fill_value.
 */
export async function openArray(url) {
  const base = url.endsWith('/') ? url : url + '/';
  const meta = await fetch(base + 'zarr.json').then(r => { if (!r.ok) throw new Error(`zarr.json ${r.status}`); return r.json(); });
  const names = meta.codecs.map(c => c.name);
  const transpose = names[0] === 'transpose' ? meta.codecs[0].configuration.order : null;
  const rest = names.slice(transpose ? 1 : 0).join(',');
  if (meta.zarr_format !== 3 || !(rest === 'bytes,gzip' || rest === 'bytes')) throw new Error(`unsupported Zarr array (${names})`);
  if (meta.codecs.find(c => c.name === 'bytes').configuration?.endian === 'big') throw new Error('big-endian Zarr not supported');
  const Type = TYPES[meta.data_type];
  if (!Type) throw new Error(`unsupported data type ${meta.data_type}`);
  const chunkShape = meta.chunk_grid.configuration.chunk_shape;
  const order = transpose ?? chunkShape.map((_, i) => i);
  // strides of the stored (transposed) layout, mapped back to array dimension order
  const storedShape = order.map(d => chunkShape[d]);
  const strides = new Array(chunkShape.length);
  for (let k = order.length - 1, s = 1; k >= 0; s *= storedShape[k], k--) strides[order[k]] = s;
  return {
    meta,
    shape: meta.shape,
    chunkShape,
    /** offset of chunk-relative indices (in array dimension order) within a decoded chunk */
    offset: idx => idx.reduce((sum, v, d) => sum + v * strides[d], 0),
    strides,
    async chunk(indices) {
      const r = await fetch(`${base}c/${indices.join('/')}`);
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`chunk ${indices.join('/')}: ${r.status}`);
      const body = rest.endsWith('gzip') ? r.body.pipeThrough(new DecompressionStream('gzip')) : r.body;
      return new Type(await new Response(body).arrayBuffer());
    }
  };
}
