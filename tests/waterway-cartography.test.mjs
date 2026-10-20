import test from 'node:test';
import assert from 'node:assert/strict';
import {waterwayRole,overviewRank} from '../scripts/waterway-cartography.mjs';
test('unnamed canals retain their source classification and drainageways stay distinct',()=>{
  assert.equal(waterwayRole({name:'',kind:2}),'canal');
  assert.equal(waterwayRole({name:null,kind:3}),'drainageway');
  assert.equal(waterwayRole({name:'',kind:1}),'river');
  assert.equal(waterwayRole({name:'',kind:5}),'connector');
});
test('named canal and river centerlines are references without reclassifying their source type',()=>{
  const canal={name:'Friant-Kern Canal',kind:5};assert.equal(waterwayRole(canal),'canal');assert.equal(canal.kind,5);
  assert.equal(waterwayRole({name:'Kings River',kind:5}),'river');
  assert.equal(waterwayRole({name:'Unnamed network link',kind:7}),'connector');
  assert.equal(overviewRank({name:'  SAN  JOAQUIN River '}),0);assert.equal(overviewRank({name:''}),1);
});
