/* =========================================================================
   ABDUCTION — the core loop: creatures in the beam build a lock (faster near
   the center, scaled by weather + HUNGER buff); when it fills they're taken.
   ========================================================================= */
import { lerp } from '../core/math.js';
import { S } from '../core/state.js';
import { scene } from '../core/engine.js';
import { animals } from '../entities/registry.js';
import { saucer } from './saucer.js';
import { effBeamR } from './beam.js';
import { buff, grantBuff } from './buffs.js';
import { Special } from './special.js';
import { checkMissions } from './missions.js';
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
    const inBeam=R>0&&a.visible&&!(a.userData.hidden>0)&&d2<R*R;
    if(inBeam){
      if(S.lockTime<=0.001){ triggerAbduct(a); continue; }
      const closeness=1-Math.sqrt(d2)/R;            // 0 at edge, 1 at center
      // S.beamStr falls off with altitude: the same creature takes far longer
      // to lock from a high hover than from a low pass.
      a.userData.progress+=dt*weatherMult*(0.6+1.6*closeness)*(buff==='lock'?2:1)*(S.beamStr||1);
      if(a.userData.progress>=S.lockTime){ triggerAbduct(a); continue; }
    }else{
      a.userData.progress=0;
    }
    if(a.userData.progress>bestP){bestP=a.userData.progress;best=a;}
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
  Special.gainAnimal();
  if(Story.active)Story.animalHook(nm);
  if(S.taken%4===0)grantBuff();
  spawnPop(a.position,'+'+pts,t('creature.'+nm));
  cry(nm);
  setTimeout(()=>beep(880,0.14,0.06),160);setTimeout(()=>beep(1320,0.12,0.05),250);
}
