import test from 'node:test';
import assert from 'node:assert/strict';
import {shouldAutoSignIn} from '../site/lib/auth.js';

test('a new tab signs in through the portal only when another tab is signed in, and never twice in two minutes',()=>{
  const now=1_000_000_000;
  assert.equal(shouldAutoSignIn('1',null,now),true);
  assert.equal(shouldAutoSignIn(null,null,now),false);// never signed in, or signed out everywhere
  assert.equal(shouldAutoSignIn('1',String(now-30000),now),false);// just tried: a cancel or failure does not loop
  assert.equal(shouldAutoSignIn('1',String(now-180000),now),true);
});
