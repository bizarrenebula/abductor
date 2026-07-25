#!/usr/bin/env node
/* =========================================================================
   fetch-sfx.mjs — generate a game sound effect with the ElevenLabs
   sound-effects API, save it into assets/sfx/, and register it in the
   manifest so the game plays it in place of the synthesized cry.

   USAGE
     ELEVENLABS_API_KEY=... node scripts/fetch-sfx.mjs <Name> "<prompt>" [seconds]

   EXAMPLES
     node scripts/fetch-sfx.mjs Sheep "a funny cartoon sheep bleat" 2
     node scripts/fetch-sfx.mjs Goat  "the screaming goat meme"      1.5

   <Name> must match the creature name the game uses (see ANIMAL_VOICE in
   src/audio/sfx.js — e.g. Sheep, Goat, Duck, Blob...). It becomes the manifest
   key, so cry('Sheep') will play sheep.mp3.

   NETWORK
     Outbound HTTPS is done with curl, which already honors this sandbox's
     HTTPS_PROXY + CA bundle. On a normal machine curl works directly. The host
     api.elevenlabs.io must be reachable / allow-listed by the network policy.

   ENV (optional)
     ELEVENLABS_API_KEY   required — your key (never hard-code it here)
     ELEVENLABS_SFX_URL   override endpoint (default v1/sound-generation)
     SFX_PROMPT_INFLUENCE  0..1, default 0.4 (higher = hew closer to the prompt)
   ========================================================================= */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const SFX_DIR = join(ROOT, 'assets', 'sfx');
const MANIFEST = join(SFX_DIR, 'manifest.json');

function die(msg){ console.error('✗ ' + msg); process.exit(1); }

const [, , nameArg, promptArg, secondsArg] = process.argv;
if(!nameArg || !promptArg){
  die('usage: node scripts/fetch-sfx.mjs <Name> "<prompt>" [seconds]');
}
const key = process.env.ELEVENLABS_API_KEY;
if(!key) die('set ELEVENLABS_API_KEY in the environment (do not paste it into files or chat)');

const name = nameArg.trim();
const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const outFile = slug + '.mp3';
const outPath = join(SFX_DIR, outFile);
const url = process.env.ELEVENLABS_SFX_URL || 'https://api.elevenlabs.io/v1/sound-generation';

const body = { text: promptArg, prompt_influence: Number(process.env.SFX_PROMPT_INFLUENCE || 0.4) };
const secs = secondsArg ? Number(secondsArg) : NaN;
if(!Number.isNaN(secs)) body.duration_seconds = Math.max(0.5, Math.min(22, secs));

if(!existsSync(SFX_DIR)) mkdirSync(SFX_DIR, { recursive: true });

console.log(`→ generating "${name}"  (${promptArg})`);

// curl handles the proxy + CA in this sandbox and is available on most dev
// machines. --fail-with-body so we still capture a JSON error payload on 4xx.
const args = [
  '-sS', '--fail-with-body', '-X', 'POST', url,
  '-H', 'xi-api-key: ' + key,
  '-H', 'Content-Type: application/json',
  '-H', 'Accept: audio/mpeg',
  '--data-binary', JSON.stringify(body),
  '-o', outPath,
];
const r = spawnSync('curl', args, { encoding: 'buffer' });
if(r.error) die('failed to run curl: ' + r.error.message);
if(r.status !== 0){
  let detail = '';
  try{ detail = existsSync(outPath) ? readFileSync(outPath, 'utf8').slice(0, 400) : ''; }catch(e){}
  if(existsSync(outPath)) rmSync(outPath);
  die(`curl exited ${r.status}. ${(r.stderr||'').toString().trim()} ${detail}`.trim());
}

// Guard against a JSON error body saved as if it were audio.
if(!existsSync(outPath) || statSync(outPath).size < 256){
  const peek = existsSync(outPath) ? readFileSync(outPath, 'utf8').slice(0, 400) : '(no file)';
  if(existsSync(outPath)) rmSync(outPath);
  die('response was not audio: ' + peek);
}
const head = readFileSync(outPath).subarray(0, 1);
if(head[0] === 0x7b /* '{' */){
  const peek = readFileSync(outPath, 'utf8').slice(0, 400);
  rmSync(outPath);
  die('API returned an error: ' + peek);
}

// Register it in the manifest (creature name -> filename).
let manifest = {};
try{ manifest = JSON.parse(readFileSync(MANIFEST, 'utf8')); }catch(e){ manifest = {}; }
manifest[name] = outFile;
writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');

const kb = (statSync(outPath).size / 1024).toFixed(1);
console.log(`✓ saved assets/sfx/${outFile} (${kb} KB) and registered "${name}" in the manifest`);
console.log('  reload the game — cry("' + name + '") will now play this sample.');
