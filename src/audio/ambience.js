/* =========================================================================
   AMBIENCE — the living soundscape under the whole game.

   The premise is the mix: you are an alien who has just arrived. The bed is
   what YOU sound like — a low, eerie, faintly wrong drone that never leaves.
   Everything else is Earth, heard from above and at a distance: wind over the
   valley, rain, the roar of a highway, birdsong, a murmur of people you cannot
   quite make out. The Earth layers all run through the shared reverb and stay
   quieter than the bed, so they read as new, distant and a little confusing —
   stimuli, not score.

   Two kinds of sound here:

     LAYERS   persistent noise/oscillator voices, created once. Their gains are
              target-ramped from update() — no node churn, no allocation, and
              they cross-fade smoothly as the world under the ship changes.
     EVENTS   one-shots (a bird, a car passing, a snatch of speech) fired by a
              Poisson process whose rate is driven by what is actually nearby.
              These are stereo-panned by bearing, which is most of what sells
              "sounds all around me".

   This module is a LEAF: it imports only the audio bus and takes everything it
   needs about the world as a plain context object from main.js. That keeps the
   dependency direction one-way and avoids a cycle with world/ and entities/.
   ========================================================================= */
import { Music } from './music.js';

/* Per-weather targets. Each entry is [wind, precip, grit]; `grit` is the dry,
   abrasive band that sand and dust need and rain does not. Anything missing
   falls back to CLEAR. */
const WX={
  clear    :[0.26,0.00,0.00],
  sunny    :[0.18,0.00,0.00],
  calm     :[0.12,0.00,0.00],
  fog      :[0.20,0.00,0.00],
  rain     :[0.45,1.00,0.00],
  snow     :[0.30,0.16,0.00],
  snowstorm:[0.95,0.42,0.00],
  sandstorm:[0.90,0.00,1.00],
  duststorm:[0.85,0.00,0.90],
  meteors  :[0.30,0.00,0.00],
  vacuum   :[0.00,0.00,0.00],   // the moon has no air to carry any of this
};

/* How much life a biome supports — scales birdsong and the insect bed. */
const LIFE={forest:1.0, plains:0.75, water:0.45, desert:0.12, mountain:0.18};

const clamp01=v=>v<0?0:v>1?1:v;

let noiseBuf=null;
function noiseBuffer(ac){
  if(noiseBuf&&noiseBuf.sampleRate===ac.sampleRate)return noiseBuf;
  const n=(ac.sampleRate*8)|0;
  const b=ac.createBuffer(1,n,ac.sampleRate);
  const d=b.getChannelData(0);
  for(let i=0;i<n;i++)d[i]=Math.random()*2-1;
  noiseBuf=b; return noiseBuf;
}

export const Ambience={
  ac:null, bus:null, dry:null, wet:null, evt:null, far:null,
  started:false, enabled:true, level:0,
  L:{},                  // named layer gains
  _lfo:[], _srcs:[],
  _t:0, _wx:'clear',

  /* ---- construction ----------------------------------------------------- */

  /* One looping noise voice through a filter, with optional LFO modulation of
     the filter centre. Returns the gain the caller rides. */
  _noiseLayer({type='bandpass',f=600,q=1,vol=0,lfoHz=0,lfoAmt=0,send=0.3,f2=0,far=false}={}){
    const ac=this.ac;
    const src=ac.createBufferSource(); src.buffer=noiseBuffer(ac); src.loop=true;
    const flt=ac.createBiquadFilter(); flt.type=type; flt.frequency.value=f; flt.Q.value=q;
    const g=ac.createGain(); g.gain.value=vol;
    src.connect(flt); flt.connect(g);
    // `far` layers belong to the world out there and take the distance chain,
    // which already carries its own reverb send.
    g.connect(far?this.far:this.dry);
    if(send&&!far){ const s=ac.createGain(); s.gain.value=send; g.connect(s); s.connect(this.wet); }
    if(f2){                                   // a second formant band off the same noise
      const f2n=ac.createBiquadFilter(); f2n.type='bandpass'; f2n.frequency.value=f2; f2n.Q.value=q*1.4;
      src.connect(f2n); f2n.connect(g);
    }
    if(lfoHz){
      const lfo=ac.createOscillator(); lfo.frequency.value=lfoHz;
      const amt=ac.createGain(); amt.gain.value=lfoAmt;
      lfo.connect(amt); amt.connect(flt.frequency);
      lfo.start(); this._lfo.push(lfo);
    }
    src.start(); this._srcs.push(src);
    return g;
  },

  /* A held oscillator stack — the alien bed. */
  _droneLayer(freqs,{type='sawtooth',cut=190,q=1.2,vol=0,lfoHz=0.05,lfoAmt=140,send=0.5}={}){
    const ac=this.ac;
    const flt=ac.createBiquadFilter(); flt.type='lowpass'; flt.frequency.value=cut; flt.Q.value=q;
    const g=ac.createGain(); g.gain.value=vol;
    flt.connect(g); g.connect(this.dry);
    if(send){ const s=ac.createGain(); s.gain.value=send; g.connect(s); s.connect(this.wet); }
    if(lfoHz){
      const lfo=ac.createOscillator(); lfo.frequency.value=lfoHz;
      const amt=ac.createGain(); amt.gain.value=lfoAmt;
      lfo.connect(amt); amt.connect(flt.frequency);
      lfo.start(); this._lfo.push(lfo);
    }
    for(const fr of freqs){
      const o=ac.createOscillator(); o.type=type; o.frequency.value=fr;
      o.connect(flt); o.start(); this._srcs.push(o);
    }
    return g;
  },

  /* A tremolo'd high band — insects. The square LFO gives the stridulating
     on/off rhythm that a smooth sine cannot. */
  _insectLayer(){
    const ac=this.ac;
    const src=ac.createBufferSource(); src.buffer=noiseBuffer(ac); src.loop=true;
    const flt=ac.createBiquadFilter(); flt.type='bandpass'; flt.frequency.value=4800; flt.Q.value=18;
    const trem=ac.createGain(); trem.gain.value=0.45;
    const lfo=ac.createOscillator(); lfo.type='square'; lfo.frequency.value=11.5;
    const amt=ac.createGain(); amt.gain.value=0.45;
    lfo.connect(amt); amt.connect(trem.gain);
    const g=ac.createGain(); g.gain.value=0;
    src.connect(flt); flt.connect(trem); trem.connect(g); g.connect(this.dry);
    const s=ac.createGain(); s.gain.value=0.35; g.connect(s); s.connect(this.wet);
    src.start(); lfo.start(); this._srcs.push(src); this._lfo.push(lfo);
    return g;
  },

  start(){
    if(this.started)return;
    try{
      Music.ensure();
      const ac=Music.ac;
      if(ac.state==='suspended')ac.resume();
      this.ac=ac;

      // master -> the SFX bus, so ambience obeys the same volume as everything
      // else and never fights the arrival cue for headroom.
      this.bus=ac.createGain(); this.bus.gain.value=0; this.bus.connect(Music.sfx);
      this.dry=ac.createGain(); this.dry.gain.value=1; this.dry.connect(this.bus);
      this.wet=ac.createGain(); this.wet.gain.value=0.55;
      try{ this.wet.connect(Music.conv); }catch(e){}   // conv -> revWet -> master
      /* DISTANCE CHAIN. Everything that belongs to the world out there — the
         highway, the murmur of a town, every bird and voice — goes through here
         rather than straight to the mix. Three things make a sound read as far
         away, and it needs all three: air swallows the high frequencies, the
         direct signal is much quieter than the reflections, and the reflections
         arrive late. So: a gentle lowpass, a dry path pulled well down, a short
         valley slap-back, and a heavy send to the shared reverb.

         The result is meant to sit under everything and never pull focus. If a
         sound out here is ever intelligible or attention-grabbing, this chain is
         the thing to turn further down. */
      const farIn=ac.createGain(); farIn.gain.value=1;
      const air=ac.createBiquadFilter(); air.type='lowpass'; air.frequency.value=2400; air.Q.value=0.5;
      farIn.connect(air);
      const farDry=ac.createGain(); farDry.gain.value=0.34;      // mostly reflections, little direct
      air.connect(farDry); farDry.connect(this.bus);
      const slap=ac.createDelay(0.6); slap.delayTime.value=0.17;
      const slapFb=ac.createGain(); slapFb.gain.value=0.30;
      const slapOut=ac.createGain(); slapOut.gain.value=0.42;
      air.connect(slap); slap.connect(slapFb); slapFb.connect(slap);
      slap.connect(slapOut); slapOut.connect(this.bus);
      const farWet=ac.createGain(); farWet.gain.value=0.95;
      air.connect(farWet); farWet.connect(this.wet);
      slap.connect(farWet);
      this.far=farIn;

      this.evt=this.far;                 // one-shots are all "out there" too

      const L=this.L;
      // --- the alien bed: two near-unison lows that beat against each other,
      //     plus a barely-there high shimmer. Always on, never resolves.
      L.bed    = this._droneLayer([38.90,39.17,58.27],{vol:0.055,cut:180,lfoHz:0.043,lfoAmt:130,send:0.6});
      L.shimmer= this._noiseLayer({type:'bandpass',f:2600,q:9,vol:0.006,lfoHz:0.031,lfoAmt:1400,send:0.7});
      // --- Earth, in layers ---
      L.wind   = this._noiseLayer({type:'bandpass',f:420,q:0.55,vol:0,lfoHz:0.09,lfoAmt:260,send:0.45});
      L.gust   = this._noiseLayer({type:'bandpass',f:1500,q:5,  vol:0,lfoHz:0.13,lfoAmt:700,send:0.5});
      L.precip = this._noiseLayer({type:'highpass',f:1300,q:0.7,vol:0,send:0.35});
      L.pbody  = this._noiseLayer({type:'bandpass',f:430, q:0.8,vol:0,send:0.4});
      L.grit   = this._noiseLayer({type:'bandpass',f:900, q:0.9,vol:0,lfoHz:0.21,lfoAmt:420,send:0.35});
      L.road   = this._noiseLayer({type:'lowpass', f:230, q:0.8,vol:0,lfoHz:0.07,lfoAmt:70,f2:760,far:true});
      L.murmur = this._noiseLayer({type:'bandpass',f:470, q:7,  vol:0,lfoHz:0.17,lfoAmt:110,f2:1180,far:true});
      L.insects= this._insectLayer();

      this.started=true;
    }catch(e){ this.started=false; }
  },

  /* ---- one-shot events -------------------------------------------------- */

  /* Every event goes through its own panner, so a bird is over there and the
     highway is behind you. `pan` is -1..1. Output lands on the distance chain,
     which supplies the air filter, the slap-back and the reverb. */
  _voiceOut(pan){
    const ac=this.ac;
    const g=ac.createGain();
    let out=g;
    try{ const p=ac.createStereoPanner(); p.pan.value=pan||0; g.connect(p); out=p; }catch(e){}
    out.connect(this.evt);
    return g;
  },

  _blip(dest,t,{f0,f1,dur,vol,type='sine',fHz=0,fQ=3,cut=0,vibHz=0,vibDepth=0}){
    const ac=this.ac;
    const o=ac.createOscillator(); o.type=type;
    o.frequency.setValueAtTime(f0,t);
    if(f1)o.frequency.exponentialRampToValueAtTime(Math.max(30,f1),t+dur);
    if(vibHz){
      const v=ac.createOscillator(); v.frequency.value=vibHz;
      const vg=ac.createGain(); vg.gain.value=vibDepth;
      v.connect(vg); vg.connect(o.frequency);
      v.start(t); v.stop(t+dur+0.03);
    }
    let node=o;
    if(fHz){ const b=ac.createBiquadFilter(); b.type='bandpass'; b.frequency.value=fHz; b.Q.value=fQ; o.connect(b); node=b; }
    if(cut){ const l=ac.createBiquadFilter(); l.type='lowpass'; l.frequency.value=cut; node.connect(l); node=l; }
    const g=ac.createGain();
    g.gain.setValueAtTime(0.0001,t);
    g.gain.linearRampToValueAtTime(vol,t+Math.min(0.02,dur*0.3));
    g.gain.exponentialRampToValueAtTime(0.0001,t+dur);
    node.connect(g); g.connect(dest);
    o.start(t); o.stop(t+dur+0.03);
  },

  /* BIRD — two to five bright notes with a quick glide, or a fast trill. Short,
     high and irregular; regular intervals read as machinery, not an animal. */
  _bird(pan,k){
    const ac=this.ac, t=ac.currentTime+0.02;
    const out=this._voiceOut(pan);
    const A=k==null?1:0.45+0.55*k;      // a bird you can see is a touch closer than one you cannot
    const base=1650+Math.random()*1350;
    if(Math.random()<0.25){                          // trill
      for(let i=0;i<7;i++)
        this._blip(out,t+i*0.045,{f0:base*(1+(i%2)*0.13),f1:base*0.94,dur:0.05,vol:0.032*A,type:'triangle'});
      return;
    }
    const n=2+((Math.random()*4)|0);
    let tt=t;
    for(let i=0;i<n;i++){
      const up=Math.random()<0.6;
      const f=base*(0.86+Math.random()*0.3);
      this._blip(out,tt,{f0:f,f1:f*(up?1.35:0.72),dur:0.06+Math.random()*0.05,vol:(0.028+Math.random()*0.018)*A,type:'sine'});
      tt+=0.07+Math.random()*0.11;
    }
  },

  /* PASSING CAR — a band of noise whose centre rises then falls while the pan
     sweeps across. That pitch arc IS the doppler; without it a car sounds like
     a washing machine. */
  _carPass(fromLeft,k){
    const ac=this.ac, t=ac.currentTime+0.02;
    const dur=1.5+Math.random()*1.1;
    const src=ac.createBufferSource(); src.buffer=noiseBuffer(ac); src.loop=true;
    const flt=ac.createBiquadFilter(); flt.type='bandpass'; flt.Q.value=1.1;
    flt.frequency.setValueAtTime(330,t);
    flt.frequency.linearRampToValueAtTime(880,t+dur*0.45);
    flt.frequency.linearRampToValueAtTime(300,t+dur);
    const g=ac.createGain();
    g.gain.setValueAtTime(0.0001,t);
    g.gain.linearRampToValueAtTime(0.034*(k==null?1:0.35+0.65*k),t+dur*0.45);
    g.gain.exponentialRampToValueAtTime(0.0001,t+dur);
    let out=g;
    try{
      const p=ac.createStereoPanner();
      p.pan.setValueAtTime(fromLeft?-0.9:0.9,t);
      p.pan.linearRampToValueAtTime(fromLeft?0.9:-0.9,t+dur);
      g.connect(p); out=p;
    }catch(e){}
    src.connect(flt); flt.connect(g); out.connect(this.evt);
    src.start(t); src.stop(t+dur+0.05);
  },

  /* DISTANT SPEECH — a mumble, not dialogue. Syllables are slow and smeared
     into each other, the formant is broad rather than sharp (a narrow one makes
     vowels legible, which is exactly wrong), and everything above ~600Hz is
     gone, so what is left is the rhythm and pitch contour of a voice with none
     of its content. You should be able to tell someone is talking down there and
     never be tempted to listen. */
  _speech(pan,k){
    const ac=this.ac, t=ac.currentTime+0.02;
    const out=this._voiceOut(pan);
    const A=k==null?1:0.4+0.6*k;
    const male=Math.random()<0.5;
    const base=male?92+Math.random()*38:150+Math.random()*55;
    const n=3+((Math.random()*4)|0);
    let tt=t;
    for(let i=0;i<n;i++){
      const f=base*(0.92+Math.random()*0.2);
      this._blip(out,tt,{f0:f,f1:f*(0.9+Math.random()*0.22),dur:0.16+Math.random()*0.14,
        vol:(0.026+Math.random()*0.014)*A,type:'sawtooth',
        fHz:(male?300:400)+Math.random()*200,fQ:1.6,cut:620});
      tt+=0.13+Math.random()*0.16;                  // overlaps the previous syllable
    }
    if(Math.random()<0.12){                          // someone laughs, somewhere
      for(let i=0;i<4;i++)
        this._blip(out,tt+i*0.14,{f0:base*1.35*(1-i*0.07),dur:0.13,vol:0.022*A,
          type:'sawtooth',fHz:420,fQ:1.6,cut:680});
    }
  },

  /* DOG — two clipped barks with a noise transient on the front of each. */
  _dog(pan){
    const ac=this.ac, t=ac.currentTime+0.02;
    const out=this._voiceOut(pan);
    for(let i=0;i<2;i++){
      const b=t+i*0.26;
      this._blip(out,b,{f0:190,f1:110,dur:0.13,vol:0.034,type:'sawtooth',fHz:760,fQ:3,cut:2200});
      const src=ac.createBufferSource(); src.buffer=noiseBuffer(ac);
      const f=ac.createBiquadFilter(); f.type='bandpass'; f.frequency.value=1100; f.Q.value=1.4;
      const g=ac.createGain();
      g.gain.setValueAtTime(0.017,b); g.gain.exponentialRampToValueAtTime(0.0001,b+0.07);
      src.connect(f); f.connect(g); g.connect(out);
      src.start(b); src.stop(b+0.09);
    }
  },

  /* HORN — a distant two-tone, filtered down so it reads as far away. */
  _horn(pan){
    const ac=this.ac, t=ac.currentTime+0.02;
    const out=this._voiceOut(pan);
    for(const w of [0,0.26]){
      this._blip(out,t+w,{f0:392,dur:0.17,vol:0.021,type:'sawtooth',fHz:800,fQ:1.5,cut:1500});
      this._blip(out,t+w,{f0:494,dur:0.17,vol:0.017,type:'sawtooth',fHz:1000,fQ:1.5,cut:1500});
    }
  },

  /* NIGHT CALL — an owl-ish two-note hoot. Rare, and the single most effective
     thing in the whole mix for making a dark valley feel inhabited. */
  _nightCall(pan){
    const ac=this.ac, t=ac.currentTime+0.02;
    const out=this._voiceOut(pan);
    this._blip(out,t,     {f0:404,f1:372,dur:0.30,vol:0.030,type:'sine',cut:900});
    this._blip(out,t+0.42,{f0:372,f1:340,dur:0.42,vol:0.027,type:'sine',cut:900});
  },

  /* SHEEP / GOAT — a wavering bleat. The vibrato is the whole character; without
     it this is just a tone. Goats are higher and shake faster. */
  _bleat(pan,vol,goat){
    const ac=this.ac, t=ac.currentTime+0.02;
    const out=this._voiceOut(pan);
    const f=(goat?430:300)*(0.9+Math.random()*0.2);
    const dur=(goat?0.42:0.55)*(0.8+Math.random()*0.4);
    this._blip(out,t,{f0:f,f1:f*0.86,dur,vol,type:'sawtooth',fHz:goat?900:700,fQ:2.4,cut:1300,
      vibHz:goat?17:9, vibDepth:goat?26:14});
  },

  /* DUCK — three flat nasal quacks, no glide. */
  _quack(pan,vol){
    const ac=this.ac, t=ac.currentTime+0.02;
    const out=this._voiceOut(pan);
    for(let i=0;i<3;i++)
      this._blip(out,t+i*0.15,{f0:255-i*10,f1:230,dur:0.1,vol,type:'sawtooth',fHz:1250,fQ:4,cut:1800});
  },

  /* Pick a nearby emitter of a kind, biased toward the close ones (the list
     arrives sorted). Returns null if nothing of that kind is in earshot. */
  _pick(emit,kinds,range){
    if(!emit||!emit.length)return null;
    const hits=[];
    for(const e of emit)if(kinds.indexOf(e.k)>=0&&e.d<range)hits.push(e);
    if(!hits.length)return null;
    // square-biased index: mostly the nearest, occasionally one further out
    return hits[Math.min(hits.length-1,(Math.pow(Math.random(),2)*hits.length)|0)];
  },

  /* Inverse-square-ish falloff, reaching silence at `range`. This is the thing
     that makes flying past a flock work: it swells as you close and dies as you
     leave, without any explicit fade logic. */
  _fall(d,range){ const k=clamp01(1-d/range); return k*k; },

  /* Fire an event with probability rate*dt — a Poisson process, so the spacing
     is irregular the way real ambience is. */
  _maybe(rate,dt,fn){
    if(rate<=0)return;
    if(Math.random()<rate*dt)fn.call(this,Math.random()*1.8-0.9);
  },

  /* ---- per-frame ---------------------------------------------------------
     ctx: {agl, dayF, biome, weather, world, roadD, cars, houses, speed}
       agl     height above ground (units)
       dayF    1 = day, 0 = night
       biome   terrain biome under the ship
       weather current weather key
       world   'earth' | 'moon' | 'mars'
       roadD   distance to the nearest road (units)
       cars    vehicles within earshot
       houses  buildings within earshot
       speed   ship speed (units/s) — adds slipstream to the wind
  */
  update(dt,ctx){
    if(!this.started||!this.enabled)return;
    try{
      const ac=this.ac, now=ac.currentTime;
      this._t+=dt;

      // Master level: the caller decides how present ambience should be (0 in
      // the menu, low under the arrival cue, full in play).
      this.bus.gain.setTargetAtTime(this.level*0.9,now,0.5);
      if(this.level<=0.001)return;

      const earth=ctx.world==='earth';
      const wx=WX[ctx.weather]||WX.clear;
      const day=clamp01(ctx.dayF);
      const life=(LIFE[ctx.biome]!=null?LIFE[ctx.biome]:0.4)*(earth?1:0);

      /* Height falloff. Ground-borne sound thins out as you climb; wind does the
         opposite. At hover height everything is present, by ~250 units the
         valley has gone quiet and it is just you and the air. */
      const agl=Math.max(0,ctx.agl||0);
      const near=clamp01(1-(agl-25)/230);
      const high=clamp01((agl-40)/240);

      /* --- the bed: louder at night and higher up, where there is nothing else --- */
      const L=this.L;
      L.bed.gain.setTargetAtTime(0.048+0.030*(1-day)+0.022*high,now,1.2);
      L.shimmer.gain.setTargetAtTime(0.005+0.007*(1-day)+0.006*high,now,1.5);

      /* --- wind: weather sets the floor, altitude and airspeed add to it --- */
      const windAmt=earth||ctx.world==='mars'
        ? wx[0]+high*0.45+Math.min(0.28,(ctx.speed||0)/260)
        : 0;
      L.wind.gain.setTargetAtTime(0.055*windAmt,now,0.8);
      L.gust.gain.setTargetAtTime(0.012*windAmt*(0.35+high),now,1.0);

      /* --- precipitation and grit --- */
      L.precip.gain.setTargetAtTime(0.042*wx[1],now,0.7);
      L.pbody.gain.setTargetAtTime(0.020*wx[1],now,0.7);
      L.grit.gain.setTargetAtTime(0.030*wx[2],now,0.7);

      /* --- the highway: audible from a long way off, and it is the loudest
             thing a quiet valley has. Falls off with distance and altitude. --- */
      const roadK=earth?clamp01(1-(ctx.roadD||999)/190)*near:0;
      const traffic=roadK*(0.35+0.65*clamp01((ctx.cars||0)/6))*(0.45+0.55*day);
      L.road.gain.setTargetAtTime(0.055*traffic,now,0.9);

      /* --- people: fades with the distance to the nearest building, not with a
             raw count, so leaving a hamlet behind actually sounds like leaving --- */
      const town=earth?this._fall(Math.min(ctx.dHouse!=null?ctx.dHouse:999,260),260)
                       *(0.45+0.55*clamp01((ctx.houses||0)/5))*near:0;
      L.murmur.gain.setTargetAtTime(0.030*town*(0.25+0.75*day),now,1.1);

      /* --- insects: a summer night in the grass --- */
      L.insects.gain.setTargetAtTime(0.020*life*(1-day)*near,now,1.4);

      /* --- events ---------------------------------------------------------
             Rates are per second. The creature and traffic calls are driven by
             ACTUAL nearby things (ctx.emit, nearest first): the scheduler picks
             a real emitter, pans it to its real bearing and scales it by its own
             distance. That is what makes flying over a flock sound like flying
             over a flock — they bleat, they fall behind, and whatever is ahead
             fades up in their place, with no explicit fade logic anywhere.

             Rates were tuned by counting events per simulated minute; the target
             is "occasional and curious", never a wall of sound. */
      const em=ctx.emit;
      const R_ANI=150, R_HUM=185, R_CAR=210;

      // livestock: the closer the flock, the more often one of them speaks up
      const flock=this._pick(em,['Sheep','Goat'],R_ANI);
      if(flock)this._maybe(0.42*this._fall(flock.d,R_ANI)*(0.35+0.65*day),dt,
        ()=>this._bleat(flock.pan,0.030*this._fall(flock.d,R_ANI),flock.k==='Goat'));

      const duck=this._pick(em,['Duck'],R_ANI);
      if(duck)this._maybe(0.30*this._fall(duck.d,R_ANI)*day,dt,
        ()=>this._quack(duck.pan,0.026*this._fall(duck.d,R_ANI)));

      // birds you can see, plus a thinner scatter of the ones you cannot
      const seen=this._pick(em,['Bird'],R_ANI);
      if(seen)this._maybe(0.34*this._fall(seen.d,R_ANI)*day,dt,
        ()=>this._bird(seen.pan,this._fall(seen.d,R_ANI)));
      this._maybe(0.14*life*day*near, dt, this._bird);

      // traffic: a real car, panned where it really is
      const car=this._pick(em,['car'],R_CAR);
      if(car)this._maybe(0.30*this._fall(car.d,R_CAR)*(0.45+0.55*day),dt,
        ()=>this._carPass(car.pan<0, this._fall(car.d,R_CAR)));
      this._maybe(0.025*traffic, dt, this._horn);

      // people: a real person nearby, else the general hum of a settlement
      const who=this._pick(em,['human'],R_HUM);
      if(who)this._maybe(0.30*this._fall(who.d,R_HUM)*(0.3+0.7*day),dt,
        ()=>this._speech(who.pan,this._fall(who.d,R_HUM)));
      this._maybe(0.10*town*(0.3+0.7*day), dt, this._speech);
      this._maybe(0.05*town,               dt, this._dog);
      this._maybe(0.07*life*(1-day)*near,  dt, this._nightCall);
    }catch(e){}
  },

  /* How present the soundscape should be: 0 menu, ~0.25 under the arrival cue,
     1 in play. Ramped inside update(), so this is safe to set every frame. */
  setLevel(v){ this.level=clamp01(v); },

  setEnabled(on){
    this.enabled=!!on;
    try{ localStorage.setItem('abductor.ambience',this.enabled?'1':'0'); }catch(e){}
    if(!this.enabled&&this.bus)
      this.bus.gain.setTargetAtTime(0.0001,this.ac.currentTime,0.3);
  },
};

try{ Ambience.enabled=localStorage.getItem('abductor.ambience')!=='0'; }catch(e){}
export default Ambience;
