import test from 'node:test';
import assert from 'node:assert/strict';
import {badgeUrl,badgeSymbol,isLight,BADGE_GLYPHS} from '../site/lib/badge-symbols.js';

const svg=url=>decodeURIComponent(url.replace(/^data:image\/svg\+xml;charset=utf-8,/,''));

test('every glyph renders as an SVG picture marker with its fill',()=>{
  for(const glyph of BADGE_GLYPHS){const s=svg(badgeUrl({glyph,fill:'#2ecc71'}));assert.match(s,/^<svg [^>]*viewBox="0 0 36 36"/);assert.match(s,/fill="#2ecc71"/);}
  assert.deepEqual(Object.keys(badgeSymbol({glyph:'plow',fill:'#2ecc71'},24)).sort(),['height','type','url','width']);
  assert.throws(()=>badgeUrl({glyph:'tank',fill:'#000000'}),/Unknown badge glyph/);
});

test('glyph ink flips to dark on light fills so it stays readable',()=>{
  assert.equal(isLight('#f5c542'),true);assert.equal(isLight('#6fd3e0'),true);
  assert.equal(isLight('#2b6cb0'),false);assert.equal(isLight('#6b7378'),false);assert.equal(isLight('nope'),false);
  assert.match(svg(badgeUrl({glyph:'wrench',fill:'#f5c542'})),/fill="#17232b" d="M22\.6/);
  assert.match(svg(badgeUrl({glyph:'wrench',fill:'#6b7378'})),/fill="#ffffff" d="M22\.6/);
});

test('a heading adds a direction tick rotated to it; no heading, no tick',()=>{
  assert.match(svg(badgeUrl({glyph:'plow',fill:'#4aa3ff',heading:92.4})),/rotate\(92 18 18\)/);
  assert.doesNotMatch(svg(badgeUrl({glyph:'plow',fill:'#4aa3ff'})),/rotate\(/);
});
