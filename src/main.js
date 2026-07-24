/* =========================================================================
   ABDUCTOR — entry point. Imports every subsystem (their import side effects
   build the scene, wire input, and set up the UI), then runs the main loop
   and boot sequence. Loaded as a native ES module from index.html after THREE.
   ========================================================================= */
import { THREE } from './core/three.js';
import { env } from './core/env.js';
import { lerp, clamp, ramp } from './core/math.js';
import { HOVER_BASE, HOVER_MIN, HOVER_MAX, HOVER_ACC, HOVER_DRAG, HOVER_VMAX,
         YAW_ACC, YAW_DRAG, YAW_VMAX, MOVE_ACC, BEAM_MOVE, MTN_H, CAM_ZOOM_LOW, CAM_ZOOM_HIGH,
         BEAM_STR_LOW, BEAM_STR_HIGH, DRAIN_ALT_LOW, DRAIN_ALT_HIGH } from './core/constants.js';
import { S, camOffset, camLook } from './core/state.js';
import { renderer, scene, camera, sun, stars, moon } from './core/engine.js';
import { keys, input } from './core/input.js';

import { reseed } from './world/noise.js';
import { sample, heightAt } from './world/terrain.js';
import { roadHeightAt } from './world/roads.js';
import { World, dayNightUpdate, applyDayNightLight } from './world/world-config.js';
import { updateChunks, chunks } from './world/chunks.js';
import { WEATHER, weather, updateDust, pickWeather, applyWeather, updateWeatherParticles, setBeamMultHUD } from './world/weather.js';

import { updateAnimals } from './entities/animals.js';
import { updateCrystals } from './entities/crystals.js';
import { updateProps } from './entities/props.js';
import { updateVehicles } from './entities/vehicles.js';
import { updateUpgradeItems } from './entities/upgradeItems.js';

import { saucer, beamLight, shipLight, ebarBG, ebarFill3, updateEnergyBar } from './systems/saucer.js';
import { beam, beamMat, disc, discMat, effBeamR } from './systems/beam.js';
import { updateAbduction } from './systems/abduction.js';
import { buff, updateBuff } from './systems/buffs.js';
import { applyCloakVisual } from './systems/cloak.js';
import { updateCollision } from './systems/collision.js';
import { Special } from './systems/special.js';
import { Upgrades } from './systems/upgrades.js';
import { CropCircles } from './systems/cropcircles.js';
import { Clouds } from './systems/clouds.js';

import { updateMeteors } from './hazards/meteors.js';
import { updateGeysers } from './hazards/geysers.js';
import { updateLightning, flashAmt } from './hazards/lightning.js';

import { Story } from './story/story.js';

import { Music, beep } from './audio/music.js';
import { BeamSFX } from './audio/sfx.js';

import { waterMat } from './world/water.js';
import { banner } from './ui/banner.js';
import { clockV, cloakRing, cloakArc, altScale, altKnob, altVal } from './ui/dom.js';
import { drawMinimap } from './ui/minimap.js';
import { updateFlare } from './ui/flare.js';
import { renderFrame, allocRT } from './ui/postfx.js';
import { endGame, respawn } from './ui/screens.js';

import { diagFinish, loadAllAssets, spawnModel } from './assets.js';
import { t as tr, applyStaticDOM, onLang } from './i18n.js';   // aliased: `t` is used locally for time in animate()

const _v=new THREE.Vector3();

/* =========================================================================
   MAIN LOOP
   ========================================================================= */
const clock=new THREE.Clock();

/* Ship-gesture feedback: the cloak hold ring and the altitude scale. Both are
   driven off `input`, and both hide themselves when their gesture is idle. */
const RING_LEN=2*Math.PI*19;   // r=19 in the cloak-ring SVG viewBox
let altHudT=0;                 // keeps the altitude scale up briefly after an altitude change
let camZoom=1;                 // chase-camera distance multiplier, eased toward altitude
function updateShipGestureHUD(){
  if(cloakRing){               // hold-the-ship-to-cloak progress ring
    const p=input.cloakProg||0;
    cloakRing.classList.toggle('on',p>0.02);
    if(cloakArc)cloakArc.style.strokeDashoffset=(RING_LEN*(1-p)).toFixed(1);
  }
  if(altScale){
    const showBar=altHudT>0;   // W/S or the left joystick's vertical axis
    altScale.classList.toggle('on',showBar);
    if(showBar){
      const f=(S.hover-HOVER_MIN)/(HOVER_MAX-HOVER_MIN);   // 0 at floor, 1 at ceiling
      altKnob.style.top=((1-f)*100).toFixed(1)+'%';
      altVal.textContent=Math.round(S.hover)+'m';
      altScale.classList.toggle('climb',S.hoverV>0.6);
      altScale.classList.toggle('dive',S.hoverV<-0.6);
    }
  }
}

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
    // Opening the beam breaks cloak — you cannot feed while invisible (req 1).
    if(beamOn&&S.cloak){S.cloak=false;beep(300,0.14,0.06);}
    S.beamPower=lerp(S.beamPower,beamOn?1:0,Math.min(1,dt*7));
    if(beamOn&&!S.prevBeam)BeamSFX.start();
    if(!beamOn&&S.prevBeam)BeamSFX.stop();
    S.prevBeam=beamOn;
    BeamSFX.set(S.beamPower);

    /* ---- heading: A / D (desktop) or the left joystick's x-axis (touch) spin
       the ship on its own axis. Momentum: the intent accelerates S.yawV, which
       then coasts down and is capped, so turns wind up and unwind. ---- */
    let turn=input.tTurn;
    if(keys['a'])turn-=1;
    if(keys['d'])turn+=1;
    turn=clamp(turn,-1,1);
    S.yawV+=turn*YAW_ACC*dt;
    S.yawV*=Math.pow(YAW_DRAG,dt);
    S.yawV=clamp(S.yawV,-YAW_VMAX,YAW_VMAX);
    S.yaw-=S.yawV*dt;                                  // +turn (right) swings the nose clockwise

    /* ---- translation, relative to the heading:
         forward/back  ↑ / ↓  or left-joystick y
         strafe        ← / →  or right-joystick x                             ---- */
    const fx=-Math.sin(S.yaw), fz=-Math.cos(S.yaw);    // nose / forward (into the screen at yaw 0)
    const rx= Math.cos(S.yaw), rz=-Math.sin(S.yaw);    // ship's right
    let fwd=input.tFwd, side=input.tStrafe;
    if(keys['arrowup'])fwd+=1;
    if(keys['arrowdown'])fwd-=1;
    if(keys['arrowright'])side+=1;
    if(keys['arrowleft'])side-=1;
    fwd=clamp(fwd,-1,1);side=clamp(side,-1,1);
    const il=Math.hypot(fwd,side); if(il>1){fwd/=il;side/=il;}
    const moveMag=Math.min(1,Math.hypot(fwd,side));
    const ax=rx*side+fx*fwd, az=rz*side+fz*fwd;
    // Beaming keeps full steering but cuts thrust (BEAM_MOVE) — you fly slower
    // while feeding, not stuck. Handling (drag) stays the same so it still glides.
    const ACC=MOVE_ACC*(S.upSpeed||1)*(beamOn?BEAM_MOVE:1)*(buff==='speed'?1.6:1)*(World.name==='moon'?1.4:1)*(1.2-0.35*S.dayF);   // faster at night; S.upSpeed is the earned engine upgrade
    S.vel.x+=ax*ACC*dt; S.vel.z+=az*ACC*dt;
    // drag / gradual stop with delay
    const drag=Math.pow(World.name==='moon'?0.05:0.08,dt);
    S.vel.x*=drag; S.vel.z*=drag;
    saucer.position.x+=S.vel.x*dt;
    saucer.position.z+=S.vel.z*dt;

    /* ---- altitude: W / S or the left joystick's y-axis. Momentum-driven — the
       input feeds a climb rate (hoverV) that eases in and coasts out, so a climb
       reads like a takeoff and a descent like a settling landing. ---- */
    let ah=input.tClimb;
    if(keys['w'])ah+=1;
    if(keys['s'])ah-=1;
    ah=clamp(ah,-1,1);
    // Grounded start: altitude is locked until the THRUSTERS upgrade. Any climb
    // intent is ignored (and gently explained once) so the ship holds base hover.
    if(!S.upAltitude){ if(ah)Upgrades.altBlockedHint(); ah=0; }
    S.hoverV+=ah*HOVER_ACC*dt;
    S.hoverV*=Math.pow(HOVER_DRAG,dt);
    S.hoverV=clamp(S.hoverV,-HOVER_VMAX,HOVER_VMAX);
    S.hover+=S.hoverV*dt;
    if(S.hover<HOVER_MIN){S.hover=HOVER_MIN;if(S.hoverV<0)S.hoverV=0;}
    if(S.hover>HOVER_MAX){S.hover=HOVER_MAX;if(S.hoverV>0)S.hoverV=0;}
    if(ah||Math.abs(S.hoverV)>0.4)altHudT=0.8; else altHudT=Math.max(0,altHudT-dt);
    // The absolute floor scales with the commanded hover, otherwise it would
    // pin the ship at 26 and descending would do nothing over low ground.
    // The surface the ship flies over is the terrain OR the road deck above it,
    // whichever is higher — otherwise it sails straight through embankments
    // and bridges, which sit well above the ground they span.
    const gh=Math.max(heightAt(saucer.position.x,saucer.position.z),
                      roadHeightAt(saucer.position.x,saucer.position.z));
    const floorY=26*(S.hover/HOVER_BASE);
    const targetY=Math.max(floorY,gh+S.hover)+Math.sin(t*1.4)*0.5;
    saucer.position.y=lerp(saucer.position.y,targetY,Math.min(1,dt*3));

    /* Altitude trade-off, derived once from the ship's true height above ground
       and shared by the beam, the reactor and the camera. Low = strong beam,
       cheap flight, lethal scenery. High = weak beam, thirsty reactor, safe. */
    S.agl=saucer.position.y-gh;
    S.beamStr=ramp(S.agl,HOVER_MIN,HOVER_BASE,HOVER_MAX,BEAM_STR_LOW,1,BEAM_STR_HIGH);
    const drainAlt=ramp(S.agl,HOVER_MIN,HOVER_BASE,HOVER_MAX,DRAIN_ALT_LOW,1,DRAIN_ALT_HIGH);
    updateShipGestureHUD();

    // Mountains are solid. Sample the terrain a little ahead along travel: if it's
    // a mountain (above MTN_H) and the hull is below its face, you crash into it.
    // Hills stay passable, and climbing high enough still clears a peak.
    const sp=Math.hypot(S.vel.x,S.vel.z);
    if(sp>2){
      const hx=saucer.position.x+S.vel.x/sp*8, hz=saucer.position.z+S.vel.z/sp*8;
      const hAhead=heightAt(hx,hz);
      if(hAhead>MTN_H&&saucer.position.y-1.5<hAhead){
        S.crashReason='impact';S.state='crashing';S.vy=-3;
        BeamSFX.stop();S.prevBeam=false;
      }
    }

    // banking swing: roll into the turn, plus pitch/roll from motion in the
    // ship's own frame so the tilt stays sane at any heading.
    const localVX=S.vel.x*rx+S.vel.z*rz;   // sideways speed
    const localVZ=S.vel.x*fx+S.vel.z*fz;   // forward speed
    S.tiltZ=lerp(S.tiltZ,-localVX*0.010-S.yawV*0.16,Math.min(1,dt*4));
    S.tiltX=lerp(S.tiltX, localVZ*0.010,Math.min(1,dt*4));
    saucer.rotation.y=S.yaw;
    saucer.rotation.z=S.tiltZ; saucer.rotation.x=S.tiltX;
    saucer.userData.lights.rotation.y-=dt*1.5;

    /* ---- beam + disc ---- */
    const groundY=gh;
    const h=saucer.position.y-groundY-1;
    const bp=S.beamPower;
    beam.visible=disc.visible=bp>0.02;
    // Show the altitude falloff: a high beam reads visibly thinner and paler.
    // Kept partial (never below ~0.6x) so the beam stays legible when it matters.
    const bvis=bp*(0.6+0.4*Math.min(1,S.beamStr));
    beamMat.uniforms.uPow.value=bvis;
    discMat.uniforms.uPow.value=bvis;
    const eR=effBeamR();
    beam.position.set(saucer.position.x,(saucer.position.y-1+groundY)/2,saucer.position.z);
    beam.scale.set(eR*(0.55+0.45*bp),h,eR*(0.55+0.45*bp));
    disc.position.set(saucer.position.x,groundY+0.15,saucer.position.z);
    disc.scale.setScalar(eR*(0.55+0.45*bp));
    beamLight.position.set(saucer.position.x,saucer.position.y-4,saucer.position.z);
    beamLight.intensity=(1.5+0.3*Math.sin(t*13.7)+0.2*Math.sin(t*29.3))*bp;
    // Running light: a soft pool that lights the ground around the ship. Much
    // stronger and wider-reaching at night, so the area below is readable rather
    // than pitch black. Sits a little below the hull so it spills onto the terrain.
    shipLight.position.set(saucer.position.x,saucer.position.y-1.0,saucer.position.z);
    const _night=1-S.dayF;
    shipLight.intensity=(0.5+2.7*_night)+0.14*Math.sin(t*3.1);
    shipLight.distance=lerp(70,140,_night);
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
    setBeamMultHUD(WEATHER[weather.cur].mult*S.beamStr);   // weather x altitude
    updateBuff(dt);
    Special.update(dt,input.spHeld||!!keys['q']);
    updateCrystals(dt,beamOn&&bp>0.5);
    updateProps(dt,beamOn&&bp>0.5);
    updateMeteors(dt);
    updateGeysers(dt);
    updateLightning(dt);
    updateVehicles(dt,beamOn&&bp>0.5);
    updateUpgradeItems(dt);     // findable ship-part pickups (thrusters / engine / ring)
    CropCircles.update(dt,beamOn&&bp>0.5);   // "Little Green Thumb" — scorch a crop circle
    updateCollision();          // trees / barns / stations are solid — may flip state to 'crashing'
    Story.update(dt,beamOn&&bp>0.5);

    /* ---- energy ---- */
    if(S.energyMode==='drain'){
      const im=moveMag;
      // drainAlt scales the whole rate: holding a high hover costs the reactor
      // more, and projecting the beam that much further costs more again.
      const dr=(1/160+(beamOn?1/70:0)+(Special.active?1/45:0)+im/220+(S.cloak?1/55:0))*drainAlt;
      S.energy=Math.max(0,S.energy-dr*dt);
      // tiered low-energy warnings (fire once per threshold as it drops)
      const lvl=S.energy<0.10?3:S.energy<0.25?2:S.energy<0.50?1:0;
      if(lvl>S.warnLevel){
        S.warnLevel=lvl;
        if(lvl===1)banner(tr('banner.energy50'));
        else if(lvl===2){banner(tr('banner.energy25'));beep(330,0.3,0.08);}
        else if(lvl===3){banner(tr('banner.energy10'));beep(220,0.4,0.1);setTimeout(()=>beep(180,0.4,0.1),260);}
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

    /* ---- camera ----
       Zoom with altitude: low = tight and close for threading between trees,
       high = pulled back for a wide survey view. Driven off the *actual* height
       above ground rather than the commanded S.hover, so the camera eases with
       the ship instead of snapping the moment a key is pressed. */
    // Anchored so zoom is exactly 1.0 at HOVER_BASE — the resting framing stays
    // what camOffset was tuned for, and only leaving that height moves it.
    camZoom=lerp(camZoom,ramp(S.agl,HOVER_MIN,HOVER_BASE,HOVER_MAX,CAM_ZOOM_LOW,1,CAM_ZOOM_HIGH),Math.min(1,dt*2));
    // Chase camera rides behind the nose: rotate the offset by the heading so the
    // view swings with the ship and "forward" stays into the screen. input.zoom
    // is the zoom-slider multiplier layered on top of the altitude zoom.
    const z=camZoom*input.zoom;
    const cs=Math.sin(S.yaw), cc=Math.cos(S.yaw);
    const ox=(camOffset.x*cc+camOffset.z*cs)*z;
    const oz=(-camOffset.x*cs+camOffset.z*cc)*z;
    const desired=_v.set(saucer.position.x+ox,saucer.position.y+camOffset.y*z,saucer.position.z+oz);
    camera.position.lerp(desired,Math.min(1,dt*2.4));
    camera.lookAt(saucer.position.x+camLook.x,saucer.position.y+camLook.y,saucer.position.z+camLook.z);

    /* ---- clock ---- */
    S.elapsed+=dt;
    // Remember a "last living point" a couple of seconds back, so the story-mode
    // respawn drops the ship somewhere it was safe rather than on the fatal spot.
    S.safeT-=dt;
    if(S.safeT<=0&&S.energy>0.14&&!S.cloak){S.safeT=2.2;S.safePos.copy(saucer.position);S.safeYaw=S.yaw;}
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
    camera.lookAt(saucer.position.x+camLook.x,saucer.position.y+camLook.y,saucer.position.z+camLook.z);
    const gh=Math.max(heightAt(saucer.position.x,saucer.position.z),
                      roadHeightAt(saucer.position.x,saucer.position.z));
    if(saucer.position.y<=gh+2.5){
      saucer.position.y=gh+2.5;
      // Story mode: a fatal hit costs the current mission's progress, not the run.
      if(Story.active)respawn(); else endGame(S.crashReason||'crash');
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
    camera.position.set(saucer.position.x+Math.sin(ang)*76,58,saucer.position.z+Math.cos(ang)*76);
    camera.lookAt(saucer.position.x,saucer.position.y-2,saucer.position.z);
    if(chunks.size===0)updateChunks(0,0);
    updateAnimals(dt);
  }

  Clouds.update(dt);
  drawMinimap(dt);
  updateFlare(dt);
  if(window._lflash)window._lflash.style.opacity=(typeof flashAmt!=='undefined'?flashAmt*0.7:0);
  renderFrame();
}

/* =========================================================================
   BOOT
   ========================================================================= */
const SPLASH_T0=performance.now();
let assetsReady=false, langChosen=false, splashGone=false;
function enablePlay(){
  if(assetsReady)return;assetsReady=true;
  const b=document.getElementById('startBtn');if(b)b.disabled=false;
  const n=document.getElementById('loadNote');if(n)n.textContent=tr('loadNote.ready');
  diagFinish();   // settle the splash line even if some assets fell back
  maybeDismissSplash();
}
// The splash only leaves once the player has picked a language AND assets are
// ready — language selection is mandatory before the settings screen.
function maybeDismissSplash(){
  if(splashGone||!assetsReady||!langChosen)return;
  splashGone=true;
  const sp=document.getElementById('splash');
  if(sp){
    const wait=Math.max(300,1200-(performance.now()-SPLASH_T0));   // brief hold so it doesn't blink past
    setTimeout(()=>{sp.classList.add('done');setTimeout(()=>sp.remove(),900);},wait);
  }
}
// Picking a language on the splash is what lets the boot proceed.
document.querySelectorAll('#splashLang [data-lang]').forEach(b=>
  b.addEventListener('click',()=>{
    langChosen=true;
    const sp=document.getElementById('splash');if(sp)sp.classList.add('picked');
    maybeDismissSplash();
  }));
setTimeout(enablePlay,20000);   // never trap the player on a dead network

((env.LOW_END||env.noExternal)?Promise.resolve():loadAllAssets()).then(()=>{
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

applyStaticDOM();   // apply the saved language to every static [data-i18n] element on load
onLang(()=>{ const n=document.getElementById('loadNote'); if(n&&assetsReady)n.textContent=tr('loadNote.ready'); });
reseed();updateChunks(0,0);Clouds.spawnField(0,0);

addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);allocRT();});
animate();
