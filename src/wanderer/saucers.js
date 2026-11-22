/* =========================================================================
   AI SAUCERS — the harvest, seen from the ground.

   A handful of saucers work the land around the wanderer. Each one runs a small
   state machine:

     roam     drift near the player looking for something to take
     chase    fly at a chosen target (an animal, a villager — or you)
     beam     hold over it; a lock builds, the target rises toward the hull
     search   lost sight of you (you took cover): circle where you were
     stunned  hit by a pulse: wobbles, drops whatever it held
     retreat  flies off and climbs for ~15–20 s, then comes back angrier
     leave    took something: climbs away, and a fresh ship arrives later

   The beam on a creature is the same lock idea the player saucer uses — the
   lock fills, the creature lifts and shrinks toward the hull, and a full lock
   takes it. On the wanderer it is a LOCK the HUD shows: step out of the beam,
   reach cover or pulse the ship to break it. A full lock is an abduction.

   Saucers are clones of the player's saucer model (whatever loaded: GLB or the
   procedural disc), and their beams are clones of the player's beam with their
   own materials so each glows independently.
   ========================================================================= */
import { THREE } from '../core/three.js';
import { S } from '../core/state.js';
import { scene } from '../core/engine.js';
import { WATER_Y } from '../core/constants.js';
import { heightAt } from '../world/terrain.js';
import { animals } from '../entities/registry.js';
import { saucer, beamLight, shipLight } from '../systems/saucer.js';
import { beam, disc } from '../systems/beam.js';
import { threats } from './threats.js';
import { P, playerVisible } from './player.js';
import { BeamSFX, cry } from '../audio/sfx.js';
import { beep } from '../audio/music.js';
import { spawnPop } from '../ui/pop.js';
import { t } from '../i18n.js';
import { H, addHeat, HEAT_GAIN, tune } from './heat.js';

export const AI={
  max:3,                      // live saucers at the start; heat raises it (heat.js)
  nearBeam:1e9,               // distance to the nearest open beam (for heat decay)
  playerLock:0,               // 0..1, the strongest lock any saucer has on you
  abducted:false,             // set the frame a lock on you completes
};

const CRUISE=20, BEAM_ALT=13;          // height above ground: cruising / beaming
const SPD_ROAM=9, SPD_CHASE=15, SPD_HUNT=10.5, SPD_RETREAT=26;
const BEAM_R=5.2;                      // ground radius of an AI beam
const TRACK=3.4;                       // how fast a beaming ship follows its target (u/s)
const LOCK_T={animal:4.2, human:5.2, player:4.4};
const SIGHT=95;                        // how far a saucer notices the wanderer in the open
const STUN_T=1.3;

const ships=[];
const _v=new THREE.Vector3();

/* ---- building a ship ---- */
function cloneMats(root,list){
  root.traverse(o=>{ if(o.material&&o.material.uniforms){ o.material=o.material.clone(); list.push(o.material); } });
}
function makeShip(){
  const g=saucer.clone(true);
  g.visible=true;
  g.rotation.set(0,0,0);
  scene.add(g);
  const mats=[];
  const b=beam.clone(true); cloneMats(b,mats); scene.add(b);
  const dd=disc.clone(true); cloneMats(dd,mats); scene.add(dd);
  b.visible=dd.visible=false;
  // searchlight (heat stage 2+): a pale cone from the hull to a sweeping spot
  const cg=new THREE.CylinderGeometry(0.35,3.6,1,18,1,true); cg.translate(0,-0.5,0); cg.rotateX(-Math.PI/2);
  const cone=new THREE.Mesh(cg,new THREE.MeshBasicMaterial({color:0xfff4d0,transparent:true,opacity:0,
    blending:THREE.AdditiveBlending,depthWrite:false,side:THREE.DoubleSide}));
  const spot=new THREE.Mesh(new THREE.CircleGeometry(4.2,28).rotateX(-Math.PI/2),new THREE.MeshBasicMaterial({color:0xfff0c0,
    transparent:true,opacity:0,blending:THREE.AdditiveBlending,depthWrite:false}));
  cone.frustumCulled=spot.frustumCulled=false; cone.visible=spot.visible=false;
  scene.add(cone); scene.add(spot);
  return {g,b,d:dd,mats,cone,spot,sl:0,slA:Math.random()*6.28,slT:0,x:0,y:0,z:0,vx:0,vz:0,
    state:'roam',timer:0,target:null,kind:'',prog:0,pow:0,
    stunT:0,aggro:false,lx:0,lz:0,thinkT:0,spin:Math.random()*6,wob:0,wx:0,wz:0,away:0};
}

function placeFar(s){
  const a=Math.random()*Math.PI*2, d=140+Math.random()*80;
  s.x=P.x+Math.sin(a)*d; s.z=P.z+Math.cos(a)*d;
  s.y=Math.max(heightAt(s.x,s.z),WATER_Y)+CRUISE+12;
  s.vx=s.vz=0; s.state='roam'; s.timer=0; s.target=null; s.prog=0; s.pow=0;
  s.stunT=0; s.thinkT=Math.random(); s.away=0;
  pickWander(s);
}
function pickWander(s){
  // somewhere 40–110 units from the wanderer, so the harvest happens where you can see it
  const a=Math.random()*Math.PI*2, d=40+Math.random()*70;
  s.wx=P.x+Math.sin(a)*d; s.wz=P.z+Math.cos(a)*d;
}

export function startSaucers(){
  stopSaucers();
  for(let i=0;i<AI.max;i++){ const s=makeShip(); ships.push(s); placeFar(s); }
  AI.playerLock=0; AI.abducted=false;
}
export function stopSaucers(){
  for(const s of ships){
    releaseTarget(s);
    disposeShip(s);
  }
  ships.length=0; threats.n=0;
  AI.playerLock=0;
  BeamSFX.stop(); sfxOn=false;
}

function disposeShip(s){
  scene.remove(s.g); scene.remove(s.b); scene.remove(s.d); scene.remove(s.cone); scene.remove(s.spot);
  for(const m of s.mats)m.dispose();
  s.cone.geometry.dispose(); s.cone.material.dispose(); s.spot.geometry.dispose(); s.spot.material.dispose();
}

/* ---- targets ---- */
const claimed=new Set();
function validCreature(a){
  if(!a||!a.parent)return false;                       // chunk unloaded, or taken
  const u=a.userData;
  if(u.abducting>0||u.hidden>0||!a.visible)return false;
  if(u.fly)return false;                               // birds are too quick for the harvest
  return true;
}
function targetPos(s){
  if(s.kind==='player')return {x:P.x,z:P.z};
  return s.target.position;
}
function chooseTarget(s){
  const pv=playerVisible();
  const dP=Math.hypot(P.x-s.x,P.z-s.z);
  // A saucer that was shot comes back for the shooter.
  const sight=tune.sight();
  if(pv&&dP<(s.aggro?sight*1.6:sight)&&(s.aggro||Math.random()<tune.huntChance())){
    s.kind='player'; s.target=null; s.state='chase'; return true;
  }
  // Prefer what is near the wanderer: the harvest should happen where you can
  // see it and get to it, not over the horizon.
  let best=null,bs=1e9;
  for(const a of animals){
    if(claimed.has(a)||!validCreature(a))continue;
    const d=Math.hypot(a.position.x-s.x,a.position.z-s.z);
    if(d>160)continue;
    const dp=Math.hypot(a.position.x-P.x,a.position.z-P.z);
    if(dp>170)continue;
    const sc=d+dp*1.6;
    if(sc<bs){bs=sc;best=a;}
  }
  if(best){ s.kind=best.userData.humanKind?'human':'animal'; s.target=best; claimed.add(best); s.state='chase'; return true; }
  return false;
}
function releaseTarget(s,dropFrom){
  const a=s.target;
  if(a){
    claimed.delete(a);
    const u=a.userData;
    if(u.aiHeld){
      u.aiHeld=false;
      if(u.aiScale0!=null){ a.scale.setScalar(u.aiScale0); u.aiScale0=null; }
      u.aiLift=0;
      if(a.parent){                                     // drop it: it lands and bolts away
        const gy=u.biome==='water'?WATER_Y+0.12:Math.max(heightAt(a.position.x,a.position.z),WATER_Y);
        a.position.y=gy;
        u.panicSrc={x:s.x,z:s.z};
        if(u.humanKind){ u.fleeT=Math.max(u.fleeT||0,2.2); u.bolt=null; }
        else u.panic=1.3;
      }
    }
  }
  s.target=null; s.kind=''; s.prog=0;
}

/* ---- public: hit by a pulse ---- */
export function shipsForHit(){ return ships; }
export function stunShip(s){
  if(s.state==='stunned'||s.state==='retreat'||s.state==='leave')return false;
  const wasHolding=s.state==='beam'&&s.prog>0.05;
  releaseTarget(s);
  s.state='stunned'; s.stunT=STUN_T; s.aggro=true;
  const rt=tune.retreat();
  s.timer=rt[0]+Math.random()*(rt[1]-rt[0]);           // how long it stays away (shorter at high heat)
  return {saved:wasHolding};
}

/* ---- per frame ---- */
let sfxOn=false, fleetT=0;
export function updateSaucers(dt,time){
  let lockP=0, nearBeam=1e9, nearBeamShip=null, nearShip=null, nearD=1e9;
  AI.abducted=false;
  for(let i=0;i<ships.length;i++){
    const s=ships[i];
    const gy=Math.max(heightAt(s.x,s.z),WATER_Y);
    let tx=s.x, tz=s.z, spd=SPD_ROAM, alt=CRUISE;
    s.thinkT-=dt;
    const active=s.state!=='stunned'&&s.state!=='retreat'&&s.state!=='leave';
    // every saucer that can see you in the open makes the harvest more aware of you
    if(active&&playerVisible()&&Math.hypot(P.x-s.x,P.z-s.z)<tune.sight())addHeat(HEAT_GAIN.seenPerSec*dt);

    if(s.state==='roam'){
      tx=s.wx; tz=s.wz;
      if(Math.hypot(s.x-P.x,s.z-P.z)>110)spd=SPD_CHASE+3;   // far out: close in quickly
      if(s.dismiss){ s.state='leave'; s.timer=6; }
      if(Math.hypot(s.wx-s.x,s.wz-s.z)<8||Math.hypot(s.wx-P.x,s.wz-P.z)>160)pickWander(s);
      if(s.thinkT<=0){ s.thinkT=0.8+Math.random()*0.6; chooseTarget(s); }
    }
    else if(s.state==='chase'){
      if(s.kind==='player'){
        if(!playerVisible()){ s.state='search'; s.timer=4+Math.random()*2; s.lx=P.x; s.lz=P.z; s.kind=''; }
        else { tx=P.x; tz=P.z; spd=SPD_HUNT*tune.speed(); s.lx=P.x; s.lz=P.z; }
      }else if(!validCreature(s.target)){ releaseTarget(s); s.state='roam'; }
      else { tx=s.target.position.x; tz=s.target.position.z; spd=SPD_CHASE*tune.speed(); }
      if(s.state==='chase'){
        alt=BEAM_ALT+3;
        if(Math.hypot(tx-s.x,tz-s.z)<3){ s.state='beam'; s.prog=0; }
      }
    }
    else if(s.state==='beam'){
      alt=BEAM_ALT;
      const player=s.kind==='player';
      const ok=player?true:validCreature(s.target);
      if(!ok){ releaseTarget(s); s.state='roam'; }
      else{
        const tp=targetPos(s);
        const d=Math.hypot(tp.x-s.x,tp.z-s.z);
        // drift after the target at a walking pace: you can walk out of it, slowly
        const k=Math.min(1,TRACK*dt/Math.max(d,0.001));
        s.x+=(tp.x-s.x)*k; s.z+=(tp.z-s.z)*k; tx=s.x; tz=s.z;
        s.vx*=0.85; s.vz*=0.85;
        const inside=d<BEAM_R&&(!player||playerVisible());
        const LT=LOCK_T[s.kind]||4.5;
        if(inside){
          s.prog+=dt/LT*(0.65+0.7*(1-d/BEAM_R));         // faster at the beam's heart
          if(!player){
            const u=s.target.userData;
            u.aiHeld=true; u.hop=null; u.phase='idle'; u.fleeT=0;
            if(u.aiScale0==null)u.aiScale0=s.target.scale.x;
          }
        }else{
          s.prog-=dt*(player?0.9:0.6);
          if(player&&!playerVisible()){ s.prog-=dt*2; }
          if(!player&&s.target.userData.aiHeld&&s.prog<0.05)releaseTarget(s);
          if(s.prog<=0){
            s.prog=0;
            if(player){ s.state=playerVisible()?'chase':'search'; s.timer=4; s.lx=P.x; s.lz=P.z; if(s.state==='chase')s.kind='player'; else s.kind=''; }
            else if(s.target){ s.state='chase'; }
            else s.state='roam';
          }
        }
        if(s.state==='beam'&&player){ lockP=Math.max(lockP,s.prog); if(inside)addHeat(HEAT_GAIN.beamPerSec*dt); }
        if(s.state==='beam'&&s.prog>=1){
          if(player){ AI.abducted=true; }
          else takeCreature(s);
        }
      }
    }
    else if(s.state==='search'){
      s.timer-=dt;
      const a=time*0.9+i;
      tx=s.lx+Math.sin(a)*14; tz=s.lz+Math.cos(a)*14; spd=7; alt=CRUISE-2;
      if(playerVisible()&&Math.hypot(P.x-s.x,P.z-s.z)<SIGHT*0.8){ s.kind='player'; s.state='chase'; }
      else if(s.timer<=0){ s.state='roam'; pickWander(s); }
    }
    else if(s.state==='stunned'){
      s.stunT-=dt;
      s.vx*=0.9; s.vz*=0.9; tx=s.x; tz=s.z; alt=CRUISE;
      if(s.stunT<=0){ s.state='retreat'; }
    }
    else if(s.state==='retreat'){
      s.timer-=dt;
      let ax=s.x-P.x, az=s.z-P.z; const l=Math.hypot(ax,az)||1;
      tx=s.x+ax/l*50; tz=s.z+az/l*50; spd=SPD_RETREAT; alt=CRUISE+30;
      if(l>320){ tx=s.x; tz=s.z; }                       // far enough: hang there
      if(s.timer<=0){ s.state='roam'; pickWander(s); s.thinkT=0.5; }
    }
    else if(s.state==='leave'){
      s.timer-=dt;
      let ax=s.x-P.x, az=s.z-P.z; const l=Math.hypot(ax,az)||1;
      tx=s.x+ax/l*50; tz=s.z+az/l*50; spd=SPD_RETREAT; alt=CRUISE+60;
      if(s.timer<=0){ if(s.dismiss)s.gone=true; else placeFar(s); }
    }

    // ---- fly ----
    if(s.state!=='beam'){
      let dx=tx-s.x, dz=tz-s.z; const dl=Math.hypot(dx,dz);
      const want=dl>0.5?Math.min(spd,dl*1.5):0;
      const dvx=dl>0.001?dx/dl*want:0, dvz=dl>0.001?dz/dl*want:0;
      const k=Math.min(1,dt*1.8);
      s.vx+=(dvx-s.vx)*k; s.vz+=(dvz-s.vz)*k;
      s.x+=s.vx*dt; s.z+=s.vz*dt;
    }
    // keep ships apart so two never stack on one sheep
    for(let j=0;j<ships.length;j++){
      if(j===i)continue; const o=ships[j];
      const dx=s.x-o.x, dz=s.z-o.z, d2=dx*dx+dz*dz;
      if(d2<16*16&&d2>1e-4){ const d=Math.sqrt(d2), p=(16-d)*0.5*dt*3; s.x+=dx/d*p; s.z+=dz/d*p; }
    }
    const gy2=Math.max(heightAt(s.x,s.z),WATER_Y);
    const ty=gy2+alt;
    s.y+=(ty-s.y)*Math.min(1,dt*(s.state==='beam'?1.6:0.9));
    if(s.y<gy2+8)s.y=gy2+8;

    // ---- look ----
    s.spin+=dt*(s.state==='stunned'?9:0.7);
    s.g.position.set(s.x,s.y+(s.state==='stunned'?Math.sin(time*23)*0.5:Math.sin(time*1.3+i)*0.4),s.z);
    const bank=s.state==='stunned'?Math.sin(time*17)*0.35:0;
    s.g.rotation.set(Math.max(-0.3,Math.min(0.3,s.vz*0.012))+bank, s.spin, Math.max(-0.3,Math.min(0.3,-s.vx*0.012))+bank*0.7);

    // ---- beam visuals ----
    s.pow+=((s.state==='beam'?1:0)-s.pow)*Math.min(1,dt*6);
    const on=s.pow>0.02;
    s.b.visible=s.d.visible=on;
    if(on){
      const top=s.y-1, h=top-gy2, R=BEAM_R*(0.6+0.4*s.pow);
      s.b.position.set(s.x,(top+gy2)/2,s.z); s.b.scale.set(R,h,R);
      s.d.position.set(s.x,gy2+0.15,s.z); s.d.scale.setScalar(R);
      for(const m of s.mats){ m.uniforms.uTime.value=time; m.uniforms.uPow.value=s.pow; m.uniforms.uLock.value=Math.min(1,s.prog); }
    }

    // ---- searchlight (heat stage 2+) ----
    const slOn=tune.searchlights()&&(s.state==='roam'||s.state==='search'||(s.state==='chase'&&s.kind!=='player'));
    s.sl+=((slOn?1:0)-s.sl)*Math.min(1,dt*2);
    s.cone.visible=s.spot.visible=s.sl>0.02;
    if(s.sl>0.02){
      s.slA+=dt*(s.state==='search'?1.6:0.9);
      const R=s.state==='search'?10:16+6*Math.sin(time*0.37+i);
      const sx=s.x+Math.cos(s.slA)*R, sz=s.z+Math.sin(s.slA)*R;
      const sy=Math.max(heightAt(sx,sz),WATER_Y);
      s.spot.position.set(sx,sy+0.2,sz);
      s.spot.material.opacity=0.32*s.sl;
      s.cone.position.set(s.x,s.y-1.2,s.z);
      _v.set(sx,sy,sz); s.cone.lookAt(_v);
      s.cone.scale.set(1,1,Math.hypot(sx-s.x,sy-(s.y-1.2),sz-s.z));
      s.cone.material.opacity=0.10*s.sl;
      // caught in it: open ground or under a tree (a deck or a roof still hides you)
      s.slT-=dt;
      if(s.sl>0.6&&s.slT<=0&&Math.hypot(P.x-sx,P.z-sz)<4.6&&(P.cover===null||P.cover==='tree')){
        s.slT=2.5; P.revealT=Math.max(P.revealT,1.6); addHeat(HEAT_GAIN.spotlit);
        releaseTarget(s); s.kind='player'; s.state='chase'; s.aggro=true;
        beep(880,0.08,0.06); setTimeout(()=>beep(880,0.08,0.06),120);
      }
    }

    // ---- publish for humans / minimap ----
    const th=threats.list[i]||(threats.list[i]={});
    th.x=s.x; th.y=s.y; th.z=s.z; th.beaming=s.state==='beam'; th.stunned=s.state==='stunned'||s.state==='retreat';

    const dP=Math.hypot(s.x-P.x,s.z-P.z);
    if(dP<nearD){nearD=dP;nearShip=s;}
    if(s.state==='beam'&&dP<nearBeam){nearBeam=dP;nearBeamShip=s;}
  }
  // ---- fleet size follows the heat ----
  for(let i=ships.length-1;i>=0;i--)if(ships[i].gone){ releaseTarget(ships[i]); disposeShip(ships[i]); ships.splice(i,1); }
  const want=tune.ships();
  fleetT-=dt;
  const live=ships.filter(s=>!s.dismiss).length;
  if(live<want&&fleetT<=0){ const s=makeShip(); ships.push(s); placeFar(s); fleetT=3+Math.random()*3; }
  else if(live>want&&fleetT<=0){ const s=ships.find(x=>!x.dismiss&&x.state==='roam'); if(s){ s.dismiss=true; fleetT=4; } }
  // a ship added (or removed) above has no up-to-date entry yet: write them all
  for(let i=0;i<ships.length;i++){
    const sh=ships[i], th=threats.list[i]||(threats.list[i]={});
    th.x=sh.x; th.y=sh.y; th.z=sh.z; th.beaming=sh.state==='beam'; th.stunned=sh.state==='stunned'||sh.state==='retreat';
  }
  threats.n=ships.length;
  AI.nearBeam=nearBeam;

  AI.playerLock=lockP;

  // ---- lights: the nearest beam lights the ground, the nearest hull glows ----
  if(nearBeamShip&&nearBeam<120){
    beamLight.position.set(nearBeamShip.x,nearBeamShip.y-4,nearBeamShip.z);
    beamLight.intensity=(1.6+0.3*Math.sin(time*13.7))*nearBeamShip.pow;
    beamLight.distance=60;
  }else beamLight.intensity=0;
  if(nearShip&&nearD<150){
    shipLight.position.set(nearShip.x,nearShip.y-2,nearShip.z);
    shipLight.intensity=1.6; shipLight.distance=34;
  }else shipLight.intensity=0;

  // ---- sound: the hum of the nearest beam ----
  const hum=nearBeamShip?Math.max(0,1-nearBeam/70):0;
  if(hum>0.02&&!sfxOn){ BeamSFX.start(); sfxOn=true; }
  if(hum<=0.02&&sfxOn){ BeamSFX.stop(); sfxOn=false; }
  if(sfxOn)BeamSFX.set(hum);
}

/* Creatures in a beam rise toward the hull and shrink — run AFTER updateAnimals
   so the lift overrides the ground height it set this frame. */
export function liftHeld(dt){
  for(const s of ships){
    if(s.state!=='beam'||!s.target||s.kind==='player')continue;
    const a=s.target, u=a.userData;
    if(!u.aiHeld||!a.parent)continue;
    const l=Math.min(1,s.prog);
    const gy=u.biome==='water'?WATER_Y+0.12:Math.max(heightAt(a.position.x,a.position.z),WATER_Y);
    const top=s.y-2.5;
    a.position.y=gy+l*(top-gy);
    a.position.x+=(s.x-a.position.x)*Math.min(1,dt*l*2);
    a.position.z+=(s.z-a.position.z)*Math.min(1,dt*l*2);
    a.rotation.y+=dt*(0.9+l*1.8);
    a.scale.setScalar(u.aiScale0*(1-0.8*l));
  }
}

function takeCreature(s){
  const a=s.target, u=a.userData;
  claimed.delete(a);
  u.aiHeld=false;
  const i=animals.indexOf(a); if(i>=0)animals.splice(i,1);
  scene.remove(a);
  if(Math.hypot(a.position.x-P.x,a.position.z-P.z)<120){
    spawnPop(a.position,t('w.pop.taken'),t('creature.'+u.name));
    cry(u.name);
    setTimeout(()=>beep(300,0.2,0.05),120);
  }
  s.target=null; s.kind=''; s.prog=0;
  s.state='leave'; s.timer=5+Math.random()*4;
}
