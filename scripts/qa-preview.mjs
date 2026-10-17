/** Local-only 390px responsive viewport; never deployed by the Pages workflow. */
import http from 'node:http';
const live = process.argv.includes('--live');
const conditions=process.argv.includes('--conditions');
const watch=process.argv.includes('--watch');
const html = '<!doctype html><html lang="en"><meta charset="utf-8"><title>Storm Watch mobile layout check</title><body style="margin:0;background:#dce3e8;font-family:Arial"><p style="margin:12px">Local layout check · 390 × 844 CSS pixels · fictional exercise</p><iframe title="390px Storm Watch viewport" src="http://127.0.0.1:8777/PLACEHOLDER" style="width:390px;height:844px;border:1px solid #607d8b;margin:0 16px"></iframe></body></html>';
const previewHtml = html.replace('PLACEHOLDER',live?(watch?'?view=watch':conditions?'?view=conditions&overlay=qpf&qpf=11':''):watch?'?exercise=1&view=watch':'?exercise=1').replace('fictional exercise',live?'live public sources':'fictional exercise');
const server = http.createServer((request, response) => {
  const wide=new URL(request.url,'http://localhost').searchParams.get('wide')==='1';
  let page=previewHtml;
  if(wide)page=page.replaceAll('390','1366').replaceAll('844','768').replace('border:1px','transform-origin:top left;border:1px').replace('</body>','<script>const frame=document.querySelector("iframe");function fit(){frame.style.transform="scale("+Math.min(1,(innerWidth-32)/1366,(innerHeight-52)/768)+")";}addEventListener("resize",fit);fit();</script></body>');
  response.writeHead(200, { 'Content-Type':'text/html; charset=utf-8', 'Cache-Control':'no-store' });response.end(page);
});
server.listen(0,'127.0.0.1', () => console.log(`Local responsive QA: http://127.0.0.1:${server.address().port}/`));
