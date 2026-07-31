/* =========================================================================
   ARRIVAL CUE — the score for the intro cinematic (systems/intro.js).

   One synthesized piece, ~9s, written against the film's beats and scheduled in
   one go on the AudioContext clock. Scheduling absolutely (rather than firing
   sounds from the frame loop) is what keeps the hits welded to the cuts: the
   film can stutter under load and the edit still lands on the downbeat.

   The music engine is disabled game-wide (see audio/music.js — every track
   entry point is a deliberate no-op), so this does NOT go through it. It builds
   its own bus into Music.sfx, which means the one cinematic cue plays without
   bringing ambient music back, and it sits under the same master as every other
   sound in the game.

   Beat sheet, in seconds, matching intro.js:
     0.00  impact + sub drop — something enormous is overhead
     0.00  drone bed and mothership hum come up under everything
     0.30  riser: noise sweep + glissando, building through the first shot
     0.45  beam ignition — the harmonic shimmer as the shaft opens
     2.70  CUT to the valley floor: sub kick, bright crash, brass stab
     2.70  descending four-note motif, tracking the saucer down
     5.76  CUT behind the ship: string-ish swell into the landing
     6.66  TOUCHDOWN: resonant hit, the beam powers down
     6.90  resolve — a warm D-minor-add9 that fades to nothing by 9.00
   ========================================================================= */
import { Music } from './music.js';

const T_CUT2 = 2.70;    // intro.js shot 1 -> 2   (T=0.30)
const T_CUT3 = 5.76;    // intro.js shot 2 -> 3   (T=0.64)
const T_LAND = 6.66;    // intro.js DROP_TO       (T=0.74)
const T_END  = 9.00;    // intro.js DUR

/* One shared noise buffer — regenerating white noise per burst is pure waste at
   this density, and eight seconds is longer than any single hit needs. */
let noiseBuf=null;
function noise(ac){
  if(noiseBuf&&noiseBuf.sampleRate===ac.sampleRate)return noiseBuf;
  const n=(ac.sampleRate*8)|0;
  const b=ac.createBuffer(1,n,ac.sampleRate);
  const d=b.getChannelData(0);
  for(let i=0;i<n;i++)d[i]=Math.random()*2-1;
  noiseBuf=b; return noiseBuf;
}

export const Arrival={
  ac:null, bus:null, wet:null, nodes:[], active:false,
  _bedGain:null, _humGain:null,

  /* The cue's own sub-mix: dry into the SFX bus, plus a send into the shared
     convolution reverb so the mothership has a valley to sound big in. */
  _open(){
    const ac=Music.ac;
    this.ac=ac;
    const bus=ac.createGain(); bus.gain.value=0.9; bus.connect(Music.sfx);
    const wet=ac.createGain(); wet.gain.value=0.5;
    try{ wet.connect(Music.conv); }catch(e){}      // conv -> revWet -> master
    this.bus=bus; this.wet=wet; this.nodes=[];
  },

  /* ---- voices -------------------------------------------------------------
     Each returns nothing and registers its sources so stop()/skip() can cut
     them; `send` is how much of the voice goes to the reverb. */

  _tone(t,freq,dur,{type='sine',vol=0.1,atk=0.01,cut=3000,q=0.7,glide=0,send=0.25}={}){
    const ac=this.ac;
    const o=ac.createOscillator(); o.type=type; o.frequency.setValueAtTime(freq,t);
    if(glide)o.frequency.exponentialRampToValueAtTime(Math.max(20,glide),t+dur);
    const f=ac.createBiquadFilter(); f.type='lowpass'; f.frequency.value=cut; f.Q.value=q;
    const g=ac.createGain();
    g.gain.setValueAtTime(0.0001,t);
    g.gain.linearRampToValueAtTime(vol,t+atk);
    g.gain.exponentialRampToValueAtTime(0.0001,t+dur);
    o.connect(f); f.connect(g); g.connect(this.bus);
    if(send){ const s=ac.createGain(); s.gain.value=send; g.connect(s); s.connect(this.wet); }
    o.start(t); o.stop(t+dur+0.05);
    this.nodes.push(o);
  },

  _noise(t,dur,{vol=0.1,type='bandpass',f0=800,f1=0,q=1,atk=0.004,send=0.3}={}){
    const ac=this.ac;
    const src=ac.createBufferSource(); src.buffer=noise(ac); src.loop=true;
    const f=ac.createBiquadFilter(); f.type=type;
    f.frequency.setValueAtTime(f0,t);
    if(f1)f.frequency.exponentialRampToValueAtTime(Math.max(40,f1),t+dur);
    f.Q.value=q;
    const g=ac.createGain();
    g.gain.setValueAtTime(0.0001,t);
    g.gain.linearRampToValueAtTime(vol,t+atk);
    g.gain.exponentialRampToValueAtTime(0.0001,t+dur);
    src.connect(f); f.connect(g); g.connect(this.bus);
    if(send){ const s=ac.createGain(); s.gain.value=send; g.connect(s); s.connect(this.wet); }
    src.start(t); src.stop(t+dur+0.05);
    this.nodes.push(src);
  },

  _chord(t,freqs,dur,opts){ for(const f of freqs)this._tone(t,f,dur,opts); },

  /* A held voice with an amplitude LFO — the mothership's engine note, and the
     beam's pulse. Returns its gain so the caller can fade it on a cut. */
  _bed(t,dur,freqs,{type='sawtooth',vol=0.06,atk=1.2,cut0=180,cut1=900,lfoHz=0,lfoDepth=0.4,send=0.4}={}){
    const ac=this.ac;
    const f=ac.createBiquadFilter(); f.type='lowpass'; f.Q.value=1.4;
    f.frequency.setValueAtTime(cut0,t);
    f.frequency.linearRampToValueAtTime(cut1,t+dur*0.75);
    f.frequency.linearRampToValueAtTime(cut0*0.7,t+dur);
    const g=ac.createGain();
    g.gain.setValueAtTime(0.0001,t);
    g.gain.linearRampToValueAtTime(vol,t+atk);
    g.gain.setValueAtTime(vol,t+dur-1.1);
    g.gain.exponentialRampToValueAtTime(0.0001,t+dur);
    f.connect(g); g.connect(this.bus);
    if(send){ const s=ac.createGain(); s.gain.value=send; g.connect(s); s.connect(this.wet); }
    if(lfoHz){
      const lfo=ac.createOscillator(); lfo.frequency.value=lfoHz;
      const amt=ac.createGain(); amt.gain.value=vol*lfoDepth;
      lfo.connect(amt); amt.connect(g.gain);
      lfo.start(t); lfo.stop(t+dur+0.05); this.nodes.push(lfo);
    }
    for(const fr of freqs){
      const o=ac.createOscillator(); o.type=type; o.frequency.value=fr;
      o.connect(f); o.start(t); o.stop(t+dur+0.05); this.nodes.push(o);
    }
    return g;
  },

  /* ---- the piece ---------------------------------------------------------- */
  play(){
    try{
      Music.ensure();
      const ac=Music.ac;
      if(ac.state==='suspended')ac.resume();
      this.stop();
      this._open();
      this.active=true;
      const t0=ac.currentTime+0.04;      // a beat of headroom so nothing schedules in the past

      /* --- bed: a low D drone that breathes under the whole film, and the
             mothership's engine hum, which leaves when the ship does. --- */
      this._bedGain=this._bed(t0,T_END,[36.71,36.95,55.00,73.42],
        {vol:0.075,atk:1.6,cut0:150,cut1:820,lfoHz:0.16,lfoDepth:0.35,send:0.45});
      this._humGain=this._bed(t0,T_LAND+1.2,[55,110.3],
        {type:'sawtooth',vol:0.035,atk:0.9,cut0:220,cut1:520,lfoHz:6.2,lfoDepth:0.55,send:0.3});

      /* --- 0.00 impact: the arrival itself. Sub drop plus a wide, dark hit. --- */
      this._tone(t0,90,1.5,{type:'sine',vol:0.30,atk:0.004,cut:200,glide:28,send:0.2});
      this._noise(t0,1.8,{vol:0.16,type:'lowpass',f0:1400,f1:70,q:0.6,send:0.5});
      this._noise(t0,0.09,{vol:0.13,type:'highpass',f0:5000,f1:8000,q:0.5,send:0.2});

      /* --- 0.30 riser into the first cut: noise sweeping up under a
             glissando, both crescendoing. Standard, and it works. --- */
      this._noise(t0+0.30,T_CUT2-0.30,{vol:0.085,type:'bandpass',f0:280,f1:5200,q:1.1,atk:1.6,send:0.35});
      this._tone(t0+0.55,200,T_CUT2-0.62,{type:'triangle',vol:0.05,atk:1.5,cut:4000,glide:1500,send:0.4});

      /* --- 0.45 beam ignition: a harmonic stack over the fundamental, fast
             attack, shimmering. This is the shaft opening. --- */
      this._chord(t0+0.45,[110,164.81,220,329.63,440],2.4,
        {type:'sine',vol:0.045,atk:0.05,cut:5200,send:0.55});
      this._noise(t0+0.45,2.2,{vol:0.05,type:'highpass',f0:2600,f1:6500,q:0.8,atk:0.08,send:0.5});

      /* --- 2.70 CUT to the valley: kick, crash, and a brass-ish stab so the
             edit reads as scored rather than incidental. --- */
      this._tone(t0+T_CUT2,120,0.7,{type:'sine',vol:0.34,atk:0.004,cut:180,glide:38,send:0.15});
      this._noise(t0+T_CUT2,1.3,{vol:0.09,type:'highpass',f0:4200,f1:2000,q:0.5,send:0.6});
      this._chord(t0+T_CUT2,[73.42,110,146.83,220],0.85,
        {type:'sawtooth',vol:0.075,atk:0.02,cut:1600,send:0.4});

      /* --- 2.70 descending motif: four notes falling with the ship, echoing
             across the valley. D minor: A3 G3 F3 D3. --- */
      const fall=[220,196,174.61,146.83];
      for(let i=0;i<fall.length;i++)
        this._tone(t0+T_CUT2+0.18+i*0.95,fall[i],1.8,
          {type:'triangle',vol:0.062,atk:0.03,cut:2800,send:0.65});

      /* --- 5.76 CUT behind the ship: the swell into the landing. --- */
      this._chord(t0+T_CUT3-0.9,[110,146.83,220,293.66,349.23],2.6,
        {type:'sawtooth',vol:0.042,atk:1.5,cut:1900,send:0.5});
      this._noise(t0+T_CUT3-0.9,1.9,{vol:0.055,type:'bandpass',f0:500,f1:3400,q:1.2,atk:1.4,send:0.45});

      /* --- 6.66 TOUCHDOWN: the hit, and the beam powering down. --- */
      this._tone(t0+T_LAND,72,1.6,{type:'sine',vol:0.26,atk:0.005,cut:160,glide:32,send:0.25});
      this._noise(t0+T_LAND,1.5,{vol:0.10,type:'lowpass',f0:2200,f1:110,q:0.7,send:0.55});
      this._tone(t0+T_LAND+0.02,880,1.1,{type:'sine',vol:0.035,atk:0.01,cut:6000,glide:220,send:0.7});

      /* --- 6.90 resolve: warm and open, gone by the handover so play starts
             on silence rather than a tail. --- */
      this._chord(t0+T_LAND+0.24,[73.42,110,146.83,220,329.63],T_END-T_LAND-0.24,
        {type:'sine',vol:0.055,atk:0.5,cut:2600,send:0.6});

      // Nothing is scheduled past T_END: gameplay begins on silence.
    }catch(e){ this.active=false; }
  },

  /* The player tapped through. Audio can't scrub, so duck what's playing and
     put the landing under the shortened ending instead of letting the build
     run on over a film that has already finished. */
  skip(){
    if(!this.active)return;
    try{
      const ac=this.ac, t=ac.currentTime;
      for(const g of [this._bedGain,this._humGain]){
        if(!g)continue;
        g.gain.cancelScheduledValues(t);
        g.gain.setValueAtTime(Math.max(0.0001,g.gain.value),t);
        g.gain.exponentialRampToValueAtTime(0.0001,t+0.9);
      }
      this.bus.gain.cancelScheduledValues(t);
      this.bus.gain.setValueAtTime(this.bus.gain.value,t);
      this.bus.gain.exponentialRampToValueAtTime(0.28,t+0.35);   // duck, don't mute
      this._tone(t+0.05,72,1.4,{type:'sine',vol:0.22,atk:0.005,cut:160,glide:32,send:0.25});
      this._chord(t+0.28,[73.42,110,146.83,220,329.63],1.5,
        {type:'sine',vol:0.05,atk:0.35,cut:2600,send:0.6});
    }catch(e){}
  },

  /* The film ended normally. The cue has already decayed to silence by T_END, so
     there is nothing to fade — just stop considering it live, and let the last
     reverb tail ring out under the opening seconds of play. */
  release(){ this.active=false; },

  /* Hard stop — quitting to the menu mid-film, or starting a fresh run. */
  stop(){
    this.active=false;
    const ac=this.ac;
    if(!ac||!this.bus){ this.nodes=[]; return; }
    try{
      const t=ac.currentTime;
      this.bus.gain.cancelScheduledValues(t);
      this.bus.gain.setValueAtTime(this.bus.gain.value,t);
      this.bus.gain.exponentialRampToValueAtTime(0.0001,t+0.25);
      for(const n of this.nodes){ try{ n.stop(t+0.3); }catch(e){} }
      const bus=this.bus, wet=this.wet;
      setTimeout(()=>{ try{bus.disconnect();wet.disconnect();}catch(e){} },500);
    }catch(e){}
    this.nodes=[]; this.bus=null; this.wet=null;
  },
};
export default Arrival;
