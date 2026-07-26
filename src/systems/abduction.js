/* =========================================================================
   ABDUCTION — the core loop: creatures in the beam build a lock (faster near
   the center, scaled by weather + HUNGER buff); when it fills they're taken.
   ========================================================================= */
import { lerp } from '../core/math.js';
import { WATER_Y } from '../core/constants.js';
import { S } from '../core/state.js';
import { scene } from '../core/engine.js';
import { heightAt } from '../world/terrain.js';
import { animals } from '../entities/registry.js';
import { saucer } from './saucer.js';
import { effBeamR } from './beam.js';
import { buff, grantBuff } from './buffs.js';
import { Special } from './special.js';
import { checkMissions } from './missions.js';
import { Upgrades } from './upgrades.js';
import { beep } from '../audio/music.js';
import { cry } from '../audio/sfx.js';
import { spawnPop } from '../ui/pop.js';
import { scoreV, specV, hTarget, barFill, tName } from '../ui/dom.js';
import { Story } from '../story/story.js';
import { t } from '../i18n.js';

export function updateAbduction(dt,weatherMult,beamOn){
  const bx=saucer.position.x, bz=saucer.position.z;
  const R=beamOn?effBeamR():-1;   // beam off: nothing is in range, locks decay
  let best=null,bestP=0;
  for(let i=animals.length-1;i>=0;i--){
    const a=animals[i];
    if(a.userData.abducting>0){
      a.userData.abducting-=dt;
      const k=1-Math.max(0,a.userData.abducting)/0.8;
      a.position.y=lerp(a.userData.abFromY,saucer.position.y,k);
      a.scale.setScalar(lerp(a.userData.abScale,0.02,k));
      a.rotation.y+=dt*10;
      if(a.userData.abducting<=0){scene.remove(a);animals.splice(i,1);}
      continue;
    }
    const dx=a.position.x-bx, dz=a.position.z-bz;
    const d2=dx*dx+dz*dz;
    const u=a.userData;
    const inBeam=R>0&&a.visible&&!(u.hidden>0)&&d2<R*R;
    if(inBeam){
      if(S.lockTime<=0.001){ triggerAbduct(a); continue; }
      const closeness=1-Math.sqrt(d2)/R;            // 0 at edge, 1 at center
      // S.beamStr falls off with altitude: the same creature takes far longer
      // to lock from a high hover than from a low pass.
      u.progress+=dt*weatherMult*(0.6+1.6*closeness)*(buff==='lock'?2:1)*(S.beamStr||1);
      u.beamLift=Math.min(1,(u.beamLift||0)+dt*1.3);   // slowly drawn ~1m off the ground
      u.panicked=0;                                    // re-arm the release panic
    }else{
      u.progress=0;
      // Beam lost while it was suspended: it drops back down and, panicking, makes
      // a couple of quick bolts away from the ship before it settles.
      if((u.beamLift||0)>0.25 && !u.panicked){
        u.panicked=1;
        if(u.humanKind){ u.fleeT=Math.max(u.fleeT||0,1.3); u.bolt=null; }
        else u.panic=1.1;
      }
      u.beamLift=Math.max(0,(u.beamLift||0)-dt*2.2);   // fall back to the ground
    }
    // Suspend the creature HALFWAY between the ground and the ship while the lock
    // builds (a noticeably high levitation), and let it drop back on release.
    // Overrides the ground y that updateAnimals set earlier this frame.
    const bl=u.beamLift||0;
    if(bl>0.001&&!u.fly){
      const gy=(u.biome==='water')?WATER_Y+0.12:Math.max(heightAt(a.position.x,a.position.z),WATER_Y);
      const mid=(gy+saucer.position.y)*0.5;             // half way up to the ship
      a.position.y=gy+bl*(mid-gy)+Math.sin(performance.now()*0.006+(u.face||0))*0.12*bl;
      a.rotation.y+=dt*bl*1.4;                          // turns gently in the beam
    }
    // lock complete → carry it the rest of the way up (starting from the lifted y)
    if(inBeam && u.progress>=S.lockTime){ triggerAbduct(a); continue; }
    if(u.progress>bestP){bestP=u.progress;best=a;}
  }
  if(best){
    hTarget.classList.add('show');
    barFill.style.width=Math.min(100,best.userData.progress/S.lockTime*100)+'%';
    tName.textContent=t('hud.lock',{name:t('creature.'+best.userData.name),pts:best.userData.pts});
  }else hTarget.classList.remove('show');
}
export function triggerAbduct(a){
  a.userData.abducting=0.8;a.userData.abFromY=a.position.y;a.userData.abScale=a.scale.x;
  a.userData.progress=0;
  const pts=a.userData.pts||1,nm=a.userData.name||'?';
  S.score+=pts; S.taken++;
  const tl=S.tally[nm]||(S.tally[nm]={c:0,p:pts});tl.c++;
  scoreV.textContent=S.score;
  specV.textContent=t('hud.taken',{n:S.taken});
  checkMissions();
  Upgrades.gain(pts);       // every catch feeds the ship-upgrade ladder
  Special.gainAnimal();
  if(Story.active)Story.animalHook(nm);
  if(S.taken%4===0)grantBuff();
  spawnPop(a.position,'+'+pts,t('creature.'+nm));
  cry(nm);
  setTimeout(()=>beep(880,0.14,0.06),160);setTimeout(()=>beep(1320,0.12,0.05),250);
}
