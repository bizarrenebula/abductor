/* =========================================================================
   WANDERER MODE — the game turned over: on foot, under the saucers.

   Entry points used by the rest of the game:
     Wanderer.start()        screens.js, once the world for a run is built
     Wanderer.stop()         screens.js, on game over / back to menu
     Wanderer.update(dt,t)   main.js, every playing frame, BEFORE the world ticks
     Wanderer.afterAnimals() main.js, right after updateAnimals (beam lift)

   The spec is docs/wanderer-mode.md. This first slice covers walking and
   looking, AI saucers, the pulse gun and crystals, being beamed, and hiding.
   Heat, the trek and its save points, and the upgrade shop come next.
   ========================================================================= */
import { S } from '../core/state.js';
import { TOUCH_ONLY } from '../core/env.js';
import { THREE } from '../core/three.js';
import { renderer, camera } from '../core/engine.js';
import { saucer, glowLight, shipLight, beamLight } from '../systems/saucer.js';
import { beam, disc, sparks } from '../systems/beam.js';
import { pollControls, resetControls, W_IN } from './controls.js';
import { P, EYE, resetPlayer, updatePlayer } from './player.js';
import { AI, startSaucers, stopSaucers, updateSaucers, liftHeld } from './saucers.js';
import { GUN, updateGun, showGun, clearShots } from './gun.js';
import { showWanderHUD, drawWanderHUD } from './hud.js';
import { specV } from '../ui/dom.js';
import { Trek, planTrek, buildTrek, clearTrek, updateTrek, trekDistances, respawnSpot, saveReachedFX } from './trek.js';
import { banner } from '../ui/banner.js';
import { H, updateHeat, resetHeat } from './heat.js';
import { UP, resetShop, openShop, closeShop, shopIsOpen, shopButton, onBuy } from './shop.js';
import { saveAt } from './trek.js';
import { shotCost } from './gun.js';
import { keys } from '../core/input.js';
import { t } from '../i18n.js';

let running=false, wasLocked=false, atSave=-1, bWas=false;
const _e=new THREE.Euler(0,0,0,'YXZ');

/* Losing pointer lock mid-run (Esc, alt-tab) pauses, the way any first-person
   game does — otherwise the mouse is free and the run carries on without you. */
document.addEventListener('pointerlockchange',()=>{
  const locked=document.pointerLockElement===renderer.domElement;
  if(running&&wasLocked&&!locked&&S.state==='playing'&&!shopIsOpen())
    dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}));
  wasLocked=locked;
});

export const Wanderer={
  get active(){ return running; },

  start(){
    running=true;
    S.repels=0; S.score=0;
    specV.textContent=t('w.hud.repels',{n:0});
    saucer.visible=false;
    beam.visible=disc.visible=false; sparks.visible=false;
    resetControls();
    // S.yaw faces the ship's nose (+Z rotated); the camera looks down -Z, so turn it round.
    resetPlayer(S.spawnX,S.spawnZ,S.yaw+Math.PI);
    P.takenT=0;
    this.won=false;
    resetHeat();
    resetShop(); onBuy.wind=()=>{ Trek.lives++; };
    atSave=-1;
    startSaucers();
    clearShots();
    showGun(true);
    showWanderHUD(true);
  },

  stop(){
    if(!running)return;
    running=false;
    stopSaucers();
    closeShop(); shopButton(false);
    clearTrek();
    clearShots();
    showGun(false);
    showWanderHUD(false);
    resetControls();
    saucer.visible=true;
    glowLight.intensity=0; shipLight.intensity=0; beamLight.intensity=0;
    if(document.pointerLockElement)document.exitPointerLock();
  },

  update(dt,time){
    pollControls();
    // An AI beam on you drags at your legs: you can still walk out, slowly.
    P.beamSlow=AI.playerLock>0.01?0.6:1;
    updatePlayer(dt);
    updateSaucers(dt,time);
    // the camera lifts and shakes with the lock
    P.lift+=(AI.playerLock-P.lift)*Math.min(1,dt*5);
    updateGun(dt,W_IN.fire);

    // ---- heat: how hard the harvest is looking for you ----
    updateHeat(dt,P.cover,1-S.dayF,AI.nearBeam<60);

    // ---- the trek: save points and the escape door ----
    const ev=updateTrek(dt,time,P);
    if(ev==='won')this.won=true;
    else if(ev!=null){
      saveReachedFX(ev);
      if(S.energyMode==='drain')S.energy=1;          // a save point refills the cell
    }
    // ---- the shop: open on arriving at a save point, close on leaving it ----
    const at=saveAt(P);
    if(at>=0&&atSave<0)openShop();
    if(at<0&&shopIsOpen())closeShop();
    atSave=at;
    const b=!!keys['b'];
    if(b&&!bWas&&at>=0){ if(shopIsOpen())closeShop(); else openShop(); }
    bWas=b;
    shopButton(at>=0);

    beam.visible=disc.visible=false; sparks.visible=false;
    // a small pool of light around you, so the night is walkable
    const night=1-S.dayF;
    glowLight.position.set(P.x,P.y+9,P.z);
    glowLight.intensity=0.2+0.75*night;
    glowLight.distance=40;

    drawWanderHUD({
      energy:S.energyMode==='drain'?S.energy:1,
      cool:GUN.cool>0||(S.energyMode==='drain'&&S.energy<shotCost()),
      cover:P.cover, revealed:P.revealT>0, lock:AI.playerLock,
      nearShelter:!!P.nearShelter, inBarn:!!P.inBarn,
      locked:!!document.pointerLockElement,
      trek:trekDistances(P),
      heat:H.heat, stage:H.stage,
    });
  },

  /* for the end card */
  stats(){
    const d=trekDistances(P);
    return {saves:d.saves,total:d.total,time:S.elapsed-Trek.startT,
      walked:Math.max(0,Trek.routeLen-d.dest)};
  },

  /* ---- one "run it back" from the last save point ---- */
  canRespawn(){ return running&&Trek.lives>0; },
  respawn(){
    Trek.lives--;
    const sp=respawnSpot();
    resetPlayer(sp.x,sp.z,P.yaw);
    if(sp.shelter)P.inBarn=sp.shelter;              // you come to inside the barn
    P.takenT=0; P.lift=0;
    resetHeat(true);                                 // they lose some of their interest too
    startSaucers();                                  // they lose track of you
    if(S.energyMode==='drain')S.energy=Math.max(S.energy,0.6);
    S.state='playing';
    banner(t(Trek.last>=0?'w.banner.respawn':'w.banner.respawnStart'));
  },
  /* plan + build the route; called by startGame before the first chunk */
  plan(){ planTrek(); buildTrek(); },

  afterAnimals(dt){ liftHeld(dt); },

  /* The lock completed: a couple of seconds of being drawn up into the light
     before the game-over card. The saucers keep running so the ship that has
     you holds its beam on you while it happens. */
  taken(dt,time){
    updateSaucers(dt,time);
    P.lift=1;
    P.y+=dt*(4+P.takenT*10); P.takenT=(P.takenT||0)+dt;
    P.pitch+=(1.25-P.pitch)*Math.min(1,dt*2.5);
    camera.position.set(P.x,P.y+EYE,P.z);
    _e.set(P.pitch+Math.sin(time*31)*0.04,P.yaw+Math.sin(time*7)*0.05,Math.sin(time*23)*0.05);
    camera.quaternion.setFromEuler(_e);
    drawWanderHUD({energy:S.energy,cool:true,cover:null,revealed:false,lock:1,nearShelter:false,inBarn:false,locked:true});
  },

  /* true the frame a saucer's lock on you completes */
  abducted(){ return AI.abducted; },
};
