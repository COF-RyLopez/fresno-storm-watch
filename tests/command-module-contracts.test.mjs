import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createModuleLoader, validateModule} from '../command/src/module-loader.ts';

test('Command external boundary checks the actual shared adapter exports', async () => {
  const root = new URL('../site/', import.meta.url);
  const load = createModuleLoader(root);
  for (const name of ['command-data','command-private','watch-terrain-map','command-weather-player']) {
    const loaded = await load(name);
    assert.equal(loaded, await import(new URL(`lib/${name}.js`, root)));
  }
});

test('unknown module paths and malformed exports fail before use', async () => {
  let imports=0;
  const load=createModuleLoader(new URL('https://example.test/'),async()=>{imports++;return {};});
  for(const name of ['__proto__','../../secret','constructor'])
    await assert.rejects(load(name),/Unknown Command module/);
  assert.equal(imports,0);
  assert.throws(()=>validateModule('command-data',{createCommandFeeds: true}),/missing function/);
  assert.throws(()=>validateModule('command-weather-player',null),/Invalid Command module/);
  await assert.rejects(load('command-private'),/missing function createCommandPrivate/);
});

test('compiler rejects unknown exports, wrong callbacks, map bounds and playback arguments', () => {
  // Expect-error fixtures also fail if the boundary silently widens to any.
  execFileSync(process.execPath,['node_modules/typescript/bin/tsc','-p','command/tsconfig.json'],{
    cwd:new URL('../',import.meta.url),stdio:'pipe',
  });
});
