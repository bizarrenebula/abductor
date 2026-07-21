/* =========================================================================
   PROCEDURAL SOUNDTRACK — per-world synthesized themes (no audio files) plus
   the shared `beep` SFX helper. Everything routes through Music's buses.
   ========================================================================= */
export function beep(freq,dur,vol){
  try{
    Music.ensure();
    const c=Music.ac;
    if(c.state==='suspended')c.resume();
    const o=c.createOscillator(),g=c.createGain();
    o.frequency.value=freq;o.type='sine';o.connect(g);
    g.connect(Music.sfx);
    g.gain.value=vol||0.06;
    o.start();g.gain.exponentialRampToValueAtTime(0.0001,c.currentTime+dur);o.stop(c.currentTime+dur);
  }catch(e){}
}

export const Music={
  ac:null,master:null,musicBus:null,sfx:null,conv:null,revWet:null,delay:null,delayFb:null,echoIn:null,
  track:'off',playing:false,vol:0.6,timer:null,step:0,nextT:0,spb:0.25,drone:[],
  ensure(){
    if(this.ac)return;
    const AC=window.AudioContext||window.webkitAudioContext;const ac=new AC();this.ac=ac;
    if(ac.state==='suspended')ac.resume();
    this.master=ac.createGain();this.master.gain.value=0.6;this.master.connect(ac.destination);
    this.sfx=ac.createGain();this.sfx.gain.value=0.9;this.sfx.connect(this.master);
    this.musicBus=ac.createGain();this.musicBus.gain.value=this.vol;
    // convolution reverb from generated impulse
    const ir=ac.createBuffer(2,(ac.sampleRate*2.6)|0,ac.sampleRate);
    for(let ch=0;ch<2;ch++){const d=ir.getChannelData(ch);for(let i=0;i<d.length;i++)d[i]=(Math.random()*2-1)*Math.pow(1-i/d.length,2.6);}
    this.conv=ac.createConvolver();this.conv.buffer=ir;
    this.revWet=ac.createGain();this.revWet.gain.value=0.35;
    this.musicBus.connect(this.master);
    this.musicBus.connect(this.conv);this.conv.connect(this.revWet);this.revWet.connect(this.master);
    // echo delay send
    this.delay=ac.createDelay(1.0);this.delay.delayTime.value=0.375;
    this.delayFb=ac.createGain();this.delayFb.gain.value=0.34;
    this.echoIn=ac.createGain();this.echoIn.gain.value=1.0;
    this.echoIn.connect(this.delay);this.delay.connect(this.delayFb);this.delayFb.connect(this.delay);
    this.delay.connect(this.musicBus);
  },
  note(time,freq,dur,type,vol,cut,atk,echo){
    const ac=this.ac;
    const o=ac.createOscillator();o.type=type||'sine';o.frequency.value=freq;
    const g=ac.createGain();const f=ac.createBiquadFilter();f.type='lowpass';f.frequency.value=cut||3000;
    o.connect(f);f.connect(g);g.connect(this.musicBus);if(echo)g.connect(this.echoIn);
    const a=(atk==null)?0.01:atk;
    g.gain.setValueAtTime(0.0001,time);
    g.gain.linearRampToValueAtTime(vol,time+a);
    g.gain.exponentialRampToValueAtTime(0.0001,time+dur);
    o.start(time);o.stop(time+dur+0.05);
  },
  kick(time){
    const ac=this.ac;const o=ac.createOscillator();o.type='sine';const g=ac.createGain();
    o.frequency.setValueAtTime(140,time);o.frequency.exponentialRampToValueAtTime(45,time+0.12);
    g.gain.setValueAtTime(0.0001,time);g.gain.linearRampToValueAtTime(0.5,time+0.005);
    g.gain.exponentialRampToValueAtTime(0.0001,time+0.28);
    o.connect(g);g.connect(this.musicBus);o.start(time);o.stop(time+0.3);
  },
  startDrone(){
    const ac=this.ac;const f=ac.createBiquadFilter();f.type='lowpass';f.frequency.value=320;
    const lfo=ac.createOscillator();lfo.frequency.value=0.05;const lfoG=ac.createGain();lfoG.gain.value=200;
    lfo.connect(lfoG);lfoG.connect(f.frequency);
    const g=ac.createGain();g.gain.value=0.0001;g.gain.setTargetAtTime(0.15,ac.currentTime,1.6);
    f.connect(g);g.connect(this.musicBus);
    const oscs=[];[55,55.25,82.5].forEach(fr=>{const o=ac.createOscillator();o.type='sawtooth';o.frequency.value=fr;o.connect(f);o.start();oscs.push(o);});
    lfo.start();this.drone=[lfo,...oscs];
  },
  stopDrone(){const ac=this.ac;this.drone.forEach(n=>{try{n.stop(ac.currentTime+0.1);}catch(e){}});this.drone=[];},
  stepDrift(step,time){
    if(step%32===0){
      const bars=[[110,130.81,164.81],[87.31,110,130.81],[146.83,174.61,220],[82.41,103.83,123.47]];
      bars[(step/32)%4|0].forEach(fr=>this.note(time,fr,7.5,'sawtooth',0.05,600,2.0,false));
    }
    if(step%16===0)this.note(time,55,1.3,'sine',0.13,200,0.005,false);
    if(Math.random()<0.06){const pent=[880,987.77,1174.66,1318.51,1567.98];
      this.note(time,pent[(Math.random()*5)|0],2.6,'sine',0.045,4000,0.005,true);}
  },
  stepPulse(step,time){
    const s=step%16,bar=(Math.floor(step/16))%4;
    const roots=[55,43.65,49,41.20];
    if(s%4===0){this.note(time,roots[bar]*2,0.26,'sawtooth',0.11,520,0.005,false);
      this.note(time,roots[bar],0.5,'sine',0.15,150,0.005,false);}
    if(s===0||s===8)this.kick(time);
    const arp=[0,2,3,4,2,3,6,4, 0,2,3,4,7,6,4,2];
    const pent=[220,261.63,293.66,329.63,392,440,523.25,587.33];
    this.note(time,pent[arp[s]],0.22,'triangle',0.06,2600,0.005,true);
    if(s===0){const ch=[[220,261.63,329.63],[174.61,220,261.63],[196,246.94,293.66],[164.81,207.65,246.94]];
      ch[bar].forEach(fr=>this.note(time,fr,3.6,'sawtooth',0.028,900,1.1,false));}
  },
  stepVoid(step,time){
    // moon: vast, empty, crystalline
    if(step%24===0)this.note(time,41.2,3.4,'sine',0.16,120,0.02,false);
    if(step%48===0){[164.81,196,246.94].forEach((fr,i)=>this.note(time+i*0.45,fr,7,'sine',0.032,900,2.4,false));}
    if(Math.random()<0.07){const pent=[1046.5,1174.66,1318.51,1567.98,1760];
      this.note(time,pent[(Math.random()*5)|0],3.4,'sine',0.04,5200,0.01,true);}
    if(step%24===12&&Math.random()<0.5)this.note(time,55,1.8,'triangle',0.06,160,0.4,false);
  },
  schedule(){const look=this.ac.currentTime+0.13;
    while(this.nextT<look){
      if(this.track==='drift')this.stepDrift(this.step,this.nextT);
      else if(this.track==='pulse')this.stepPulse(this.step,this.nextT);
      else if(this.track==='void')this.stepVoid(this.step,this.nextT);
      this.step++;this.nextT+=this.spb;
    }},
  startTrack(name){
    this.ensure();this.track=name;this.step=0;this.playing=true;
    if(name==='drift'){this.spb=60/52/2;this.startDrone();}
    else if(name==='void'){this.spb=60/40/2;}
    else{this.spb=60/96/4;}
    this.nextT=this.ac.currentTime+0.1;
    clearInterval(this.timer);this.timer=setInterval(()=>this.schedule(),25);
  },
  stopAll(){clearInterval(this.timer);this.timer=null;this.stopDrone();this.playing=false;},
  setVolume(v){this.vol=v;if(this.musicBus)this.musicBus.gain.setTargetAtTime(Math.max(0.0001,v),this.ac.currentTime,0.1);},
  set(name){
    this.ensure();if(this.ac.state==='suspended')this.ac.resume();
    if(name==='off'){if(this.playing){this.musicBus.gain.setTargetAtTime(0.0001,this.ac.currentTime,0.2);setTimeout(()=>this.stopAll(),450);}this.track='off';return;}
    if(this.track===name&&this.playing)return;
    const swap=()=>{this.stopAll();this.startTrack(name);
      this.musicBus.gain.cancelScheduledValues(this.ac.currentTime);
      this.musicBus.gain.setTargetAtTime(this.vol,this.ac.currentTime,0.4);};
    if(this.playing){this.musicBus.gain.setTargetAtTime(0.0001,this.ac.currentTime,0.12);setTimeout(swap,320);}
    else swap();
  }
};

export const TRACK_BY_WORLD={earth:'drift',moon:'void',mars:'pulse'};
