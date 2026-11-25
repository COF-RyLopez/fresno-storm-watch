/** Local-only laboratory. Explicit public site/replay roots; never serves the repository or private work files. */
import http from 'node:http';
import {readFile,stat,realpath} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,sep,extname} from 'node:path';
import {createReadStream} from 'node:fs';

const site=fileURLToPath(new URL('../site/',import.meta.url)),base=new URL('../work/weather-delivery/',import.meta.url);
const pointer=JSON.parse(await readFile(new URL('current.json',base),'utf8'));
if(!/^capture-\d+-[a-f0-9]{8}$/.test(pointer.id))throw Error('Invalid capture pointer');
const replay=fileURLToPath(new URL(pointer.id+'/',base));
const latency=Number(process.env.WEATHER_LAB_LATENCY_MS||0),port=Number(process.env.WEATHER_LAB_PORT||8779);
if(!Number.isInteger(latency)||latency<0||latency>2000)throw Error('Invalid simulated latency');
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8',
  '.json':'application/json','.geojson':'application/geo+json','.png':'image/png','.svg':'image/svg+xml','.pbf':'application/x-protobuf','.pmtiles':'application/vnd.pmtiles'};
const server=http.createServer(async(req,res)=>{
  try{
    if(!['GET','HEAD'].includes(req.method)){res.writeHead(405).end();return;}
    const url=new URL(req.url,'http://localhost'),pathname=decodeURIComponent(url.pathname);
    const prefix='/data/weather-delivery-experiment/';
    if(pathname===prefix+'index.json'){res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'}).end(JSON.stringify({schemaVersion:1,recording:'records/'+'0'.repeat(64)+'/',capturedAt:pointer.capturedAt}));return;}
    if(pathname.startsWith(prefix)&&pathname.endsWith('/profile.json')||pathname==='/__weather-replay/profile.json'){
      res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'}).end(JSON.stringify({latencyMs:latency,kind:'same-host-recorded-response-replay'}));return;
    }
    const recorded=pathname.startsWith(prefix)||pathname.startsWith('/__weather-replay/'),root=recorded?replay:site;
    let suffix=recorded?pathname.slice(pathname.startsWith(prefix)?prefix.length:'/__weather-replay/'.length):pathname.slice(1);
    if(recorded&&suffix.startsWith('records/')){if(!/^records\/0{64}\//.test(suffix)){res.writeHead(404).end();return;}suffix=suffix.replace(/^records\/0{64}\//,'');}
    if(suffix==='')suffix='weather-delivery.html';
    const path=resolve(root,suffix);
    if(!path.startsWith(resolve(root)+sep)){res.writeHead(403).end();return;}
    const actual=await realpath(path);
    if(!actual.startsWith(resolve(root)+sep)||!(await stat(actual)).isFile()){res.writeHead(404).end();return;}
    const size=(await stat(actual)).size;
    if(recorded&&latency)await new Promise(done=>setTimeout(done,latency));
    const range=req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
    let lo=0,hi=size-1,status=200;
    if(range){lo=Number(range[1]);hi=range[2]?Math.min(Number(range[2]),hi):hi;if(lo>hi){res.writeHead(416).end();return;}status=206;}
    const headers={'content-type':types[extname(path)]||'application/octet-stream','content-length':hi-lo+1,'cache-control':'no-store','accept-ranges':'bytes'};
    if(status===206)headers['content-range']=`bytes ${lo}-${hi}/${size}`;
    res.writeHead(status,headers);
    if(req.method==='HEAD'||!size){res.end();return;}
    const stream=createReadStream(actual,{start:lo,end:hi});stream.on('error',()=>res.destroy());stream.pipe(res);
  }catch(error){res.writeHead(error.code==='ENOENT'?404:400).end('Replay resource unavailable');}
});
server.listen(port,'127.0.0.1',()=>process.stdout.write(JSON.stringify({url:`http://127.0.0.1:${port}/weather-delivery.html`,latencyMs:latency,capture:pointer.id})+'\n'));
process.on('SIGINT',()=>server.close());
