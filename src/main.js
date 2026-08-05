/* =========================================================================
   ABDUCTOR — entry point. Imports every subsystem (their import side effects
   build the scene, wire input, and set up the UI), then runs the main loop
   and boot sequence. Loaded as a native ES module from index.html after THREE.
   ========================================================================= */
import { THREE } from './core/three.js';
import { env, TOUCH_ONLY } from './core/env.js';
import { lerp, clamp, ramp } from './core/math.js';
import { HOVER_BASE, HOVER_MIN, HOVER_MAX, HOVER_ACC, HOVER_DRAG, HOVER_VMAX,
         YAW_ACC, YAW_DRAG, YAW_VMAX, MOVE_ACC, BEAM_MOVE, BEAM_MAXSPEED, MTN_H, CAM_ZOOM_LOW, CAM_ZOOM_HIGH,
         BEAM_STR_LOW, BEAM_STR_HIGH, DRAIN_ALT_LOW, DRAIN_ALT_HIGH } from './core/constants.js';
import { S, camOffset, camLook } from './core/state.js';
import { renderer, scene, camera, sun, stars, moon } from './core/engine.js';
import { keys, input, held } from './core/input.js';

import { reseed } from './world/noise.js';
import { sample, heightAt } from './world/terrain.js';
import { roadHeightAt, roadDist } from './world/roads.js';
import { World, dayNightUpdate, applyDayNightLight } from './world/world-config.js';
import { updateChunks, chunks } from './world/chunks.js';
import { WEATHER, weather, updateDust, tickWeather, applyWeather, updateWeatherParticles, setBeamMultHUD } from './world/weather.js';

import { updateAnimals } from './entities/animals.js';
import { updateCrystals } from './entities/crystals.js';
import { updateProps } from './entities/props.js';
import { updateWindmills } from './entities/humans.js';
import { updateVehicles } from './entities/vehicles.js';
import { updateUpgradeItems } from './entities/upgradeItems.js';

import { saucer, beamLight, shipLight, glowLight, ebarBG, ebarFill3, updateEnergyBar, updateSaucer, updateShadow } from './systems/saucer.js';
import { NightLights } from './systems/nightlights.js';
import { updateDestruction } from './systems/destruction.js';
import { beam, beamMat, disc, discMat, effBeamR, updateBeamFX, sparks } from './systems/beam.js';
import { updateAbduction } from './systems/abduction.js';
import { buff, updateBuff } from './systems/buffs.js';
import { applyCloakVisual } from './systems/cloak.js';
import { updateCollision } from './systems/collision.js';
import { Special } from './systems/special.js';
import { ModuleIcons } from './systems/moduleIcons.js';
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
import { Ambience } from './audio/ambience.js';
import { buildings, vehicles, animals } from './entities/registry.js';
import { nearestTown } from './world/settlements.js';

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
import { Tutorial } from './systems/tutorial.js';
import { Intro } from './systems/intro.js';
import { renderWaypoints, clearWaypoints } from './systems/waypoints.js';
import { HULL_DROP, FLY_CLEAR, POWER_MIN } from './core/constants.js';
import { FlightModel } from './systems/flight.js';
import { resetFlightInput } from './systems/flight-input.js';

/* One "you haven't got that yet" message per few seconds per module, so holding
   the control is a single line rather than a strobe. */
const _lockT={};
function lockedHint(which){
  const now=performance.now();
  if(_lockT[which]&&now-_lockT[which]<3200)return;
  _lockT[which]=now;
  banner(tr('upg.locked.'+which));   // `t` is local time in animate(); tr is i18n
}
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

/* ---- ambience context ----------------------------------------------------
   What the soundscape needs to know about the world under the ship. The terrain
   sample, the road distance and the two proximity counts are far too expensive
   to redo every frame and change far too slowly to need to be — so they refresh
   on a timer and the audio layers ramp between values smoothly regardless. */
const ambCtx={agl:HOVER_BASE,dayF:1,biome:'plains',weather:'clear',world:'earth',
              roadD:999,cars:0,houses:0,dHouse:999,speed:0,groundY:0,emit:[]};
/* Nearby sound sources, nearest first: {k: kind, d: distance, pan: -1..1}.
   The ambience picks real emitters out of this list and attenuates each by its
   own distance, so a flock you fly over bleats and then falls behind while
   whatever is ahead fades up. Reused in place — no per-scan allocation. */
const EMIT_R=210;
const emitPool=[];
for(let i=0;i<14;i++)emitPool.push({k:'',d:0,pan:0});
function collectEmitters(x,z){
  const list=ambCtx.emit; list.length=0;
  // Pan is the source's bearing projected onto the ship's right vector, so a
  // sheep off the starboard wing is heard on the right and swings across as the
  // ship turns. (0,0,-1) rotated by yaw is forward, so right is (cos, -sin).
  const cy=Math.cos(S.yaw), sy=Math.sin(S.yaw);
  let n=0;
  const add=(k,px,pz)=>{
    if(n>=emitPool.length)return;
    const dx=px-x, dz=pz-z;
    const d2=dx*dx+dz*dz;
    if(d2>EMIT_R*EMIT_R)return;
    const d=Math.sqrt(d2)||0.001;
    const e=emitPool[n++];
    e.k=k; e.d=d; e.pan=Math.max(-1,Math.min(1,(dx*cy-dz*sy)/d));
    list.push(e);
  };
  for(const a of animals){
    const nm=a.userData&&a.userData.name;
    if(!nm)continue;
    add(nm==='Hiker'||nm==='Villager'?'human':nm, a.position.x, a.position.z);
  }
  for(const v of vehicles)add('car', v.position.x, v.position.z);
  list.sort((p,q)=>p.d-q.d);
}
let ambT=0;
function updateAmbCtx(dt){
  ambCtx.dayF=S.dayF; ambCtx.weather=weather.cur;
  ambCtx.world=World.name; ambCtx.speed=flight.speed;
  // S.agl is only maintained while playing; elsewhere (the intro film, a crash)
  // derive it from the last sampled ground height.
  ambCtx.agl=S.state==='playing'?S.agl:Math.max(0,saucer.position.y-ambCtx.groundY);
  ambT-=dt;
  if(ambT>0)return;
  ambT=0.45;
  const x=saucer.position.x, z=saucer.position.z;
  ambCtx.groundY=groundAt(x,z);
  ambCtx.biome=sample(x,z).biome;
  ambCtx.roadD=roadDist(x,z);
  let cars=0,houses=0,dHouse=999;
  for(const v of vehicles){ const dx=v.position.x-x, dz=v.position.z-z;
    if(dx*dx+dz*dz<170*170)cars++; }
  for(const b of buildings){ const dx=b.position.x-x, dz=b.position.z-z;
    const d2=dx*dx+dz*dz;
    if(d2<150*150)houses++;
    if(d2<dHouse*dHouse)dHouse=Math.sqrt(d2);
  }
  // A village or city is a much stronger "people live here" cue than a lone
  // barn, and it comes from the settlement field rather than the batched meshes.
  const town=nearestTown(x,z);
  if(town.d<dHouse)dHouse=town.d;
  if(town.d<150)houses+=5;
  ambCtx.cars=cars; ambCtx.houses=houses; ambCtx.dHouse=dHouse;
  collectEmitters(x,z);
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
    /* THE MODULES ACTUALLY GATE THE SHIP NOW. They used to cost only an extra
       trickle of energy, which made "your ship came down incomplete" a line of
       flavour text rather than a fact — a player who skipped the tutorial could
       do everything on the first night. Without the tractor beam there is no
       beam; without thrusters there is no climb; the cloak was already gated in
       toggleCloak. Each refusal says which module is missing, throttled so
       holding the key is one message rather than sixty a second. */
    const beamTry=input.beamHold||held('beam');
    const beamWant=beamTry&&S.upHasBeam;
    if(beamTry)ModuleIcons.ping('beam','try');   // no-op once the beam is aboard
    if(beamTry&&!S.upHasBeam)lockedHint('beam');
    const beamOn=beamWant||Special.active;   // the mass pull is its own thing
    /* The beam used to break cloak outright — "you cannot feed while
       invisible". That rule is gone, because it made the interesting move
       impossible: sliding over a town unseen and taking someone before anyone
       looks up. Cloaked feeding now works, and it PARALYSES rather than
       panicking (see updateHuman) — nothing announced itself, the light simply
       arrived, and you do not run from something you cannot see. */
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
    if(prevState!=='playing'){ flight.reset(saucer.position); flight.yaw=S.yaw; camRig.reset(); resetFlightInput(); }
    const fin=flightInputFrom(input,held,dt);
    const speedMult=(S.upSpeed||1)*(beamOn?BEAM_MOVE:1)*(buff==='speed'?1.6:1)*(World.name==='moon'?1.4:1)*(1.2-0.35*S.dayF);
    flight.f.acceleration=ACCEL_BASE*speedMult;
    // While beaming, hard-cap top speed too — low accel alone still lets built-up
    // momentum coast the ship off the target, so clamp maxSpeed to a crawl.
    flight.f.maxSpeed=beamOn?MAXSPEED_BASE*BEAM_MAXSPEED:MAXSPEED_BASE;
    // Free flight, but never sink through the ground: a per-frame soft floor at the
    // terrain (crash-on-contact for flying INTO a rise is still handled below).
    const ghPre=Math.max(heightAt(flight._base.x,flight._base.z),roadHeightAt(flight._base.x,flight._base.z));
    flight.f.floorY=ghPre+HULL_DROP+FLY_CLEAR;   // clearance under the HULL, not the origin
    // Mobile auto-level: on touch devices, climb/dive is done by pitching with the
    // left stick's vertical. The moment that input is released, ease the nose back
    // to horizontal — quickly but smoothly — so the ship settles into level flight
    // instead of holding a climb/dive angle. (PC keeps its mouse-look pitch.)
    if(TOUCH_ONLY && Math.abs(input.lookStickY)<0.02 && Math.abs(flight.pitch)>0.004){
      flight.pitch-=flight.pitch*Math.min(1,dt*1.5);    // soft: τ≈0.67s → eases level over ~2s
      if(Math.abs(flight.pitch)<0.004)flight.pitch=0;
    }
    /* THE REST OF THE ARRIVAL. The film ends with the ship still well above its
       hover height (see systems/intro.js) and this flies the last stretch down
       under live control, so the opening seconds of a run read as the mothership
       still lowering you rather than as a cut to a parked saucer.

       An exponential ease, not a linear one — it arrives asymptotically and so
       has no moment where the descent visibly stops. Any climb or dive input
       cancels it outright: the instant the player reaches for the controls they
       own the ship, and a scripted animation that fights them would feel broken. */
    if(S.descendT>0){
      // RAW, not the smoothed value: the eased command coasts for about a
      // second after the finger lifts and would cancel the arrival by itself.
      if(Math.abs(fin.verticalRaw||0)>0.02||Math.abs(fin.pitchDelta||0)>0.004){ S.descendT=0; }
      else{
        S.descendT=Math.max(0,S.descendT-dt);
        flight._base.y+=(S.descendY-flight._base.y)*(1-Math.exp(-dt*0.85));
        if(flight.velocity.y>0)flight.velocity.y=0;
      }
    }
    /* THE THRUSTERS GATE THE DEDICATED ALTITUDE CONTROL, NOT CLIMBING.

       Only `vertical` is zeroed — the lift slider and Shift/Ctrl. Pitching the
       nose up and pushing forward still climbs, because that comes out of the
       flight model's facing frame (pitchDelta + forward) and never touches this
       axis. That distinction is the whole design: a ship with no thrusters can
       still get up and down by flying like an aircraft, it just cannot hold an
       altitude on a stick. The thrusters are for reaching the modules lying on
       the ground and for convenience — not a licence to leave the deck.

       Do not "fix" this by gating pitch or forward as well. */
    if(Math.abs(fin.verticalRaw||0)>0.02)ModuleIcons.ping('thrusters','try');
    if(!S.upAltitude){
      if(Math.abs(fin.verticalRaw||0)>0.02)lockedHint('alt');
      fin.vertical=0; fin.verticalRaw=0;
    }
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
    S.pitch=flight.pitch;                             // nose angle (read by the tutorial)
    S.vel.x=flight.velocity.x; S.vel.z=flight.velocity.z;
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
    if(saucer.position.y-1.2<hitH&&!S.tutorial){    // no fatal terrain hits in training
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
    // Lock-driven beam FX: brighten + golden tint + ground-ring sweep + rising
    // sparks, eased so it fades in/out smoothly (S.beamLock is last frame's value,
    // set by updateAbduction below — a 1-frame lag is imperceptible).
    const uLock=lerp(beamMat.uniforms.uLock.value,beamOn?S.beamLock:0,Math.min(1,dt*6));
    beamMat.uniforms.uLock.value=uLock;discMat.uniforms.uLock.value=uLock;
    updateBeamFX(dt,saucer.position.x,saucer.position.z,groundY,saucer.position.y-1,eR*(0.55+0.45*bp),bvis,uLock);
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
    // The module glyphs sit above the bar. Fed the ship's ground speed, because
    // the reveal shortens the faster you fly (see moduleIcons.js). Updated
    // BEFORE the bar, which reads their state — the other order showed the bar
    // one frame behind the glyphs and one frame after they went.
    ModuleIcons.update(dt,Math.hypot(flight.velocity.x,flight.velocity.z));
    /* THE BAR IS UP WHEN THE ANSWER MATTERS: while either power is actually
       running, while the reactor is low enough that the next one might not
       start, and alongside the module glyphs — the reactor and the missing
       modules are one subject, and the glyphs already appear at exactly the
       moments a player is thinking about what the ship can and cannot do. */
    updateEnergyBar(dt,S.energyMode==='drain'&&
      (S.cloak||Special.active||S.energy<0.28||ModuleIcons.shown()));

    /* ---- world ---- */
    updateChunks(saucer.position.x,saucer.position.z);
    updateAnimals(dt);

    /* ---- weather ----
       A slow-drifting field over the world, not a timer: see world/weather.js. */
    weather.biome=sample(saucer.position.x,saucer.position.z).biome;
    tickWeather(dt,saucer.position.x,saucer.position.z,weather.biome);
    scene.fog.density=lerp(scene.fog.density,weather.fogTarget,Math.min(1,dt*0.6));
    updateWeatherParticles(dt);

    updateAbduction(dt,WEATHER[weather.cur].mult,beamOn&&bp>0.5);
    setBeamMultHUD(WEATHER[weather.cur].mult*S.beamStr);   // weather x altitude
    updateBuff(dt);
    /* The mass pull IS the beam, used all at once, so the reach that does
       nothing because the beam is still lying out in the grass shows the beam
       glyph. Once the beam is aboard this says nothing, like every other
       working control. */
    const pullTry=input.spHeld||held('pull');
    if(pullTry)ModuleIcons.ping('beam','try');
    Special.update(dt,pullTry,Tutorial.pullTaught());
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
      /* ENERGY IS WHAT THE CLOAK AND THE MASS PULL RUN ON. NOTHING ELSE.

         Flying is free, the ordinary beam is free, and an empty reactor is not
         fatal — it just means the two best tools are offline until you find
         crystals. That is the whole design: running out has to be a LOSS OF
         CAPABILITY the player wants to fix, not a death that ends the run. A
         reactor that kills you makes a player hoard energy and never use the
         powers; one that switches the powers off makes them go looking for
         more.

         The ordinary beam staying free is what makes the recovery possible —
         it is the tool you refuel WITH, so gating it on energy would strand a
         flat ship with no way back. Two earlier rules charged for flying and
         for beaming; both are gone, because both punished the player for the
         act of digging themselves out.

         drainAlt scales it: a power projected from a higher hover costs more. */
      const dr=((S.cloak?1/55:0)+(Special.active?1/45:0))*drainAlt;
      S.energy=Math.max(0,S.energy-dr*dt);
      // tiered low-energy warnings (fire once per threshold as it drops)
      const lvl=S.energy<0.10?3:S.energy<0.25?2:S.energy<0.50?1:0;
      if(lvl>S.warnLevel){
        S.warnLevel=lvl;
        if(lvl===1)banner(tr('banner.energy50'));
        else if(lvl===2){banner(tr('banner.energy25'));beep(330,0.3,0.08);}
        else if(lvl===3){banner(tr('banner.energy10'));beep(220,0.4,0.1);setTimeout(()=>beep(180,0.4,0.1),260);}
      }else if(lvl<S.warnLevel){S.warnLevel=lvl;}   // re-arm after refuelling
      /* Flat: drop the cloak and keep it down. Special.update makes its own
         check, so the mass pull cuts out here too. The ship flies on. */
      if(S.cloak&&S.energy<POWER_MIN)S.cloak=false;
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
    Ambience.setLevel(1);             // the valley, in full
    updateAmbCtx(dt); Ambience.update(dt,ambCtx);
    Tutorial.update(dt);              // optional guided intro (no-op unless active)
    // Draw the direction arrows for everything the systems above marked this
    // frame (story objectives, ship parts, tutorial goals).
    renderWaypoints(camera,saucer.position);

  } else if(S.state==='intro'){
    /* ---- arrival cinematic ----
       The mothership lowers the saucer into the valley. None of the gameplay
       systems tick; the world just lives and breathes underneath, and the film
       hands the camera over to the chase rig exactly where it would have been. */
    clearWaypoints();
    Intro.update(dt);
    updateChunks(saucer.position.x,saucer.position.z);
    dayNightUpdate(dt);
    applyDayNightLight();
    // Held well back so the arrival cue owns the film; it swells to full as the
    // ship settles and the world takes over.
    Ambience.setLevel(0.30);
    updateAmbCtx(dt); Ambience.update(dt,ambCtx);
    beam.visible=disc.visible=false;
    ebarBG.material.opacity=0;ebarFill3.material.opacity=0;
    updateShadow(groundAt);          // the ship's shadow grows on the ground as it descends
    shipLight.position.set(saucer.position.x,saucer.position.y+5.5,saucer.position.z);
    shipLight.intensity=2.3;shipLight.distance=30;
    glowLight.position.set(saucer.position.x,saucer.position.y-1.5,saucer.position.z);
    glowLight.intensity=(0.9+4.2*(1-S.dayF));glowLight.distance=lerp(100,150,1-S.dayF);
    updateAnimals(dt);
    updateProps(dt,false);updateCrystals(dt,false);

  } else if(S.state==='crashing'){
    clearWaypoints();                 // no guidance arrows while going down
    Ambience.setLevel(0.6);           // the world is still there, rushing up
    updateAmbCtx(dt); Ambience.update(dt,ambCtx);
    /* powerless: the ship falls */
    S.vy-=42*dt;
    saucer.position.y+=S.vy*dt;
    saucer.rotation.z+=dt*1.4;saucer.rotation.x+=dt*0.8;
    beam.visible=disc.visible=false;beamLight.intensity=0;sparks.visible=false;
    shipLight.position.set(saucer.position.x,saucer.position.y+5.5,saucer.position.z);
    shipLight.distance=30;
    shipLight.intensity=Math.max(0.15,shipLight.intensity-dt*0.8);  // dying reactor
    glowLight.position.set(saucer.position.x,saucer.position.y-1.5,saucer.position.z);
    glowLight.intensity=Math.max(0,glowLight.intensity-dt*3);       // pool collapses as it falls
    updateEnergyBar(dt,false);
    ModuleIcons.update(dt,0);                // crashing: hides itself on !playing
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
    clearWaypoints();
    Ambience.setLevel(0);             // silence behind the menus
    Ambience.update(dt,ambCtx);
    /* menu / over idle: gentle drift + slow orbit */
    saucer.position.y=40+Math.sin(t*1.2)*0.6;
    saucer.rotation.y+=dt*0.3;
    const gh=heightAt(saucer.position.x,saucer.position.z);
    beam.visible=disc.visible=true;
    beamMat.uniforms.uPow.value=1;discMat.uniforms.uPow.value=1;
    beam.position.set(saucer.position.x,(saucer.position.y-1+gh)/2,saucer.position.z);
    beam.scale.set(8,saucer.position.y-gh-1,8);
    disc.position.set(saucer.position.x,gh+0.15,saucer.position.z);disc.scale.setScalar(8);
    beamMat.uniforms.uLock.value=0;discMat.uniforms.uLock.value=0;
    updateBeamFX(dt,saucer.position.x,saucer.position.z,gh,saucer.position.y-1,8,1,0);
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
  } else {
    // paused / story interstitial: the valley carries on faintly behind the card
    Ambience.setLevel(0.25);
    Ambience.update(dt,ambCtx);
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
