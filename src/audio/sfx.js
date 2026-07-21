/* =========================================================================
   SFX — synthesized sweeps, filtered-noise bursts, signature hazard sounds,
   the sustained beam loop, and creature cries. All route through Music.sfx.
   ========================================================================= */
import { Music, beep } from './music.js';

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
const CRY={Sheep:[520,0.35],Camel:[300,0.4],Duck:[780,0.22],Goat:[470,0.35],
  Hiker:[880,0.45],Villager:[840,0.45],Blob:[200,0.4],Crawler:[560,0.25],Skimmer:[700,0.3],
  Strider:[340,0.4],Tumbler:[620,0.25],Wormling:[240,0.45]};
export function cry(name){
  const cfg=CRY[name]||[500,0.3];
  try{
    Music.ensure();const c=Music.ac;if(c.state==='suspended')c.resume();
    const f=cfg[0]*(0.92+Math.random()*0.16),dur=cfg[1];
    const o=c.createOscillator();o.type='sawtooth';
    o.frequency.setValueAtTime(f*1.15,c.currentTime);
    o.frequency.exponentialRampToValueAtTime(f*0.5,c.currentTime+dur);
    const fl=c.createBiquadFilter();fl.type='bandpass';fl.frequency.value=f*1.5;fl.Q.value=2.5;
    const g=c.createGain();g.gain.value=0.12;
    const trem=c.createOscillator();trem.frequency.value=8+Math.random()*4;
    const tg=c.createGain();tg.gain.value=0.055;trem.connect(tg);tg.connect(g.gain);
    o.connect(fl);fl.connect(g);g.connect(Music.sfx);
    o.start();trem.start();
    g.gain.exponentialRampToValueAtTime(0.0001,c.currentTime+dur);
    o.stop(c.currentTime+dur+0.05);trem.stop(c.currentTime+dur+0.05);
  }catch(e){}
}
