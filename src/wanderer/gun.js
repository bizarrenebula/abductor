/* =========================================================================
   THE PULSE — the wanderer's one answer to a saucer.

   Thrown from the palm (see hand.js): a fast glowing pulse along the view. A pulse that reaches a saucer
   STUNS it: the ship wobbles, drops whatever its beam was holding, and flies
   off for 15–20 s (see saucers.js). Saucers cannot be destroyed.

   Every shot costs pulse-cell energy. Crystals refill it — walk over one to
   pick it up. A very slow trickle recharge stops an empty cell from leaving
   you with nothing at all; crystals are still the real supply.

   Firing gives your position away for a moment even from cover (P.revealT).
   Points come from repelling saucers, nothing else.
   ========================================================================= */
import { THREE } from '../core/three.js';
import { S } from '../core/state.js';
import { scene, camera } from '../core/engine.js';
import { heightAt } from '../world/terrain.js';
import { pickups } from '../entities/registry.js';
import { chunks } from '../world/chunks.js';
import { P } from './player.js';
import { shipsForHit, stunShip } from './saucers.js';
import { updateHand, handEmitPos, showHand, handPrana } from './hand.js';
import { AI } from './saucers.js';
import { addHeat, HEAT_GAIN } from './heat.js';
import { UP } from './shop.js';
import { beep } from '../audio/music.js';
import { sweep, noiseBurst } from '../audio/sfx.js';
import { spawnPop } from '../ui/pop.js';
import { banner } from '../ui/banner.js';
import { scoreV, specV } from '../ui/dom.js';
import { t } from '../i18n.js';

export const GUN={cool:0, empty:false};
const COST_BASE=0.11;       // ~9 shots on a full cell (fewer per shot with the Cell upgrade)
const COOLDOWN_BASE=0.42;
const SPEED=150, LIFE=1.3;
const HIT_R_BASE=7.5;       // generous: a saucer is a big disc, and it moves
/* upgrade-scaled, read live (shop.js) */
export const shotCost=()=>COST_BASE*Math.pow(0.75,UP.cell);
const cooldown=()=>COOLDOWN_BASE*Math.pow(0.78,UP.quick);
const hitR=()=>HIT_R_BASE+2.2*UP.wide;
const REVEAL=1.6;           // seconds your position is given away after a shot
const TRICKLE=1/150;        // cell per second, idle recharge
const CRYSTAL_GAIN=0.35, CRYSTAL_REACH=3.2;
export const REPEL_PTS=10;

/* ---- pulses ---- */
function glowTex(){
  const c=document.createElement('canvas'); c.width=c.height=64; const x=c.getContext('2d');
  const g=x.createRadialGradient(32,32,0,32,32,32);
  g.addColorStop(0,'rgba(255,255,255,1)'); g.addColorStop(0.35,'rgba(150,255,230,0.8)'); g.addColorStop(1,'rgba(80,220,255,0)');
  x.fillStyle=g; x.fillRect(0,0,64,64);
  const tx=new THREE.CanvasTexture(c); tx.encoding=THREE.sRGBEncoding; return tx;
}
const TEX=glowTex();
const shots=[], bursts=[];
function sprite(size,op){
  const s=new THREE.Sprite(new THREE.SpriteMaterial({map:TEX,color:0xaaffee,transparent:true,opacity:op,
    blending:THREE.AdditiveBlending,depthWrite:false}));
  s.scale.set(size,size,1); scene.add(s); return s;
}
const _f=new THREE.Vector3(), _p=new THREE.Vector3(), _q=new THREE.Vector3();

function fire(){
  const free=S.energyMode!=='drain';
  if(!free&&S.energy<shotCost()){
    if(!GUN.empty){ GUN.empty=true; banner(t('w.banner.empty')); }
    beep(140,0.08,0.05); GUN.cool=0.35; return;
  }
  if(!free)S.energy=Math.max(0,S.energy-shotCost());
  GUN.cool=cooldown();
  P.revealT=REVEAL; P.kick=1;
  camera.getWorldDirection(_f);
  handEmitPos(_p);
  const s=sprite(1.4*(1+0.35*UP.wide),1);
  s.position.copy(_p);
  shots.push({s,vx:_f.x*SPEED,vy:_f.y*SPEED,vz:_f.z*SPEED,life:LIFE});
  sweep(900,240,0.22,0.08); noiseBurst(0.12,0.03,'highpass',2000,800,0.7);
}

function burst(pos,size){
  const s=sprite(size*0.3,1); s.position.copy(pos);
  bursts.push({s,t:0,size});
}

/* On-screen? A pop for something behind you would land in a random place. */
function popAt(pos,big,small){
  _q.copy(pos).project(camera);
  if(_q.z<1&&Math.abs(_q.x)<1.1&&Math.abs(_q.y)<1.1)spawnPop(pos,big,small);
}

export function updateGun(dt,fireHeld){
  GUN.cool=Math.max(0,GUN.cool-dt);
  if(fireHeld&&GUN.cool<=0&&!P.inBarn)fire();
  if(S.energyMode==='drain')S.energy=Math.min(1,S.energy+TRICKLE*dt);
  if(S.energy>=shotCost())GUN.empty=false;

  // the hand: thrust on the shot, curl while recharging, sway with the walk
  const ready=GUN.cool<=0&&(S.energyMode!=='drain'||S.energy>=shotCost());
  const spd=Math.hypot(P.vx,P.vz);
  updateHand(dt,{kick:P.kick,ready,empty:S.energyMode==='drain'&&S.energy<shotCost(),
    beamed:AI.playerLock,inside:!!P.inBarn,bob:P.bob,bobA:Math.min(1,spd/9)*0.09});

  const ships=shipsForHit();
  for(let i=shots.length-1;i>=0;i--){
    const sh=shots[i];
    sh.life-=dt;
    const steps=3;                                       // sub-step so a fast pulse cannot skip a ship
    let hit=null, dead=sh.life<=0;
    for(let k=0;k<steps&&!hit&&!dead;k++){
      sh.s.position.x+=sh.vx*dt/steps; sh.s.position.y+=sh.vy*dt/steps; sh.s.position.z+=sh.vz*dt/steps;
      const p=sh.s.position;
      for(const s of ships){
        const dx=p.x-s.x, dy=(p.y-s.y)*1.6, dz=p.z-s.z;
        const HR=hitR();
        if(dx*dx+dy*dy+dz*dz<HR*HR){ hit=s; break; }
      }
      if(!hit&&p.y<heightAt(p.x,p.z))dead=true;
    }
    if(hit){
      const r=stunShip(hit);
      burst(sh.s.position,14);
      if(r){
        S.score+=REPEL_PTS; S.repels=(S.repels||0)+1;
        addHeat(HEAT_GAIN.repel+(r.saved?HEAT_GAIN.save:0));   // fighting back gets you noticed
        scoreV.textContent=S.score;
        specV.textContent=t('w.hud.repels',{n:S.repels});
        _p.set(hit.x,hit.y,hit.z);
        popAt(_p,'+'+REPEL_PTS,r.saved?t('w.pop.saved'):t('w.pop.repelled'));
        sweep(300,90,0.5,0.1); beep(660,0.1,0.05); setTimeout(()=>beep(990,0.12,0.05),90);
      }else beep(240,0.06,0.04);                        // already reeling
      scene.remove(sh.s); sh.s.material.dispose(); shots.splice(i,1); continue;
    }
    if(dead){ burst(sh.s.position,3); scene.remove(sh.s); sh.s.material.dispose(); shots.splice(i,1); continue; }
    sh.s.material.opacity=Math.min(1,sh.life*3);
  }
  for(let i=bursts.length-1;i>=0;i--){
    const b=bursts[i]; b.t+=dt*2.6;
    const k=Math.min(1,b.t);
    b.s.scale.setScalar(b.size*(0.3+0.9*k));
    b.s.material.opacity=1-k;
    if(k>=1){ scene.remove(b.s); b.s.material.dispose(); bursts.splice(i,1); }
  }

  // ---- crystals: walk over one to refill the cell ----
  for(let i=pickups.length-1;i>=0;i--){
    const p=pickups[i];
    const dx=p.position.x-P.x, dz=p.position.z-P.z;
    if(dx*dx+dz*dz>CRYSTAL_REACH*CRYSTAL_REACH||Math.abs(p.position.y-P.y)>4)continue;
    S.energy=Math.min(1,S.energy+CRYSTAL_GAIN); S.crystals=(S.crystals||0)+1; handPrana();
    popAt(p.position,'+'+Math.round(CRYSTAL_GAIN*100)+'%',t('w.pop.cell'));
    beep(1046,0.1,0.05); setTimeout(()=>beep(1568,0.14,0.05),90);
    scene.remove(p); pickups.splice(i,1);
    for(const [k,c] of chunks){ const j=c.pickups.indexOf(p); if(j>=0){ c.pickups.splice(j,1); break; } }
  }
}

export function showGun(on){ showHand(on); }
export function clearShots(){
  for(const sh of shots){ scene.remove(sh.s); sh.s.material.dispose(); }
  for(const b of bursts){ scene.remove(b.s); b.s.material.dispose(); }
  shots.length=0; bursts.length=0; GUN.cool=0; GUN.empty=false;
}
