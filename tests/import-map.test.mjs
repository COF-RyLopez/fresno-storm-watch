import test from 'node:test';
import assert from 'node:assert/strict';
import {pages,keyedSpecifiers,renderPage} from '../scripts/import-map.mjs';

test('every page carries a current content-keyed import map; run npm run build:import-map if this fails',async()=>{
  assert.deepEqual(await keyedSpecifiers(),[],'first-party imports must be unkeyed; the page import map supplies keys');
  const stale=(await pages()).filter(p=>p.current!==p.expected).map(p=>p.file.pathname.split('/').pop());
  assert.deepEqual(stale,[]);
});

test('the import map precedes every module script and maps an entry to the same URL its script tag loads',async()=>{
  const html=await renderPage('<link rel="stylesheet" href="./theme.css"><script type="module" src="https://js.arcgis.com/5.1/"></script><script type="module" src="./eoc.js?v=old"></script>');
  assert(html.indexOf('type="importmap"')<html.indexOf('<script type="module"'));
  const map=JSON.parse(html.match(/<script type="importmap">([\s\S]*?)<\/script>/)[1]).imports;
  assert.equal(`./eoc.js?v=${html.match(/src="\.\/eoc\.js\?v=([0-9a-f]{10})"/)[1]}`,map['./eoc.js']);
  assert.match(html,/href="\.\/theme\.css\?v=[0-9a-f]{10}"/);
  assert(map['./lib/eoc-model.js'],'transitive modules are mapped');
  assert(!Object.keys(map).some(k=>k.includes('/vendor/')),'vendor files are versioned by path');
});

test('a strict page CSP admits exactly the current import map by hash, and regeneration replaces the old hash',async()=>{
  const {createHash}=await import('node:crypto');
  const page='<meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\' https://js.arcgis.com"><script type="module" src="./eoc.js"></script>';
  const once=await renderPage(page),twice=await renderPage(once);
  assert.equal(twice,once);
  const text=once.match(/<script type="importmap">([\s\S]*?)<\/script>/)[1],hash=`'sha256-${createHash('sha256').update(text).digest('base64')}'`;
  assert.match(once,new RegExp(`script-src 'self' https://js\\.arcgis\\.com ${hash.replace(/[+/]/g,'\\$&')}"`));
  assert.equal(once.match(/'sha256-/g).length,1);
});
