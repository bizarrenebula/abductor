/* =========================================================================
   SFX — synthesized sweeps, filtered-noise bursts, signature hazard sounds,
   the sustained beam loop, and creature cries. All route through Music.sfx.
   ========================================================================= */
import { Music, beep } from './music.js';
import { Samples } from './samples.js';

export function sweep(f0,f1,dur,vol){try{Music.ensure();const c=Music.ac;if(c.state==='suspended')c.resume();
  const o=c.createOscillator(),g=c.createGain();o.type='sine';
  o.frequency.setValueAtTime(f0,c.currentTime);
  o.frequency.exponentialRampToValueAtTime(Math.max(30,f1),c.currentTime+dur);
  g.gain.value=vol;o.connect(g);g.connect(Music.sfx);
  o.start();g.gain.exponentialRampToValueAtTime(0.0001,c.currentTime+dur);
  o.stop(c.currentTime+dur+0.05);}catch(e){}}

/* ---- filtered noise burst: the core of realistic hazard sounds ---- */
export function noiseBurst(dur,vol,filterType,f0,f1,q){
  try{Music.ensure();const c=Music.ac;if(c.state==='suspended')c.resume();
    const n=Math.floor(c.sampleRate*dur);
    const buf=c.createBuffer(1,n,c.sampleRate);const d=buf.getChannelData(0);
    for(let i=0;i<n;i++)d[i]=Math.random()*2-1;
    const src=c.createBufferSource();src.buffer=buf;
    const flt=c.createBiquadFilter();flt.type=filterType||'bandpass';
    flt.frequency.setValueAtTime(f0,c.currentTime);
    if(f1)flt.frequency.exponentialRampToValueAtTime(Math.max(40,f1),c.currentTime+dur);
    flt.Q.value=q||1;
    const g=c.createGain();g.gain.value=vol;
    src.connect(flt);flt.connect(g);g.connect(Music.sfx);
    src.start();g.gain.setValueAtTime(vol,c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001,c.currentTime+dur);
    src.stop(c.currentTime+dur+0.02);
  }catch(e){}
}

/* ---- distinct signature sounds per hazard ---- */
// METEOR: a rising airy whistle as it screams in, then a deep booming impact with debris crackle
export function sfxMeteorIncoming(){ sweep(2600,700,0.9,0.05); noiseBurst(0.9,0.04,'highpass',3000,1600,0.7); }
export function sfxMeteorImpact(big){
  noiseBurst(big?0.7:0.4, big?0.22:0.13,'lowpass',900,90,0.8);   // dull boom
  beep(big?46:60,big?0.7:0.4,big?0.2:0.12);                       // sub thud
  setTimeout(()=>noiseBurst(0.25,0.06,'bandpass',1800,600,1.2),60); // debris scatter
}
// GEYSER: a pressurized gassy hiss that swells upward — no boom, all wind/steam
export function sfxGeyserWarn(){ noiseBurst(0.5,0.05,'bandpass',400,900,2); }   // pressure building, low rumble
export function sfxGeyserErupt(){
  noiseBurst(1.4,0.16,'highpass',300,1400,0.5);                   // rushing hiss up
  noiseBurst(1.4,0.10,'bandpass',180,420,1.5);                    // deep gassy body
  sweep(120,320,1.2,0.05);                                        // subtle upward pitch of the plume
}
// LIGHTNING: a bright electric crackle-zap, then a sharp thunder crack with a long rumbling tail
export function sfxThunderWarn(){ noiseBurst(0.35,0.05,'bandpass',3000,5000,3); }   // electric static crackle
export function sfxLightningStrike(){
  noiseBurst(0.06,0.28,'highpass',6000,9000,0.4);                 // the zap/crack (very bright, instant)
  setTimeout(()=>{                                                // thunder follows
    noiseBurst(0.9,0.22,'lowpass',400,60,0.7);                    // the crack body
    noiseBurst(1.6,0.12,'lowpass',200,40,0.6);                    // long rolling rumble tail
    beep(42,1.4,0.16);                                            // deep sub boom
  },90);
}
export const BeamSFX={h:null,
  start(){
    try{
      Music.ensure();const c=Music.ac;if(c.state==='suspended')c.resume();
      sweep(160,540,0.28,0.12);                       // ignition
      if(this.h)return;
      const g=c.createGain();g.gain.value=0.0001;
      const fl=c.createBiquadFilter();fl.type='lowpass';fl.frequency.value=260;
      const lfo=c.createOscillator();lfo.frequency.value=0.7;
      const lg=c.createGain();lg.gain.value=90;lfo.connect(lg);lg.connect(fl.frequency);
      const o1=c.createOscillator();o1.type='sawtooth';o1.frequency.value=49;
      const o2=c.createOscillator();o2.type='sawtooth';o2.frequency.value=49.6;
      const o3=c.createOscillator();o3.type='sine';o3.frequency.value=98;
      o1.connect(fl);o2.connect(fl);o3.connect(fl);fl.connect(g);g.connect(Music.sfx);
      o1.start();o2.start();o3.start();lfo.start();
      g.gain.setTargetAtTime(0.17,c.currentTime,0.12);
      this.h={g,osc:[o1,o2,o3,lfo]};
    }catch(e){}
  },
  set(p){if(this.h)this.h.g.gain.value=0.17*Math.max(0,Math.min(1,p));},
  stop(){
    try{
      if(!this.h)return;
      const c=Music.ac;
      sweep(430,120,0.3,0.1);                        // power-down
      const h=this.h;this.h=null;
      h.g.gain.setTargetAtTime(0.0001,c.currentTime,0.08);
      setTimeout(()=>{h.osc.forEach(o=>{try{o.stop();}catch(e){}});},400);
    }catch(e){}
  }
};
/* =========================================================================
   VOICES — the game's comic perk: funny synthesized animal cries, three human
   screams, and a car honk, all fired on an abduction attempt. Everything is one
   formant-filtered, pitch-gliding, optionally-vibratoed "voice" primitive; the
   character comes from the per-creature parameters and the layering.
   ========================================================================= */
// A single vowel-ish voice: pitch glides f0->f1, a bandpass formant gives it a
// throat, and an optional vibrato (vibHz/vibDepth) adds the wobble that reads as
// bleating / panic / warble. `when` offsets it so calls can chain into phrases.
function voice(o){
  try{
    Music.ensure();const c=Music.ac;if(c.state==='suspended')c.resume();
    const t0=c.currentTime+(o.when||0), dur=o.dur;
    const osc=c.createOscillator();osc.type=o.type||'sawtooth';
    osc.frequency.setValueAtTime(o.f0,t0);
    if(o.f1)osc.frequency.exponentialRampToValueAtTime(Math.max(30,o.f1),t0+dur);
    const fl=c.createBiquadFilter();fl.type='bandpass';fl.frequency.value=o.fHz||1200;fl.Q.value=o.fQ||3;
    const g=c.createGain();
    g.gain.setValueAtTime(0.0001,t0);
    g.gain.linearRampToValueAtTime(o.vol,t0+Math.min(0.03,dur*0.2));
    g.gain.exponentialRampToValueAtTime(0.0001,t0+dur);
    osc.connect(fl);fl.connect(g);g.connect(Music.sfx);
    osc.start(t0);osc.stop(t0+dur+0.05);
    if(o.vibHz){
      const v=c.createOscillator();v.frequency.value=o.vibHz;
      const vg=c.createGain();vg.gain.value=o.vibDepth||30;
      v.connect(vg);vg.connect(osc.frequency);v.start(t0);v.stop(t0+dur+0.05);
    }
  }catch(e){}
}

// Per-creature voice params. Higher fQ + big vibDepth = more comic warble.
const ANIMAL_VOICE={
  Sheep :{f0:360,f1:300,dur:0.6, vol:0.30,fHz:1100,fQ:4,vibHz:11,vibDepth:22},
  Goat  :{f0:540,f1:440,dur:0.7, vol:0.30,fHz:1400,fQ:6,vibHz:24,vibDepth:75},   // the goat-scream meme
  Camel :{f0:150,f1:92, dur:0.7, vol:0.32,fHz:520, fQ:3,vibHz:6, vibDepth:12,gruff:true},
  Duck  :{quack:true},
  Blob  :{f0:190,f1:120,dur:0.34,vol:0.30,fHz:620, fQ:2,vibHz:0, vibDepth:0,blorp:true},
  Crawler:{f0:520,f1:420,dur:0.3,vol:0.26,fHz:1600,fQ:5,vibHz:18,vibDepth:30},
  Skimmer:{f0:680,f1:940,dur:0.3,vol:0.26,fHz:2000,fQ:4,vibHz:0, vibDepth:0},
  Strider:{f0:300,f1:220,dur:0.45,vol:0.30,fHz:800,fQ:3,vibHz:7, vibDepth:14},
  Tumbler:{f0:620,f1:500,dur:0.28,vol:0.26,fHz:1500,fQ:4,vibHz:20,vibDepth:40},
  Wormling:{f0:220,f1:140,dur:0.5,vol:0.30,fHz:520,fQ:2,vibHz:5, vibDepth:10},
};
export function animalCry(name){
  const v=ANIMAL_VOICE[name]||{f0:480,f1:360,dur:0.4,vol:0.3,fHz:1200,fQ:3,vibHz:10,vibDepth:20};
  if(v.quack){                                   // duck: three nasal quacks
    for(let i=0;i<3;i++)voice({type:'sawtooth',f0:300-i*12,f1:250,dur:0.09,vol:0.30,fHz:1700,fQ:7,when:i*0.13});
    return;
  }
  const p=1+(Math.random()*0.12-0.06);           // small per-call pitch variance
  voice({type:'sawtooth',f0:v.f0*p,f1:v.f1*p,dur:v.dur,vol:v.vol,fHz:v.fHz,fQ:v.fQ,vibHz:v.vibHz,vibDepth:v.vibDepth});
  if(v.gruff)noiseBurst(v.dur*0.7,0.06,'bandpass',320,200,1.4);          // camel grumble
  if(v.blorp)voice({type:'sine',f0:v.f0*2.4,f1:v.f0*0.5,dur:0.18,vol:0.18,fHz:800,fQ:2,when:0.02}); // squish
}

// Three distinct comic human screams, chosen at random per abduction.
export function humanScream(){
  const v=(Math.random()*3)|0;
  if(v===0){                                     // shrill panic that cracks
    voice({type:'sawtooth',f0:600,f1:860,dur:0.5,vol:0.32,fHz:1800,fQ:4,vibHz:16,vibDepth:42});
    voice({type:'sawtooth',f0:860,f1:400,dur:0.4,vol:0.28,fHz:1500,fQ:4,vibHz:14,vibDepth:34,when:0.42});
  }else if(v===1){                               // cartoon "wa-hoo!" glissando
    voice({type:'sawtooth',f0:380,f1:780,dur:0.26,vol:0.32,fHz:1400,fQ:3});
    voice({type:'sawtooth',f0:780,f1:300,dur:0.42,vol:0.30,fHz:1200,fQ:3,when:0.25});
  }else{                                         // frantic yodel/warble
    for(let i=0;i<5;i++)voice({type:'sawtooth',f0:i%2?520:760,dur:0.11,vol:0.30,fHz:1500,fQ:5,when:i*0.1});
  }
}

// Classic two-tone "beep-beep" car horn for when the beam grabs a vehicle.
function honkBlast(when){
  voice({type:'sawtooth',f0:400,dur:0.18,vol:0.22,fHz:820, fQ:1,when});
  voice({type:'sawtooth',f0:500,dur:0.18,vol:0.18,fHz:1020,fQ:1,when});
}
export function carHonk(){ honkBlast(0); honkBlast(0.24); }

/* Fired from the abduction loop for every captured creature/human. A recorded
   sample (assets/sfx via the manifest) wins if one exists for this creature;
   otherwise we fall back to the synthesized voice. */
export function cry(name){
  Samples.init();                                  // lazy, one-time manifest load
  if(Samples.has(name) && Samples.play(name)) return;
  if(name==='Hiker'||name==='Villager'){ humanScream(); return; }
  animalCry(name);
}
