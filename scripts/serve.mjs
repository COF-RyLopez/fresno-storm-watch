import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../site/', import.meta.url));
const types = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.mjs':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.geojson':'application/geo+json', '.json':'application/json', '.svg':'image/svg+xml', '.png':'image/png', '.webp':'image/webp', '.pdf':'application/pdf', '.tif':'image/tiff', '.parquet':'application/vnd.apache.parquet' };
const port = Number(process.env.STORM_PORT || process.env.PORT || 8777);
const server = http.createServer(async (request, response) => {
  if(process.env.STORM_TILE_LOG==='1'&&request.url.includes('.pbf'))process.stdout.write(`Tile ${new URL(request.url,'http://localhost').pathname}\n`);
  if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405).end(); return; }
  try {
    let path = resolve(root, '.' + decodeURIComponent(new URL(request.url, 'http://localhost').pathname));
    if (path !== resolve(root) && !path.startsWith(resolve(root) + sep)) { response.writeHead(403).end(); return; }
    if ((await stat(path)).isDirectory()) path = resolve(path, 'index.html');
    let data = await readFile(path);
    // Published TileJSON uses canonical absolute URLs (the SDK treats relative
    // templates as service-directory paths). Preview only: keep tiles local.
    if(path.endsWith(`${sep}frog-waterways-dark${sep}tilejson.json`)||path.endsWith(`${sep}frog-waterways-dark${sep}waterbodies-tilejson.json`)){
      const json=JSON.parse(data);json.tiles=json.tiles.map(template=>template.replace('https://cof-rylopez.github.io/fresno-storm-watch/',`http://127.0.0.1:${port}/`));data=Buffer.from(JSON.stringify(json));
    }
    const headers = { 'Content-Type': types[extname(path)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Accept-Ranges': 'bytes' };
    // Byte ranges, as GitHub Pages serves them: COG and Parquet readers fetch only the parts they need.
    const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range || '');
    if (range && (range[1] || range[2])) {
      const size = data.length;
      const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
      const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
      if (start >= size || start > end) { response.writeHead(416, { 'Content-Range': `bytes */${size}` }).end(); return; }
      response.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 });
      response.end(request.method === 'HEAD' ? undefined : data.subarray(start, end + 1));
      return;
    }
    response.writeHead(200, { ...headers, 'Content-Length': data.length });
    response.end(request.method === 'HEAD' ? undefined : data);
  } catch { response.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found'); }
});
server.listen(port, '127.0.0.1', () => process.stdout.write(`Storm Watch preview: http://127.0.0.1:${port}/\n`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
