/* =========================================================================
   SAMPLES — optional recorded audio that overrides the synthesized creature
   cries. Drop an MP3 into assets/sfx/ and list it in assets/sfx/manifest.json
   (creature name -> filename); if a sample is present for a creature, cry()
   plays it instead of the built-in synth. No sample = nothing changes, the
   procedural voice still fires. Files are produced by scripts/fetch-sfx.mjs
   (ElevenLabs sound-effects), but any MP3/OGG/WAV the browser can decode works.
   ========================================================================= */
import { Music } from './music.js';

const buffers = {};        // name -> decoded AudioBuffer (ready to play)
let started = false;       // manifest load kicked off?

/* Fetch the manifest, then fetch + decode every listed clip. Runs once, lazily,
   the first time a cry wants a sample — so decoding waits for the AudioContext
   the first user gesture creates. Any failure is swallowed: the synth covers it. */
async function loadAll(){
  try{
    const res = await fetch('assets/sfx/manifest.json', { cache:'no-cache' });
    if(!res.ok) return;
    const map = await res.json();
    Music.ensure();
    const ac = Music.ac;
    await Promise.all(Object.entries(map).map(async ([name, file])=>{
      try{
        const r = await fetch('assets/sfx/'+file, { cache:'force-cache' });
        if(!r.ok) return;
        const bytes = await r.arrayBuffer();
        // decodeAudioData is callback-style in older WebAudio; wrap for both.
        buffers[name] = await new Promise((ok,no)=>{
          const p = ac.decodeAudioData(bytes, ok, no);
          if(p && p.then) p.then(ok, no);
        });
      }catch(e){ /* skip this clip, keep the synth */ }
    }));
  }catch(e){ /* no manifest / offline — pure synth */ }
}

export const Samples = {
  /* Idempotent, fire-and-forget. Called from cry() so it never blocks a frame. */
  init(){ if(started) return; started = true; loadAll(); },
  /* Is a decoded clip ready for this creature? */
  has(name){ return !!buffers[name]; },
  /* Play the clip through the shared SFX bus, with a touch of pitch variance so
     repeats don't feel machine-gunned. Returns true if it actually played. */
  play(name){
    const buf = buffers[name];
    if(!buf) return false;
    try{
      Music.ensure();
      const c = Music.ac;
      if(c.state==='suspended') c.resume();
      const src = c.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = 1 + (Math.random()*0.12 - 0.06);
      const g = c.createGain(); g.gain.value = 0.9;
      src.connect(g); g.connect(Music.sfx);
      src.start();
      return true;
    }catch(e){ return false; }
  },
};
