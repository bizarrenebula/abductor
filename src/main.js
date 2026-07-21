/* =========================================================================
   ABDUCTOR — entry point. Imports every subsystem (their import side effects
   build the scene, wire input, and set up the UI), then runs the main loop
   and boot sequence. Loaded as a native ES module from index.html after THREE.
   ========================================================================= */
import { THREE } from './core/three.js';
import { env } from './core/env.js';
import { lerp } from './core/math.js';
import { S, camOffset } from './core/state.js';
import { renderer, scene, camera, sun, stars, moon } from './core/engine.js';
import { keys, input } from './core/input.js';

import { reseed } from './world/noise.js';
import { sample, heightAt } from './world/terrain.js';
import { World, dayNightUpdate, applyDayNightLight } from './world/world-config.js';
import { updateChunks, chunks } from './world/chunks.js';
import { WEATHER, weather, updateDust, pickWeather, applyWeather, updateWeatherParticles } from './world/weather.js';

import { updateAnimals } from './entities/animals.js';
import { updateCrystals } from './entities/crystals.js';
import { updateProps } from './entities/props.js';

import { saucer, beamLight, shipLight, ebarBG, ebarFill3, updateEnergyBar } from './systems/saucer.js';
import { beam, beamMat, disc, discMat, effBeamR } from './systems/beam.js';
import { updateAbduction } from './systems/abduction.js';
import { buff, updateBuff } from './systems/buffs.js';
import { applyCloakVisual } from './systems/cloak.js';
import { Special } from './systems/special.js';

import { updateMeteors } from './hazards/meteors.js';
import { updateGeysers } from './hazards/geysers.js';
import { updateLightning, flashAmt } from './hazards/lightning.js';

import { Story } from './story/story.js';

import { Music, beep } from './audio/music.js';
import { BeamSFX } from './audio/sfx.js';

import { waterMat } from './world/water.js';
import { banner } from './ui/banner.js';
import { clockV } from './ui/dom.js';
import { drawMinimap } from './ui/minimap.js';
import { updateFlare } from './ui/flare.js';
import { renderFrame, allocRT } from './ui/postfx.js';
import { endGame } from './ui/screens.js';

import { LOAD_ORDER, loadAllAssets, spawnModel } from './assets.js';

const _v=new THREE.Vector3();

/* =========================================================================
   MAIN LOOP
   ========================================================================= */
const clock=new THREE.Clock();
function animate(){
  requestAnimationFrame(animate);
  const dt=Math.min(0.05,clock.getDelta());
  const t=performance.now()*0.001;

  beamMat.uniforms.uTime.value=t;
  discMat.uniforms.uTime.value=t;
  waterMat.uniforms.uTime.value=t;
  waterMat.uniforms.uCam.value.copy(camera.position);
  waterMat.uniforms.uFogD.value=scene.fog.density;
  waterMat.uniforms.uSun.value.copy(sun.position).normalize();
  waterMat.uniforms.uMoonF.value=S.dayF;
  updateDust();
  stars.position.set(camera.position.x,0,camera.position.z);
  moon.position.copy(camera.position).addScaledVector(_v.copy(sun.position).sub(saucer.position).normalize(),820);

  if(S.state==='playing'){
    /* ---- beam hold: pointer down or space ---- */
    const beamOn=input.beamHold||keys[' ']||Special.active;
    S.beamPower=lerp(S.beamPower,beamOn?1:0,Math.min(1,dt*7));
    if(beamOn&&!S.prevBeam)BeamSFX.start();
    if(!beamOn&&S.prevBeam)BeamSFX.stop();
    S.prevBeam=beamOn;
    BeamSFX.set(S.beamPower);

    /* ---- movement input ---- */
    let ix=0,iz=0;
    if(keys['w']||keys['arrowup'])iz-=1;
    if(keys['s']||keys['arrowdown'])iz+=1;
    if(keys['a']||keys['arrowleft'])ix-=1;
    if(keys['d']||keys['arrowright'])ix+=1;
    if(input.dragActive){ix+=input.dragVX;iz+=input.dragVY;}
    const il=Math.hypot(ix,iz)||1; if(il>1){ix/=il;iz/=il;}
    const ACC=110*(beamOn?0.42:1)*(buff==='speed'?1.6:1)*(World.name==='moon'?1.55:1)*(1.25-0.4*S.dayF);   // faster at night
    S.vel.x+=ix*ACC*dt; S.vel.z+=iz*ACC*dt;
    // drag / gradual stop with delay
    const drag=Math.pow(World.name==='moon'?(beamOn?0.02:0.035):(beamOn?0.03:0.06),dt);
    S.vel.x*=drag; S.vel.z*=drag;
    saucer.position.x+=S.vel.x*dt;
    saucer.position.z+=S.vel.z*dt;

    // altitude: float, rise above terrain
    const gh=heightAt(saucer.position.x,saucer.position.z);
    const targetY=Math.max(26,gh+15)+Math.sin(t*1.4)*0.5;
    saucer.position.y=lerp(saucer.position.y,targetY,Math.min(1,dt*3));

    // banking swing
    S.tiltZ=lerp(S.tiltZ,-S.vel.x*0.012,Math.min(1,dt*4));
    S.tiltX=lerp(S.tiltX, S.vel.z*0.012,Math.min(1,dt*4));
    saucer.rotation.z=S.tiltZ; saucer.rotation.x=S.tiltX;
    saucer.rotation.y+=dt*0.4;
    saucer.userData.lights.rotation.y-=dt*1.5;

    /* ---- beam + disc ---- */
    const groundY=gh;
    const h=saucer.position.y-groundY-1;
    const bp=S.beamPower;
    beam.visible=disc.visible=bp>0.02;
    beamMat.uniforms.uPow.value=bp;
    discMat.uniforms.uPow.value=bp;
    const eR=effBeamR();
    beam.position.set(saucer.position.x,(saucer.position.y-1+groundY)/2,saucer.position.z);
    beam.scale.set(eR*(0.55+0.45*bp),h,eR*(0.55+0.45*bp));
    disc.position.set(saucer.position.x,groundY+0.15,saucer.position.z);
    disc.scale.setScalar(eR*(0.55+0.45*bp));
    beamLight.position.set(saucer.position.x,saucer.position.y-4,saucer.position.z);
    beamLight.intensity=(1.5+0.3*Math.sin(t*13.7)+0.2*Math.sin(t*29.3))*bp;
    shipLight.position.set(saucer.position.x,saucer.position.y+1.5,saucer.position.z);
    shipLight.intensity=(0.55+0.9*(1-S.dayF))+0.12*Math.sin(t*3.1);   // glows more at night
    const lg=saucer.userData.lights;
    if(lg&&lg.visible!==false){
      const blink=S.dayF>0.6?1:(0.3+0.7*(0.5+0.5*Math.sin(t*6.5)));
      lg.children.forEach(c=>{if(c.material)c.material.opacity=blink*(S.cloak?0.24:1);});
    }
    updateEnergyBar(dt,S.energyMode==='drain'&&(bp>0.05||S.cloak||S.energy<0.28));

    /* ---- world ---- */
    updateChunks(saucer.position.x,saucer.position.z);
    updateAnimals(dt);

    /* ---- weather ---- */
    weather.biome=sample(saucer.position.x,saucer.position.z).biome;
    weather.timer-=dt;
    if(weather.timer<=0||applyWeather._last!==weather.biome){
      applyWeather.prevBiome=weather.biome;
      applyWeather(pickWeather(weather.biome));
      applyWeather._last=weather.biome;
    }
    scene.fog.density=lerp(scene.fog.density,weather.fogTarget,Math.min(1,dt*0.6));
    updateWeatherParticles(dt);

    updateAbduction(dt,WEATHER[weather.cur].mult,beamOn&&bp>0.5);
    updateBuff(dt);
    Special.update(dt,input.spHeld||!!keys['q']);
    updateCrystals(dt,beamOn&&bp>0.5);
    updateProps(dt,beamOn&&bp>0.5);
    updateMeteors(dt);
    updateGeysers(dt);
    updateLightning(dt);
    Story.update(dt,beamOn&&bp>0.5);

    /* ---- energy ---- */
    if(S.energyMode==='drain'){
      const im=Math.min(1,Math.hypot(ix,iz));
      const dr=1/160+(beamOn?1/70:0)+(Special.active?1/45:0)+im/220+(S.cloak?1/55:0);
      S.energy=Math.max(0,S.energy-dr*dt);
      // tiered low-energy warnings (fire once per threshold as it drops)
      const lvl=S.energy<0.10?3:S.energy<0.25?2:S.energy<0.50?1:0;
      if(lvl>S.warnLevel){
        S.warnLevel=lvl;
        if(lvl===1)banner('ENERGY 50% · FIND CRYSTALS');
        else if(lvl===2){banner('ENERGY 25% · CRYSTALS NEEDED');beep(330,0.3,0.08);}
        else if(lvl===3){banner('CRITICAL 10% · HARVEST NOW');beep(220,0.4,0.1);setTimeout(()=>beep(180,0.4,0.1),260);}
      }else if(lvl<S.warnLevel){S.warnLevel=lvl;}   // re-arm after refuelling
      if(S.cloak&&S.energy<0.02)S.cloak=false;       // forced decloak when empty
      if(S.energy<=0){
        S.state='crashing';S.vy=0;S.crashReason='energy';S.cloak=false;
        BeamSFX.stop();S.prevBeam=false;
        Music.set('off');
        beep(110,0.8,0.1);setTimeout(()=>beep(70,1.2,0.1),300);
      }
    }
    applyCloakVisual();

    /* ---- shadow follows ---- */
    sun.target.position.copy(saucer.position);
    sun.position.set(saucer.position.x+60,saucer.position.y+90,saucer.position.z+30);

    /* ---- camera ---- */
    const desired=_v.set(saucer.position.x+camOffset.x,saucer.position.y+camOffset.y,saucer.position.z+camOffset.z);
    camera.position.lerp(desired,Math.min(1,dt*2.4));
    camera.lookAt(saucer.position.x,saucer.position.y-6,saucer.position.z);

    /* ---- clock ---- */
    S.elapsed+=dt;
    dayNightUpdate(dt);
    applyDayNightLight();
    if(!S.endless){
      S.timeLeft-=dt;
      if(S.timeLeft<=0){S.timeLeft=0;endGame();}
      const m=Math.floor(S.timeLeft/60),sec=Math.floor(S.timeLeft%60);
      clockV.textContent=(m<10?'0':'')+m+':'+(sec<10?'0':'')+sec;
      clockV.classList.toggle('crit',S.timeLeft<20);
    }else{clockV.textContent='∞';}

  } else if(S.state==='crashing'){
    /* powerless: the ship falls */
    S.vy-=42*dt;
    saucer.position.y+=S.vy*dt;
    saucer.rotation.z+=dt*1.4;saucer.rotation.x+=dt*0.8;
    beam.visible=disc.visible=false;beamLight.intensity=0;
    shipLight.position.set(saucer.position.x,saucer.position.y+1.5,saucer.position.z);
    shipLight.intensity=Math.max(0.1,shipLight.intensity-dt*0.8);   // dying reactor
    updateEnergyBar(dt,false);
    updateProps(dt,false);updateCrystals(dt,false);updateAnimals(dt);
    camera.position.lerp(_v.set(saucer.position.x+camOffset.x,saucer.position.y+camOffset.y,saucer.position.z+camOffset.z),Math.min(1,dt*2.4));
    camera.lookAt(saucer.position);
    const gh=heightAt(saucer.position.x,saucer.position.z);
    if(saucer.position.y<=gh+2.5){
      saucer.position.y=gh+2.5;
      endGame(S.crashReason||'crash');
    }
  } else if(S.state==='menu'||S.state==='over'){
    /* menu / over idle: gentle drift + slow orbit */
    saucer.position.y=40+Math.sin(t*1.2)*0.6;
    saucer.rotation.y+=dt*0.3;
    saucer.userData.lights.rotation.y-=dt*1.2;
    const gh=heightAt(saucer.position.x,saucer.position.z);
    beam.visible=disc.visible=true;
    beamMat.uniforms.uPow.value=1;discMat.uniforms.uPow.value=1;
    beam.position.set(saucer.position.x,(saucer.position.y-1+gh)/2,saucer.position.z);
    beam.scale.set(8,saucer.position.y-gh-1,8);
    disc.position.set(saucer.position.x,gh+0.15,saucer.position.z);disc.scale.setScalar(8);
    beamLight.position.set(saucer.position.x,saucer.position.y-4,saucer.position.z);beamLight.intensity=1.4;
    shipLight.position.set(saucer.position.x,saucer.position.y+1.5,saucer.position.z);shipLight.intensity=0.85;
    ebarBG.material.opacity=0;ebarFill3.material.opacity=0;
    const ang=t*0.12;
    camera.position.set(saucer.position.x+Math.sin(ang)*70,72,saucer.position.z+Math.cos(ang)*70);
    camera.lookAt(saucer.position.x,saucer.position.y-8,saucer.position.z);
    if(chunks.size===0)updateChunks(0,0);
    updateAnimals(dt);
  }

  drawMinimap(dt);
  updateFlare(dt);
  if(window._lflash)window._lflash.style.opacity=(typeof flashAmt!=='undefined'?flashAmt*0.7:0);
  renderFrame();
}

/* =========================================================================
   BOOT
   ========================================================================= */
const SPLASH_T0=performance.now();
let assetsReady=false;
function enablePlay(){
  if(assetsReady)return;assetsReady=true;
  const b=document.getElementById('startBtn');if(b)b.disabled=false;
  const n=document.getElementById('loadNote');if(n)n.textContent='ready';
  // resolve any still-pending lines so the list is complete before the splash closes
  LOAD_ORDER.forEach(nm=>{
    const el=document.getElementById('ld-'+nm);
    if(el&&el.innerHTML.indexOf('…')>=0)el.innerHTML=nm+': <i>built-in</i>';
  });
  const sp=document.getElementById('splash');
  if(sp){
    // hold the splash at least ~1.8s total so fast loads don't blink past the list
    const wait=Math.max(700,1800-(performance.now()-SPLASH_T0));
    setTimeout(()=>{sp.classList.add('done');setTimeout(()=>sp.remove(),900);},wait);
  }
}
setTimeout(enablePlay,20000);   // never trap the player on a dead network

(env.LOW_END?Promise.resolve():loadAllAssets()).then(()=>{
  enablePlay();
  const sm=spawnModel('saucer');
  if(sm){
    (saucer.userData.procBody||[]).forEach(o=>o.visible=false);  // hide primitive body
    /* rim lights kept for the night-time blink effect */
    sm.name='saucerModel';saucer.add(sm);
  }
});

/* ---- iOS audio unlock: silent looping <audio> flips Safari to playback
   mode (plays despite the ring/silent switch); resume context on any gesture ---- */
const silentAudio=document.createElement('audio');
silentAudio.preload='auto';silentAudio.loop=true;
silentAudio.src='data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';
function unlockAudio(){
  try{
    Music.ensure();
    if(Music.ac.state==='suspended')Music.ac.resume();
  }catch(e){}
  silentAudio.play().catch(()=>{});
}
['pointerdown','touchend','keydown','click'].forEach(ev=>document.addEventListener(ev,unlockAudio,{passive:true}));
document.addEventListener('visibilitychange',()=>{
  if(!document.hidden&&Music.ac&&Music.ac.state==='suspended')Music.ac.resume();
});

document.getElementById('ctrlHint').innerHTML=matchMedia('(pointer:coarse)').matches
  ?'<b>drag</b> to fly &nbsp;·&nbsp; <b>double-tap &amp; hold</b> to beam &nbsp;·&nbsp; <b>PULL</b> when charged'
  :'<b>WASD</b> / drag to fly &nbsp;·&nbsp; <b>double-click hold</b> or <b>space</b> to beam &nbsp;·&nbsp; <b>Q</b> pulls';
reseed();updateChunks(0,0);

addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);allocRT();});
animate();
