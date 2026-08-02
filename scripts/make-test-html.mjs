#!/usr/bin/env node
/* =========================================================================
   index-test.html generator.

   The headless test harness cannot reach a CDN — the agent proxy blocks it —
   so testing needs a copy of index.html with the two THREE script tags pointed
   at the vendored files in the repo root. That copy was maintained BY HAND, and
   every time index.html's CDN URLs changed it silently kept loading nothing:
   THREE came back undefined and the whole suite failed with an error that had
   nothing to do with the change being tested. It cost an hour once already.

   Run it from anywhere:  node scripts/make-test-html.mjs
   ========================================================================= */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/* Matched by FILENAME, not by full URL. The host has changed twice (unpkg,
   jsdelivr, cdnjs) and the version will change again; what has stayed constant
   is that one tag ends in three.min.js and the other in GLTFLoader.js. */
const SUBS = [
  [/(<script[^>]*\ssrc=")https?:\/\/[^"]*\/three(\.min)?\.js(")/g, '$1/_t_three.js$3'],
  [/(<script[^>]*\ssrc=")https?:\/\/[^"]*\/GLTFLoader\.js(")/g,    '$1/_t_gltf.js$2'],
];

const src = readFileSync(join(root, 'index.html'), 'utf8');
let out = src, hits = 0;
for (const [re, to] of SUBS) {
  const before = out;
  out = out.replace(re, to);
  if (out !== before) hits++;
}

if (hits !== SUBS.length) {
  console.error(
    'make-test-html: expected to rewrite ' + SUBS.length + ' script tags, rewrote ' + hits + '.\n' +
    'index.html\'s THREE/GLTFLoader tags have changed shape — update SUBS in this script.');
  process.exit(1);
}

writeFileSync(join(root, 'index-test.html'), out);
console.log('index-test.html written (' + out.length + ' bytes, ' + hits + ' tags rewritten)');
