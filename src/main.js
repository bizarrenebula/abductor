/* =========================================================================
   ABDUCTOR — entry point. Imports every subsystem (their import side effects
   build the scene, wire input, and set up the UI), then runs the main loop
   and boot sequence. Loaded as a native ES module from index.html after THREE.
   ========================================================================= */
import { THREE } from './core/three.js';
import { env } from './core/env.js';
import { lerp, clamp, ramp } from './core/math.js';
import { HOVER_BASE, HOVER_MIN, HOVER_MAX, HOVER_ACC, HOVER_DRAG, HOVER_VMAX,
         YAW_ACC, YAW_DRAG, YAW_VMAX, MOVE_ACC, BEAM_MOVE, BEAM_MAXSPEED, MTN_H, CAM_ZOOM_LOW, CAM_ZOOM_HIGH,
         BEAM_STR_LOW, BEAM_STR_HIGH, DRAIN_ALT_LOW, DRAIN_ALT_HIGH } from './core/constants.js';
import { S, camOffset, camLook } from './core/state.js';
import { renderer, scene, camera, sun, stars, moon } from './core/engine.js';
import { keys, input, held } from './core/input.js';

import { reseed } from './world/noise.js';
import { sample, heightAt } from './world/terrain.js';
import { roadHeightAt } from './world/roads.js';
import { World, dayNightUpdate, applyDayNightLight } from './world/world-config.js';
import { updateChunks, chunks } from './world/chunks.js';
import { WEATHER, weather, updateDust, pickWeather, applyWeather, updateWeatherParticles, setBeamMultHUD } from './world/weather.js';

import { updateAnimals } from './entities/animals.js';
import { updateCrystals } from './entities/crystals.js';
import { updateProps } from './entities/props.js';
import { updateWindmills } from './entities/humans.js';
import { updateVehicles } from './entities/vehicles.js';
import { updateUpgradeItems } from './entities/upgradeItems.js';

import { saucer, beamLight, shipLight, glowLight, ebarBG, ebarFill3, updateEnergyBar, updateSaucer, updateShadow } from './systems/saucer.js';
import { NightLights } from './systems/nightlights.js';
import { updateDestruction } from './systems/destruction.js';
import { beam, beamMat, disc, discMat, effBeamR } from './systems/beam.js';
import { updateAbduction } from './systems/abduction.js';
import { buff, updateBuff } from './systems/buffs.js';
import { applyCloakVisual } from './systems/cloak.js';
import { updateCollision } from './systems/collision.js';
import { Special } from './systems/special.js';
import { CropCircles } from './systems/cropcircles.js';
import { Clouds } from './systems/clouds.js';
import { Fireflies } from './systems/fireflies.js';
import { ValleyFog } from './systems/valleyfog.js';
import { Birds } from './systems/birds.js';

import { updateMeteors } from './hazards/meteors.js';
import { updateGeysers } from './hazards/geysers.js';
import { updateLightning, flashAmt } from './hazards/lightning.js';

import { Story } from './story/story.js';

import { Music, beep } from './audio/music.js';
import { BeamSFX } from './audio/sfx.js';

import { waterMat } from './world/water.js';
import { banner } from './ui/banner.js';
import { cloakRing, cloakArc, altScale, altKnob, altVal } from './ui/dom.js';
import { drawMinimap } from './ui/minimap.js';
import { updateFlare } from './ui/flare.js';
import { renderFrame, allocRT, setFX } from './ui/postfx.js';
import { endGame, respawn } from './ui/screens.js';

import { diagFinish, loadAllAssets, spawnModel } from './assets.js';
import { t as tr, applyStaticDOM, onLang } from './i18n.js';   // aliased: `t` is used locally for time in animate()

const _v=new THREE.Vector3();

/* Ported "Many Lives" flight model + intimate follow camera (isolated modules,
   profile-injected). They own the ship's position/heading and the playing-state
   camera; the rest of the game (beam, cloak, collision, energy, HUD) reads the
   synced S.* fields exactly as before. */
import { FlightModel } from './systems/flight.js';
import { CameraRig } from './systems/camera-rig.js';
import { FLIGHT_PROFILE } from './systems/flight-profile.js';
import { flightInputFrom } from './systems/flight-input.js';
const flight=new FlightModel(FLIGHT_PROFILE.flight,new THREE.Vector3(0,HOVER_BASE,0));
const camRig=new CameraRig(camera,FLIGHT_PROFILE.camera);
const ACCEL_BASE=FLIGHT_PROFILE.flight.acceleration;
const MAXSPEED_BASE=FLIGHT_PROFILE.flight.maxSpeed;
let prevState='';
let shipSpin=0, shipSpinVel=0;            // swipe-flick cosmetic spin about the ship's axis
// terrain+road ground height at a world point — shared by the shadow drape below
const groundAt=(x,z)=>Math.max(heightAt(x,z),roadHeightAt(x,z));

/* =========================================================================
   MAIN LOOP
   ========================================================================= */
const clock=new THREE.Clock();

/* Ship-gesture feedback: the cloak hold ring and the altitude scale. Both are
   driven off `input`, and both hide themselves when their gesture is idle. */
const RING_LEN=2*Math.PI*19;   // r=19 in the cloak-ring SVG viewBox
let altHudT=0;                 // keeps the altitude scale up briefly after an altitude change
let camZoom=1;                 // chase-camera distance multiplier, eased toward altitude
let camPitchE=0;               // eased camera pitch: 0 behind-the-ship, 1 top-down (angle slider)

/* Adaptive quality: if the frame rate stays low, step the presentation DOWN so
   weaker hardware still runs smoothly — shrink the shadow map, then drop shadows,
   then fall back to basic post-fx. One-way (never flip-flops), and only while
   actually flying. This is the brief's "automatically deliver the best possible
   presentation for the available hardware". */
let fpsEMA=60, perfLowT=0, perfStep=0;
function perfGuard(dt){
  if(dt<=0)return;
  fpsEMA=fpsEMA*0.93+(1/dt)*0.07;
  if(perfStep>=3)return;
  perfLowT = fpsEMA<27 ? perfLowT+dt : Math.max(0,perfLowT-dt*0.6);
  if(perfLowT>4){
    perfLowT=0; perfStep++;
    if(perfStep===1){                                     // half-resolution shadows
      if(sun.shadow.map){sun.shadow.map.dispose();sun.shadow.map=null;}
      sun.shadow.mapSize.set(512,512);
    }else if(perfStep===2){ renderer.shadowMap.enabled=false; sun.castShadow=false; }  // shadows off
    else if(perfStep===3){ setFX('basic'); }               // basic render, no post-fx
  }
}
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
  NightLights.set(S.dayF,t);        // street lamps / station / headlight pools fade in at night
  updateSaucer(t);                  // lid wave-glow + chasing border lights (all states)
  updateDestruction(dt);            // toppling wreckage + gas-station explosions animate
  stars.position.set(camera.position.x,0,camera.position.z);
  moon.position.copy(camera.position).addScaledVector(_v.copy(sun.position).sub(saucer.position).normalize(),820);

  if(S.state==='playing'){
    perfGuard(dt);
    /* ---- beam hold: pointer down or space ----
       The beam works from the very start, but a raw beam DRAINS the reactor
       every second it's open; finding the Plasma Beam module makes it free. ---- */
    const beamWant=input.beamHold||held('beam')||Special.active;
    const beamOn=beamWant;
    // Opening the beam breaks cloak — you cannot feed while invisible (req 1).
    if(beamOn&&S.cloak){S.cloak=false;beep(300,0.14,0.06);}
    S.beamPower=lerp(S.beamPower,beamOn?1:0,Math.min(1,dt*7));
    if(beamOn&&!S.prevBeam)BeamSFX.start();
    if(!beamOn&&S.prevBeam)BeamSFX.stop();
    S.prevBeam=beamOn;
    BeamSFX.set(S.beamPower);

    /* ---- flight: ported dragonfly model (hover-capable, analytic-inertia) ----
       On the first playing frame (after start / respawn) sync the model to the
       spawn pose. Gameplay speed modifiers (engine upgrade, beam slowdown, night,
       speed buff) fold into acceleration; the profile's maxSpeed stays the hard
       cap, so e.g. beaming cruises slower but the top speed is unchanged. */
    if(prevState!=='playing'){ flight.reset(saucer.position); flight.yaw=S.yaw; camRig.reset(); }
    const fin=flightInputFrom(input,held,dt);
    const speedMult=(S.upSpeed||1)*(beamOn?BEAM_MOVE:1)*(buff==='speed'?1.6:1)*(World.name==='moon'?1.4:1)*(1.2-0.35*S.dayF);
    flight.f.acceleration=ACCEL_BASE*speedMult;
    // While beaming, hard-cap top speed too — low accel alone still lets built-up
    // momentum coast the ship off the target, so clamp maxSpeed to a crawl.
    flight.f.maxSpeed=beamOn?MAXSPEED_BASE*BEAM_MAXSPEED:MAXSPEED_BASE;
    // Free flight, but never sink through the ground: a per-frame soft floor at the
    // terrain (crash-on-contact for flying INTO a rise is still handled below).
    const ghPre=Math.max(heightAt(flight._base.x,flight._base.z),roadHeightAt(flight._base.x,flight._base.z));
    flight.f.floorY=ghPre+4;
    flight.update(dt,fin);
    saucer.position.copy(flight.position);
    saucer.quaternion.copy(flight.quaternion);        // dragonfly bank/heading
    // Fun perk: a left/right swipe on the ship flicks it into a spin about its own
    // axis. The flick sets an angular velocity that decays back to rest; the extra
    // yaw is purely cosmetic (the disc is symmetric) so it never affects flight.
    shipSpinVel+=input.spinKick; input.spinKick=0;
    if(shipSpinVel!==0||shipSpin!==0){
      shipSpin+=shipSpinVel*dt;
      shipSpinVel*=Math.exp(-1.7*dt);                 // gradually slow…
      if(Math.abs(shipSpinVel)<0.03)shipSpinVel=0;    // …then settle to normal
      shipSpin%=Math.PI*2;                            // keep the accumulated angle bounded
      saucer.rotateY(shipSpin);
    }
    S.yaw=flight.yaw;
    S.vel.x=flight.velocity.x; S.vel.z=flight.velocity.z;
    const moveMag=Math.min(1,Math.hypot(fin.forward,fin.strafe));
    const climbing=Math.abs(fin.vertical)>0.01;
    if(climbing||Math.abs(flight.velocity.y)>0.4)altHudT=0.8; else altHudT=Math.max(0,altHudT-dt);
    const gh=Math.max(heightAt(saucer.position.x,saucer.position.z),
                      roadHeightAt(saucer.position.x,saucer.position.z));
    updateShadow(groundAt);    // ground shadow / aim aid draped on the terrain below

    /* Altitude trade-off, derived once from the ship's true height above ground
       and shared by the beam, the reactor and the camera. Low = strong beam,
       cheap flight, lethal scenery. High = weak beam, thirsty reactor, safe. */
    S.agl=saucer.position.y-gh;
    S.hover=S.agl; S.hoverV=flight.velocity.y;   // altitude HUD reads actual height + climb rate
    S.beamStr=ramp(S.agl,HOVER_MIN,HOVER_BASE,HOVER_MAX,BEAM_STR_LOW,1,BEAM_STR_HIGH);
    const drainAlt=ramp(S.agl,HOVER_MIN,HOVER_BASE,HOVER_MAX,DRAIN_ALT_LOW,1,DRAIN_ALT_HIGH);
    updateShipGestureHUD();

    // Everything the hull touches interacts: ANY ground the ship flies into — a
    // hillside, an embankment, a road/bridge deck, a mountain face — is a fatal
    // impact at the touchpoint, not just tall peaks. Check directly below plus a
    // short step ahead along travel (so a wall met head-on still lands).
    const sp=Math.hypot(S.vel.x,S.vel.z);
    let hitH=gh;
    if(sp>1.2){
      const hx=saucer.position.x+S.vel.x/sp*4.5, hz=saucer.position.z+S.vel.z/sp*4.5;
      hitH=Math.max(hitH,heightAt(hx,hz),roadHeightAt(hx,hz));
    }
    if(saucer.position.y-1.2<hitH){
      S.crashReason='impact';S.state='crashing';S.vy=-3;
      BeamSFX.stop();S.prevBeam=false;
    }

    // Orientation (heading + bank) comes from the flight model's quaternion, set
    // above (plus the swipe-spin flick).

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
    const _night=1-S.dayF;
    // KEY LIGHT — sits just ABOVE the ship and lights the hull + dome so the craft
    // is always clearly readable (day and night), even in the darkest terrain. Soft
    // and localized (short range, smooth 1/d^2 falloff, no shadow) so it reveals the
    // ship without lifting the whole scene.
    shipLight.position.set(saucer.position.x,saucer.position.y+5.5,saucer.position.z);
    shipLight.intensity=1.9+1.0*_night;
    shipLight.distance=30;
    // GROUND POOL — a soft circle of terrain light directly below the ship, so its
    // altitude and immediate surroundings read. Smooth falloff to darkness (the
    // eerie dark stays all around); a gentle day floor keeps it readable in shadow.
    glowLight.position.set(saucer.position.x,saucer.position.y-1.5,saucer.position.z);
    glowLight.intensity=(0.9+4.2*_night)+0.12*Math.sin(t*2.3);
    glowLight.distance=lerp(100,150,_night);
    // (border-light blink + lid glow are driven centrally by updateSaucer)
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
    Special.update(dt,input.spHeld||held('pull'));
    updateCrystals(dt,beamOn&&bp>0.5);
    updateProps(dt,beamOn&&bp>0.5);
    updateWindmills(dt);
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
      // The beam and the thrusters draw from this same reactor. A RAW beam and RAW
      // thrusters are thirsty; collecting the Plasma Beam / Nuclear Thrusters module
      // makes each one free. drainAlt scales the whole rate: a higher hover, and a
      // beam projected that much further, both cost the reactor more.
      const beamDr=beamOn&&!S.upHasBeam?1/55:0;
      const altDr =climbing&&!S.upAltitude?1/70:0;
      const dr=(1/160+beamDr+altDr+(Special.active?1/45:0)+im/220+(S.cloak?1/55:0))*drainAlt;
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

    /* ---- camera: ported intimate spring-damper follow rig ----
       Zoom slider (0.5..2.5) + altitude pull-back drive the follow distance;
       the angle slider raises the camera for a higher, more overhead framing. */
    const CAMP=FLIGHT_PROFILE.camera;
    const altPull=ramp(S.agl,HOVER_MIN,HOVER_BASE,HOVER_MAX,0.85,1,1.6);
    camRig.zoom=clamp(CAMP.distance*input.zoom*altPull,CAMP.zoomMin,CAMP.zoomMax);
    camRig.update(dt,flight);   // pitch (mouse / left-stick) drives the look; height stays the tuned base

    /* ---- world clock (no time limit; only drives the day/night cycle) ---- */
    S.elapsed+=dt;
    // Remember a "last living point" a couple of seconds back, so the story-mode
    // respawn drops the ship somewhere it was safe rather than on the fatal spot.
    S.safeT-=dt;
    if(S.safeT<=0&&S.energy>0.14&&!S.cloak){S.safeT=2.2;S.safePos.copy(saucer.position);S.safeYaw=S.yaw;}
    dayNightUpdate(dt);
    applyDayNightLight();

  } else if(S.state==='crashing'){
    /* powerless: the ship falls */
    S.vy-=42*dt;
    saucer.position.y+=S.vy*dt;
    saucer.rotation.z+=dt*1.4;saucer.rotation.x+=dt*0.8;
    beam.visible=disc.visible=false;beamLight.intensity=0;
    shipLight.position.set(saucer.position.x,saucer.position.y+5.5,saucer.position.z);
    shipLight.distance=30;
    shipLight.intensity=Math.max(0.15,shipLight.intensity-dt*0.8);  // dying reactor
    glowLight.position.set(saucer.position.x,saucer.position.y-1.5,saucer.position.z);
    glowLight.intensity=Math.max(0,glowLight.intensity-dt*3);       // pool collapses as it falls
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
    const gh=heightAt(saucer.position.x,saucer.position.z);
    beam.visible=disc.visible=true;
    beamMat.uniforms.uPow.value=1;discMat.uniforms.uPow.value=1;
    beam.position.set(saucer.position.x,(saucer.position.y-1+gh)/2,saucer.position.z);
    beam.scale.set(8,saucer.position.y-gh-1,8);
    disc.position.set(saucer.position.x,gh+0.15,saucer.position.z);disc.scale.setScalar(8);
    beamLight.position.set(saucer.position.x,saucer.position.y-4,saucer.position.z);beamLight.intensity=1.4;
    shipLight.position.set(saucer.position.x,saucer.position.y+5.5,saucer.position.z);shipLight.intensity=2.3;shipLight.distance=30;
    glowLight.position.set(saucer.position.x,saucer.position.y-1.5,saucer.position.z);
    glowLight.intensity=(0.9+4.2*(1-S.dayF));glowLight.distance=lerp(100,150,1-S.dayF);
    ebarBG.material.opacity=0;ebarFill3.material.opacity=0;
    const ang=t*0.12;
    camera.position.set(saucer.position.x+Math.sin(ang)*76,58,saucer.position.z+Math.cos(ang)*76);
    camera.lookAt(saucer.position.x,saucer.position.y-2,saucer.position.z);
    if(chunks.size===0)updateChunks(0,0);
    updateAnimals(dt);
  }

  Clouds.update(dt);
  Fireflies.update(dt);
  ValleyFog.update(dt);
  Birds.update(dt);
  drawMinimap(dt);
  updateFlare(dt);
  if(window._lflash)window._lflash.style.opacity=(typeof flashAmt!=='undefined'?flashAmt*0.7:0);
  prevState=S.state;   // flight/camera rig re-sync on the first frame back in 'playing'
  renderFrame();
}

/* =========================================================================
   BOOT
   ========================================================================= */
const SPLASH_T0=performance.now();
let assetsReady=false, splashGone=false;
function enablePlay(){
  if(assetsReady)return;assetsReady=true;
  const b=document.getElementById('startBtn');if(b)b.disabled=false;
  const n=document.getElementById('loadNote');if(n)n.textContent=tr('loadNote.ready');
  diagFinish();   // settle the splash line even if some assets fell back
  maybeDismissSplash();
}
// The splash hands straight to the setup menu once assets are ready — there is
// no language gate any more.
function maybeDismissSplash(){
  if(splashGone||!assetsReady)return;
  splashGone=true;
  const sp=document.getElementById('splash');
  if(sp){
    const wait=Math.max(300,1200-(performance.now()-SPLASH_T0));   // brief hold so it doesn't blink past
    setTimeout(()=>{sp.classList.add('done');setTimeout(()=>sp.remove(),900);},wait);
  }
}
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
reseed();updateChunks(0,0);Clouds.spawnField(0,0);Fireflies.reset(0,0);ValleyFog.reset(0,0);Birds.reset(0,0);

addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);allocRT();});
animate();
