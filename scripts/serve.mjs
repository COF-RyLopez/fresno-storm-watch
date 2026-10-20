import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../site/', import.meta.url));
const types = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.geojson':'application/geo+json', '.json':'application/json', '.svg':'image/svg+xml', '.png':'image/png', '.webp':'image/webp', '.pdf':'application/pdf' };
const port = Number(process.env.STORM_PORT || 8777);
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
    if(path.endsWith(`${sep}frog-waterways-dark${sep}tilejson.json`)){
      const json=JSON.parse(data);json.tiles=[`http://127.0.0.1:${port}/basemaps/frog-waterways-dark/tiles/{z}/{x}/{y}.pbf`];data=Buffer.from(JSON.stringify(json));
    }
    response.writeHead(200, { 'Content-Type': types[extname(path)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    response.end(request.method === 'HEAD' ? undefined : data);
  } catch { response.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found'); }
});
server.listen(port, '127.0.0.1', () => process.stdout.write(`Storm Watch preview: http://127.0.0.1:${port}/\n`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
